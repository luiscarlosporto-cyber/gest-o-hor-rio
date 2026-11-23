import { describe, expect, it } from 'vitest'
import { emptyData } from '../data/store'
import { easter, holidays, hourlyRate, premiumHours } from './payroll'

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
  it('a madrugada de sábado (noite de sexta) é noturno de dia útil; a de domingo é de fim de semana', () => {
    const data = { ...emptyData(), shiftDays: [{ date: '2026-06-12', code: 'N' }, { date: '2026-06-13', code: 'N' }] }
    const p = premiumHours(data, 2026, 5)
    // sex 22h → sáb 08h: 10h dia útil; sáb 22h → dom 08h: 10h fim de semana; 08–09h: 1h diurna sáb (normal) + 1h dom
    expect(p.weekdayNight).toBe(10)
    expect(p.weekendNight).toBe(10)
    expect(p.weekendDay).toBe(1)
  })
  it('turnos extra contam como suplementar (1.ª hora e seguintes), fora das rubricas TN', () => {
    const data = {
      ...emptyData(),
      shiftDays: [
        { date: '2026-12-22', code: 'M', extra: true }, // terça 08:30–15:30: 1h + 6h diurnas em dia útil
        { date: '2026-12-13', code: 'MT2', extra: true }, // domingo 08:30–22:30: 1h + 10,5h diurno domingo, 2,5h noturno domingo
        { date: '2026-12-23', code: 'MT2' }, // normal: 2,5h noturno dia útil
      ],
    }
    const p = premiumHours(data, 2026, 11)
    expect(p.extra.dayWeekday).toEqual({ first: 1, next: 6 })
    expect(p.extra.nightWeekdayOrDayRest).toEqual({ first: 1, next: 10.5 })
    expect(p.extra.nightRest).toEqual({ first: 0, next: 2.5 })
    expect(p.weekdayNight).toBe(2.5)
    expect(p.weekendDay).toBe(0)
    expect(p.total).toBe(7 + 14 + 14)
  })
  it('valor/hora como na tabela de 2026', () => {
    expect(hourlyRate(1657.04)).toBe(10.93)
    expect(hourlyRate(2462.31)).toBe(16.24)
  })
})

describe('estimativa em euros', () => {
  it('usa o nível da TRU e as percentagens da tabela', async () => {
    const { estimatePay } = await import('./payroll')
    const data = { ...emptyData(), shiftDays: [{ date: '2026-12-22', code: 'M', extra: true }, { date: '2026-12-14', code: 'N' }] }
    const p = premiumHours(data, 2026, 11)
    expect(estimatePay(p, undefined)).toBeUndefined()
    const e = estimatePay(p, { category: 'Enfermeiro', level: 19, weeklyHours: 35, municipalHolidays: ['11-11'] })!
    expect(e.rate).toBe(10.93)
    // seg 22h → ter 09h: 10h noturnas dia útil a 50%; extra M: 1h a 1,25R + 6h a 1,5R
    expect(e.lines.map((l) => l.amount)).toEqual([54.65, 13.66, 98.37])
  })
})
