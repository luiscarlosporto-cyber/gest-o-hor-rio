import { findConflicts } from './conflicts'
import { addDays, daysInMonth, minutesBetween, parseLocal, startOfDay, toDateKey } from './dates'
import { occurrencesIn } from './operations'
import { findType, paidTimes, summarizeMonth, type MonthSummary } from './shifts'
import { groupTasks, type Task } from './tasks'
import type { AppData, Category, DateKey, Occurrence, ShiftType } from './types'

// ---------- Painel "Hoje" ----------

export interface DayStrip {
  date: DateKey
  shift?: { code: string; color?: string; work: boolean }
  events: number
}

export interface TodayOverview {
  /** Turno que está a decorrer agora (inclui a noite que começou ontem). */
  currentShift?: Occurrence
  /** Próximo turno de trabalho que ainda não começou. */
  nextShift?: Occurrence
  /** Horas de descanso entre o fim do último turno e o próximo. */
  restMinutes?: number
  /** Agenda de hoje (eventos e turnos), por ordem. */
  agenda: Occurrence[]
  tasksDue: Task[]
  overdue: Task[]
  /** Próximos 7 dias, a começar hoje. */
  week: DayStrip[]
  /** Próximo dia sem turno de trabalho. */
  nextDayOff?: DateKey
  conflicts: number
}

/**
 * Dia de "saída da noite": o dia sem turno (ex.: D) a seguir a uma noite que passa a meia-noite.
 * Não é folga: ainda se trabalha da meia-noite até ao fim da noite (ex.: 00h–09h).
 */
export function isNightExit(data: AppData, key: DateKey): boolean {
  const sd = data.shiftDays.find((s) => s.date === key)
  const type = sd ? findType(data.shiftTypes, sd.code) : undefined
  if (type?.work) return false
  const prevKey = toDateKey(addDays(parseLocal(key), -1))
  const prev = data.shiftDays.find((s) => s.date === prevKey)
  const pt = prev ? findType(data.shiftTypes, prev.code) : undefined
  return Boolean(pt?.work && pt.start && pt.end && pt.end <= pt.start && pt.end > '00:00')
}

const isWorkShift = (o: Occurrence) => o.source === 'shift' && !o.transparent

export function todayOverview(data: AppData, now: Date): TodayOverview {
  const today = startOfDay(now)
  const tomorrow = addDays(today, 1)
  const ahead = occurrencesIn(data, addDays(today, -1), addDays(today, 15))
  const shifts = ahead.filter(isWorkShift)

  const currentShift = shifts.find((o) => o.start <= now && o.end > now)
  const nextShift = shifts.find((o) => o.start > now)
  const lastEnded = [...shifts].reverse().find((o) => o.end <= (nextShift?.start ?? now))
  const restMinutes = nextShift && lastEnded && !currentShift ? minutesBetween(lastEnded.end, nextShift.start) : undefined

  const agenda = ahead.filter((o) => o.start < tomorrow && o.end > today && !(o.source === 'shift' && o.transparent))
  const g = groupTasks(data.tasks, now)

  const week: DayStrip[] = []
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i)
    const key = toDateKey(d)
    const sd = data.shiftDays.find((s) => s.date === key)
    const type = sd ? findType(data.shiftTypes, sd.code) : undefined
    const events = ahead.filter((o) => o.source === 'event' && toDateKey(o.start) === key).length
    week.push({ date: key, shift: sd ? { code: sd.code, color: type?.color, work: Boolean(type?.work) } : undefined, events })
  }

  let nextDayOff: DateKey | undefined
  for (let i = 0; i < 60; i++) {
    const key = toDateKey(addDays(today, i))
    const sd = data.shiftDays.find((s) => s.date === key)
    const type = sd ? findType(data.shiftTypes, sd.code) : undefined
    if (sd && !type?.work && !isNightExit(data, key)) {
      nextDayOff = key
      break
    }
  }

  const todayOccs = occurrencesIn(data, today, tomorrow)
  return {
    currentShift,
    nextShift,
    restMinutes,
    agenda,
    tasksDue: g.today,
    overdue: g.overdue,
    week,
    nextDayOff,
    conflicts: findConflicts(todayOccs).length,
  }
}

// ---------- Relatório mensal ----------

export interface ReportDay {
  date: DateKey
  code?: string
  label?: string
  workMinutes: number
  night: boolean
  /** Dia a seguir a uma noite: ainda se trabalha de madrugada, não é folga. */
  nightExit: boolean
  /** Turno extra (suplementar). */
  extra: boolean
  weekend: boolean
  events: number
}

export interface MonthReport {
  year: number
  month: number
  summary: MonthSummary
  /** Diferença de horas de turno face ao mês anterior (minutos). */
  deltaMinutes: number
  nights: number
  weekendsWorked: number
  daysOff: number
  /** Dias de saída da noite (contam como trabalho, não como folga). */
  nightExits: number
  /** Maior sequência de dias seguidos com turno de trabalho. */
  longestStreak: number
  /** Horas de turno por semana (segunda a domingo) que toca o mês. */
  weeks: { start: DateKey; minutes: number }[]
  /** Minutos de eventos (fora dos turnos) por categoria. */
  eventMinutes: Partial<Record<Category, number>>
  eventCount: number
  conflicts: number
  tasksDone: number
  tasksCreated: number
  days: ReportDay[]
}

/** Um turno é "noite" se começa às 20h ou depois, ou passa a meia-noite. */
const isNight = (t: ShiftType) => Boolean(t.start && t.end && (t.start >= '20:00' || t.end <= t.start))

function workMinutesOn(data: AppData, key: DateKey) {
  const sd = data.shiftDays.find((s) => s.date === key)
  const type = sd ? findType(data.shiftTypes, sd.code) : undefined
  if (!sd || !type?.work) return { sd, type, minutes: 0 }
  const t = paidTimes(key, type)
  return { sd, type, minutes: t.allDay ? 0 : minutesBetween(t.start, t.end) }
}

export function monthReport(data: AppData, year: number, month: number): MonthReport {
  const summary = summarizeMonth(data.shiftDays, data.shiftTypes, year, month)
  const prevDate = new Date(year, month - 1, 1)
  const prev = summarizeMonth(data.shiftDays, data.shiftTypes, prevDate.getFullYear(), prevDate.getMonth())
  const first = new Date(year, month, 1)
  const after = new Date(year, month + 1, 1)
  const occs = occurrencesIn(data, first, after)
  const events = occs.filter((o) => o.source === 'event')

  const days: ReportDay[] = []
  let nights = 0
  let weekendsWorked = 0
  let daysOff = 0
  let nightExits = 0
  let streak = 0
  let longestStreak = 0
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const date = new Date(year, month, d)
    const key = toDateKey(date)
    const { sd, type, minutes } = workMinutesOn(data, key)
    const weekend = date.getDay() === 0 || date.getDay() === 6
    const night = Boolean(type?.work && isNight(type))
    if (night) nights++
    if (type?.work && weekend) weekendsWorked++
    const nightExit = isNightExit(data, key)
    if (nightExit) nightExits++
    else if (sd && !type?.work) daysOff++
    streak = type?.work || nightExit ? streak + 1 : 0
    longestStreak = Math.max(longestStreak, streak)
    days.push({
      date: key,
      code: sd?.code,
      label: nightExit ? 'Saída da noite' : type?.label,
      workMinutes: minutes,
      night,
      nightExit,
      extra: Boolean(sd?.extra),
      weekend,
      events: events.filter((o) => toDateKey(o.start) === key).length,
    })
  }

  // Semanas de segunda a domingo que tocam o mês
  const weeks: { start: DateKey; minutes: number }[] = []
  let ws = addDays(first, -((first.getDay() + 6) % 7))
  while (ws < after) {
    let minutes = 0
    for (let i = 0; i < 7; i++) minutes += workMinutesOn(data, toDateKey(addDays(ws, i))).minutes
    weeks.push({ start: toDateKey(ws), minutes })
    ws = addDays(ws, 7)
  }

  const eventMinutes: Partial<Record<Category, number>> = {}
  for (const e of events) {
    if (e.allDay) continue
    const start = e.start < first ? first : e.start
    const end = e.end > after ? after : e.end
    eventMinutes[e.category] = (eventMinutes[e.category] ?? 0) + Math.max(0, minutesBetween(start, end))
  }

  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const inMonth = (iso?: string) => Boolean(iso) && toDateKey(new Date(iso!)).startsWith(prefix)

  return {
    year,
    month,
    summary,
    deltaMinutes: summary.workedMinutes - prev.workedMinutes,
    nights,
    weekendsWorked,
    daysOff,
    nightExits,
    longestStreak,
    weeks,
    eventMinutes,
    eventCount: events.length,
    conflicts: findConflicts(occs).length,
    tasksDone: data.tasks.filter((t) => t.done && inMonth(t.doneAt)).length,
    tasksCreated: data.tasks.filter((t) => inMonth(t.createdAt)).length,
    days,
  }
}

export const fmtHours = (min: number) => {
  const sign = min < 0 ? '-' : ''
  const m = Math.abs(min)
  return `${sign}${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`
}

/** Relatório em CSV (separador ";" para abrir direto no Excel em português). */
export function reportCsv(r: MonthReport): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows: (string | number)[][] = [['Data', 'Dia da semana', 'Turno', 'Descrição', 'Horas de turno', 'Noite', 'Eventos', 'Extra']]
  for (const d of r.days) {
    const date = parseLocal(d.date)
    rows.push([
      d.date,
      date.toLocaleDateString('pt-PT', { weekday: 'long' }),
      d.code ?? '',
      d.label ?? '',
      d.workMinutes ? (d.workMinutes / 60).toFixed(2).replace('.', ',') : '',
      d.night ? 'sim' : '',
      d.events || '',
      d.extra ? 'sim' : '',
    ])
  }
  rows.push([])
  rows.push(['Total de horas', '', '', '', (r.summary.workedMinutes / 60).toFixed(2).replace('.', ','), '', r.eventCount])
  rows.push(['Dias de trabalho', r.summary.workDays])
  rows.push(['Noites', r.nights])
  rows.push(['Fins de semana a trabalhar', r.weekendsWorked])
  rows.push(['Saídas da noite', r.nightExits])
  rows.push(['Folgas e descansos', r.daysOff])
  return '﻿' + rows.map((row) => row.map(esc).join(';')).join('\r\n')
}
