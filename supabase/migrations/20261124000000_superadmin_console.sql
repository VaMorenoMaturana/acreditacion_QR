-- Global platform superadministrator, isolated from normal tenant RLS.
-- Apply after 20261123000000_multi_tenant_and_auditoriums.sql.
begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('staff', 'admin', 'volunteer', 'superadmin'));

alter table public.profiles drop constraint if exists profiles_superadmin_email_check;
alter table public.profiles
  add constraint profiles_superadmin_email_check
  check (
    role <> 'superadmin'
    or lower(coalesce(email, '')) = 'vamoreno.maturana@gmail.com'
  );

-- Only the designated account can hold the global role. Ordinary tenant admins
-- cannot promote themselves or another account to superadmin through the Data API.
create or replace function public.guard_superadmin_profile()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.role = 'superadmin'
     and lower(coalesce(new.email, '')) <> 'vamoreno.maturana@gmail.com' then
    raise exception 'El rol superadmin está reservado para la cuenta designada';
  end if;

  if (new.role = 'superadmin' or old.role = 'superadmin')
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user <> 'postgres' then
    raise exception 'Solo el proceso privilegiado puede modificar el superadministrador';
  end if;

  return new;
end;
$function$;

drop trigger if exists profiles_superadmin_protection on public.profiles;
create trigger profiles_superadmin_protection
before update of role, email on public.profiles
for each row execute procedure public.guard_superadmin_profile();

-- Permit trusted server provisioning to move a profile between organizations.
-- Tenant-owned data rows remain immutable across organizations.
create or replace function public.prevent_organization_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.organization_id is distinct from old.organization_id then
    if tg_table_name = 'profiles'
       and (coalesce(auth.role(), '') = 'service_role' or current_user = 'postgres') then
      return new;
    end if;
    raise exception 'La organización propietaria de un registro no se puede modificar';
  end if;
  return new;
end;
$function$;

create table if not exists public.platform_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_logs_created_idx
  on public.platform_audit_logs(created_at desc);
create index if not exists platform_audit_logs_entity_idx
  on public.platform_audit_logs(entity_type, entity_id);

alter table public.platform_audit_logs enable row level security;
revoke all on table public.platform_audit_logs from public, anon, authenticated;
grant all on table public.platform_audit_logs to service_role;

-- Upgrade an existing account with this exact email, if it already exists.
-- If the account is created later, run the one-time bootstrap UPDATE shown in README.
update public.profiles
set role = 'superadmin',
    organization_id = null
where lower(email) = 'vamoreno.maturana@gmail.com';

notify pgrst, 'reload schema';
commit;
