import { describe, expect, it } from 'vitest'
import { emptyData } from '../data/store'
import { buildAssistantContext, checkProposal, type Proposal } from './assistant'

const now = new Date(2026, 10, 23, 10, 0) // segunda, 23/11/2026 10:00
const data = {
  ...emptyData(),
  shiftDays: [
    { date: '2026-11-23', code: 'M' },
    { date: '2026-11-24', code: 'N' },
    { date: '2026-11-25', code: 'D' },
  ],
  events: [{ id: 'g', title: 'Ginásio', start: '2026-11-26T18:00', end: '2026-11-26T19:00', allDay: false, category: 'pessoal' as const, createdAt: '', updatedAt: '' }],
  tasks: [
    { id: 't', title: 'Entregar escala', due: '2026-11-24', dueTime: '18:00', priority: 'alta' as const, done: false, createdAt: '', updatedAt: '' },
    { id: 'v', title: 'Já feita', priority: 'normal' as const, done: true, createdAt: '', updatedAt: '' },
  ],
  pay: { category: 'Enfermeiro', weeklyHours: 35, municipalHolidays: [], monthly: 1800 },
}

const base: Proposal = { kind: 'event', title: 'Dentista', start: null, end: null, allDay: false, category: 'pessoal', location: null, due: null, dueTime: null, priority: null, notes: null, why: '' }

describe('assistente', () => {
  it('resume turnos, compromissos, livres e tarefas por fazer, sem dados de vencimento', () => {
    const ctx = buildAssistantContext(data, now, 7)
    expect(ctx).toContain('2026-11-23 segunda')
    expect(ctx).toContain('turno M')
    expect(ctx).toContain('"Ginásio" [pessoal]')
    expect(ctx).toContain('livre 15:30–22:00')
    expect(ctx).toContain('"Entregar escala" até 2026-11-24 18:00 (prioridade alta)')
    expect(ctx).not.toContain('Já feita')
    expect(ctx).not.toContain('1800')
    expect(ctx).toContain('2026-11-29')
    expect(ctx).not.toContain('2026-11-30 ')
  })

  it('valida um compromisso e encontra colisões com turnos', () => {
    const c = checkProposal(data, { ...base, start: '2026-11-23T10:00', end: '2026-11-23T11:00' })
    expect(c.kind).toBe('event')
    if (c.kind !== 'event') return
    expect(c.conflicts.map((o) => o.source)).toContain('shift')
    const free = checkProposal(data, { ...base, start: '2026-11-26T10:00', end: '2026-11-26T11:00' })
    expect(free.kind === 'event' && free.conflicts).toEqual([])
  })

  it('dia inteiro: o fim é o dia seguinte ao último dia', () => {
    const c = checkProposal(data, { ...base, allDay: true, start: '2026-12-01', end: '2026-12-02' })
    expect(c.kind === 'event' && [c.draft.start, c.draft.end]).toEqual(['2026-12-01T00:00', '2026-12-03T00:00'])
  })

  it('recusa propostas sem datas válidas ou com fim antes do início', () => {
    expect(checkProposal(data, { ...base, start: 'amanhã', end: null }).kind).toBe('invalid')
    expect(checkProposal(data, { ...base, start: '2026-11-26T11:00', end: '2026-11-26T10:00' }).kind).toBe('invalid')
    expect(checkProposal(data, { ...base, title: '  ' }).kind).toBe('invalid')
  })

  it('tarefa: ignora hora sem data e prioridade desconhecida', () => {
    const c = checkProposal(data, { ...base, kind: 'task', title: 'Pagar luz', dueTime: '10:00', priority: 'urgente' as never })
    expect(c).toEqual({ kind: 'task', task: { title: 'Pagar luz', due: undefined, dueTime: undefined, priority: 'normal', notes: undefined } })
  })
})
