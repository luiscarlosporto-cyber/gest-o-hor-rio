import type { ShiftType } from './types'

/**
 * Família de um turno, para a linguagem de cores da Ritmia (igual em todo o lado):
 * manhã, tarde, manhã e tarde, noite, descanso, férias, feriado. Os extra levam contorno.
 * Deduzida das horas do tipo de turno, por isso funciona também com tipos criados pelo utilizador.
 */
export type ShiftFamily = 'morning' | 'afternoon' | 'long' | 'night' | 'rest' | 'leave' | 'holiday' | 'other'

export const FAMILY_LABEL: Record<ShiftFamily, string> = {
  morning: 'Manhã',
  afternoon: 'Tarde',
  long: 'Manhã e tarde',
  night: 'Noite',
  rest: 'Descanso',
  leave: 'Férias',
  holiday: 'Feriado',
  other: 'Outro',
}

const hours = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h + (m || 0) / 60
}

export function shiftFamily(type: ShiftType | undefined): ShiftFamily {
  if (!type) return 'other'
  const code = type.code.trim().toUpperCase()
  if (!type.work) {
    if (code === 'L' || /f[ée]rias/i.test(type.label)) return 'leave'
    if (code === 'FE' || /feriado/i.test(type.label)) return 'holiday'
    return 'rest'
  }
  if (!type.start || !type.end) return 'other'
  const s = hours(type.start)
  const e = hours(type.end)
  if (e <= s || s >= 20) return 'night'
  if (s < 12 && e > 17) return 'long'
  return s < 12 ? 'morning' : 'afternoon'
}

/** Parte do dia de um instante: manhã (até às 13h), tarde (até às 20h) e noite. */
export type DayPart = 'morning' | 'afternoon' | 'night'
export const dayPart = (d: Date): DayPart => (d.getHours() < 13 ? 'morning' : d.getHours() < 20 ? 'afternoon' : 'night')

/** "em 45 min", "em 3 h 20 min", "amanhã às 08:30" já fica a cargo de quem chama; aqui só a duração. */
export function countdown(from: Date, to: Date): string {
  const min = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d} d ${rh} h` : `${d} ${d === 1 ? 'dia' : 'dias'}`
}
