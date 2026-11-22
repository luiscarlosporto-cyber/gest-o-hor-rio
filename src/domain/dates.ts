import type { DateKey, LocalDateTime } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-11-23T08:30" ou "2026-11-23" → Date com esses campos na hora local. */
export function parseLocal(value: LocalDateTime | DateKey): Date {
  const [d, t = '00:00'] = value.split('T')
  const [y, m, day] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  return new Date(y, m - 1, day, h, mi, 0, 0)
}

export function toLocal(date: Date): LocalDateTime {
  return `${toDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function toDateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function timeOf(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

/** Semana começa à segunda-feira. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date)
  const dow = (d.getDay() + 6) % 7
  return addDays(d, -dow)
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

export function isSameDay(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b)
}

/** 6 semanas × 7 dias, começando na segunda-feira antes do dia 1. */
export function monthGrid(date: Date): Date[] {
  const first = startOfWeek(startOfMonth(date))
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000)
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export const weekdayName = (d: Date) => WEEKDAYS[d.getDay()]
export const weekdayShort = (d: Date) => WEEKDAYS_SHORT[d.getDay()]
export const monthName = (m: number) => MONTHS[m]

export function formatLongDate(d: Date): string {
  return `${weekdayName(d)}, ${d.getDate()} de ${MONTHS[d.getMonth()]}`
}

export function formatMonthYear(d: Date): string {
  const m = MONTHS[d.getMonth()]
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${d.getFullYear()}`
}

export function formatRange(start: Date, end: Date, allDay: boolean): string {
  if (allDay) return 'Dia inteiro'
  const sameDay = isSameDay(start, end) || (end.getHours() === 0 && end.getMinutes() === 0 && minutesBetween(start, end) <= 24 * 60)
  return sameDay ? `${timeOf(start)}–${timeOf(end)}` : `${timeOf(start)}–${timeOf(end)} (+1)`
}
