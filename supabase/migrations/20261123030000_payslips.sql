-- Talões de vencimento lidos no aparelho: só rubricas, horas e valores (sem nome, NIF, IBAN, n.º de beneficiário).
create table public.payslips (
  user_id uuid not null references auth.users (id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  month int not null check (month between 0 and 11),
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, year, month)
);
alter table public.payslips enable row level security;
create policy "talões próprios" on public.payslips
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
