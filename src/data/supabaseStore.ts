import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_SHIFT_TYPES } from '../domain/shifts'
import type { Task } from '../domain/tasks'
import type { AppData, CalendarEvent, PaySettings, ShiftDay, ShiftType } from '../domain/types'
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
  paid_hours?: number | null
  color: string
  is_work: boolean
  sort_order: number
}

interface TaskRow {
  id: string
  user_id: string
  title: string
  notes: string | null
  due_date: string | null
  due_time: string | null
  priority: Task['priority']
  done: boolean
  done_at: string | null
  source: string
  created_at?: string
  updated_at?: string
}

const hm = (t: string | null) => (t ? t.slice(0, 5) : undefined)

export const rowToTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes ?? undefined,
  due: r.due_date ?? undefined,
  dueTime: hm(r.due_time),
  priority: r.priority,
  done: r.done,
  doneAt: r.done_at ?? undefined,
  source: r.source === 'gmail' ? 'gmail' : 'manual',
  createdAt: r.created_at ?? '',
  updatedAt: r.updated_at ?? '',
})

export const taskToRow = (t: Task, userId: string): TaskRow => ({
  id: t.id,
  user_id: userId,
  title: t.title,
  notes: t.notes ?? null,
  due_date: t.due ?? null,
  due_time: t.due && t.dueTime ? t.dueTime : null,
  priority: t.priority,
  done: t.done,
  done_at: t.doneAt ?? null,
  source: t.source ?? 'manual',
})

const taskKey = (t: Task) => JSON.stringify([t.title, t.notes, t.due, t.dueTime, t.priority, t.done, t.doneAt])

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
    const [ev, sd, st, tk, pr] = await Promise.all([
      this.db.from('events').select('*').is('deleted_at', null),
      this.db.from('shift_days').select('day, code, extra').is('deleted_at', null),
      this.db.from('shift_types').select('*').order('sort_order'),
      this.db.from('tasks').select('*'),
      this.db.from('profiles').select('pay_settings').eq('id', this.userId).maybeSingle(),
    ])
    for (const r of [ev, sd, st, tk, pr]) if (r.error) throw new Error(r.error.message)
    const types = (st.data as ShiftTypeRow[]).map<ShiftType>((t) => ({
      code: t.code,
      label: t.label,
      start: hm(t.start_time),
      end: hm(t.end_time),
      color: t.color,
      work: t.is_work,
      ...(t.paid_hours ? { paidHours: Number(t.paid_hours) } : {}),
    }))
    const data: AppData = {
      version: 1,
      events: (ev.data as EventRow[]).map(rowToEvent),
      shiftDays: (sd.data as { day: string; code: string; extra?: boolean }[]).map<ShiftDay>((r) => (r.extra ? { date: r.day, code: r.code, extra: true } : { date: r.day, code: r.code })),
      shiftTypes: types.length ? types : DEFAULT_SHIFT_TYPES,
      tasks: ((tk.data ?? []) as TaskRow[]).map(rowToTask),
      pay: (pr.data as { pay_settings?: PaySettings | null } | null)?.pay_settings ?? undefined,
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
    const prev: AppData = this.last ?? { version: 1, events: [], shiftDays: [], shiftTypes: [], tasks: [] }
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
    const sig = (d: ShiftDay) => `${d.code}${d.extra ? '+' : ''}`
    const prevSd = new Map(prev.shiftDays.map((d) => [d.date, sig(d)]))
    const nextSd = new Map(next.shiftDays.map((d) => [d.date, sig(d)]))
    const prevCode = (date: string) => prevSd.get(date)?.replace(/\+$/, '')
    const touched = next.shiftDays.filter((d) => prevSd.get(d.date) !== sig(d))
    // Mudou o código: vai para o Google. Só mudou a marca de extra: fica na app.
    const sdChanged = touched
      .filter((d) => prevCode(d.date) !== d.code)
      .map((d) => ({ user_id: uid, day: d.date, code: d.code, extra: Boolean(d.extra), dirty: true, deleted_at: null }))
    const extraOnly = touched.filter((d) => prevCode(d.date) === d.code)
    const sdRemoved = prev.shiftDays.filter((d) => !nextSd.has(d.date)).map((d) => d.date)
    if (sdChanged.length) await check(this.db.from('shift_days').upsert(sdChanged))
    for (const on of [true, false]) {
      const days = extraOnly.filter((d) => Boolean(d.extra) === on).map((d) => d.date)
      if (days.length) await check(this.db.from('shift_days').update({ extra: on }).eq('user_id', uid).in('day', days))
    }
    if (sdRemoved.length) await check(this.db.from('shift_days').update({ deleted_at: now, dirty: true }).eq('user_id', uid).in('day', sdRemoved))

    // Dados de vencimento (perfil)
    if (JSON.stringify(prev.pay) !== JSON.stringify(next.pay)) {
      await check(this.db.from('profiles').update({ pay_settings: next.pay ?? null }).eq('id', uid))
    }

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
        paid_hours: t.paidHours ?? null,
        sort_order: i,
      }))
      if (rows.length) await check(this.db.from('shift_types').upsert(rows))
      const gone = prev.shiftTypes.filter((t) => !next.shiftTypes.some((n) => n.code === t.code)).map((t) => t.code)
      if (gone.length) await check(this.db.from('shift_types').delete().eq('user_id', uid).in('code', gone))
    }

    // Tarefas (só na app; não vão para o Google)
    const prevTk = new Map(prev.tasks.map((t) => [t.id, t]))
    const nextTk = new Set(next.tasks.map((t) => t.id))
    const tkChanged = next.tasks.filter((t) => !prevTk.has(t.id) || taskKey(prevTk.get(t.id)!) !== taskKey(t)).map((t) => taskToRow(t, uid))
    const tkRemoved = prev.tasks.filter((t) => !nextTk.has(t.id)).map((t) => t.id)
    if (tkChanged.length) await check(this.db.from('tasks').upsert(tkChanged))
    if (tkRemoved.length) await check(this.db.from('tasks').delete().in('id', tkRemoved))
  }
}

async function check(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  if (error) throw new Error(error.message)
}
