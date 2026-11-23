// Cenários de auditoria do vencimento (Ritmia 2.0). Documentam o comportamento ATUAL das fórmulas,
// incluindo os casos-limite cuja regra ainda tem de ser confirmada com um talão real.
// Dados fictícios: nenhum valor pessoal.
import { describe, expect, it } from 'vitest'
import { emptyData } from '../data/store'
import { estimatePay, holidays, hourlyRate, positionsFor, premiumHours, projectSalary, TRU_2026 } from './payroll'

const days = (list: [string, string][], extra: string[] = []) => ({
  ...emptyData(),
  shiftDays: list.map(([date, code]) => ({ date, code, ...(extra.includes(date) ? { extra: true } : {}) })),
})

describe('cenários de auditoria do vencimento', () => {
  it('categoria e posição dão o nível e o valor/hora certos (especialista, 5.ª posição = nível 37)', () => {
    expect(positionsFor('Enfermeiro especialista')[4]).toBe(37)
    expect(TRU_2026[37]).toBe(2624.97)
    expect(hourlyRate(2624.97, 35)).toBe(17.31) // 2624,97 × 12 / (52 × 35)
  })

  it('Natal numa sexta (25/12/2026), MT2: tudo é feriado, diurno até às 20h e noturno depois', () => {
    const p = premiumHours(days([['2026-12-25', 'MT2']]), 2026, 11)
    expect(p.weekendDay).toBe(11.5) // 08:30–20:00
    expect(p.weekendNight).toBe(2.5) // 20:00–22:30
    expect(p.weekdayNight).toBe(0)
  })

  it('noite de véspera de feriado: só as horas depois da meia-noite são de feriado', () => {
    const p = premiumHours(days([['2026-11-30', 'N']]), 2026, 10) // segunda 30/11 → feriado 1/12
    expect(p.weekdayNight).toBe(2) // 22h–24h de segunda
    expect(p.weekendNight).toBe(7) // 00h–07h de 1 de dezembro
    expect(p.weekendDay).toBe(2) // 07h–09h de 1 de dezembro
  })

  it('A CONFIRMAR: o Carnaval (17/02/2026) conta hoje como feriado', () => {
    expect(holidays(2026).has('2026-02-17')).toBe(true)
    const p = premiumHours(days([['2026-02-17', 'M']]), 2026, 1)
    expect(p.weekendDay).toBe(7) // se o hospital não o tratar como feriado, devia ser 0
  })

  it('A CONFIRMAR: na noite da mudança da hora (24→25/10/2026) contam-se 12 h de presença', () => {
    const p = premiumHours(days([['2026-10-24', 'N']]), 2026, 9)
    expect(p.total).toBe(12)
  })

  it('turno extra ao domingo à noite: 1.ª hora a 2,25R e as seguintes a 2,5R, sem TN', () => {
    const data = days([['2026-11-29', 'N']], ['2026-11-29']) // domingo 29/11 → segunda
    const p = premiumHours(data, 2026, 10)
    expect(p.extra.nightRest.first).toBe(1)
    expect(p.extra.nightRest.next).toBe(1) // 23h–24h de domingo
    expect(p.extra.nightWeekday.next).toBe(7) // 00h–07h de segunda
    expect(p.weekdayNight + p.weekendNight + p.weekendDay).toBe(0)
    const e = estimatePay(p, { category: 'Enfermeiro', level: 37, weeklyHours: 35, municipalHolidays: ['11-11'] })!
    expect(e.lines.find((l) => l.factor === 2.25)?.amount).toBe(38.95) // 1 × 2,25 × 17,31
  })

  it('subsídio de refeição: a noite e a saída (N + D) contam um só dia', () => {
    const pay = { category: 'Enfermeiro especialista', position: 5, level: 37, weeklyHours: 35, municipalHolidays: ['11-11'], mealPerDay: 6, irsPct: 0 }
    const data = { ...days([['2026-10-05', 'N'], ['2026-10-06', 'D'], ['2026-10-07', 'M']]), pay }
    const nov = projectSalary(data, 2026, 10)!
    expect(nov.lines.find((l) => l.label.startsWith('Subsídio de refeição'))?.amount).toBe(12)
  })

  it('talão de junho: sem prémio, com subsídio de férias, e a ADSE desconta sobre a base a dobrar', () => {
    const pay = { category: 'Enfermeiro especialista', position: 5, level: 37, weeklyHours: 35, municipalHolidays: ['11-11'], irsPct: 0 }
    const jun = projectSalary({ ...emptyData(), pay }, 2026, 5)!
    expect(jun.lines.some((l) => l.label.startsWith('Prémio'))).toBe(false)
    expect(jun.lines.find((l) => l.label === 'Subsídio de férias')?.amount).toBe(2624.97)
    expect(jun.lines.find((l) => l.label.startsWith('ADSE'))?.amount).toBe(183.75) // 2 × 2624,97 × 3,5%
  })

  it('talão de novembro: prémio de 14,28% e subsídio de Natal', () => {
    const pay = { category: 'Enfermeiro especialista', position: 5, level: 37, weeklyHours: 35, municipalHolidays: ['11-11'], irsPct: 0 }
    const nov = projectSalary({ ...emptyData(), pay }, 2026, 10)!
    expect(nov.lines.find((l) => l.label.startsWith('Prémio'))?.amount).toBe(374.85) // 2624,97 × 14,28%
    expect(nov.lines.find((l) => l.label === 'Subsídio de Natal')?.amount).toBe(2624.97)
  })
})
