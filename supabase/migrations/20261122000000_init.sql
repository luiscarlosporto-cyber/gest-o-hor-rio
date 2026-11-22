-- Gestão Horário · esquema inicial (fase 1)
-- Cada linha pertence a um utilizador; as políticas RLS garantem que cada um só vê os seus dados.
-- As horas são "hora local" (timestamp without time zone) no fuso indicado em profiles.time_zone,
-- tal como na app. As ligações ao Google (fase 2) acrescentam google_event_id/etag.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  time_zone text not null default 'Europe/Lisbon',
  created_at timestamptz not null default now()
);

create table public.shift_types (
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null check (length(code) between 1 and 12),
  label text not null,
  start_time time,
  end_time time,
  color text not null default '#D9D9D9' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_work boolean not null default false,
  sort_order int not null default 0,
  primary key (user_id, code),
  check ((start_time is null) = (end_time is null))
);

create table public.shift_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  code text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create type public.event_category as enum ('trabalho', 'reuniao', 'pessoal', 'pausa', 'bloqueio');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  starts_at timestamp not null,
  ends_at timestamp not null,
  all_day boolean not null default false,
  category public.event_category not null default 'reuniao',
  location text,
  notes text,
  rrule text,
  exdates date[] not null default '{}',
  recurring_event_id uuid references public.events (id) on delete cascade,
  original_date date,
  transparent boolean,
  -- Fase 2 (Google Calendar)
  google_calendar_id text,
  google_event_id text,
  google_etag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at),
  check (rrule is null or recurring_event_id is null),
  unique (user_id, google_calendar_id, google_event_id)
);

create index events_user_range_idx on public.events (user_id, starts_at, ends_at);
create index events_series_idx on public.events (recurring_event_id) where recurring_event_id is not null;

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  actor text not null check (actor in ('user', 'sync', 'ai')),
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_user_idx on public.audit_log (user_id, created_at desc);

-- updated_at automático
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();
create trigger shift_days_touch before update on public.shift_days
  for each row execute function public.touch_updated_at();

-- Perfil e tipos de turno por omissão (códigos SISQUAL) ao criar a conta
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));

  insert into public.shift_types (user_id, code, label, start_time, end_time, color, is_work, sort_order) values
    (new.id, 'MT2', 'Manhã e tarde', '08:30', '22:30', '#F4B183', true, 1),
    (new.id, 'M', 'Manhã', '08:30', '15:30', '#FFE699', true, 2),
    (new.id, 'N', 'Noite', '22:00', '09:00', '#8EA9DB', true, 3),
    (new.id, 'D', 'Descanso', null, null, '#C6E0B4', false, 4),
    (new.id, 'DS', 'Descanso semanal', null, null, '#E2EFDA', false, 5),
    (new.id, 'DC', 'Descanso complementar', null, null, '#E2EFDA', false, 6),
    (new.id, 'F', 'Folga', null, null, '#E2EFDA', false, 7),
    (new.id, 'Fe', 'Férias', null, null, '#D9D9D9', false, 8),
    (new.id, 'L', 'Licença', null, null, '#D9D9D9', false, 9);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: cada utilizador só acede às suas linhas
alter table public.profiles enable row level security;
alter table public.shift_types enable row level security;
alter table public.shift_days enable row level security;
alter table public.events enable row level security;
alter table public.audit_log enable row level security;

create policy "perfil próprio" on public.profiles
  for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "tipos de turno próprios" on public.shift_types
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "turnos próprios" on public.shift_days
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "eventos próprios" on public.events
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- O registo só se lê; quem escreve é o servidor (service role).
create policy "ler o próprio registo" on public.audit_log
  for select to authenticated using (user_id = (select auth.uid()));
