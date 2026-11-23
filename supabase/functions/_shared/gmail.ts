// Leitura do Gmail (só leitura) para sugerir compromissos. Nunca envia, apaga ou altera emails.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { detectCommitment, type MailInput } from './commitments.ts'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

/** Diz se o token de acesso inclui leitura do Gmail. */
export async function hasGmailScope(accessToken: string): Promise<boolean> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`)
  if (!res.ok) return false
  const info = (await res.json()) as { scope?: string }
  return (info.scope ?? '').split(' ').includes(GMAIL_SCOPE)
}

interface GmailMessage {
  id: string
  snippet?: string
  internalDate?: string
  payload?: { headers?: { name: string; value: string }[] }
}

const decode = (s: string) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

/** Lê os emails recentes e guarda sugestões novas. Devolve quantas sugestões novas criou. */
export async function scanGmail(db: SupabaseClient, token: string, userId: string, since: string | null): Promise<number> {
  // Primeira vez: últimos 14 dias. Depois: desde a última leitura (com 1 dia de margem).
  const from = since ? Math.floor(Date.parse(since) / 1000) - 86400 : Math.floor(Date.now() / 1000) - 14 * 86400
  const q = `after:${from} -category:promotions -category:social -category:forums -in:chats -in:sent -in:drafts`
  const list = await fetch(`${API}/messages?${new URLSearchParams({ q, maxResults: '60' })}`, { headers: { Authorization: `Bearer ${token}` } })
  if (list.status === 403) throw new Error('O Gmail não autorizou a leitura. Ativa a Gmail API no Google Cloud e volta a ligar o Gmail.')
  if (!list.ok) throw new Error(`Gmail ${list.status}: ${(await list.text()).slice(0, 200)}`)
  const ids = (((await list.json()) as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id)
  if (!ids.length) return 0

  const { data: known } = await db.from('suggestions').select('gmail_id').eq('user_id', userId).in('gmail_id', ids)
  const seen = new Set((known ?? []).map((r: { gmail_id: string }) => r.gmail_id))

  const rows = []
  for (const id of ids.filter((x) => !seen.has(x))) {
    const qs = new URLSearchParams({ format: 'metadata' })
    qs.append('metadataHeaders', 'Subject')
    qs.append('metadataHeaders', 'From')
    const res = await fetch(`${API}/messages/${id}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) continue
    const msg = (await res.json()) as GmailMessage
    const header = (n: string) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? ''
    const mail: MailInput = {
      id,
      subject: header('Subject'),
      from: header('From'),
      snippet: decode(msg.snippet ?? ''),
      received: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
    }
    const s = detectCommitment(mail)
    if (s) rows.push({ ...s, user_id: userId })
  }
  if (rows.length) {
    const { error } = await db.from('suggestions').upsert(rows, { onConflict: 'user_id,gmail_id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
  }
  await db.from('google_accounts').update({ gmail_scanned_at: new Date().toISOString() }).eq('user_id', userId)
  return rows.length
}
