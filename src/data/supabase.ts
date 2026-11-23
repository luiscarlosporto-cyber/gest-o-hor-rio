import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'

/** Está a correr dentro da app Android? */
export const isNative = Capacitor.isNativePlatform()
/** Endereço para onde o Google devolve o login na app Android (tem de estar nos Redirect URLs do Supabase). */
export const NATIVE_REDIRECT = 'pt.gestaohorario.app://login'

// Valores públicos (o URL e a chave publicável podem estar no browser; a segurança é feita pelo RLS).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

// Na app Android o login volta por um endereço próprio com um código (PKCE), trocado depois por uma sessão.
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, isNative ? { auth: { flowType: 'pkce', detectSessionInUrl: false } } : undefined) : null

/** Âmbitos pedidos ao Google: ver e editar eventos do calendário. */
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.events'
/** Só leitura do Gmail, pedido à parte quando o utilizador liga as sugestões. */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

export async function signInWithGoogle(opts: { gmail?: boolean } = {}) {
  if (!supabase) throw new Error('Supabase não configurado')
  const redirectTo = isNative ? NATIVE_REDIRECT : `${window.location.origin}${import.meta.env.BASE_URL}`
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: isNative,
      scopes: opts.gmail ? `${GOOGLE_SCOPES} ${GMAIL_SCOPE}` : GOOGLE_SCOPES,
      // offline + consent: o Google devolve um refresh token para a sincronização em segundo plano
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })
  if (error) throw error
  if (isNative && data.url) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url: data.url })
  }
}

export interface SyncResult {
  ok?: boolean
  error?: string
  reconnect?: boolean
  report?: { pushed: number; pulled: number; deleted: number; conflicts: number } | 'busy'
  found?: number
}

export async function callGoogle(action: 'connect' | 'sync' | 'disconnect' | 'gmail_scan', extra: Record<string, unknown> = {}): Promise<SyncResult> {
  if (!supabase) return { error: 'Supabase não configurado' }
  const { data, error } = await supabase.functions.invoke<SyncResult>('google', { body: { action, ...extra } })
  if (error) {
    // Erros HTTP trazem o corpo JSON com a mensagem em português
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        return (await ctx.json()) as SyncResult
      } catch {
        /* sem corpo */
      }
    }
    return { error: error.message }
  }
  return data ?? { error: 'Sem resposta' }
}
