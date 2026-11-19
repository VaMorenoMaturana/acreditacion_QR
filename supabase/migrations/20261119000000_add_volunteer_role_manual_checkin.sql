-- Add a volunteer-only accreditation role and manual attendee check-in.
-- Run this migration once in the Supabase SQL Editor on an existing project.

begin;

-- Extend the existing profile role constraint.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('staff', 'admin', 'volunteer'));

-- Keep is_staff() unchanged: operational writes remain restricted to staff/admin.
-- Volunteers may read the data needed by the accreditation screen and call the
-- dedicated accreditation functions below.
create or replace function public.is_accreditor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('staff', 'admin', 'volunteer')
  );
$$;

-- Read-only access needed by the accreditation module.
drop policy if exists "staff reads activities" on public.activities;
drop policy if exists "accreditors read activities" on public.activities;
create policy "accreditors read activities"
  on public.activities for select to authenticated
  using (public.is_accreditor());

drop policy if exists "staff reads attendees" on public.attendees;
drop policy if exists "accreditors read attendees" on public.attendees;
create policy "accreditors read attendees"
  on public.attendees for select to authenticated
  using (public.is_accreditor());

drop policy if exists "staff reads registrations" on public.registrations;
drop policy if exists "accreditors read registrations" on public.registrations;
create policy "accreditors read registrations"
  on public.registrations for select to authenticated
  using (public.is_accreditor());

drop policy if exists "staff reads checkins" on public.check_ins;
drop policy if exists "accreditors read checkins" on public.check_ins;
create policy "accreditors read checkins"
  on public.check_ins for select to authenticated
  using (public.is_accreditor());

-- Camera-based QR accreditation remains available to volunteers.
create or replace function public.check_in_ticket(p_token uuid, p_activity_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_name text;
  v_activity text;
begin
  if not public.is_accreditor() then
    raise exception 'No autorizado';
  end if;

  select r.* into v_reg
  from public.registrations r
  where r.qr_token = p_token
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'QR no reconocido');
  end if;
  if p_activity_id is not null and v_reg.activity_id <> p_activity_id then
    return jsonb_build_object('ok', false, 'message', 'Esta entrada pertenece a otra actividad');
  end if;
  if v_reg.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'message', 'La inscripción está cancelada');
  end if;
  if v_reg.status = 'checked_in' then
    return jsonb_build_object('ok', false, 'message', 'Esta entrada ya fue acreditada');
  end if;

  select a.full_name, act.name
    into v_name, v_activity
  from public.attendees a
  join public.activities act on act.id = v_reg.activity_id
  where a.id = v_reg.attendee_id;

  update public.registrations
  set status = 'checked_in'
  where id = v_reg.id;

  insert into public.check_ins(registration_id, activity_id, token, checked_in_by)
  values (v_reg.id, v_reg.activity_id, v_reg.qr_token, auth.uid());

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'checkin_success',
    'registration',
    v_reg.id::text,
    jsonb_build_object('activity_id', v_reg.activity_id, 'method', 'qr')
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Acreditación válida: ' || v_name || ' · ' || v_activity
  );
end;
$$;

grant execute on function public.check_in_ticket(uuid, uuid) to authenticated;

-- Manual accreditation by registration ID. The row lock prevents double check-in
-- when a volunteer and a QR scanner attempt to accredit the same person together.
create or replace function public.manual_check_in_registration(
  p_registration_id uuid,
  p_activity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_name text;
  v_activity text;
begin
  if not public.is_accreditor() then
    raise exception 'No autorizado';
  end if;

  select r.* into v_reg
  from public.registrations r
  where r.id = p_registration_id
    and r.activity_id = p_activity_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'No se encontró esta inscripción en la actividad seleccionada');
  end if;
  if v_reg.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'message', 'La inscripción está cancelada');
  end if;
  if v_reg.status = 'checked_in' then
    return jsonb_build_object('ok', false, 'message', 'Esta persona ya fue acreditada');
  end if;

  select a.full_name, act.name
    into v_name, v_activity
  from public.attendees a
  join public.activities act on act.id = v_reg.activity_id
  where a.id = v_reg.attendee_id;

  update public.registrations
  set status = 'checked_in'
  where id = v_reg.id;

  insert into public.check_ins(registration_id, activity_id, token, checked_in_by)
  values (v_reg.id, v_reg.activity_id, v_reg.qr_token, auth.uid());

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'checkin_success',
    'registration',
    v_reg.id::text,
    jsonb_build_object('activity_id', v_reg.activity_id, 'method', 'manual')
  );

  return jsonb_build_object(
    'ok', true,
    'message', 'Acreditación manual registrada: ' || v_name || ' · ' || v_activity
  );
end;
$$;

revoke all on function public.manual_check_in_registration(uuid, uuid) from public;
revoke all on function public.manual_check_in_registration(uuid, uuid) from anon;
grant execute on function public.manual_check_in_registration(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
