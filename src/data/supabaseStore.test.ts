import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_SHIFT_TYPES } from '../domain/shifts'
import type { AppData, CalendarEvent } from '../domain/types'
import { eventToRow, rowToEvent, SupabaseStore } from './supabaseStore'

/** Cliente falso que regista as operações pedidas. */
function fakeDb(tables: Record<string, unknown[]>) {
  const calls: { table: string; op: string; payload?: unknown; filters: string[] }[] = []
  const builder = (table: string) => {
    const call = { table, op: 'select', payload: undefined as unknown, filters: [] as string[] }
    const api: Record<string, unknown> = {}
    const chain = (name: string) => (...args: unknown[]) => {
      call.filters.push(`${name}:${JSON.stringify(args)}`)
      return api
    }
    for (const f of ['eq', 'in', 'is', 'order', 'maybeSingle']) api[f] = chain(f)
    api.select = () => api
    api.upsert = (p: unknown) => ((call.op = 'upsert'), (call.payload = p), api)
    api.update = (p: unknown) => ((call.op = 'update'), (call.payload = p), api)
    api.delete = () => ((call.op = 'delete'), api)
    api.then = (res: (v: unknown) => unknown) => {
      calls.push(call)
      return Promise.resolve({ data: call.op === 'select' ? tables[table] ?? [] : null, error: null }).then(res)
    }
    return api
  }
  return { db: { from: builder } as unknown as SupabaseClient, calls }
}

const ev = (id: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: 'Reunião',
  start: '2026-11-23T10:00',
  end: '2026-11-23T11:00',
  allDay: false,
  category: 'reuniao',
  createdAt: '',
  updatedAt: '',
  ...over,
})

describe('SupabaseStore', () => {
  it('converte eventos para linhas e de volta', () => {
    const e = ev('a', { rrule: 'FREQ=DAILY', exdates: ['2026-11-24'], location: 'Sala 2' })
    const row = eventToRow(e, 'u1')
    expect(row).toMatchObject({ user_id: 'u1', starts_at: '2026-11-23T10:00', rrule: 'FREQ=DAILY', dirty: true })
    expect(rowToEvent({ ...row, starts_at: '2026-11-23T10:00:00', ends_at: '2026-11-23T11:00:00' })).toMatchObject({
      id: 'a',
      start: '2026-11-23T10:00',
      end: '2026-11-23T11:00',
      exdates: ['2026-11-24'],
      location: 'Sala 2',
    })
  })

  it('lê e só envia o que mudou, apagando com marca para o Google', async () => {
    const { db, calls } = fakeDb({
      events: [{ ...eventToRow(ev('a'), 'u1'), starts_at: '2026-11-23T10:00:00', ends_at: '2026-11-23T11:00:00' }, eventToRow(ev('b'), 'u1')],
      shift_days: [{ day: '2026-11-23', code: 'M' }],
      shift_types: [],
    })
    const store = new SupabaseStore(db, 'u1')
    const data = await store.load()
    expect(data.events).toHaveLength(2)
    expect(data.shiftTypes).toEqual(DEFAULT_SHIFT_TYPES)
    calls.length = 0

    const next: AppData = {
      ...data,
      events: [{ ...data.events[0], title: 'Reunião de serviço' }, ev('c')],
      shiftDays: [{ date: '2026-11-24', code: 'N' }],
    }
    await store.save(next)
    const writes = calls.map((c) => `${c.table}.${c.op}`)
    expect(writes).toEqual(['events.upsert', 'events.update', 'shift_days.upsert', 'shift_days.update'])
    expect((calls[0].payload as { id: string }[]).map((r) => r.id)).toEqual(['a', 'c'])
    expect(calls[1].payload).toMatchObject({ dirty: true })
    expect(calls[1].filters).toContain('in:["id",["b"]]')
    expect(calls[3].filters).toContain('in:["day",["2026-11-23"]]')
  })

  it('marcar um turno como extra ou mudar o vencimento não vai para o Google', async () => {
    const { db, calls } = fakeDb({ events: [], shift_days: [{ day: '2026-11-24', code: 'N' }], shift_types: [] })
    const store = new SupabaseStore(db, 'u1')
    const data = await store.load()
    calls.length = 0
    await store.save({ ...data, shiftDays: [{ date: '2026-11-24', code: 'N', extra: true }], pay: { category: 'Enfermeiro', level: 34, weeklyHours: 35, municipalHolidays: ['11-11'] } })
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual(['shift_days.update', 'profiles.update'])
    expect(calls[0].payload).toEqual({ extra: true })
    expect(calls[1].payload).toMatchObject({ pay_settings: { level: 34 } })
  })
})
