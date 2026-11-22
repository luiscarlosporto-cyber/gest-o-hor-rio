-- Fase 2 · sincronização com o Google Calendar

-- Estado de sincronização por evento e por turno
alter table public.events
  add column dirty boolean not null default false,
  add column deleted_at timestamptz;

alter table public.shift_days
  add column google_event_id text,
  add column google_etag text,
  add column dirty boolean not null default false,
  add column deleted_at timestamptz;

create index events_dirty_idx on public.events (user_id) where dirty;
create index shift_days_dirty_idx on public.shift_days (user_id) where dirty;
create unique index shift_days_google_idx on public.shift_days (user_id, google_event_id) where google_event_id is not null;

-- Conta Google ligada. O refresh token fica no Vault (encriptado); aqui só a referência.
create table public.google_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  google_email text,
  token_secret_id uuid,
  calendar_id text not null default 'primary',
  sync_token text,
  channel_id text,
  channel_token text,
  channel_resource_id text,
  channel_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now()
);

alter table public.google_accounts enable row level security;

-- O utilizador vê o estado da ligação, mas não o token nem o segredo do canal.
create view public.google_status with (security_invoker = true) as
  select user_id, google_email, calendar_id, last_synced_at, last_error, connected_at
  from public.google_accounts;

create policy "ver a própria ligação" on public.google_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "desligar a própria conta" on public.google_accounts
  for delete to authenticated using (user_id = (select auth.uid()));

revoke select on public.google_accounts from anon, authenticated;
grant select (user_id, google_email, calendar_id, last_synced_at, last_error, connected_at)
  on public.google_accounts to authenticated;
grant delete on public.google_accounts to authenticated;
grant select on public.google_status to authenticated;

-- Guardar e ler o refresh token: só o servidor (service_role) pode chamar.
create function public.store_google_token(p_user uuid, p_token text, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
begin
  select token_secret_id into v_secret from public.google_accounts where user_id = p_user;
  if v_secret is null then
    v_secret := vault.create_secret(p_token, 'google_refresh_' || p_user::text);
  else
    perform vault.update_secret(v_secret, p_token);
  end if;
  insert into public.google_accounts (user_id, google_email, token_secret_id)
  values (p_user, p_email, v_secret)
  on conflict (user_id) do update
    set google_email = coalesce(excluded.google_email, public.google_accounts.google_email),
        token_secret_id = excluded.token_secret_id,
        last_error = null;
end $$;

create function public.read_google_token(p_user uuid)
returns text language sql security definer set search_path = '' as $$
  select s.decrypted_secret
  from public.google_accounts a
  join vault.decrypted_secrets s on s.id = a.token_secret_id
  where a.user_id = p_user
$$;

create function public.forget_google_token() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.token_secret_id is not null then
    delete from vault.secrets where id = old.token_secret_id;
  end if;
  return old;
end $$;

create trigger google_accounts_forget after delete on public.google_accounts
  for each row execute function public.forget_google_token();

revoke execute on function public.store_google_token(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.read_google_token(uuid) from public, anon, authenticated;
revoke execute on function public.forget_google_token() from public, anon, authenticated;
grant execute on function public.store_google_token(uuid, text, text) to service_role;
grant execute on function public.read_google_token(uuid) to service_role;
