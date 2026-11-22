// Recebe as notificações push do Google Calendar e sincroniza o utilizador desse canal.
// Sem JWT: a autenticação é o par (X-Goog-Channel-ID, X-Goog-Channel-Token) guardado ao criar o canal.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { syncUser } from '../_shared/sync.ts'

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  const channelId = req.headers.get('X-Goog-Channel-ID')
  const channelToken = req.headers.get('X-Goog-Channel-Token')
  const state = req.headers.get('X-Goog-Resource-State')
  if (!channelId || !channelToken) return new Response('missing', { status: 400 })
  if (state === 'sync') return new Response('ok') // primeira mensagem do canal

  const db = admin()
  const { data: acc } = await db
    .from('google_accounts')
    .select('user_id')
    .eq('channel_id', channelId)
    .eq('channel_token', channelToken)
    .maybeSingle()
  if (!acc) return new Response('unknown channel', { status: 404 }) // o Google deixa de enviar

  const work = syncUser(db, acc.user_id).catch((e) => console.error('webhook sync', e instanceof Error ? e.message : e))
  // Responder já ao Google; a sincronização continua em segundo plano.
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(work)
  else await work
  return new Response('ok')
})
