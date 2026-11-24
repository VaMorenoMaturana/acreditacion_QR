-- Support multiple platform superadministrators.
-- Run once after 20261124000000_superadmin_console.sql.
begin;

-- Remove the single-email restriction introduced for the first bootstrap account.
alter table public.profiles
  drop constraint if exists profiles_superadmin_email_check;

-- A platform superadministrator is global, never attached to a tenant.
alter table public.profiles
  drop constraint if exists profiles_superadmin_no_org_check;
alter table public.profiles
  add constraint profiles_superadmin_no_org_check
  check (role <> 'superadmin' or organization_id is null);

-- Role and email changes involving a superadmin must come from the trusted
-- server-side service role or a postgres operator using the SQL editor.
-- This keeps tenant administrators from promoting themselves through the API.
create or replace function public.guard_superadmin_profile()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if (new.role = 'superadmin' or old.role = 'superadmin')
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user <> 'postgres' then
    raise exception 'Solo un superadministrador o un operador de plataforma puede cambiar este perfil';
  end if;

  if new.role = 'superadmin' and new.organization_id is not null then
    raise exception 'Un superadministrador no puede pertenecer a una organización';
  end if;

  return new;
end;
$function$;

notify pgrst, 'reload schema';
commit;
