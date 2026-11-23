// Direitos sobre os dados (RGPD): apagar a conta e tudo o que lhe pertence.
// Exportar é feito na própria app (lê as tabelas com as permissões do utilizador).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/cors.ts'

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

async function accessToken(refresh: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '', client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '', refresh_token: refresh, grant_type: 'refresh_token' }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error('Google token')
  return body.access_token as string
}

async function stopChannel(token: string, id: string, resourceId: string) {
  const res = await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, resourceId }),
  })
  await res.body?.cancel()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não suportado' }, 405)
  const db = admin()
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const { data: auth, error: authErr } = await db.auth.getUser(jwt)
  if (authErr || !auth.user) return json({ error: 'Sessão inválida' }, 401)
  const userId = auth.user.id

  let body: { action?: string; confirm?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Pedido inválido' }, 400)
  }
  if (body.action !== 'delete') return json({ error: 'Ação desconhecida' }, 400)
  if (body.confirm !== 'APAGAR') return json({ error: 'Escreve APAGAR para confirmar.' }, 400)

  // 1. Retirar o acesso ao Google (canal de avisos e autorização). Os eventos no Google ficam lá.
  try {
    const { data: acc } = await db.from('google_accounts').select('channel_id, channel_resource_id').eq('user_id', userId).maybeSingle()
    const { data: refresh } = await db.rpc('read_google_token', { p_user: userId })
    if (refresh) {
      if (acc?.channel_id && acc.channel_resource_id) await stopChannel(await accessToken(refresh as string), acc.channel_id, acc.channel_resource_id).catch(() => undefined)
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh as string)}`, { method: 'POST' })
        .then((r) => r.body?.cancel())
        .catch(() => undefined)
    }
  } catch {
    /* segue: apagar a conta é mais importante */
  }

  // 2. Apagar o utilizador: todas as tabelas apagam em cascata e o token sai do Vault (trigger).
  const { error } = await db.auth.admin.deleteUser(userId)
  if (error) return json({ error: `Não foi possível apagar a conta: ${error.message}` }, 500)
  return json({ ok: true })
})
