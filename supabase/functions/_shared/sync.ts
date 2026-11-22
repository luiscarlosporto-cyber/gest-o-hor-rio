// Motor de sincronização bidirecional com o Google Calendar.
// Corre numa Edge Function com a chave de serviço (ignora RLS), sempre filtrado por user_id.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  googleShift,
  googleToRow,
  originalDateKey,
  originalStartParam,
  rowToGoogle,
  shiftToGoogle,
  type EventRow,
  type GEvent,
} from './gcal.ts'

const API = 'https://www.googleapis.com/calendar/v3'
const INITIAL_WINDOW_DAYS = 180

export class GoogleAuthError extends Error {}

export async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const body = await res.json()
  if (!res.ok) {
    if (body.error === 'invalid_grant') throw new GoogleAuthError('A ligação ao Google expirou ou foi retirada. Volta a ligar a conta.')
    throw new Error(`Google token: ${body.error ?? res.status} ${body.error_description ?? ''}`)
  }
  return body.access_token as string
}

async function g(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

async function gJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as T
}

interface DbEvent extends EventRow {
  id: string
  user_id: string
  dirty: boolean
  deleted_at: string | null
  updated_at: string
}

interface DbShift {
  user_id: string
  day: string
  code: string
  google_event_id: string | null
  google_etag: string | null
  dirty: boolean
  deleted_at: string | null
  updated_at: string
}

export interface SyncReport {
  pushed: number
  pulled: number
  deleted: number
  conflicts: number
}

const cal = (id: string) => encodeURIComponent(id)

/** Sincroniza um utilizador. Usa um "cadeado" na tabela para não correr duas vezes em paralelo. */
export async function syncUser(db: SupabaseClient, userId: string): Promise<SyncReport | 'busy'> {
  const { data: locked } = await db
    .from('google_accounts')
    .update({ sync_lock_until: new Date(Date.now() + 120_000).toISOString(), resync_requested: false })
    .eq('user_id', userId)
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${new Date().toISOString()}`)
    .select('user_id')
  if (!locked?.length) {
    await db.from('google_accounts').update({ resync_requested: true }).eq('user_id', userId)
    return 'busy'
  }

  const total: SyncReport = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0 }
  try {
    for (let round = 0; round < 3; round++) {
      const r = await syncOnce(db, userId)
      total.pushed += r.pushed
      total.pulled += r.pulled
      total.deleted += r.deleted
      total.conflicts += r.conflicts
      const { data } = await db.from('google_accounts').select('resync_requested').eq('user_id', userId).single()
      if (!data?.resync_requested) break
      await db.from('google_accounts').update({ resync_requested: false }).eq('user_id', userId)
    }
    await db
      .from('google_accounts')
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq('user_id', userId)
    return total
  } catch (e) {
    await db
      .from('google_accounts')
      .update({ last_error: e instanceof Error ? e.message : String(e) })
      .eq('user_id', userId)
    throw e
  } finally {
    await db.from('google_accounts').update({ sync_lock_until: null }).eq('user_id', userId)
  }
}

async function syncOnce(db: SupabaseClient, userId: string): Promise<SyncReport> {
  const { data: refresh, error: tokErr } = await db.rpc('read_google_token', { p_user: userId })
  if (tokErr || !refresh) throw new GoogleAuthError('Conta Google não ligada.')
  const token = await accessToken(refresh as string)
  const { data: account } = await db.from('google_accounts').select('*').eq('user_id', userId).single()
  const calendarId: string = account?.calendar_id ?? 'primary'

  const report: SyncReport = { pushed: 0, pulled: 0, deleted: 0, conflicts: 0 }
  // Primeiro ler (liga os turnos que já existem no Google aos do dia, sem duplicar), depois enviar.
  await pull(db, token, userId, calendarId, account?.sync_token ?? null, report)
  await pushEvents(db, token, userId, calendarId, report)
  await pushShifts(db, token, userId, calendarId, report)
  await ensureChannel(db, token, userId, calendarId, account)
  return report
}

// ---------- Enviar alterações locais ----------

async function clearDirty(db: SupabaseClient, table: 'events', id: string, updatedAt: string, patch: Record<string, unknown> = {}) {
  // Só limpa se ninguém mexeu entretanto (updated_at igual ao que foi enviado).
  await db.from(table).update({ ...patch, dirty: false }).eq('id', id).eq('updated_at', updatedAt)
}

async function pushEvents(db: SupabaseClient, token: string, userId: string, calendarId: string, report: SyncReport) {
  const { data: rows } = await db.from('events').select('*').eq('user_id', userId).eq('dirty', true)
  const dirty = ((rows ?? []) as DbEvent[]).sort((a, b) => Number(Boolean(a.recurring_event_id)) - Number(Boolean(b.recurring_event_id)))
  for (const row of dirty) {
    // Apagados
    if (row.deleted_at) {
      if (row.google_event_id) {
        const res = await g(token, `/calendars/${cal(calendarId)}/events/${encodeURIComponent(row.google_event_id)}`, { method: 'DELETE' })
        if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google ${res.status} ao apagar`)
      }
      await db.from('events').delete().eq('id', row.id).eq('updated_at', row.updated_at)
      report.deleted++
      continue
    }

    // Exceção de uma série: atualiza a instância correspondente no Google
    if (row.recurring_event_id) {
      const { data: master } = await db.from('events').select('*').eq('id', row.recurring_event_id).single()
      if (!master?.google_event_id) continue // a série ainda não foi enviada; fica para a próxima ronda
      let instanceId = row.google_event_id
      if (!instanceId && row.original_date) {
        const qs = new URLSearchParams({ originalStart: originalStartParam(row.original_date, master.starts_at.slice(0, 16), master.all_day) })
        const list = await gJson<{ items: GEvent[] }>(
          await g(token, `/calendars/${cal(calendarId)}/events/${encodeURIComponent(master.google_event_id)}/instances?${qs}`),
        )
        instanceId = list.items?.[0]?.id ?? null
      }
      if (!instanceId) continue
      const body = rowToGoogle({ ...row, rrule: null, starts_at: row.starts_at.slice(0, 16), ends_at: row.ends_at.slice(0, 16) })
      const res = await g(token, `/calendars/${cal(calendarId)}/events/${encodeURIComponent(instanceId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      const saved = await gJson<GEvent>(res)
      await clearDirty(db, 'events', row.id, row.updated_at, { google_event_id: saved.id, google_etag: saved.etag, google_calendar_id: calendarId })
      report.pushed++
      continue
    }

    // Série ou evento simples. As datas com exceção própria não vão como EXDATE.
    let keep = row.exdates ?? []
    if (row.rrule) {
      const { data: exc } = await db.from('events').select('original_date').eq('recurring_event_id', row.id).is('deleted_at', null)
      const withException = new Set((exc ?? []).map((e: { original_date: string }) => e.original_date))
      keep = keep.filter((d) => !withException.has(d))
    }
    const body = rowToGoogle({ ...row, starts_at: row.starts_at.slice(0, 16), ends_at: row.ends_at.slice(0, 16) }, keep)
    let res: Response
    if (row.google_event_id) {
      res = await g(token, `/calendars/${cal(calendarId)}/events/${encodeURIComponent(row.google_event_id)}`, {
        method: 'PATCH',
        headers: row.google_etag ? { 'If-Match': row.google_etag } : {},
        body: JSON.stringify(body),
      })
      if (res.status === 412) {
        // Mudou no Google depois da última sincronização: o Google ganha, a leitura a seguir atualiza.
        await clearDirty(db, 'events', row.id, row.updated_at)
        report.conflicts++
        continue
      }
      if (res.status === 404 || res.status === 410) {
        res = await g(token, `/calendars/${cal(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) })
      }
    } else {
      res = await g(token, `/calendars/${cal(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) })
    }
    const saved = await gJson<GEvent>(res)
    await clearDirty(db, 'events', row.id, row.updated_at, { google_event_id: saved.id, google_etag: saved.etag, google_calendar_id: calendarId })
    report.pushed++
  }
}

async function pushShifts(db: SupabaseClient, token: string, userId: string, calendarId: string, report: SyncReport) {
  const { data: rows } = await db.from('shift_days').select('*').eq('user_id', userId).eq('dirty', true)
  for (const s of (rows ?? []) as DbShift[]) {
    if (s.deleted_at) {
      if (s.google_event_id) {
        const res = await g(token, `/calendars/${cal(calendarId)}/events/${encodeURIComponent(s.google_event_id)}`, { method: 'DELETE' })
        if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google ${res.status} ao apagar turno`)
      }
      await db.from('shift_days').delete().eq('user_id', userId).eq('day', s.day).eq('updated_at', s.updated_at)
      report.deleted++
      continue
    }
    const body = shiftToGoogle({ day: s.day, code: s.code })
    let res = s.google_event_id
      ? await g(token, `/calendars/${cal(calendarId)}/events/${encodeURIComponent(s.google_event_id)}`, { method: 'PATCH', body: JSON.stringify(body) })
      : await g(token, `/calendars/${cal(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) })
    if (s.google_event_id && (res.status === 404 || res.status === 410)) {
      res = await g(token, `/calendars/${cal(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) })
    }
    const saved = await gJson<GEvent>(res)
    await db
      .from('shift_days')
      .update({ google_event_id: saved.id, google_etag: saved.etag, dirty: false })
      .eq('user_id', userId)
      .eq('day', s.day)
      .eq('updated_at', s.updated_at)
    report.pushed++
  }
}

// ---------- Receber alterações do Google ----------

async function pull(db: SupabaseClient, token: string, userId: string, calendarId: string, syncToken: string | null, report: SyncReport) {
  const items: GEvent[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | undefined
  let usingToken = syncToken
  for (;;) {
    const qs = new URLSearchParams({ maxResults: '250', showDeleted: 'true' })
    if (usingToken) qs.set('syncToken', usingToken)
    else qs.set('timeMin', new Date(Date.now() - INITIAL_WINDOW_DAYS * 864e5).toISOString())
    if (pageToken) qs.set('pageToken', pageToken)
    const res = await g(token, `/calendars/${cal(calendarId)}/events?${qs}`)
    if (res.status === 410 && usingToken) {
      // Token inválido: recomeçar do zero.
      usingToken = null
      pageToken = undefined
      items.length = 0
      continue
    }
    const page = await gJson<{ items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }>(res)
    items.push(...(page.items ?? []))
    pageToken = page.nextPageToken
    if (!pageToken) {
      nextSyncToken = page.nextSyncToken
      break
    }
  }

  const { data: types } = await db.from('shift_types').select('code').eq('user_id', userId)
  const codes = (types ?? []).map((t: { code: string }) => t.code)

  // Séries e eventos simples primeiro, depois as exceções (que apontam para a série).
  items.sort((a, b) => Number(Boolean(a.recurringEventId)) - Number(Boolean(b.recurringEventId)))
  for (const ev of items) {
    if (await applyRemote(db, userId, calendarId, ev, codes)) report.pulled++
  }

  if (nextSyncToken) await db.from('google_accounts').update({ sync_token: nextSyncToken }).eq('user_id', userId)
}

async function applyRemote(db: SupabaseClient, userId: string, calendarId: string, ev: GEvent, codes: string[]): Promise<boolean> {
  // Turno?
  const { data: shift } = await db.from('shift_days').select('*').eq('user_id', userId).eq('google_event_id', ev.id).maybeSingle()
  if (shift) {
    if (shift.dirty) return false
    if (ev.status === 'cancelled') {
      await db.from('shift_days').delete().eq('user_id', userId).eq('day', shift.day)
      return true
    }
    if (shift.google_etag === ev.etag) return false
    const parsed = googleShift(ev, codes)
    if (parsed && parsed.day === shift.day) {
      await db.from('shift_days').update({ code: parsed.code, google_etag: ev.etag }).eq('user_id', userId).eq('day', shift.day)
      return true
    }
    // Deixou de ser um turno (mudou de dia ou de título): passa a evento normal.
    await db.from('shift_days').delete().eq('user_id', userId).eq('day', shift.day)
  } else if (ev.status !== 'cancelled') {
    const parsed = googleShift(ev, codes)
    if (parsed) {
      const { data: sameDay } = await db.from('shift_days').select('*').eq('user_id', userId).eq('day', parsed.day).maybeSingle()
      if (sameDay && !sameDay.google_event_id) {
        // O dia já tem turno na app: liga-o a este evento em vez de criar outro.
        // Se o código for diferente, a app ganha e o envio a seguir corrige o Google.
        await db
          .from('shift_days')
          .update({ google_event_id: ev.id, google_etag: ev.etag, dirty: sameDay.code !== parsed.code })
          .eq('user_id', userId)
          .eq('day', parsed.day)
        return true
      }
      if (sameDay?.dirty) return false
      if (sameDay?.google_event_id && sameDay.google_event_id !== ev.id) {
        // Dois eventos de turno no mesmo dia no Google: fica o que já estava ligado.
        return false
      }
      await db.from('shift_days').upsert({ user_id: userId, day: parsed.day, code: parsed.code, google_event_id: ev.id, google_etag: ev.etag, dirty: false, deleted_at: null })
      return true
    }
  }

  const { data: local } = await db.from('events').select('*').eq('user_id', userId).eq('google_event_id', ev.id).maybeSingle()
  if (local?.dirty) return false

  // Instância cancelada de uma série → data excluída na série
  if (ev.status === 'cancelled') {
    if (ev.recurringEventId) {
      const day = originalDateKey(ev.originalStartTime)
      const { data: master } = await db.from('events').select('id, exdates').eq('user_id', userId).eq('google_event_id', ev.recurringEventId).maybeSingle()
      if (master && day && !(master.exdates ?? []).includes(day)) {
        await db.from('events').update({ exdates: [...(master.exdates ?? []), day] }).eq('id', master.id)
      }
    }
    if (local) {
      await db.from('events').delete().eq('id', local.id)
      return true
    }
    return Boolean(ev.recurringEventId)
  }

  if (local && local.google_etag === ev.etag) return false
  const row = googleToRow(ev)
  if (!row) return false

  let link: { recurring_event_id?: string; original_date?: string | null } = {}
  if (ev.recurringEventId) {
    const { data: master } = await db.from('events').select('id, exdates').eq('user_id', userId).eq('google_event_id', ev.recurringEventId).maybeSingle()
    if (!master) return false // série fora da janela importada
    const day = originalDateKey(ev.originalStartTime)
    link = { recurring_event_id: master.id, original_date: day }
    if (day && !(master.exdates ?? []).includes(day)) {
      await db.from('events').update({ exdates: [...(master.exdates ?? []), day] }).eq('id', master.id)
    }
  }

  const values = { ...row, ...link, user_id: userId, google_calendar_id: calendarId, dirty: false, deleted_at: null }
  if (local) {
    // Mantém a categoria local se o Google não a trouxer.
    if (!ev.extendedProperties?.private?.gh_category) values.category = local.category
    // Mantém as exceções locais que o Google representa como instâncias.
    if (row.rrule) values.exdates = [...new Set([...(row.exdates ?? []), ...(local.exdates ?? [])])].sort()
    await db.from('events').update(values).eq('id', local.id)
  } else {
    await db.from('events').insert(values)
  }
  return true
}

// ---------- Notificações push do Google ----------

async function ensureChannel(
  db: SupabaseClient,
  token: string,
  userId: string,
  calendarId: string,
  account: { channel_id?: string; channel_resource_id?: string; channel_expires_at?: string } | null,
) {
  const webhook = Deno.env.get('GOOGLE_WEBHOOK_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-webhook`
  const expires = account?.channel_expires_at ? Date.parse(account.channel_expires_at) : 0
  if (account?.channel_id && expires - Date.now() > 24 * 3600_000) return

  if (account?.channel_id && account.channel_resource_id) {
    await g(token, '/channels/stop', { method: 'POST', body: JSON.stringify({ id: account.channel_id, resourceId: account.channel_resource_id }) })
  }
  const id = crypto.randomUUID()
  const channelToken = crypto.randomUUID()
  const res = await g(token, `/calendars/${cal(calendarId)}/events/watch`, {
    method: 'POST',
    body: JSON.stringify({ id, type: 'web_hook', address: webhook, token: channelToken, params: { ttl: String(7 * 24 * 3600) } }),
  })
  if (!res.ok) {
    // Sem notificações push a app continua a sincronizar quando abre; não é fatal.
    console.warn('watch falhou', res.status, await res.text())
    return
  }
  const ch = (await res.json()) as { resourceId: string; expiration: string }
  await db
    .from('google_accounts')
    .update({ channel_id: id, channel_token: channelToken, channel_resource_id: ch.resourceId, channel_expires_at: new Date(Number(ch.expiration)).toISOString() })
    .eq('user_id', userId)
}

export async function stopChannel(token: string, channelId: string, resourceId: string) {
  await g(token, '/channels/stop', { method: 'POST', body: JSON.stringify({ id: channelId, resourceId }) })
}
