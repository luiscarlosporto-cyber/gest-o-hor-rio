// Ligar, sincronizar e desligar a conta Google do utilizador autenticado.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/cors.ts'
import { accessToken, GoogleAuthError, stopChannel, syncUser } from '../_shared/sync.ts'

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)

  const db = admin()
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const { data: auth, error: authErr } = await db.auth.getUser(jwt)
  if (authErr || !auth.user) return json({ error: 'Sessão inválida' }, 401)
  const user = auth.user

  let body: { action?: string; refresh_token?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Pedido inválido' }, 400)
  }

  try {
    if (body.action === 'connect') {
      if (!body.refresh_token) return json({ error: 'Falta a autorização do Google. Volta a entrar com o Google.' }, 400)
      await accessToken(body.refresh_token) // confirma que o token funciona antes de o guardar
      const { error } = await db.rpc('store_google_token', { p_user: user.id, p_token: body.refresh_token, p_email: user.email ?? null })
      if (error) throw error
      await db.from('audit_log').insert({ user_id: user.id, actor: 'user', action: 'google_connect', entity: 'google_accounts' })
      const report = await syncUser(db, user.id)
      return json({ ok: true, report })
    }

    if (body.action === 'sync') {
      const report = await syncUser(db, user.id)
      return json({ ok: true, report })
    }

    if (body.action === 'disconnect') {
      const { data: acc } = await db.from('google_accounts').select('channel_id, channel_resource_id').eq('user_id', user.id).maybeSingle()
      if (acc?.channel_id && acc.channel_resource_id) {
        try {
          const { data: refresh } = await db.rpc('read_google_token', { p_user: user.id })
          if (refresh) await stopChannel(await accessToken(refresh as string), acc.channel_id, acc.channel_resource_id)
        } catch {
          /* o canal expira sozinho */
        }
      }
      await db.from('google_accounts').delete().eq('user_id', user.id)
      await db.from('audit_log').insert({ user_id: user.id, actor: 'user', action: 'google_disconnect', entity: 'google_accounts' })
      return json({ ok: true })
    }

    return json({ error: 'Ação desconhecida' }, 400)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('google', body.action, message)
    return json({ error: message, reconnect: e instanceof GoogleAuthError }, e instanceof GoogleAuthError ? 409 : 500)
  }
})
