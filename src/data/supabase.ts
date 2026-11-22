import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Valores públicos (o URL e a chave publicável podem estar no browser; a segurança é feita pelo RLS).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

/** Âmbitos pedidos ao Google: ver e editar eventos do calendário. */
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.events'

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Supabase não configurado')
  const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      scopes: GOOGLE_SCOPES,
      // offline + consent: o Google devolve um refresh token para a sincronização em segundo plano
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })
  if (error) throw error
}

export interface SyncResult {
  ok?: boolean
  error?: string
  reconnect?: boolean
  report?: { pushed: number; pulled: number; deleted: number; conflicts: number } | 'busy'
}

export async function callGoogle(action: 'connect' | 'sync' | 'disconnect', extra: Record<string, unknown> = {}): Promise<SyncResult> {
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
