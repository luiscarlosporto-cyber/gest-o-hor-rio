// Só na app Android: receber o login do Google, abrir a app a partir de uma notificação
// e mostrar os lembretes como notificações do próprio telemóvel (sem servidor nem Firebase).

import { buildReminders, type ReminderSettings } from './domain/reminders'
import type { AppData } from './domain/types'
import { isNative, NATIVE_REDIRECT, supabase } from './data/supabase'

export { isNative }

/** Liga os ouvintes da app nativa. Chamar uma vez no arranque. */
export async function setupNative(): Promise<void> {
  if (!isNative) return
  const [{ App }, { Browser }, { LocalNotifications }] = await Promise.all([import('@capacitor/app'), import('@capacitor/browser'), import('@capacitor/local-notifications')])

  // O Google devolve "pt.gestaohorario.app://login?code=…": troca-se o código por uma sessão.
  await App.addListener('appUrlOpen', async ({ url }) => {
    if (!url.startsWith(NATIVE_REDIRECT)) return
    const u = new URL(url)
    const code = u.searchParams.get('code')
    const err = u.searchParams.get('error_description')
    await Browser.close().catch(() => undefined)
    if (code && supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) alertLater(`Não foi possível entrar: ${error.message}`)
    } else if (err) alertLater(err)
  })

  // Tocar numa notificação abre o sítio certo da app (#dia/…, #turnos/…, #tarefas).
  await LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const target = (notification.extra as { url?: string } | undefined)?.url
    if (target) window.location.hash = target
  })
}

const alertLater = (msg: string) => setTimeout(() => window.alert(msg), 0)

/** Número estável (32 bits) a partir da chave do aviso, para poder substituir a notificação. */
export function notificationId(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return (h >>> 1) || 1
}

export async function nativePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  const p = await LocalNotifications.checkPermissions()
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt'
}

export async function requestNativePermission(): Promise<boolean> {
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  const p = await LocalNotifications.requestPermissions()
  return p.display === 'granted'
}

/** Substitui as notificações agendadas no telemóvel pelas dos próximos 14 dias. */
export async function scheduleNative(data: AppData, settings: ReminderSettings | undefined, now = new Date()): Promise<number> {
  if (!isNative) return 0
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) })
  if (!settings?.enabled || (await nativePermission()) !== 'granted') return 0
  const list = buildReminders(data, settings, now).filter((r) => r.fireAt > now)
  if (!list.length) return 0
  await LocalNotifications.schedule({
    notifications: list.slice(0, 60).map((r) => ({
      id: notificationId(r.key),
      title: r.title,
      body: r.body,
      schedule: { at: r.fireAt, allowWhileIdle: true },
      extra: { url: r.url },
    })),
  })
  return Math.min(list.length, 60)
}

export async function testNative(): Promise<void> {
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  await LocalNotifications.schedule({ notifications: [{ id: 1, title: 'Gestão Horário', body: 'As notificações estão a funcionar neste telemóvel.', schedule: { at: new Date(Date.now() + 3000) } }] })
}
