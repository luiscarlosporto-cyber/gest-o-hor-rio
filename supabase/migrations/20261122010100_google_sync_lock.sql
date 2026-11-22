-- Evita duas sincronizações ao mesmo tempo para o mesmo utilizador.
alter table public.google_accounts
  add column sync_lock_until timestamptz,
  add column resync_requested boolean not null default false;
