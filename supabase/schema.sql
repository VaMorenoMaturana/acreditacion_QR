-- Liderazgo en 100 Palabras: esquema inicial para Supabase.
-- Ejecutar en SQL Editor de un proyecto NUEVO/revisado.
-- Crear usuarios en Authentication > Users y luego asignarles perfil abajo.
create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin','staff')),
  created_at timestamptz not null default now()
);

create table if not exists public.attendees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 1 and 160),
  email text null,
  organization text null,
  qr_token uuid not null unique,
  checked_in_at timestamptz null,
  checked_in_by uuid null references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists attendees_checked_in_at_idx on public.attendees(checked_in_at);
create index if not exists attendees_full_name_idx on public.attendees(full_name);

alter table public.user_profiles enable row level security;
alter table public.attendees enable row level security;

-- Cada usuario puede leer solo su perfil. Los roles no pueden ser modificados desde el navegador.
drop policy if exists "users read own profile" on public.user_profiles;
create policy "users read own profile" on public.user_profiles
  for select to authenticated using (id = auth.uid());

-- Solo administradores pueden ver/crear/actualizar/eliminar la lista completa.
drop policy if exists "admin manage attendees" on public.attendees;
create policy "admin manage attendees" on public.attendees
  for all to authenticated
  using (exists (select 1 from public.user_profiles p where p.id=auth.uid() and p.role='admin'))
  with check (exists (select 1 from public.user_profiles p where p.id=auth.uid() and p.role='admin'));

-- El personal de acceso no tiene permiso directo de lectura sobre asistentes.
-- La validación se hace a través de una función transaccional que evita doble ingreso.
create or replace function public.validate_and_check_in(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attendee public.attendees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid() and p.role in ('admin','staff')
  ) then
    raise exception 'Access denied';
  end if;

  select * into v_attendee
  from public.attendees
  where qr_token = p_token
  for update;

  if not found then
    return jsonb_build_object('status','invalid');
  end if;

  if v_attendee.checked_in_at is not null then
    return jsonb_build_object(
      'status','already_checked_in',
      'full_name',v_attendee.full_name,
      'organization',v_attendee.organization,
      'checked_in_at',v_attendee.checked_in_at
    );
  end if;

  update public.attendees
  set checked_in_at = now(), checked_in_by = auth.uid()
  where id = v_attendee.id
  returning * into v_attendee;

  return jsonb_build_object(
    'status','valid',
    'full_name',v_attendee.full_name,
    'organization',v_attendee.organization,
    'checked_in_at',v_attendee.checked_in_at
  );
end;
$$;

revoke all on function public.validate_and_check_in(uuid) from public, anon;
grant execute on function public.validate_and_check_in(uuid) to authenticated;

-- Realtime para refrescar el panel del administrador cuando cambia un ingreso.
do $$
begin
  alter publication supabase_realtime add table public.attendees;
exception when duplicate_object then null;
when undefined_object then
  raise notice 'La publicación supabase_realtime no existe; habilita Realtime desde el panel de Supabase.';
end $$;

-- Después de crear usuarios en Authentication > Users, ejecuta una inserción por usuario.
-- Sustituye UUID y nombre; asigna admin únicamente al Director de Datos.
-- insert into public.user_profiles (id, display_name, role)
-- values ('UUID_DEL_USUARIO', 'Director de Datos', 'admin');
-- insert into public.user_profiles (id, display_name, role)
-- values ('UUID_DEL_USUARIO', 'Equipo de acceso', 'staff');

-- Seguridad adicional: no habilites permisos de lectura pública para attendees.
-- Revisa las políticas en Supabase antes de usar datos reales.
