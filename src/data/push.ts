// Notificações no telemóvel: ativar neste aparelho, testar e enviar ao servidor os avisos calculados.

import { buildReminders, type ReminderSettings } from '../domain/reminders'
import type { AppData } from '../domain/types'
import { supabase } from './supabase'

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushSupport = 'ok' | 'no-browser' | 'ios-install' | 'no-account'

export function pushSupport(): PushSupport {
  if (!supabase || !VAPID) return 'no-account'
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone
  if (ios && !standalone) return 'ios-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'no-browser'
  return 'ok'
}

const toKey = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

/** Está ativo neste aparelho? */
export async function deviceSubscribed(): Promise<boolean> {
  if (pushSupport() !== 'ok') return false
  const reg = await navigator.serviceWorker.getRegistration()
  return Boolean(await reg?.pushManager.getSubscription())
}

/** Pede autorização, subscreve e guarda o aparelho na conta. */
export async function enableOnDevice(): Promise<void> {
  if (pushSupport() !== 'ok' || !supabase) throw new Error('Este navegador não suporta notificações.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('As notificações foram recusadas. Ativa-as nas definições do navegador para esta app.')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(VAPID!) }))
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { data: u } = await supabase.auth.getUser()
  if (!u.user) throw new Error('Entra com a tua conta para ativar as notificações.')
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: u.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' })
  if (error) throw new Error(error.message)
}

export async function disableOnDevice(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

export async function sendTest(): Promise<{ devices: number; delivered: number }> {
  if (!supabase) throw new Error('Sem conta')
  const { data, error } = await supabase.functions.invoke<{ devices: number; delivered: number; error?: string }>('push', { body: { action: 'test' } })
  if (error || !data) throw new Error(data?.error ?? error?.message ?? 'Sem resposta')
  return data
}

/** Envia ao servidor os avisos dos próximos 14 dias (substitui os que ainda não foram enviados). */
export async function uploadReminders(data: AppData, settings: ReminderSettings | undefined): Promise<number> {
  if (!supabase) return 0
  const list = settings ? buildReminders(data, settings) : []
  const rows = list.map((r) => ({ key: r.key, fire_at: r.fireAt.toISOString(), title: r.title, body: r.body, url: r.url }))
  const { error } = await supabase.rpc('replace_reminders', { p_rows: rows })
  if (error) throw new Error(error.message)
  return rows.length
}
