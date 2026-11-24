-- Multi-tenant workspaces and reusable auditorium templates.
-- Apply once to the existing Supabase project after taking a database backup.
begin;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 180),
  slug text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.profiles
  add column if not exists full_name text;

-- Existing Espacio Acredita data is preserved in one initial workspace.
do $$
declare
  v_org_id uuid;
  v_owner uuid;
begin
  select id into v_org_id
  from public.organizations
  where slug = 'fundacion-espacio-mejor';

  if v_org_id is null then
    select id into v_owner
    from public.profiles
    order by created_at asc
    limit 1;

    insert into public.organizations(name, slug, created_by)
    values ('Fundación Espacio Mejor', 'fundacion-espacio-mejor', v_owner)
    returning id into v_org_id;
  end if;

  update public.profiles
  set organization_id = v_org_id
  where organization_id is null;
end $$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.current_organization_id() from public, anon;
grant execute on function public.current_organization_id() to authenticated;

-- Add explicit tenant ownership to every tenant-owned table.
alter table public.activities
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.attendees
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.registrations
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.check_ins
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.audit_logs
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

do $$
declare v_org_id uuid;
begin
  select id into v_org_id
  from public.organizations
  where slug = 'fundacion-espacio-mejor';

  update public.activities set organization_id = v_org_id where organization_id is null;
  update public.attendees set organization_id = v_org_id where organization_id is null;
  update public.registrations set organization_id = v_org_id where organization_id is null;
  update public.check_ins set organization_id = v_org_id where organization_id is null;
  update public.audit_logs set organization_id = v_org_id where organization_id is null;
end $$;

alter table public.activities alter column organization_id set default public.current_organization_id();
alter table public.attendees alter column organization_id set default public.current_organization_id();
alter table public.registrations alter column organization_id set default public.current_organization_id();
alter table public.check_ins alter column organization_id set default public.current_organization_id();
alter table public.audit_logs alter column organization_id set default public.current_organization_id();

alter table public.activities alter column organization_id set not null;
alter table public.attendees alter column organization_id set not null;
alter table public.registrations alter column organization_id set not null;
alter table public.check_ins alter column organization_id set not null;
alter table public.audit_logs alter column organization_id set not null;

alter table public.activities
  add column if not exists auditorium_template_id uuid;
alter table public.activities
  add column if not exists seat_numbering_direction text default 'left_to_right'
  check (seat_numbering_direction in ('left_to_right', 'right_to_left'));

create table if not exists public.auditorium_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id()
    references public.organizations(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  layout jsonb not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists auditorium_templates_org_name_unique
  on public.auditorium_templates (organization_id, lower(name));
create index if not exists profiles_organization_id_idx
  on public.profiles(organization_id);

create index if not exists activities_organization_id_idx
  on public.activities(organization_id);
create index if not exists attendees_organization_id_idx
  on public.attendees(organization_id);
create index if not exists registrations_organization_activity_idx
  on public.registrations(organization_id, activity_id);
create index if not exists check_ins_organization_activity_idx
  on public.check_ins(organization_id, activity_id);
create index if not exists audit_logs_organization_created_idx
  on public.audit_logs(organization_id, created_at desc);
create index if not exists auditorium_templates_organization_idx
  on public.auditorium_templates(organization_id);

-- Composite keys ensure that relationships cannot cross workspace boundaries.
alter table public.activities
  add constraint activities_id_organization_unique unique (id, organization_id);
alter table public.attendees
  add constraint attendees_id_organization_unique unique (id, organization_id);
alter table public.registrations
  add constraint registrations_id_organization_unique unique (id, organization_id);
alter table public.auditorium_templates
  add constraint auditorium_templates_id_organization_unique unique (id, organization_id);

alter table public.registrations
  add constraint registrations_activity_organization_fk
  foreign key (activity_id, organization_id)
  references public.activities(id, organization_id) on delete restrict;
alter table public.registrations
  add constraint registrations_attendee_organization_fk
  foreign key (attendee_id, organization_id)
  references public.attendees(id, organization_id) on delete restrict;
alter table public.activities
  add constraint activities_auditorium_organization_fk
  foreign key (auditorium_template_id, organization_id)
  references public.auditorium_templates(id, organization_id) on delete restrict;
alter table public.check_ins
  add constraint check_ins_registration_organization_fk
  foreign key (registration_id, organization_id)
  references public.registrations(id, organization_id) on delete restrict;
alter table public.check_ins
  add constraint check_ins_activity_organization_fk
  foreign key (activity_id, organization_id)
  references public.activities(id, organization_id) on delete restrict;

-- Seed the existing 255-seat UAI auditorium as a reusable template.
do $$
declare
  v_org_id uuid;
  v_template_id uuid;
  v_layout jsonb := $layout$
  {
    "version": 1,
    "stage_label": "ESCENARIO",
    "aisle_label": "PASILLO",
    "numbering_direction": "left_to_right",
    "rows": [
      {"label":"1","sections":[{"label":"Único","seats":21}]},
      {"label":"2","sections":[{"label":"Único","seats":21}]},
      {"label":"3","sections":[{"label":"Único","seats":21}]},
      {"label":"4","sections":[{"label":"Único","seats":21}]},
      {"label":"5","sections":[{"label":"Único","seats":21}]},
      {"label":"6","sections":[{"label":"Único","seats":21}]},
      {"label":"7","sections":[{"label":"Izquierda","seats":15},{"label":"Derecha","seats":9}]},
      {"label":"8","sections":[{"label":"Izquierda","seats":14},{"label":"Derecha","seats":9}]},
      {"label":"9","sections":[{"label":"Izquierda","seats":13},{"label":"Derecha","seats":10}]},
      {"label":"10","sections":[{"label":"Izquierda","seats":11},{"label":"Derecha","seats":10}]},
      {"label":"11","sections":[{"label":"Izquierda","seats":9},{"label":"Derecha","seats":11}]},
      {"label":"12","sections":[{"label":"Izquierda","seats":7},{"label":"Derecha","seats":11}]}
    ]
  }
  $layout$::jsonb;
begin
  select id into v_org_id
  from public.organizations
  where slug = 'fundacion-espacio-mejor';

  select id into v_template_id
  from public.auditorium_templates
  where organization_id = v_org_id and lower(name) = lower('Auditorio UAI · Viña del Mar')
  limit 1;

  if v_template_id is null then
    insert into public.auditorium_templates(organization_id, name, description, layout, created_by)
    values (
      v_org_id,
      'Auditorio UAI · Viña del Mar',
      'Distribución original de 255 asientos, conservada como plantilla reutilizable.',
      v_layout,
      (select id from public.profiles where organization_id = v_org_id and role = 'admin' order by created_at limit 1)
    )
    returning id into v_template_id;
  end if;

  update public.activities
  set auditorium_template_id = v_template_id
  where organization_id = v_org_id
    and auditorium_template_id is null;
end $$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.organization_id = (select public.current_organization_id())
      and p.role in ('staff', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.organization_id = (select public.current_organization_id())
      and p.role = 'admin'
  );
$$;

create or replace function public.is_accreditor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.organization_id = (select public.current_organization_id())
      and p.role in ('staff', 'admin', 'volunteer')
  );
$$;

-- Tenant ownership is immutable after provisioning.
-- A newly created profile may transition once from NULL to its organization,
-- but only through the trusted service-role provisioning path.
create or replace function public.prevent_organization_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    if tg_table_name = 'profiles'
       and old.organization_id is null
       and new.organization_id is not null
       and auth.role() = 'service_role' then
      return new;
    end if;
    raise exception 'La organización propietaria de un registro no se puede modificar';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_organization_change() from public, anon, authenticated;

drop trigger if exists profiles_organization_immutable on public.profiles;
create trigger profiles_organization_immutable
before update of organization_id on public.profiles
for each row execute procedure public.prevent_organization_change();

drop trigger if exists activities_organization_immutable on public.activities;
create trigger activities_organization_immutable
before update of organization_id on public.activities
for each row execute procedure public.prevent_organization_change();

drop trigger if exists attendees_organization_immutable on public.attendees;
create trigger attendees_organization_immutable
before update of organization_id on public.attendees
for each row execute procedure public.prevent_organization_change();

drop trigger if exists registrations_organization_immutable on public.registrations;
create trigger registrations_organization_immutable
before update of organization_id on public.registrations
for each row execute procedure public.prevent_organization_change();

drop trigger if exists check_ins_organization_immutable on public.check_ins;
create trigger check_ins_organization_immutable
before update of organization_id on public.check_ins
for each row execute procedure public.prevent_organization_change();

drop trigger if exists audit_logs_organization_immutable on public.audit_logs;
create trigger audit_logs_organization_immutable
before update of organization_id on public.audit_logs
for each row execute procedure public.prevent_organization_change();

drop trigger if exists auditorium_templates_organization_immutable on public.auditorium_templates;
create trigger auditorium_templates_organization_immutable
before update of organization_id on public.auditorium_templates
for each row execute procedure public.prevent_organization_change();

revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_accreditor() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_accreditor() to authenticated;

-- Explicit Data API grants; RLS policies below provide the tenant/role boundary.
revoke all on table public.organizations from anon, authenticated;
grant select, update on table public.organizations to authenticated;
revoke all on table public.auditorium_templates from anon, authenticated;
grant select, insert, update, delete on table public.auditorium_templates to authenticated;

-- New self-registrations create a new isolated organization and its first administrator.
-- Admin-created staff accounts have no organization metadata and are provisioned by the admin Edge Function.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_name text;
  v_full_name text;
  v_slug_base text;
  v_slug text;
  v_org_id uuid;
begin
  v_org_name := btrim(coalesce(new.raw_user_meta_data ->> 'organization_name', ''));
  v_full_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');

  if v_org_name <> '' then
    if char_length(v_org_name) < 2 or char_length(v_org_name) > 180 then
      raise exception 'El nombre de la organización debe tener entre 2 y 180 caracteres';
    end if;

    v_slug_base := lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug_base := trim(both '-' from v_slug_base);
    if v_slug_base = '' then v_slug_base := 'organizacion'; end if;
    v_slug := left(v_slug_base, 44) || '-' || substr(replace(new.id::text, '-', ''), 1, 8);

    insert into public.organizations(name, slug, created_by)
    values (v_org_name, v_slug, new.id)
    returning id into v_org_id;

    insert into public.profiles(id, email, full_name, role, organization_id)
    values (new.id, new.email, v_full_name, 'admin', v_org_id)
    on conflict (id) do update
      set email = excluded.email,
          full_name = excluded.full_name,
          role = excluded.role,
          organization_id = excluded.organization_id;
  else
    insert into public.profiles(id, email, full_name, role)
    values (new.id, new.email, v_full_name, 'staff')
    on conflict (id) do update
      set email = excluded.email,
          full_name = coalesce(excluded.full_name, public.profiles.full_name);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Rebuild policies so every exposed row is filtered by the authenticated workspace.
drop policy if exists "profiles read self or admin" on public.profiles;
drop policy if exists "profiles read same organization" on public.profiles;
create policy "profiles read same organization"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (
      organization_id = (select public.current_organization_id())
      and (select public.is_admin())
    )
  );

drop policy if exists "admin manages profiles" on public.profiles;
drop policy if exists "same organization admin updates profiles" on public.profiles;
create policy "same organization admin updates profiles"
  on public.profiles for update to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_admin()))
  with check (organization_id = (select public.current_organization_id()));

alter table public.organizations enable row level security;
drop policy if exists "members read own organization" on public.organizations;
create policy "members read own organization"
  on public.organizations for select to authenticated
  using (id = (select public.current_organization_id()));
drop policy if exists "admins update own organization" on public.organizations;
create policy "admins update own organization"
  on public.organizations for update to authenticated
  using (id = (select public.current_organization_id()) and (select public.is_admin()))
  with check (id = (select public.current_organization_id()));

drop policy if exists "staff reads activities" on public.activities;
drop policy if exists "accreditors read activities" on public.activities;
drop policy if exists "same organization accreditors read activities" on public.activities;
create policy "same organization accreditors read activities"
  on public.activities for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_accreditor()));

drop policy if exists "staff inserts activities" on public.activities;
drop policy if exists "same organization staff inserts activities" on public.activities;
create policy "same organization staff inserts activities"
  on public.activities for insert to authenticated
  with check (organization_id = (select public.current_organization_id()) and (select public.is_staff()));

drop policy if exists "staff updates activities" on public.activities;
drop policy if exists "same organization staff updates activities" on public.activities;
create policy "same organization staff updates activities"
  on public.activities for update to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_staff()))
  with check (organization_id = (select public.current_organization_id()));

drop policy if exists "staff reads attendees" on public.attendees;
drop policy if exists "accreditors read attendees" on public.attendees;
drop policy if exists "same organization accreditors read attendees" on public.attendees;
create policy "same organization accreditors read attendees"
  on public.attendees for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_accreditor()));

drop policy if exists "staff inserts attendees" on public.attendees;
drop policy if exists "same organization staff inserts attendees" on public.attendees;
create policy "same organization staff inserts attendees"
  on public.attendees for insert to authenticated
  with check (organization_id = (select public.current_organization_id()) and (select public.is_staff()));

drop policy if exists "staff updates attendees" on public.attendees;
drop policy if exists "same organization staff updates attendees" on public.attendees;
create policy "same organization staff updates attendees"
  on public.attendees for update to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_staff()))
  with check (organization_id = (select public.current_organization_id()));

drop policy if exists "staff reads registrations" on public.registrations;
drop policy if exists "accreditors read registrations" on public.registrations;
drop policy if exists "same organization accreditors read registrations" on public.registrations;
create policy "same organization accreditors read registrations"
  on public.registrations for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_accreditor()));

drop policy if exists "staff updates registrations" on public.registrations;
drop policy if exists "same organization staff updates registrations" on public.registrations;
create policy "same organization staff updates registrations"
  on public.registrations for update to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_staff()))
  with check (organization_id = (select public.current_organization_id()));

drop policy if exists "staff reads checkins" on public.check_ins;
drop policy if exists "accreditors read checkins" on public.check_ins;
drop policy if exists "same organization accreditors read checkins" on public.check_ins;
create policy "same organization accreditors read checkins"
  on public.check_ins for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_accreditor()));

drop policy if exists "staff reads audit" on public.audit_logs;
drop policy if exists "same organization staff reads audit" on public.audit_logs;
create policy "same organization staff reads audit"
  on public.audit_logs for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_staff()));

alter table public.auditorium_templates enable row level security;
drop policy if exists "same organization staff reads auditoriums" on public.auditorium_templates;
create policy "same organization staff reads auditoriums"
  on public.auditorium_templates for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_staff()));
drop policy if exists "same organization staff creates auditoriums" on public.auditorium_templates;
create policy "same organization staff creates auditoriums"
  on public.auditorium_templates for insert to authenticated
  with check (organization_id = (select public.current_organization_id()) and (select public.is_staff()));
drop policy if exists "same organization staff updates auditoriums" on public.auditorium_templates;
create policy "same organization staff updates auditoriums"
  on public.auditorium_templates for update to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_staff()))
  with check (organization_id = (select public.current_organization_id()));
drop policy if exists "same organization admins delete auditoriums" on public.auditorium_templates;
create policy "same organization admins delete auditoriums"
  on public.auditorium_templates for delete to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_admin()));

-- Tenant-aware registration and accreditation routines.
drop function if exists public.register_attendee(uuid,text,text,text);
drop function if exists public.register_attendee(uuid,text,text,text,text,text);
create or replace function public.register_attendee(
  p_activity_id uuid,
  p_full_name text,
  p_email text default null,
  p_organization text default null,
  p_seat_row text default null,
  p_seat_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_attendee uuid;
  v_registration uuid;
  v_token uuid;
  v_status text;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null or not public.is_staff() then
    raise exception 'No autorizado';
  end if;
  if length(trim(coalesce(p_full_name,''))) = 0 then
    raise exception 'El nombre es obligatorio';
  end if;
  if length(trim(coalesce(p_seat_row,''))) > 40 or length(trim(coalesce(p_seat_number,''))) > 40 then
    raise exception 'La fila y el asiento admiten hasta 40 caracteres';
  end if;

  select a.status into v_status
  from public.activities a
  where a.id = p_activity_id and a.organization_id = v_org_id
  for share;
  if not found then raise exception 'Actividad no encontrada en su organización'; end if;
  if v_status <> 'open' then raise exception 'La actividad está cerrada'; end if;

  insert into public.attendees(organization_id, full_name, email, organization)
  values (v_org_id, trim(p_full_name), nullif(trim(p_email),''), nullif(trim(p_organization),''))
  returning id into v_attendee;

  insert into public.registrations(organization_id, activity_id, attendee_id, seat_row, seat_number, created_by)
  values (v_org_id, p_activity_id, v_attendee, nullif(trim(p_seat_row),''), nullif(trim(p_seat_number),''), auth.uid())
  returning id, qr_token into v_registration, v_token;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, details)
  values (v_org_id, auth.uid(), 'registration_created', 'registration', v_registration::text,
    jsonb_build_object('activity_id', p_activity_id));

  return jsonb_build_object('registration_id', v_registration, 'qr_token', v_token);
exception when unique_violation then
  raise exception 'Posible inscripción duplicada para esta persona y actividad. Revise el listado antes de volver a intentarlo.';
end;
$$;

create or replace function public.check_in_ticket(p_token uuid, p_activity_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_reg public.registrations%rowtype;
  v_name text;
  v_activity text;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null or not public.is_accreditor() then
    raise exception 'No autorizado';
  end if;

  select r.* into v_reg
  from public.registrations r
  where r.qr_token = p_token and r.organization_id = v_org_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'message', 'QR no reconocido'); end if;
  if p_activity_id is not null and v_reg.activity_id <> p_activity_id then
    return jsonb_build_object('ok', false, 'message', 'Esta entrada pertenece a otra actividad');
  end if;
  if v_reg.status = 'cancelled' then return jsonb_build_object('ok', false, 'message', 'La inscripción está cancelada'); end if;
  if v_reg.status = 'checked_in' then return jsonb_build_object('ok', false, 'message', 'Esta entrada ya fue acreditada'); end if;

  select a.full_name, act.name into v_name, v_activity
  from public.attendees a
  join public.activities act on act.id = v_reg.activity_id and act.organization_id = v_org_id
  where a.id = v_reg.attendee_id and a.organization_id = v_org_id;

  update public.registrations set status = 'checked_in'
  where id = v_reg.id and organization_id = v_org_id;

  insert into public.check_ins(organization_id, registration_id, activity_id, token, checked_in_by)
  values (v_org_id, v_reg.id, v_reg.activity_id, v_reg.qr_token, auth.uid());

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, details)
  values (v_org_id, auth.uid(), 'checkin_success', 'registration', v_reg.id::text,
    jsonb_build_object('activity_id', v_reg.activity_id, 'method', 'qr'));

  return jsonb_build_object('ok', true, 'message', 'Acreditación válida: ' || v_name || ' · ' || v_activity);
end;
$$;

create or replace function public.manual_check_in_registration(p_registration_id uuid, p_activity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_reg public.registrations%rowtype;
  v_name text;
  v_activity text;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null or not public.is_accreditor() then
    raise exception 'No autorizado';
  end if;

  select r.* into v_reg
  from public.registrations r
  where r.id = p_registration_id
    and r.activity_id = p_activity_id
    and r.organization_id = v_org_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'No se encontró esta inscripción en la actividad seleccionada');
  end if;
  if v_reg.status = 'cancelled' then return jsonb_build_object('ok', false, 'message', 'La inscripción está cancelada'); end if;
  if v_reg.status = 'checked_in' then return jsonb_build_object('ok', false, 'message', 'Esta persona ya fue acreditada'); end if;

  select a.full_name, act.name into v_name, v_activity
  from public.attendees a
  join public.activities act on act.id = v_reg.activity_id and act.organization_id = v_org_id
  where a.id = v_reg.attendee_id and a.organization_id = v_org_id;

  update public.registrations set status = 'checked_in'
  where id = v_reg.id and organization_id = v_org_id;

  insert into public.check_ins(organization_id, registration_id, activity_id, token, checked_in_by)
  values (v_org_id, v_reg.id, v_reg.activity_id, v_reg.qr_token, auth.uid());

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, details)
  values (v_org_id, auth.uid(), 'checkin_success', 'registration', v_reg.id::text,
    jsonb_build_object('activity_id', v_reg.activity_id, 'method', 'manual'));

  return jsonb_build_object('ok', true, 'message', 'Acreditación manual registrada: ' || v_name || ' · ' || v_activity);
end;
$$;

create or replace function public.delete_registration(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_reg public.registrations%rowtype;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null or not public.is_staff() then raise exception 'No autorizado'; end if;

  select * into v_reg
  from public.registrations
  where id = p_registration_id and organization_id = v_org_id
  for update;
  if not found then raise exception 'Inscripción no encontrada'; end if;

  delete from public.check_ins where registration_id = v_reg.id and organization_id = v_org_id;
  delete from public.registrations where id = v_reg.id and organization_id = v_org_id;
  delete from public.attendees a
  where a.id = v_reg.attendee_id and a.organization_id = v_org_id
    and not exists (
      select 1 from public.registrations r
      where r.attendee_id = a.id and r.organization_id = v_org_id
    );

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, details)
  values (v_org_id, auth.uid(), 'registration_deleted', 'registration', v_reg.id::text,
    jsonb_build_object('activity_id', v_reg.activity_id));
end;
$$;

-- Tenant-safe grants: these SECURITY DEFINER routines still perform their own tenant/role checks.
revoke all on function public.register_attendee(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.check_in_ticket(uuid,uuid) from public, anon;
revoke all on function public.manual_check_in_registration(uuid,uuid) from public, anon;
revoke all on function public.delete_registration(uuid) from public, anon;
grant execute on function public.register_attendee(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.check_in_ticket(uuid,uuid) to authenticated;
grant execute on function public.manual_check_in_registration(uuid,uuid) to authenticated;
grant execute on function public.delete_registration(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
