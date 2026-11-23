import { addDays, daysInMonth, minutesBetween, parseLocal, toDateKey } from './dates'
import type { DateKey, Occurrence, ShiftDay, ShiftType } from './types'

/**
 * Tipos de turno por omissão, com base nos códigos do horário SISQUAL da UCIP.
 * São editáveis na app.
 */
export const DEFAULT_SHIFT_TYPES: ShiftType[] = [
  { code: 'MT2', label: 'Manhã e tarde', start: '08:30', end: '22:30', color: '#F59A4A', work: true },
  { code: 'M', label: 'Manhã', start: '08:30', end: '15:30', color: '#F2B233', work: true },
  { code: 'T', label: 'Tarde', start: '15:00', end: '22:30', color: '#F07F63', work: true },
  { code: '6:30 T', label: 'Tarde curta', start: '15:30', end: '22:30', color: '#F07F63', work: true },
  { code: 'N', label: 'Noite', start: '22:00', end: '09:00', color: '#4A57D4', work: true, paidHours: 9 },
  { code: 'D', label: 'Descanso', color: '#34A872', work: false },
  { code: 'DS', label: 'Descanso semanal', color: '#34A872', work: false },
  { code: 'DC', label: 'Descanso complementar', color: '#34A872', work: false },
  { code: 'F', label: 'Folga', color: '#34A872', work: false },
  { code: 'Fe', label: 'Feriado', color: '#C62F35', work: false },
  { code: 'L', label: 'Férias', color: '#4FB0EC', work: false },
  { code: 'A', label: 'Ausência', color: '#8A94A6', work: false },
  { code: 'Cgs', label: 'Comissão gratuita de serviço', color: '#8A94A6', work: false },
]

/** Intervalo que conta como trabalho: do início até ao fim, ou só as horas contadas do tipo. */
export function paidTimes(date: DateKey, type: ShiftType) {
  const t = shiftTimes(date, type)
  if (t.allDay || !type.paidHours) return t
  const end = new Date(t.start.getTime() + type.paidHours * 3600_000)
  return { ...t, end: end < t.end ? end : t.end }
}

export function findType(types: ShiftType[], code: string): ShiftType | undefined {
  return types.find((t) => t.code === code) ?? types.find((t) => t.code.toLowerCase() === code.toLowerCase())
}

/** Início e fim de um turno num dia. Um turno que acaba antes de começar termina no dia seguinte (ex.: N). */
export function shiftTimes(date: DateKey, type: ShiftType): { start: Date; end: Date; allDay: boolean } {
  if (!type.start || !type.end) {
    const start = parseLocal(date)
    return { start, end: addDays(start, 1), allDay: true }
  }
  const start = parseLocal(`${date}T${type.start}`)
  let end = parseLocal(`${date}T${type.end}`)
  if (end <= start) end = addDays(end, 1)
  return { start, end, allDay: false }
}

export function shiftOccurrence(day: ShiftDay, types: ShiftType[]): Occurrence {
  const type = findType(types, day.code)
  const { start, end, allDay } = type
    ? shiftTimes(day.date, type)
    : { start: parseLocal(day.date), end: addDays(parseLocal(day.date), 1), allDay: true }
  return {
    key: `shift@${day.date}`,
    source: 'shift',
    shiftDate: day.date,
    title: day.code,
    start,
    end,
    allDay,
    category: 'trabalho',
    color: type?.color,
    transparent: !type?.work,
    recurring: false,
  }
}

/** Turnos que tocam o intervalo [from, to). Inclui a noite do dia anterior que entra no intervalo. */
export function shiftOccurrences(days: ShiftDay[], types: ShiftType[], from: Date, to: Date): Occurrence[] {
  const fromKey = toDateKey(addDays(from, -1))
  const toKey = toDateKey(to)
  return days
    .filter((d) => d.date >= fromKey && d.date <= toKey)
    .map((d) => shiftOccurrence(d, types))
    .filter((o) => o.start < to && o.end > from)
}

export interface RosterParseResult {
  days: ShiftDay[]
  unknown: string[]
  /** Diferença entre códigos lidos e dias do mês (0 = certo). */
  countDelta: number
}

/**
 * Lê uma linha de códigos (como copiada do PDF SISQUAL), um por dia a partir do dia 1.
 * Aceita espaços, tabulações, vírgulas ou ponto e vírgula como separadores.
 * Se vierem dias a mais, os primeiros são ignorados só quando se pede (skipFirst),
 * porque o PDF começa no último dia do mês anterior.
 */
export function parseRosterLine(
  text: string,
  year: number,
  monthIndex: number,
  types: ShiftType[],
  options: { skipFirst?: number } = {},
): RosterParseResult {
  const tokens = text
    .split(/[\s,;|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(options.skipFirst ?? 0)
  const total = daysInMonth(year, monthIndex)
  const unknown = new Set<string>()
  const days: ShiftDay[] = []
  tokens.slice(0, total).forEach((token, i) => {
    const type = findType(types, token)
    if (!type) unknown.add(token)
    const date = toDateKey(new Date(year, monthIndex, i + 1))
    days.push({ date, code: type?.code ?? token })
  })
  return { days, unknown: [...unknown], countDelta: tokens.length - total }
}

export interface MonthSummary {
  counts: { code: string; label: string; color?: string; days: number }[]
  workedMinutes: number
  workDays: number
}

export function summarizeMonth(days: ShiftDay[], types: ShiftType[], year: number, monthIndex: number): MonthSummary {
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`
  const inMonth = days.filter((d) => d.date.startsWith(prefix))
  const map = new Map<string, number>()
  let workedMinutes = 0
  let workDays = 0
  for (const d of inMonth) {
    map.set(d.code, (map.get(d.code) ?? 0) + 1)
    const type = findType(types, d.code)
    if (type?.work) {
      workDays++
      const t = paidTimes(d.date, type)
      workedMinutes += minutesBetween(t.start, t.end)
    }
  }
  const order = types.map((t) => t.code)
  const counts = [...map.entries()]
    .map(([code, n]) => {
      const t = findType(types, code)
      return { code, label: t?.label ?? 'Código desconhecido', color: t?.color, days: n }
    })
    .sort((a, b) => {
      const ia = order.indexOf(a.code)
      const ib = order.indexOf(b.code)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  return { counts, workedMinutes, workDays }
}

/** Substitui os turnos de um mês (ou de alguns dias) mantendo o resto. */
export function mergeShiftDays(existing: ShiftDay[], incoming: ShiftDay[]): ShiftDay[] {
  const byDate = new Map(existing.map((d) => [d.date, d]))
  for (const d of incoming) {
    if (d.code) byDate.set(d.date, d)
    else byDate.delete(d.date)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Código da saída da noite no SISQUAL: tem de vir logo a seguir a uma noite. */
export const NIGHT_EXIT_CODE = 'D'

const crossesMidnight = (t?: ShiftType) => Boolean(t?.work && t.start && t.end && t.end <= t.start)

/** Erros no horário: um D sem uma noite no dia anterior. */
export function shiftErrors(days: ShiftDay[], types: ShiftType[]): { date: DateKey; message: string }[] {
  const byDate = new Map(days.map((d) => [d.date, d.code]))
  const out: { date: DateKey; message: string }[] = []
  for (const d of days) {
    if (d.code !== NIGHT_EXIT_CODE) continue
    const prev = byDate.get(toDateKey(addDays(parseLocal(d.date), -1)))
    if (prev === undefined) continue // dia anterior por preencher: não dá para saber
    if (!crossesMidnight(findType(types, prev))) out.push({ date: d.date, message: `D sem noite antes (dia anterior: ${prev})` })
  }
  return out
}
