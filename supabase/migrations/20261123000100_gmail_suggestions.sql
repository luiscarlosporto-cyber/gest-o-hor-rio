-- Fase 3 · sugestões de compromissos a partir do Gmail (só leitura; o utilizador decide)
alter table public.google_accounts
  add column gmail_enabled boolean not null default false,
  add column gmail_scanned_at timestamptz;

create or replace view public.google_status with (security_invoker = true) as
  select user_id, google_email, calendar_id, last_synced_at, last_error, connected_at, gmail_enabled, gmail_scanned_at
  from public.google_accounts;
grant select (gmail_enabled, gmail_scanned_at) on public.google_accounts to authenticated;

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  gmail_id text not null,
  kind text not null check (kind in ('event', 'task')),
  title text not null,
  date date,
  time time,
  sender text,
  subject text,
  snippet text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (user_id, gmail_id)
);

alter table public.suggestions enable row level security;
-- O utilizador lê e decide (muda o estado); quem cria é o servidor.
create policy "ver as próprias sugestões" on public.suggestions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "decidir as próprias sugestões" on public.suggestions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, delete on public.suggestions from anon, authenticated;
revoke update on public.suggestions from anon, authenticated;
grant update (status) on public.suggestions to authenticated;
