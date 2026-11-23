import { describe, expect, it } from 'vitest'
import { toLocal } from './dates'
import { parseScheduleList } from './scheduleImport'

// Mensagem fictícia no formato das SMS de ginásio.
const SMS = `Ola Ana
Treinos de 11/2026:
4/11 16h
6/11 16h
12/11 15h
26/11 15h30
Para reagendar contacte 910000000`

describe('parseScheduleList', () => {
  it('lê as sessões de uma SMS e ignora cabeçalho e contactos', () => {
    const r = parseScheduleList(SMS, new Date(2026, 10, 1))
    expect(r.items.map((i) => toLocal(i.start))).toEqual(['2026-11-04T16:00', '2026-11-06T16:00', '2026-11-12T15:00', '2026-11-26T15:30'])
    expect(r.title).toBe('Treino')
    expect(r.skipped).toEqual([])
  })

  it('usa o ano do cabeçalho mesmo que a lista chegue no fim do ano', () => {
    const r = parseScheduleList('Treinos de 1/2027:\n5/1 18h', new Date(2026, 11, 28))
    expect(toLocal(r.items[0].start)).toBe('2027-01-05T18:00')
  })

  it('sem cabeçalho, uma data já bem passada é do ano seguinte', () => {
    const r = parseScheduleList('5/1 18:00\n20/12 9h', new Date(2026, 11, 10))
    expect(r.items.map((i) => toLocal(i.start))).toEqual(['2026-12-20T09:00', '2027-01-05T18:00'])
  })

  it('aponta linhas com data sem hora, datas impossíveis e repetidas', () => {
    const r = parseScheduleList('Fisio\n3/12\n31/11 10h\n4/12 10h\n4/12 10h', new Date(2026, 10, 20))
    expect(r.items).toHaveLength(1)
    expect(r.skipped).toEqual(['3/12', '31/11 10h'])
    expect(r.title).toBe('Fisioterapia')
  })
})
