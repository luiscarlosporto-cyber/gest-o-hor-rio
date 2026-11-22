-- Fase 3 · tarefas (só na app; não vão para o Google Calendar)
create type public.task_priority as enum ('alta', 'normal', 'baixa');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  notes text,
  due_date date,
  due_time time,
  priority public.task_priority not null default 'normal',
  done boolean not null default false,
  done_at timestamptz,
  source text not null default 'manual' check (source in ('manual', 'gmail')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_time is null or due_date is not null)
);

create index tasks_user_idx on public.tasks (user_id, done, due_date);

create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

alter table public.tasks enable row level security;
create policy "tarefas próprias" on public.tasks
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
