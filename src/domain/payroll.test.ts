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
        { date: '2026-06-01', code: 'N' }, // segunda 22h → terça 07h (conta 9h): 9h noturnas em dia útil
        { date: '2026-06-06', code: 'MT2' }, // sábado 08:30–22:30: 4,5h antes das 13h (normais), 7h sáb>13, 2,5h noturnas sáb
        { date: '2026-06-10', code: 'N' }, // feriado 22h → quinta 07h: 2h noturnas feriado, 7h noturnas dia útil
      ],
    }
    const p = premiumHours(data, 2026, 5)
    expect(p.weekdayNight).toBe(9 + 7)
    expect(p.weekendDay).toBe(7)
    expect(p.weekendNight).toBe(2.5 + 2)
    expect(p.total).toBe(9 + 14 + 9)
    expect(p.missingDays).toHaveLength(27)
  })
  it('a madrugada de sábado (noite de sexta) é noturno de dia útil; a de domingo é de fim de semana', () => {
    const data = { ...emptyData(), shiftDays: [{ date: '2026-06-12', code: 'N' }, { date: '2026-06-13', code: 'N' }] }
    const p = premiumHours(data, 2026, 5)
    // a N conta 22h–07h: sex → sáb 9h dia útil; sáb → dom 9h fim de semana
    expect(p.weekdayNight).toBe(9)
    expect(p.weekendNight).toBe(9)
    expect(p.weekendDay).toBe(0)
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
    // seg 22h → ter 07h: 9h noturnas dia útil a 50%; extra M: 1h a 1,25R + 6h a 1,5R
    expect(e.lines.map((l) => l.amount)).toEqual([49.19, 13.66, 98.37])
  })
})

describe('categorias e posições', () => {
  it('cada posição dá o índice e o valor da tabela de 2026', async () => {
    const { positionsFor, monthlyBase } = await import('./payroll')
    expect(positionsFor('Enfermeiro especialista')?.[3]).toBe(34)
    expect(monthlyBase({ category: 'Enfermeiro gestor', position: 1, level: 38, weeklyHours: 35, municipalHolidays: [] })).toBe(2679.17)
    expect(positionsFor('Outra')).toBeUndefined()
  })
})

describe('junho de 2026 (horário final da UCIP) contra o talão de julho', () => {
  it('bate no noturno: 47,93h em dia útil e 25h ao fim de semana', () => {
    const raw =
      '05-31 DS,06-01 N,06-02 D,06-03 N,06-04 N+,06-05 D,06-06 MT2,06-07 N,06-08 D,06-09 T,06-10 Fe,06-11 MT2,06-12 N,06-13 N,06-14 D,06-15 DS,06-16 MT2+,06-17 N,06-18 D,06-19 Cgs,06-20 MT2,06-21 N,06-22 D,06-23 DS,06-24 T+,06-25 Fe,06-26 DS,06-27 DC,06-28 DS,06-29 T+,06-30 M+'
    const shiftDays = raw.split(',').map((x) => {
      const [d, c] = x.split(' ')
      return { date: `2026-${d}`, code: c.replace('+', ''), extra: c.endsWith('+') }
    })
    const p = premiumHours({ ...emptyData(), shiftDays }, 2026, 5)
    expect(p.weekdayNight).toBe(48) // talão: 47,93
    expect(p.weekendNight).toBe(25) // talão: 25
    expect(p.missingDays).toEqual([])
  })
})
