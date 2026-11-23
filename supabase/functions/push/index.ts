// Envia as notificações dos lembretes (Web Push).
// - "send_due": chamado pelo pg_cron de minuto a minuto, com o segredo x-cron-secret.
// - "test": o utilizador autenticado pede uma notificação de teste para os seus aparelhos.
// As chaves VAPID e o segredo do cron estão no Vault do Supabase (read_push_config), nunca no código.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { cors, json } from '../_shared/cors.ts'

const APP_URL = 'https://luiscarlosporto-cyber.github.io/gest-o-hor-rio/'
const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

interface Sub {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}
interface Payload {
  title: string
  body: string
  url: string
  tag?: string
}

interface PushConfig {
  vapid_public_key: string
  vapid_private_key: string
  push_cron_secret: string
}
let config: PushConfig | null = null
async function loadConfig(db: SupabaseClient): Promise<PushConfig> {
  if (config) return config
  const { data, error } = await db.rpc('read_push_config')
  if (error || !data?.vapid_private_key) throw new Error('Configuração de notificações em falta')
  const c = data as PushConfig
  webpush.setVapidDetails(APP_URL, c.vapid_public_key, c.vapid_private_key)
  config = c
  return c
}

/** Envia para um aparelho. Devolve "gone" quando o aparelho já não aceita (apagar a subscrição). */
async function send(sub: Sub, p: Payload): Promise<'ok' | 'gone' | 'error'> {
  const req = webpush.generateRequestDetails({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(p), { TTL: 3600, urgency: 'high' })
  try {
    const res = await fetch(req.endpoint, { method: req.method, headers: req.headers as HeadersInit, body: req.body as BodyInit })
    await res.body?.cancel()
    if (res.status === 404 || res.status === 410) return 'gone'
    return res.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

async function sendToUser(db: SupabaseClient, userId: string, p: Payload) {
  const { data } = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').eq('user_id', userId)
  const subs = (data ?? []) as Sub[]
  let delivered = 0
  for (const s of subs) {
    const r = await send(s, p)
    if (r === 'ok') delivered++
    if (r === 'gone') await db.from('push_subscriptions').delete().eq('id', s.id)
  }
  return { devices: subs.length, delivered }
}

async function sendDue(db: SupabaseClient) {
  const now = new Date()
  const since = new Date(now.getTime() - 30 * 60_000).toISOString()
  // Avisos que ficaram para trás mais de 30 min já não interessam.
  await db.from('reminders').delete().is('sent_at', null).lt('fire_at', since)
  await db.from('reminders').delete().lt('sent_at', new Date(now.getTime() - 30 * 86_400_000).toISOString())
  const { data, error } = await db
    .from('reminders')
    .select('user_id, key, title, body, url')
    .is('sent_at', null)
    .lte('fire_at', now.toISOString())
    .order('fire_at')
    .limit(500)
  if (error) throw error
  let sent = 0
  for (const r of data ?? []) {
    // Marca primeiro: se esta chamada falhar a meio, o aviso não é repetido no minuto seguinte.
    const { data: claimed } = await db.from('reminders').update({ sent_at: now.toISOString() }).eq('user_id', r.user_id).eq('key', r.key).is('sent_at', null).select('key')
    if (!claimed?.length) continue
    const res = await sendToUser(db, r.user_id, { title: r.title, body: r.body, url: r.url, tag: r.key })
    sent += res.delivered
  }
  return { due: data?.length ?? 0, sent }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)
  const db = admin()
  let cronSecret: string
  try {
    cronSecret = (await loadConfig(db)).push_cron_secret
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
  const given = req.headers.get('x-cron-secret')
  if (given) {
    if (given !== cronSecret) return json({ error: 'Não autorizado' }, 401)
    try {
      return json({ ok: true, ...(await sendDue(db)) })
    } catch (e) {
      return json({ error: String(e) }, 500)
    }
  }

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const { data: auth, error: authErr } = await db.auth.getUser(jwt)
  if (authErr || !auth.user) return json({ error: 'Sessão inválida' }, 401)
  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Pedido inválido' }, 400)
  }
  if (body.action === 'test') {
    const res = await sendToUser(db, auth.user.id, { title: 'Gestão Horário', body: 'As notificações estão a funcionar neste aparelho.', url: '', tag: 'teste' })
    await db.from('audit_log').insert({ user_id: auth.user.id, actor: 'user', action: 'push_test', entity: 'push_subscriptions', detail: res })
    return json({ ok: true, ...res })
  }
  return json({ error: 'Ação desconhecida' }, 400)
})
