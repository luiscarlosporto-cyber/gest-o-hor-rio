-- Fase 2 do plano · lembretes e notificações no telemóvel (Web Push).
-- A app calcula os avisos dos próximos 14 dias; o servidor envia-os à hora certa.

alter table public.profiles add column reminder_settings jsonb;

-- Aparelhos onde o utilizador ativou as notificações.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "aparelhos próprios" on public.push_subscriptions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Avisos por enviar (e os enviados nos últimos 30 dias, para nunca repetir).
create table public.reminders (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (length(key) <= 200),
  fire_at timestamptz not null,
  title text not null check (length(title) <= 200),
  body text not null default '' check (length(body) <= 500),
  url text not null default '' check (length(url) <= 200),
  sent_at timestamptz,
  primary key (user_id, key)
);
create index reminders_due_idx on public.reminders (fire_at) where sent_at is null;
alter table public.reminders enable row level security;
create policy "avisos próprios" on public.reminders
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Substitui os avisos por enviar pelos que a app calculou agora (os já enviados não voltam).
create function public.replace_reminders(p_rows jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then raise exception 'sem sessão'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'demasiados avisos'; end if;
  delete from public.reminders r
  where r.user_id = v_user and r.sent_at is null
    and not exists (select 1 from jsonb_array_elements(p_rows) x where x->>'key' = r.key);
  insert into public.reminders (user_id, key, fire_at, title, body, url)
  select v_user, x->>'key', (x->>'fire_at')::timestamptz, x->>'title', coalesce(x->>'body', ''), coalesce(x->>'url', '')
  from jsonb_array_elements(p_rows) x
  on conflict (user_id, key) do update
    set fire_at = excluded.fire_at, title = excluded.title, body = excluded.body, url = excluded.url
    where public.reminders.sent_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.replace_reminders(jsonb) from public, anon;
grant execute on function public.replace_reminders(jsonb) to authenticated;

-- Envio: de minuto a minuto, o pg_cron chama a Edge Function "push" com um segredo guardado no Vault.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create function public.call_push_function() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://solpuulailtlewntgwjm.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"action":"send_due"}'::jsonb,
    timeout_milliseconds := 20000
  );
end $$;
revoke execute on function public.call_push_function() from public, anon, authenticated;

select cron.schedule('enviar-lembretes', '* * * * *', 'select public.call_push_function()');

-- Chaves VAPID e segredo do cron, lidos do Vault só pela Edge Function (service_role).
-- Os valores são criados à parte no Vault (vapid_public_key, vapid_private_key, push_cron_secret), nunca no código.
create function public.read_push_config() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_object_agg(name, decrypted_secret)
  from vault.decrypted_secrets
  where name in ('vapid_public_key', 'vapid_private_key', 'push_cron_secret')
$$;
revoke execute on function public.read_push_config() from public, anon, authenticated;
grant execute on function public.read_push_config() to service_role;
