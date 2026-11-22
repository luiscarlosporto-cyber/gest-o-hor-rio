import { describe, expect, it } from 'vitest'
import { findConflicts, conflictsWith, freeSlots } from './conflicts'
import { addDays, monthGrid, parseLocal, startOfWeek, toDateKey, toLocal, formatRange } from './dates'
import { deleteEvent, editOccurrence, editSeries, occurrencesIn, searchOccurrences, upsertEvent, validateDraft, type EventDraft } from './operations'
import { buildRRule, describeRRule, expandEvent, parseRRule } from './recurrence'
import { DEFAULT_SHIFT_TYPES, mergeShiftDays, parseRosterLine, shiftOccurrences, summarizeMonth } from './shifts'
import type { AppData, CalendarEvent } from './types'

const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: over.id ?? 'e1',
  title: 'Reunião',
  start: '2026-11-23T10:00',
  end: '2026-11-23T11:00',
  allDay: false,
  category: 'reuniao',
  createdAt: '',
  updatedAt: '',
  ...over,
})

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  title: 'Consulta',
  start: '2026-11-24T09:00',
  end: '2026-11-24T09:30',
  allDay: false,
  category: 'pessoal',
  ...over,
})

describe('datas', () => {
  it('lê e escreve hora local sem mudar o valor', () => {
    expect(toLocal(parseLocal('2026-03-29T08:30'))).toBe('2026-03-29T08:30')
    expect(toDateKey(parseLocal('2026-12-31'))).toBe('2026-12-31')
  })
  it('a semana começa à segunda-feira', () => {
    expect(toDateKey(startOfWeek(parseLocal('2026-11-22')))).toBe('2026-11-16') // domingo
    expect(toDateKey(startOfWeek(parseLocal('2026-11-23')))).toBe('2026-11-23') // segunda
  })
  it('a grelha do mês tem 42 dias e começa à segunda', () => {
    const g = monthGrid(parseLocal('2026-11-15'))
    expect(g).toHaveLength(42)
    expect(toDateKey(g[0])).toBe('2026-10-26')
    expect(g[0].getDay()).toBe(1)
  })
  it('mostra +1 quando acaba no dia seguinte', () => {
    expect(formatRange(parseLocal('2026-11-23T22:00'), parseLocal('2026-11-24T09:00'), false)).toBe('22:00–09:00 (+1)')
    expect(formatRange(parseLocal('2026-11-23T16:00'), parseLocal('2026-11-24T00:00'), false)).toBe('16:00–00:00')
  })
})

describe('recorrência', () => {
  it('constrói e lê regras semanais', () => {
    const rule = buildRRule({ freq: 'weekly', byWeekday: [2, 0], until: '2026-12-31' })
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T235959Z')
    expect(parseRRule(rule)).toMatchObject({ freq: 'weekly', byWeekday: [0, 2], until: '2026-12-31' })
    expect(describeRRule(rule)).toBe('Todas as semanas (seg, qua) até 31/12/2026')
    expect(buildRRule({ freq: 'none' })).toBeUndefined()
  })

  it('expande uma série semanal dentro do intervalo', () => {
    const e = ev({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' })
    const occ = expandEvent(e, parseLocal('2026-11-23'), parseLocal('2026-12-07'))
    expect(occ.map((o) => toLocal(o.start))).toEqual([
      '2026-11-23T10:00',
      '2026-11-25T10:00',
      '2026-11-30T10:00',
      '2026-12-02T10:00',
    ])
  })

  it('mantém a hora local na mudança de hora', () => {
    const e = ev({ start: '2026-03-27T09:00', end: '2026-03-27T10:00', rrule: 'FREQ=DAILY;COUNT=4' })
    const occ = expandEvent(e, parseLocal('2026-03-26'), parseLocal('2026-04-01'))
    expect(occ.map((o) => toLocal(o.start))).toEqual([
      '2026-03-27T09:00',
      '2026-03-28T09:00',
      '2026-03-29T09:00',
      '2026-03-30T09:00',
    ])
  })

  it('respeita exceções (exdates) e UNTIL', () => {
    const e = ev({ rrule: 'FREQ=DAILY;UNTIL=20261126T235959Z', exdates: ['2026-11-24'] })
    const occ = expandEvent(e, parseLocal('2026-11-20'), parseLocal('2026-12-01'))
    expect(occ.map((o) => toDateKey(o.start))).toEqual(['2026-11-23', '2026-11-25', '2026-11-26'])
  })

  it('inclui uma ocorrência que começou antes do intervalo e ainda decorre', () => {
    const e = ev({ start: '2026-11-23T23:00', end: '2026-11-24T01:00', rrule: 'FREQ=DAILY;COUNT=2' })
    const occ = expandEvent(e, parseLocal('2026-11-24'), parseLocal('2026-11-25'))
    expect(occ.map((o) => toLocal(o.start))).toEqual(['2026-11-23T23:00', '2026-11-24T23:00'])
  })
})

describe('turnos', () => {
  const types = DEFAULT_SHIFT_TYPES

  it('lê a linha do horário e marca códigos desconhecidos', () => {
    const r = parseRosterLine('MT2 N D D M Fe XX', 2026, 1, types)
    expect(r.days.slice(0, 3)).toEqual([
      { date: '2026-02-01', code: 'MT2' },
      { date: '2026-02-02', code: 'N' },
      { date: '2026-02-03', code: 'D' },
    ])
    expect(r.unknown).toEqual(['XX'])
    expect(r.countDelta).toBe(7 - 28)
  })

  it('ignora a primeira coluna (último dia do mês anterior) quando pedido', () => {
    const line = ['D', ...Array(30).fill('M')].join('\t')
    const r = parseRosterLine(line, 2026, 10, types, { skipFirst: 1 })
    expect(r.days).toHaveLength(30)
    expect(r.days.every((d) => d.code === 'M')).toBe(true)
    expect(r.countDelta).toBe(0)
  })

  it('a noite termina no dia seguinte e aparece nos dois dias', () => {
    const days = [{ date: '2026-11-23', code: 'N' }]
    const mon = shiftOccurrences(days, types, parseLocal('2026-11-23'), parseLocal('2026-11-24'))
    const tue = shiftOccurrences(days, types, parseLocal('2026-11-24'), parseLocal('2026-11-25'))
    expect(toLocal(mon[0].end)).toBe('2026-11-24T09:00')
    expect(tue).toHaveLength(1)
  })

  it('resume o mês com contagens e horas', () => {
    const days = [
      { date: '2026-11-01', code: 'MT2' },
      { date: '2026-11-02', code: 'N' },
      { date: '2026-11-03', code: 'D' },
      { date: '2026-11-04', code: 'M' },
      { date: '2026-12-01', code: 'M' },
    ]
    const s = summarizeMonth(days, types, 2026, 10)
    expect(s.workDays).toBe(3)
    expect(s.workedMinutes).toBe((14 + 11 + 7) * 60)
    expect(s.counts.map((c) => `${c.code}:${c.days}`)).toEqual(['MT2:1', 'M:1', 'N:1', 'D:1'])
  })

  it('junta turnos novos aos existentes e apaga com código vazio', () => {
    const merged = mergeShiftDays(
      [{ date: '2026-11-01', code: 'M' }, { date: '2026-11-02', code: 'N' }],
      [{ date: '2026-11-02', code: 'D' }, { date: '2026-11-01', code: '' }],
    )
    expect(merged).toEqual([{ date: '2026-11-02', code: 'D' }])
  })
})

describe('conflitos', () => {
  const data: AppData = {
    version: 1,
    tasks: [],
    shiftTypes: DEFAULT_SHIFT_TYPES,
    shiftDays: [
      { date: '2026-11-23', code: 'M' },
      { date: '2026-11-24', code: 'D' },
    ],
    events: [
      ev({ id: 'a', start: '2026-11-23T10:00', end: '2026-11-23T11:00' }),
      ev({ id: 'b', start: '2026-11-24T10:00', end: '2026-11-24T11:00' }),
      ev({ id: 'p', category: 'pausa', start: '2026-11-23T12:00', end: '2026-11-23T12:30' }),
    ],
  }

  it('deteta a reunião durante o turno da manhã, mas não no dia de descanso nem a pausa', () => {
    const occ = occurrencesIn(data, parseLocal('2026-11-23'), parseLocal('2026-11-25'))
    const c = findConflicts(occ)
    expect(c).toHaveLength(1)
    expect([c[0].a.title, c[0].b.title].sort()).toEqual(['M', 'Reunião'])
  })

  it('eventos encostados não são conflito', () => {
    const occ = occurrencesIn(
      { ...data, shiftDays: [], events: [ev({ id: 'x' }), ev({ id: 'y', start: '2026-11-23T11:00', end: '2026-11-23T12:00' })] },
      parseLocal('2026-11-23'),
      parseLocal('2026-11-24'),
    )
    expect(findConflicts(occ)).toHaveLength(0)
  })

  it('verifica um candidato ignorando o próprio evento', () => {
    const occ = occurrencesIn(data, parseLocal('2026-11-23'), parseLocal('2026-11-24'))
    const candidate = { ...occ.find((o) => o.eventId === 'a')! }
    expect(conflictsWith(candidate, occ, 'a').map((o) => o.title)).toEqual(['M'])
  })

  it('calcula horários livres', () => {
    const occ = occurrencesIn({ ...data, shiftDays: [] }, parseLocal('2026-11-23'), parseLocal('2026-11-24'))
    const slots = freeSlots(occ, parseLocal('2026-11-23T08:00'), parseLocal('2026-11-23T13:00'))
    expect(slots.map((s) => `${toLocal(s.start)}/${toLocal(s.end)}`)).toEqual([
      '2026-11-23T08:00/2026-11-23T10:00',
      '2026-11-23T11:00/2026-11-23T13:00',
    ])
  })
})

describe('operações', () => {
  it('valida o rascunho', () => {
    expect(validateDraft(draft({ title: ' ' }))).toMatch(/título/)
    expect(validateDraft(draft({ end: '2026-11-24T08:00' }))).toMatch(/fim/)
    expect(validateDraft(draft())).toBeNull()
  })

  it('cria e atualiza', () => {
    const created = upsertEvent([], draft())
    expect(created).toHaveLength(1)
    const updated = upsertEvent(created, { ...draft({ title: 'Dentista' }), id: created[0].id })
    expect(updated[0].title).toBe('Dentista')
    expect(updated[0].id).toBe(created[0].id)
  })

  it('editar só esta ocorrência cria uma exceção ligada à série', () => {
    const series = ev({ id: 's', rrule: 'FREQ=DAILY;COUNT=5' })
    const next = editOccurrence([series], 's', '2026-11-24', draft({ start: '2026-11-24T15:00', end: '2026-11-24T16:00', title: 'Reunião' }))
    expect(next).toHaveLength(2)
    expect(next[0].exdates).toEqual(['2026-11-24'])
    expect(next[1]).toMatchObject({ recurringEventId: 's', originalDate: '2026-11-24', rrule: undefined })
    const occ = expandEvent(next[0], parseLocal('2026-11-23'), parseLocal('2026-11-30'))
    expect(occ).toHaveLength(4)
  })

  it('editar a série muda a hora de todas sem mudar o dia de início', () => {
    const series = ev({ id: 's', rrule: 'FREQ=WEEKLY;BYDAY=MO' })
    const third = parseLocal('2026-12-07T10:00')
    const next = editSeries([series], 's', draft({ title: 'Reunião', start: '2026-12-07T11:00', end: '2026-12-07T12:30', rrule: series.rrule }), third)
    expect(next[0].start).toBe('2026-11-23T11:00')
    expect(next[0].end).toBe('2026-11-23T12:30')
  })

  it('apagar só esta ocorrência ou a série com as exceções', () => {
    const series = ev({ id: 's', rrule: 'FREQ=DAILY;COUNT=5' })
    const withException = editOccurrence([series], 's', '2026-11-24', draft())
    expect(deleteEvent(withException, 's', 'this', '2026-11-25')[0].exdates).toEqual(['2026-11-24', '2026-11-25'])
    expect(deleteEvent(withException, 's', 'all')).toHaveLength(0)
  })

  it('pesquisa sem acentos e filtra por categoria', () => {
    const data: AppData = {
      version: 1,
      tasks: [],
      shiftTypes: DEFAULT_SHIFT_TYPES,
      shiftDays: [{ date: '2026-11-23', code: 'N' }],
      events: [ev({ title: 'Reunião de serviço', location: 'Sala 2' })],
    }
    const occ = occurrencesIn(data, parseLocal('2026-11-23'), addDays(parseLocal('2026-11-23'), 1))
    expect(searchOccurrences(occ, { text: 'reuniao', categories: [] })).toHaveLength(1)
    expect(searchOccurrences(occ, { text: 'sala 2', categories: [] })).toHaveLength(1)
    expect(searchOccurrences(occ, { text: '', categories: ['turno'] }).map((o) => o.title)).toEqual(['N'])
  })
})
