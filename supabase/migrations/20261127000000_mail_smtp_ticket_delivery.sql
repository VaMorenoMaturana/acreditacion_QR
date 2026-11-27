-- Per-organization SMTP configuration and individual ticket delivery audit.
-- SMTP credentials are AES-GCM encrypted by the mail-manager Edge Function.
-- The encryption key must exist only in Supabase Edge Function Secrets.

begin;

create table if not exists public.mail_smtp_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  smtp_host text not null check (char_length(btrim(smtp_host)) between 1 and 253),
  smtp_port integer not null check (smtp_port between 1 and 65535),
  smtp_security text not null default 'starttls' check (smtp_security in ('starttls', 'tls')),
  smtp_username text not null check (char_length(btrim(smtp_username)) between 1 and 254),
  smtp_password_ciphertext text not null,
  sender_email text not null check (char_length(btrim(sender_email)) between 3 and 254),
  sender_name text not null default 'Espacio Acredita' check (char_length(btrim(sender_name)) between 1 and 120),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mail_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  registration_id uuid not null references public.registrations(id) on delete cascade,
  sent_by uuid references auth.users(id) on delete set null,
  recipient_email text not null,
  subject text not null,
  status text not null check (status in ('sent', 'failed')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists mail_delivery_logs_org_activity_created_idx
  on public.mail_delivery_logs (organization_id, activity_id, created_at desc);
create index if not exists mail_delivery_logs_registration_status_idx
  on public.mail_delivery_logs (registration_id, status, created_at desc);

alter table public.mail_smtp_settings enable row level security;
alter table public.mail_delivery_logs enable row level security;

-- No browser role may read or alter SMTP credentials or delivery logs directly.
revoke all on table public.mail_smtp_settings from anon, authenticated;
revoke all on table public.mail_delivery_logs from anon, authenticated;
grant all on table public.mail_smtp_settings to service_role;
grant all on table public.mail_delivery_logs to service_role;

commit;
