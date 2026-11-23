import { describe, expect, it } from 'vitest'
import { emptyData } from '../data/store'
import { easter, holidays, premiumHours } from './payroll'

describe('feriados', () => {
  it('calcula a Páscoa e os feriados móveis', () => {
    expect(easter(2026).getDate()).toBe(5) // 5 de abril de 2026
    const h = holidays(2026)
    expect(h.has('2026-04-03')).toBe(true) // Sexta-feira Santa
    expect(h.has('2026-06-04')).toBe(true) // Corpo de Deus
    expect(h.has('2026-11-11')).toBe(true) // São Martinho (Penafiel)
  })
})

describe('horas com acréscimo como no talão', () => {
  it('separa noturnas em dia útil, sábado/domingo/feriado diurnas e noturnas', () => {
    const data = {
      ...emptyData(),
      shiftDays: [
        { date: '2026-06-01', code: 'N' }, // segunda 22h → terça 09h: 10h noturnas em dia útil
        { date: '2026-06-06', code: 'MT2' }, // sábado 08:30–22:30: 4,5h antes das 13h (normais), 7h sáb>13, 2,5h noturnas sáb
        { date: '2026-06-10', code: 'N' }, // feriado 22h → quinta 09h: 2h noturnas feriado, 8h noturnas dia útil
      ],
    }
    const p = premiumHours(data, 2026, 5)
    expect(p.weekdayNight).toBe(10 + 8)
    expect(p.weekendDay).toBe(7)
    expect(p.weekendNight).toBe(2.5 + 2)
    expect(p.total).toBe(11 + 14 + 11)
    expect(p.missingDays).toHaveLength(27)
  })
})
