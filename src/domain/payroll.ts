import { addDays, parseLocal, toDateKey } from './dates'
import { findType, shiftTimes } from './shifts'
import type { AppData, DateKey } from './types'

/**
 * Horas com acréscimo, com as mesmas rubricas do talão de vencimento (pessoal hospitalar, DL 62/79):
 * - noturno: entre as 20h e as 8h;
 * - sábado depois das 13h, domingos e feriados.
 * O talão paga num mês as horas do mês anterior (ex.: talão de julho = trabalho de junho).
 * Não inclui trabalho suplementar (horas além do horário contratado).
 */

export interface PremiumHours {
  /** TN DUNot: noturnas em dias úteis. */
  weekdayNight: number
  /** TN Sáb>13 Dom Fer Diu: diurnas ao sábado depois das 13h, domingo ou feriado. */
  weekendDay: number
  /** TN Sáb Dom Fer Not: noturnas ao sábado, domingo ou feriado. */
  weekendNight: number
  /** Total de horas de turno (para referência). */
  total: number
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

export function premiumHours(data: AppData, year: number, month: number, opts: { municipal?: string[] } = {}): PremiumHours {
  const hol = new Set([...holidays(year - 1, opts.municipal), ...holidays(year, opts.municipal), ...holidays(year + 1, opts.municipal)])
  const from = new Date(year, month, 1)
  const to = new Date(year, month + 1, 1)
  const out: PremiumHours = { weekdayNight: 0, weekendDay: 0, weekendNight: 0, total: 0, missingDays: [] }
  const byDate = new Map(data.shiftDays.map((s) => [s.date, s.code]))

  // Turnos que começam no mês (inclui a noite do último dia, que acaba no mês seguinte).
  for (let d = new Date(from); d < to; d = addDays(d, 1)) {
    const key = toDateKey(d)
    const code = byDate.get(key)
    if (!code) {
      out.missingDays.push(key)
      continue
    }
    const type = findType(data.shiftTypes, code)
    if (!type?.work || !type.start || !type.end) continue
    const { start, end } = shiftTimes(key, type)
    for (let t = start.getTime(); t < end.getTime(); t += STEP * 60_000) {
      const at = new Date(t)
      const h = at.getHours() + at.getMinutes() / 60
      const dayKey = toDateKey(at)
      const dow = at.getDay()
      const night = h >= 20 || h < 8
      const special = dow === 0 || hol.has(dayKey) || (dow === 6 && (h >= 13 || night))
      const hours = STEP / 60
      out.total += hours
      if (night && (special || dow === 6)) out.weekendNight += hours
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
