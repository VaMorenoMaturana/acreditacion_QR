create table if not exists public.ticket_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id()
    references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  design jsonb not null check (
    jsonb_typeof(design) = 'object'
    and pg_column_size(design) <= 6000000
  ),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ticket_templates_org_name_unique
  on public.ticket_templates (organization_id, lower(name));

create index if not exists ticket_templates_org_updated_idx
  on public.ticket_templates (organization_id, updated_at desc);

alter table public.ticket_templates enable row level security;

grant select, insert, update, delete on public.ticket_templates to authenticated;

drop policy if exists "staff read organization ticket templates" on public.ticket_templates;
create policy "staff read organization ticket templates"
  on public.ticket_templates for select to authenticated
  using (
    organization_id = (select public.current_organization_id())
    and (select public.is_staff())
  );

drop policy if exists "admins create organization ticket templates" on public.ticket_templates;
create policy "admins create organization ticket templates"
  on public.ticket_templates for insert to authenticated
  with check (
    organization_id = (select public.current_organization_id())
    and (select public.is_admin())
    and created_by = (select auth.uid())
  );

drop policy if exists "admins update organization ticket templates" on public.ticket_templates;
create policy "admins update organization ticket templates"
  on public.ticket_templates for update to authenticated
  using (
    organization_id = (select public.current_organization_id())
    and (select public.is_admin())
  )
  with check (
    organization_id = (select public.current_organization_id())
    and (select public.is_admin())
  );

drop policy if exists "admins delete organization ticket templates" on public.ticket_templates;
create policy "admins delete organization ticket templates"
  on public.ticket_templates for delete to authenticated
  using (
    organization_id = (select public.current_organization_id())
    and (select public.is_admin())
  );
