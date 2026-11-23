import { describe, expect, it } from 'vitest'
import { emptyData } from '../data/store'
import { buildReminders, defaultReminderSettings } from './reminders'

describe('lembretes', () => {
  const now = new Date(2026, 10, 23, 10, 0) // segunda, 23/11/2026 10:00
  const settings = { ...defaultReminderSettings(), enabled: true }
  const data = {
    ...emptyData(),
    shiftDays: [
      { date: '2026-11-23', code: 'N' },
      { date: '2026-11-24', code: 'D' },
      { date: '2026-11-25', code: 'M', extra: true },
      { date: '2026-11-26', code: 'DS' },
    ],
    events: [
      { id: 'g', title: 'Ginásio', start: '2026-11-02T18:00', end: '2026-11-02T19:00', allDay: false, category: 'pessoal' as const, rrule: 'FREQ=WEEKLY;BYDAY=MO', createdAt: '', updatedAt: '' },
      { id: 'f', title: 'Aniversário', start: '2026-11-24T00:00', end: '2026-11-25T00:00', allDay: true, category: 'pessoal' as const, createdAt: '', updatedAt: '' },
    ],
    tasks: [
      { id: 't', title: 'Entregar escala', due: '2026-11-24', dueTime: '18:00', priority: 'alta' as const, done: false, createdAt: '', updatedAt: '' },
      { id: 'u', title: 'Ligar ao banco', due: '2026-11-25', priority: 'normal' as const, done: false, createdAt: '', updatedAt: '' },
      { id: 'v', title: 'Feita', due: '2026-11-25', priority: 'normal' as const, done: true, createdAt: '', updatedAt: '' },
    ],
  }

  it('não faz nada se os lembretes estiverem desligados', () => {
    expect(buildReminders(data, defaultReminderSettings(), now)).toEqual([])
  })

  it('avisa turnos de trabalho antes do início, sem a saída da noite (D) nem descansos', () => {
    const r = buildReminders(data, { ...settings, eventLead: 0, tasks: false, dailySummary: '' }, now, 3)
    expect(r.map((x) => [x.key, x.fireAt.toString() === new Date(2026, 10, 23, 20, 0).toString() || x.fireAt.getHours(), x.title])).toEqual([
      ['shift:2026-11-23:N', true, 'N daqui a 2h'],
      ['shift:2026-11-25:M', 6, 'M (extra) daqui a 2h'],
    ])
    expect(r[0].body).toBe('Noite, 22:00–09:00 (+1)')
  })

  it('avisa cada ocorrência de uma série e as tarefas, só no futuro', () => {
    const r = buildReminders(data, { ...settings, shiftLead: 0, dailySummary: '' }, now, 7)
    const keys = r.map((x) => x.key)
    expect(keys.filter((k) => k.startsWith('ev:g'))).toEqual(['ev:g:2026-11-23T18:00', 'ev:g:2026-11-30T18:00'])
    expect(keys).not.toContain(expect.stringContaining('ev:f'))
    expect(r.find((x) => x.key === 'task:t:2026-11-24T18:00')?.fireAt).toEqual(new Date(2026, 10, 24, 18, 0))
    expect(r.find((x) => x.key === 'task:u:2026-11-25')?.fireAt).toEqual(new Date(2026, 10, 25, 9, 0))
    expect(keys.some((k) => k.startsWith('task:v'))).toBe(false)
  })

  it('prepara o resumo do dia com turno, compromissos e tarefas', () => {
    const r = buildReminders(data, { ...settings, shiftLead: 0, eventLead: 0, tasks: false }, now, 2)
    expect(r.map((x) => [x.key, x.body])).toEqual([
      ['daily:2026-11-24', 'D · saída da noite até às 09:00 · 1 compromisso · 1 tarefa'],
      ['daily:2026-11-25', 'M 08:30–15:30 · 1 tarefa'],
    ])
  })
})
