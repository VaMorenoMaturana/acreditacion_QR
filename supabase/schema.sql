-- Espacio Acredita v0.1 — ejecutar en Supabase SQL Editor en un proyecto nuevo o tras revisar conflictos.
-- No ejecutar a ciegas sobre una base existente. Respaldar primero.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'staff' check (role in ('staff','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 180),
  description text,
  tagline text,
  place text not null,
  event_date date not null,
  start_time time not null,
  end_time time,
  status text not null default 'open' check (status in ('open','closed')),
  institution_logo text,
  project_logo text,
  partner_logo text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 1 and 180),
  email text,
  organization text,
  created_at timestamptz not null default now()
);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete restrict,
  attendee_id uuid not null references public.attendees(id) on delete restrict,
  qr_token uuid not null unique default gen_random_uuid(),
  status text not null default 'registered' check (status in ('registered','checked_in','cancelled')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique(activity_id, attendee_id)
);

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.registrations(id) on delete restrict,
  activity_id uuid not null references public.activities(id) on delete restrict,
  token uuid not null,
  checked_in_by uuid not null references auth.users(id),
  checked_in_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists registrations_activity_status_idx on public.registrations(activity_id,status);
create index if not exists check_ins_activity_time_idx on public.check_ins(activity_id,checked_in_at desc);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('staff','admin')); $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'); $$;

-- Crear el perfil automáticamente para cada usuario creado en Supabase Auth.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,email,role) values(new.id,new.email,'staff')
  on conflict(id) do update set email=excluded.email;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.attendees enable row level security;
alter table public.registrations enable row level security;
alter table public.check_ins enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin" on public.profiles for select to authenticated using (id=auth.uid() or public.is_admin());
drop policy if exists "admin manages profiles" on public.profiles;
create policy "admin manages profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "staff reads activities" on public.activities;
create policy "staff reads activities" on public.activities for select to authenticated using (public.is_staff());
drop policy if exists "staff inserts activities" on public.activities;
create policy "staff inserts activities" on public.activities for insert to authenticated with check (public.is_staff());
drop policy if exists "staff updates activities" on public.activities;
create policy "staff updates activities" on public.activities for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff reads attendees" on public.attendees;
create policy "staff reads attendees" on public.attendees for select to authenticated using (public.is_staff());
drop policy if exists "staff inserts attendees" on public.attendees;
create policy "staff inserts attendees" on public.attendees for insert to authenticated with check (public.is_staff());
drop policy if exists "staff updates attendees" on public.attendees;
create policy "staff updates attendees" on public.attendees for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff reads registrations" on public.registrations;
create policy "staff reads registrations" on public.registrations for select to authenticated using (public.is_staff());
drop policy if exists "staff updates registrations" on public.registrations;
create policy "staff updates registrations" on public.registrations for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff reads checkins" on public.check_ins;
create policy "staff reads checkins" on public.check_ins for select to authenticated using (public.is_staff());
drop policy if exists "staff reads audit" on public.audit_logs;
create policy "staff reads audit" on public.audit_logs for select to authenticated using (public.is_staff());

create or replace function public.register_attendee(
 p_activity_id uuid, p_full_name text, p_email text default null, p_organization text default null
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_attendee uuid; v_registration uuid; v_token uuid; v_status text;
begin
 if not public.is_staff() then raise exception 'No autorizado'; end if;
 if length(trim(coalesce(p_full_name,'')))=0 then raise exception 'El nombre es obligatorio'; end if;
 select status into v_status from public.activities where id=p_activity_id for share;
 if not found then raise exception 'Actividad no encontrada'; end if;
 if v_status<>'open' then raise exception 'La actividad está cerrada'; end if;
 insert into public.attendees(full_name,email,organization) values(trim(p_full_name),nullif(trim(p_email),''),nullif(trim(p_organization),'')) returning id into v_attendee;
 insert into public.registrations(activity_id,attendee_id,created_by) values(p_activity_id,v_attendee,auth.uid())
 returning id,qr_token into v_registration,v_token;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'registration_created','registration',v_registration::text,jsonb_build_object('activity_id',p_activity_id));
 return jsonb_build_object('registration_id',v_registration,'qr_token',v_token);
exception when unique_violation then
 raise exception 'Posible inscripción duplicada para esta persona y actividad. Revise el listado antes de volver a intentarlo.';
end;
$$;

create or replace function public.check_in_ticket(p_token uuid, p_activity_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_reg public.registrations%rowtype; v_name text; v_activity text;
begin
 if not public.is_staff() then raise exception 'No autorizado'; end if;
 select r.* into v_reg from public.registrations r where r.qr_token=p_token for update;
 if not found then return jsonb_build_object('ok',false,'message','QR no reconocido'); end if;
 if p_activity_id is not null and v_reg.activity_id<>p_activity_id then return jsonb_build_object('ok',false,'message','Esta entrada pertenece a otra actividad'); end if;
 if v_reg.status='cancelled' then return jsonb_build_object('ok',false,'message','La inscripción está cancelada'); end if;
 if v_reg.status='checked_in' then return jsonb_build_object('ok',false,'message','Esta entrada ya fue acreditada'); end if;
 select a.full_name, act.name into v_name,v_activity from public.attendees a join public.activities act on act.id=v_reg.activity_id where a.id=v_reg.attendee_id;
 update public.registrations set status='checked_in' where id=v_reg.id;
 insert into public.check_ins(registration_id,activity_id,token,checked_in_by) values(v_reg.id,v_reg.activity_id,v_reg.qr_token,auth.uid());
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'checkin_success','registration',v_reg.id::text,jsonb_build_object('activity_id',v_reg.activity_id));
 return jsonb_build_object('ok',true,'message','Acreditación válida: '||v_name||' · '||v_activity);
end;
$$;

grant execute on function public.register_attendee(uuid,text,text,text) to authenticated;
grant execute on function public.check_in_ticket(uuid,uuid) to authenticated;

-- Para asignar el primer administrador: crea primero el usuario en Authentication y luego ejecuta:
-- update public.profiles set role='admin' where email='correo-institucional@ejemplo.cl';
-- Ejecuta esa sentencia por separado y reemplaza el correo de ejemplo.
