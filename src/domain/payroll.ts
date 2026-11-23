import { addDays, parseLocal, toDateKey } from './dates'
import { findType, paidTimes } from './shifts'
import type { AppData, DateKey, PaySettings } from './types'

/**
 * Horas com acréscimo, com as mesmas rubricas do talão de vencimento (pessoal hospitalar, DL 62/79):
 * - noturno: entre as 20h e as 8h;
 * - sábado depois das 13h (noturno de sábado só depois das 20h), domingos e feriados.
 * Tabela de referência: Remuneração da Carreira de Enfermagem 2026 (R = remuneração × 12 / (52 × 35)).
 * O talão paga num mês as horas do mês anterior (ex.: talão de julho = trabalho de junho).
 * Não inclui trabalho suplementar (horas além do horário contratado).
 */

export type ExtraBand = 'dayWeekday' | 'nightWeekdayOrDayRest' | 'nightRest'

/** Multiplicadores do valor/hora (R) no trabalho suplementar: [1.ª hora, seguintes]. */
export const EXTRA_RATES: Record<ExtraBand, [number, number]> = {
  dayWeekday: [1.25, 1.5],
  nightWeekdayOrDayRest: [1.75, 2],
  nightRest: [2.25, 2.5],
}

/** Valor/hora a partir da remuneração mensal: R = mensal × 12 / (52 × horas semanais). */
export const hourlyRate = (monthly: number, weeklyHours = 35) => Math.round(((monthly * 12) / (52 * weeklyHours)) * 100) / 100

/** Tabela Remuneratória Única 2026, níveis da carreira de enfermagem (DL 29-A/2026). */
export const TRU_2026: Record<number, number> = {
  19: 1657.04, 23: 1867.57, 24: 1920.2, 27: 2082.84, 28: 2137.05, 31: 2299.69, 34: 2462.31, 37: 2624.97, 38: 2679.17,
  40: 2790.67, 42: 2904.18, 43: 2961.89, 46: 3134.97, 49: 3308.07, 50: 3365.77, 52: 3481.16, 53: 3538.86, 56: 3711.96, 58: 3827.36,
}

export const CATEGORIES_ENF = ['Enfermeiro', 'Enfermeiro especialista', 'Enfermeiro gestor'] as const

/** Índice remuneratório de cada posição, por categoria (carreiras de enfermagem, 2026). */
export const CAREER_POSITIONS: Record<(typeof CATEGORIES_ENF)[number], number[]> = {
  Enfermeiro: [19, 23, 27, 31, 34, 37, 40, 43, 46, 49, 52],
  'Enfermeiro especialista': [24, 28, 31, 34, 37, 40, 43, 46, 49, 52],
  'Enfermeiro gestor': [38, 42, 46, 50, 53, 56, 58],
}

export const positionsFor = (category: string) => CAREER_POSITIONS[category as (typeof CATEGORIES_ENF)[number]]

export const defaultPaySettings = (): PaySettings => ({ category: 'Enfermeiro', weeklyHours: 35, municipalHolidays: ['11-11'] })

export const monthlyBase = (p?: PaySettings) => p?.monthly ?? (p?.level ? TRU_2026[p.level] : undefined)

export interface PayEstimate {
  rate: number
  lines: { label: string; hours: number; factor: number; amount: number }[]
  total: number
}

/** Estimativa em euros dos acréscimos (TN) e do suplementar, com o valor/hora R. */
export function estimatePay(p: PremiumHours, settings?: PaySettings): PayEstimate | undefined {
  const base = monthlyBase(settings)
  if (!base) return undefined
  const rate = hourlyRate(base, settings?.weeklyHours || 35)
  const lines: PayEstimate['lines'] = [
    { label: 'TN noturno em dias úteis (+50%)', hours: p.weekdayNight, factor: 0.5 },
    { label: 'TN sábado >13h, domingo e feriado, diurno (+50%)', hours: p.weekendDay, factor: 0.5 },
    { label: 'TN sábado, domingo e feriado, noturno (+100%)', hours: p.weekendNight, factor: 1 },
    { label: 'Suplementar diurno, 1.ª hora (1,25R)', hours: p.extra.dayWeekday.first, factor: 1.25 },
    { label: 'Suplementar diurno, seguintes (1,5R)', hours: p.extra.dayWeekday.next, factor: 1.5 },
    { label: 'Suplementar noturno útil ou diurno fim de semana, 1.ª hora (1,75R)', hours: p.extra.nightWeekdayOrDayRest.first, factor: 1.75 },
    { label: 'Suplementar noturno útil ou diurno fim de semana, seguintes (2R)', hours: p.extra.nightWeekdayOrDayRest.next, factor: 2 },
    { label: 'Suplementar noturno fim de semana, 1.ª hora (2,25R)', hours: p.extra.nightRest.first, factor: 2.25 },
    { label: 'Suplementar noturno fim de semana, seguintes (2,5R)', hours: p.extra.nightRest.next, factor: 2.5 },
  ]
    .filter((l) => l.hours > 0)
    .map((l) => ({ ...l, amount: Math.round(l.hours * l.factor * rate * 100) / 100 }))
  return { rate, lines, total: Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100 }
}

export interface PremiumHours {
  /** TN DUNot: noturnas em dias úteis. */
  weekdayNight: number
  /** TN Sáb>13 Dom Fer Diu: diurnas ao sábado depois das 13h, domingo ou feriado. */
  weekendDay: number
  /** TN Sáb Dom Fer Not: noturnas ao sábado, domingo ou feriado. */
  weekendNight: number
  /** Total de horas de turno (para referência, inclui as extra). */
  total: number
  /**
   * Trabalho suplementar (turnos marcados como extra), por escalão da tabela de enfermagem.
   * first = 1.ª hora de cada turno extra, next = horas seguintes.
   * dayWeekday: diurno em dia útil (1,25R / 1,5R)
   * nightWeekdayOrDayRest: noturno em dia útil, ou diurno ao sábado >13h, domingo, feriado (1,75R / 2R)
   * nightRest: noturno ao sábado >20h, domingo, feriado (2,25R / 2,5R)
   */
  extra: Record<ExtraBand, { first: number; next: number }>
  /** Dias do mês sem nenhum turno registado (o cálculo fica incompleto). */
  missingDays: DateKey[]
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easter(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

/** Feriados nacionais e o municipal (por omissão Penafiel, 11 de novembro, São Martinho). */
export function holidays(year: number, municipal: string[] = ['11-11']): Set<DateKey> {
  const fixed = ['01-01', '04-25', '05-01', '06-10', '08-15', '10-05', '11-01', '12-01', '12-08', '12-25', ...municipal]
  const e = easter(year)
  const set = new Set(fixed.map((md) => `${year}-${md}`))
  set.add(toDateKey(addDays(e, -47))) // Carnaval (tolerância habitual)
  set.add(toDateKey(addDays(e, -2))) // Sexta-feira Santa
  set.add(toDateKey(e)) // Páscoa
  set.add(toDateKey(addDays(e, 60))) // Corpo de Deus
  return set
}

const STEP = 15 // minutos

export function premiumHours(data: AppData, year: number, month: number, opts: { municipal?: string[] } = { municipal: data.pay?.municipalHolidays }): PremiumHours {
  const hol = new Set([...holidays(year - 1, opts.municipal), ...holidays(year, opts.municipal), ...holidays(year + 1, opts.municipal)])
  const from = new Date(year, month, 1)
  const to = new Date(year, month + 1, 1)
  const out: PremiumHours = {
    weekdayNight: 0,
    weekendDay: 0,
    weekendNight: 0,
    total: 0,
    missingDays: [],
    extra: { dayWeekday: { first: 0, next: 0 }, nightWeekdayOrDayRest: { first: 0, next: 0 }, nightRest: { first: 0, next: 0 } },
  }
  const byDate = new Map(data.shiftDays.map((s) => [s.date, s]))

  // Turnos que começam no mês (inclui a noite do último dia, que acaba no mês seguinte).
  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    const key = toDateKey(d)
    const day = byDate.get(key)
    if (!day) {
      out.missingDays.push(key)
      continue
    }
    const type = findType(data.shiftTypes, day.code)
    if (!type?.work || !type.start || !type.end) continue
    const { start, end } = paidTimes(key, type)
    for (let t = start.getTime(); t < end.getTime(); t += STEP * 60_000) {
      const at = new Date(t)
      const h = at.getHours() + at.getMinutes() / 60
      const dayKey = toDateKey(at)
      const dow = at.getDay()
      const night = h >= 20 || h < 8
      // Sábado só conta a partir das 13h (diurno) e das 20h (noturno): a madrugada de sábado é noturno de dia útil.
      const special = dow === 0 || hol.has(dayKey) || (dow === 6 && h >= 13)
      const hours = STEP / 60
      out.total += hours
      if (day.extra) {
        // Suplementar: já inclui o acréscimo noturno/fim de semana, não entra nas rubricas TN.
        const band: ExtraBand = night && special ? 'nightRest' : night || special ? 'nightWeekdayOrDayRest' : 'dayWeekday'
        out.extra[band][t - start.getTime() < 60 * 60_000 ? 'first' : 'next'] += hours
        continue
      }
      if (night && special) out.weekendNight += hours
      else if (night) out.weekdayNight += hours
      else if (special) out.weekendDay += hours
    }
  }
  return out
}

/** Mês a que o talão se refere: o talão de julho paga junho. */
export const workMonthForPayslip = (year: number, month: number) => {
  const d = new Date(year, month - 1, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export const isHoliday = (key: DateKey) => holidays(parseLocal(key).getFullYear()).has(key)
