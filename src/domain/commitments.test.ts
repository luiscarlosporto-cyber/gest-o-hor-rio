import { describe, expect, it } from 'vitest'
import { detectCommitment, findDate, findTime } from '../../supabase/functions/_shared/commitments'

// Recebido segunda, 23/11/2026, 10:00 em Lisboa
const received = '2026-11-23T10:00:00Z'
const mail = (subject: string, snippet = '', from = '"Serviço de RH" <rh@hospital.pt>') => ({ id: 'm1', subject, snippet, from, received })

describe('datas e horas em emails', () => {
  it('lê datas por extenso, numéricas e relativas', () => {
    expect(findDate('reunião a 4 de dezembro', received)).toBe('2026-12-04')
    expect(findDate('até 15/01', received)).toBe('2027-01-15')
    expect(findDate('consulta amanhã', received)).toBe('2026-11-24')
    expect(findDate('na próxima sexta-feira', received)).toBe('2026-11-27')
    expect(findDate('sem data nenhuma', received)).toBeNull()
  })
  it('lê horas', () => {
    expect(findTime('às 14h30')).toBe('14:30')
    expect(findTime('pelas 9:15')).toBe('09:15')
    expect(findTime('às 9 na sala 2')).toBe('09:00')
    expect(findTime('dia 25/11')).toBeNull()
  })
})

describe('deteção de compromissos', () => {
  it('reunião com data e hora vira evento', () => {
    expect(detectCommitment(mail('Re: Reunião de serviço', 'Fica marcada para 4 de dezembro às 14h30 na sala 2.'))).toMatchObject({
      kind: 'event',
      title: 'Reunião de serviço',
      date: '2026-12-04',
      time: '14:30',
      sender: 'Serviço de RH',
    })
  })
  it('prazo sem hora vira tarefa', () => {
    expect(detectCommitment(mail('Escalas de janeiro', 'Por favor enviar as trocas até dia 15/12.'))).toMatchObject({ kind: 'task', date: '2026-12-15', time: null })
  })
  it('ignora compromissos com data anterior ao email', () => {
    expect(detectCommitment(mail('Reunião de serviço', 'Resumo da reunião de 20/11 às 15h'))).toBeNull()
  })
  it('ignora publicidade e emails sem data', () => {
    expect(detectCommitment(mail('Black Friday: desconto até amanhã', 'Oferta exclusiva'))).toBeNull()
    expect(detectCommitment(mail('Reunião', 'Quando puderes diz-me a tua disponibilidade.'))).toBeNull()
    expect(detectCommitment(mail('Olá', 'Tudo bem? Abraço'))).toBeNull()
  })
})

describe('aceitar sugestões', async () => {
  const { applySuggestion } = await import('../ui/Suggestions')
  const { emptyData } = await import('../data/store')
  const s = { id: 's1', kind: 'event' as const, title: 'Reunião de serviço', date: '2026-12-04', time: '14:30:00', sender: 'RH', subject: 'Re: Reunião', snippet: '' }
  it('cria um evento de uma hora com a origem nas notas', () => {
    const d = applySuggestion(emptyData(), s, 'event')
    expect(d.events[0]).toMatchObject({ title: 'Reunião de serviço', start: '2026-12-04T14:30', end: '2026-12-04T15:30', allDay: false, notes: 'De: RH\nAssunto: Re: Reunião' })
  })
  it('ou uma tarefa marcada como vinda do Gmail', () => {
    const d = applySuggestion(emptyData(), { ...s, time: null }, 'task')
    expect(d.tasks[0]).toMatchObject({ title: 'Reunião de serviço', due: '2026-12-04', dueTime: undefined, source: 'gmail' })
  })
})
