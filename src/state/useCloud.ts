import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LocalStore, type DataStore } from '../data/store'
import { callGoogle, supabase, type SyncResult } from '../data/supabase'
import { SupabaseStore } from '../data/supabaseStore'

export interface GoogleStatus {
  google_email: string | null
  last_synced_at: string | null
  last_error: string | null
  gmail_enabled?: boolean
  gmail_scanned_at?: string | null
}

export type SyncState = 'idle' | 'syncing' | 'error'

/**
 * Sessão, armazenamento e sincronização.
 * Sem sessão: dados no browser. Com sessão: dados no Supabase e sincronização com o Google.
 */
export function useCloud(injected?: DataStore) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabase || Boolean(injected))
  const [google, setGoogle] = useState<GoogleStatus | null>(null)
  const [sync, setSync] = useState<SyncState>('idle')
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const onSynced = useRef<() => void>(() => {})

  useEffect(() => {
    if (!supabase || injected) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // O refresh token do Google só aparece logo a seguir ao login: guardá-lo no servidor.
      if (event === 'SIGNED_IN' && s?.provider_refresh_token) {
        const token = s.provider_refresh_token
        setSync('syncing')
        setSyncMessage('A ligar ao Google Calendar…')
        callGoogle('connect', { refresh_token: token }).then((r) => finish(r))
      }
    })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected])

  const userId = session?.user.id
  const store = useMemo<DataStore>(() => {
    if (injected) return injected
    if (supabase && userId) return new SupabaseStore(supabase, userId)
    return new LocalStore()
  }, [injected, userId])

  const refreshStatus = useCallback(async () => {
    if (!supabase || !userId) return setGoogle(null)
    const { data } = await supabase.from('google_status').select('google_email, last_synced_at, last_error, gmail_enabled, gmail_scanned_at').maybeSingle()
    setGoogle((data as GoogleStatus | null) ?? null)
  }, [userId])

  const finish = useCallback(
    (r: SyncResult) => {
      if (r.error) {
        setSync('error')
        setSyncMessage(r.reconnect ? `${r.error}` : `Não foi possível sincronizar: ${r.error}`)
      } else {
        setSync('idle')
        const rep = r.report
        setSyncMessage(
          rep && rep !== 'busy' && rep.pulled + rep.pushed + rep.deleted > 0
            ? `Sincronizado: ${rep.pulled} recebidos, ${rep.pushed} enviados${rep.deleted ? `, ${rep.deleted} apagados` : ''}.`
            : null,
        )
        onSynced.current()
      }
      refreshStatus()
    },
    [refreshStatus],
  )

  const syncNow = useCallback(async () => {
    if (!supabase || !userId) return
    setSync('syncing')
    finish(await callGoogle('sync'))
  }, [finish, userId])

  /** Lê os emails recentes no servidor e devolve quantas sugestões novas encontrou. */
  const scanGmail = useCallback(async (): Promise<SyncResult> => {
    if (!supabase || !userId) return { error: 'Sem sessão' }
    const r = await callGoogle('gmail_scan')
    refreshStatus()
    return r
  }, [userId, refreshStatus])

  const disconnectGoogle = useCallback(async () => {
    await callGoogle('disconnect')
    await refreshStatus()
  }, [refreshStatus])

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut()
    setGoogle(null)
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  return { ready, session, store, google, sync, syncMessage, syncNow, scanGmail, disconnectGoogle, signOut, onSynced, refreshStatus }
}
