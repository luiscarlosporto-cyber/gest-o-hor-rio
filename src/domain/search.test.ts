import { describe, expect, it } from 'vitest'
import { emptyData } from '../data/store'
import { globalSearch } from './search'
import type { CalendarEvent } from './types'

const ev = (id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, title, start, end, allDay: false, category: 'pessoal', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
})

describe('pesquisa global', () => {
  const now = new Date(2026, 10, 23, 10, 0)
  const data = {
    ...emptyData(),
    events: [
      ev('a', 'Consulta médica', '2026-12-10T09:00', '2026-12-10T10:00', { location: 'Hospital de Penafiel' }),
      ev('b', 'Ginásio', '2026-11-02T18:00', '2026-11-02T19:00', { rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      ev('c', 'Consulta dentista', '2026-10-05T09:00', '2026-10-05T10:00'),
    ],
    shiftDays: [{ date: '2026-11-20', code: 'N' }, { date: '2026-11-21', code: 'D' }, { date: '2026-11-26', code: 'N' }],
    tasks: [
      { id: 't1', title: 'Levar exames à consulta', priority: 'normal' as const, done: false, createdAt: '', updatedAt: '' },
      { id: 't2', title: 'Pagar ginásio', priority: 'normal' as const, done: true, createdAt: '', updatedAt: '' },
    ],
  }

  it('encontra compromissos, sem acentos, próximos primeiro e passados depois', () => {
    const r = globalSearch(data, 'CONSULTA', now)
    expect(r.events.map((o) => o.title)).toEqual(['Consulta médica', 'Consulta dentista'])
    expect(r.tasks.map((t) => t.title)).toEqual(['Levar exames à consulta'])
    expect(globalSearch(data, 'penafiel', now).events).toHaveLength(1)
  })

  it('mostra uma série repetida uma vez, na próxima ocorrência', () => {
    const r = globalSearch(data, 'ginasio', now)
    expect(r.events).toHaveLength(1)
    expect(r.events[0].start).toEqual(new Date(2026, 10, 23, 18, 0))
    expect(r.tasks.map((t) => t.id)).toEqual(['t2'])
  })

  it('encontra turnos pelo código exato ou pelo nome do tipo', () => {
    expect(globalSearch(data, 'n', now).shifts.map((o) => o.shiftDate)).toEqual(['2026-11-26', '2026-11-20'])
    expect(globalSearch(data, 'noite', now).shifts.length).toBeGreaterThanOrEqual(2)
    expect(globalSearch(data, '', now).total).toBe(0)
  })
})
