-- Fase 4 · cópias de segurança diárias e manutenção da sincronização com o Google.

-- Uma cópia por utilizador e por dia; guardam-se as dos últimos 14 dias.
create table public.backups (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.backups enable row level security;
create policy "cópias próprias" on public.backups
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.backups from anon, authenticated;

create function public.make_backups() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  insert into public.backups (user_id, day, data)
  select p.id, (now() at time zone 'Europe/Lisbon')::date, jsonb_build_object(
    'version', 1,
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'google_etag') from public.events e where e.user_id = p.id and e.deleted_at is null), '[]'::jsonb),
    'shift_days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'code', d.code, 'extra', d.extra)) from public.shift_days d where d.user_id = p.id and d.deleted_at is null), '[]'::jsonb),
    'shift_types', coalesce((select jsonb_agg(to_jsonb(t)) from public.shift_types t where t.user_id = p.id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(to_jsonb(k)) from public.tasks k where k.user_id = p.id), '[]'::jsonb),
    'profile', jsonb_build_object('pay_settings', p.pay_settings, 'reminder_settings', p.reminder_settings),
    'payslips', coalesce((select jsonb_agg(jsonb_build_object('year', s.year, 'month', s.month, 'data', s.data)) from public.payslips s where s.user_id = p.id), '[]'::jsonb)
  )
  from public.profiles p
  on conflict (user_id, day) do update set data = excluded.data, created_at = now();
  get diagnostics v_count = row_count;
  delete from public.backups where day < (now() at time zone 'Europe/Lisbon')::date - 14;
  return v_count;
end $$;
revoke execute on function public.make_backups() from public, anon, authenticated;

-- Todos os dias às 03:15 (UTC).
select cron.schedule('copias-diarias', '15 3 * * *', 'select public.make_backups()');

-- De 6 em 6 horas o servidor sincroniza com o Google e renova o canal de avisos,
-- mesmo que a app não seja aberta. Usa a mesma função "push" e o mesmo segredo do Vault.
create function public.call_sync_maintenance() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://solpuulailtlewntgwjm.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"action":"maintain"}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;
revoke execute on function public.call_sync_maintenance() from public, anon, authenticated;

select cron.schedule('manter-google', '7 */6 * * *', 'select public.call_sync_maintenance()');

-- Registo de alterações: compromissos, turnos e tarefas (quem mudou o quê e quando).
-- Feito pela app = "user"; feito pelo servidor (sincronização com o Google) = "sync".
-- Só regista mudanças que interessam (não as marcas internas da sincronização).
create function public.audit_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_actor text := case when (select auth.uid()) is null then 'sync' else 'user' end;
  v_action text;
  v_id text;
  v_detail jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
  else
    v_action := 'update';
    if tg_table_name <> 'tasks' then
      if new.deleted_at is distinct from old.deleted_at then
        v_action := case when new.deleted_at is null then 'create' else 'delete' end;
      end if;
    end if;
  end if;

  if tg_table_name = 'events' then
    if v_action = 'update' and (new.title, new.starts_at, new.ends_at, new.all_day, new.location, new.notes, new.rrule, new.exdates, new.category)
      is not distinct from (old.title, old.starts_at, old.ends_at, old.all_day, old.location, old.notes, old.rrule, old.exdates, old.category) then
      return null;
    end if;
    v_id := coalesce(new.id, old.id)::text;
    v_detail := jsonb_build_object('title', coalesce(new.title, old.title), 'start', coalesce(new.starts_at, old.starts_at));
  elsif tg_table_name = 'shift_days' then
    if v_action = 'update' and (new.code, new.extra) is not distinct from (old.code, old.extra) then
      return null;
    end if;
    v_id := coalesce(new.day, old.day)::text;
    v_detail := jsonb_build_object('day', coalesce(new.day, old.day), 'code', coalesce(new.code, old.code), 'before', case when v_action = 'update' then old.code end);
  else
    if v_action = 'update' and (new.title, new.done, new.due_date, new.due_time, new.priority, new.notes)
      is not distinct from (old.title, old.done, old.due_date, old.due_time, old.priority, old.notes) then
      return null;
    end if;
    if v_action = 'update' and new.done and not old.done then v_action := 'done'; end if;
    v_id := coalesce(new.id, old.id)::text;
    v_detail := jsonb_build_object('title', coalesce(new.title, old.title));
  end if;

  -- Ao apagar a conta, as linhas desaparecem em cascata: não há registo a guardar.
  if not exists (select 1 from auth.users where id = v_user) then return null; end if;
  insert into public.audit_log (user_id, actor, action, entity, entity_id, detail)
  values (v_user, v_actor, v_action, tg_table_name, v_id, v_detail);
  return null;
end $$;
revoke execute on function public.audit_changes() from public, anon, authenticated;

create trigger events_audit after insert or update or delete on public.events
  for each row execute function public.audit_changes();
create trigger shift_days_audit after insert or update or delete on public.shift_days
  for each row execute function public.audit_changes();
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function public.audit_changes();

-- O registo guarda 1 ano.
select cron.schedule('limpar-registo', '30 3 * * *', $c$delete from public.audit_log where created_at < now() - interval '1 year'$c$);

-- Primeira cópia já hoje.
select public.make_backups();
