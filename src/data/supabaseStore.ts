import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_SHIFT_TYPES } from '../domain/shifts'
import type { AppData, CalendarEvent, ShiftDay, ShiftType } from '../domain/types'
import type { DataStore } from './store'

interface EventRow {
  id: string
  user_id: string
  title: string
  starts_at: string
  ends_at: string
  all_day: boolean
  category: CalendarEvent['category']
  location: string | null
  notes: string | null
  rrule: string | null
  exdates: string[]
  recurring_event_id: string | null
  original_date: string | null
  transparent: boolean | null
  created_at?: string
  updated_at?: string
  dirty?: boolean
  deleted_at?: string | null
}

interface ShiftTypeRow {
  user_id: string
  code: string
  label: string
  start_time: string | null
  end_time: string | null
  color: string
  is_work: boolean
  sort_order: number
}

const hm = (t: string | null) => (t ? t.slice(0, 5) : undefined)

export function rowToEvent(r: EventRow): CalendarEvent {
  return {
    id: r.id,
    title: r.title,
    start: r.starts_at.slice(0, 16),
    end: r.ends_at.slice(0, 16),
    allDay: r.all_day,
    category: r.category,
    location: r.location ?? undefined,
    notes: r.notes ?? undefined,
    rrule: r.rrule ?? undefined,
    exdates: r.exdates?.length ? r.exdates : undefined,
    recurringEventId: r.recurring_event_id ?? undefined,
    originalDate: r.original_date ?? undefined,
    transparent: r.transparent ?? undefined,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  }
}

export function eventToRow(e: CalendarEvent, userId: string): EventRow {
  return {
    id: e.id,
    user_id: userId,
    title: e.title,
    starts_at: e.start,
    ends_at: e.end,
    all_day: e.allDay,
    category: e.category,
    location: e.location ?? null,
    notes: e.notes ?? null,
    rrule: e.rrule ?? null,
    exdates: e.exdates ?? [],
    recurring_event_id: e.recurringEventId ?? null,
    original_date: e.originalDate ?? null,
    transparent: e.transparent ?? null,
    dirty: true,
    deleted_at: null,
  }
}

/** Campos que interessam para decidir se um evento mudou (ignora carimbos de data). */
const eventKey = (e: CalendarEvent) =>
  JSON.stringify([e.title, e.start, e.end, e.allDay, e.category, e.location, e.notes, e.rrule, e.exdates, e.recurringEventId, e.originalDate, e.transparent])

/**
 * Guarda no Supabase. Compara com o último estado conhecido e só envia o que mudou,
 * marcado como "dirty" para a sincronização com o Google. Apagar é um "soft delete"
 * para que a sincronização também apague no Google.
 */
export class SupabaseStore implements DataStore {
  readonly kind = 'supabase' as const
  private db: SupabaseClient
  private userId: string
  private last: AppData | null = null
  private queue: Promise<void> = Promise.resolve()
  onSaved?: () => void

  constructor(db: SupabaseClient, userId: string) {
    this.db = db
    this.userId = userId
  }

  async load(): Promise<AppData> {
    const [ev, sd, st] = await Promise.all([
      this.db.from('events').select('*').is('deleted_at', null),
      this.db.from('shift_days').select('day, code').is('deleted_at', null),
      this.db.from('shift_types').select('*').order('sort_order'),
    ])
    for (const r of [ev, sd, st]) if (r.error) throw new Error(r.error.message)
    const types = (st.data as ShiftTypeRow[]).map<ShiftType>((t) => ({
      code: t.code,
      label: t.label,
      start: hm(t.start_time),
      end: hm(t.end_time),
      color: t.color,
      work: t.is_work,
    }))
    const data: AppData = {
      version: 1,
      events: (ev.data as EventRow[]).map(rowToEvent),
      shiftDays: (sd.data as { day: string; code: string }[]).map<ShiftDay>((r) => ({ date: r.day, code: r.code })),
      shiftTypes: types.length ? types : DEFAULT_SHIFT_TYPES,
    }
    this.last = data
    return data
  }

  save(next: AppData): Promise<void> {
    // Gravações em fila, pela ordem em que acontecem.
    this.queue = this.queue.then(() => this.write(next)).then(() => this.onSaved?.())
    return this.queue
  }

  private async write(next: AppData) {
    const prev = this.last ?? { version: 1 as const, events: [], shiftDays: [], shiftTypes: [] }
    this.last = next
    const uid = this.userId
    const now = new Date().toISOString()

    // Eventos
    const prevEv = new Map(prev.events.map((e) => [e.id, e]))
    const nextEv = new Map(next.events.map((e) => [e.id, e]))
    const changed = next.events
      .filter((e) => !prevEv.has(e.id) || eventKey(prevEv.get(e.id)!) !== eventKey(e))
      .sort((a, b) => Number(Boolean(a.recurringEventId)) - Number(Boolean(b.recurringEventId)))
      .map((e) => eventToRow(e, uid))
    const removed = prev.events.filter((e) => !nextEv.has(e.id)).map((e) => e.id)
    if (changed.length) await check(this.db.from('events').upsert(changed))
    if (removed.length) await check(this.db.from('events').update({ deleted_at: now, dirty: true }).in('id', removed))

    // Turnos
    const prevSd = new Map(prev.shiftDays.map((d) => [d.date, d.code]))
    const nextSd = new Map(next.shiftDays.map((d) => [d.date, d.code]))
    const sdChanged = next.shiftDays
      .filter((d) => prevSd.get(d.date) !== d.code)
      .map((d) => ({ user_id: uid, day: d.date, code: d.code, dirty: true, deleted_at: null }))
    const sdRemoved = prev.shiftDays.filter((d) => !nextSd.has(d.date)).map((d) => d.date)
    if (sdChanged.length) await check(this.db.from('shift_days').upsert(sdChanged))
    if (sdRemoved.length) await check(this.db.from('shift_days').update({ deleted_at: now, dirty: true }).eq('user_id', uid).in('day', sdRemoved))

    // Tipos de turno (não vão para o Google)
    if (JSON.stringify(prev.shiftTypes) !== JSON.stringify(next.shiftTypes)) {
      const rows = next.shiftTypes.map<ShiftTypeRow>((t, i) => ({
        user_id: uid,
        code: t.code,
        label: t.label,
        start_time: t.start && t.end ? t.start : null,
        end_time: t.start && t.end ? t.end : null,
        color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#D9D9D9',
        is_work: t.work,
        sort_order: i,
      }))
      if (rows.length) await check(this.db.from('shift_types').upsert(rows))
      const gone = prev.shiftTypes.filter((t) => !next.shiftTypes.some((n) => n.code === t.code)).map((t) => t.code)
      if (gone.length) await check(this.db.from('shift_types').delete().eq('user_id', uid).in('code', gone))
    }
  }
}

async function check(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  if (error) throw new Error(error.message)
}
