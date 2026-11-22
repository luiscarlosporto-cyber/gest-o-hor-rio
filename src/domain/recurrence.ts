import { RRule, Frequency, type Weekday } from 'rrule'
import { minutesBetween, parseLocal, toDateKey, addMinutes } from './dates'
import type { CalendarEvent, Occurrence } from './types'

/*
 * O rrule trabalha em UTC. Para respeitar a hora local (e a mudança de hora),
 * convertemos a hora local para uma data "UTC flutuante" com os mesmos campos,
 * expandimos, e voltamos a converter.
 */
const toFloating = (d: Date) =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()))
const fromFloating = (d: Date) =>
  new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes())

export type RepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface RepeatOptions {
  freq: RepeatFreq
  interval?: number
  /** 0 = segunda … 6 = domingo (apenas semanal). */
  byWeekday?: number[]
  /** Último dia (inclusive), YYYY-MM-DD. */
  until?: string
  count?: number
}

const FREQS: Record<Exclude<RepeatFreq, 'none'>, Frequency> = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
}
const WEEKDAYS: Weekday[] = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU]

/** Constrói a regra (sem DTSTART) a partir das opções do editor. */
export function buildRRule(opts: RepeatOptions): string | undefined {
  if (opts.freq === 'none') return undefined
  const parts = [`FREQ=${RRule.FREQUENCIES[FREQS[opts.freq]]}`]
  if (opts.interval && opts.interval > 1) parts.push(`INTERVAL=${opts.interval}`)
  if (opts.freq === 'weekly' && opts.byWeekday?.length) {
    const days = [...opts.byWeekday].sort((a, b) => a - b).map((i) => WEEKDAYS[i].toString())
    parts.push(`BYDAY=${days.join(',')}`)
  }
  if (opts.until) parts.push(`UNTIL=${opts.until.replaceAll('-', '')}T235959Z`)
  else if (opts.count) parts.push(`COUNT=${opts.count}`)
  return parts.join(';')
}

/** Lê uma regra para voltar a preencher o editor. */
export function parseRRule(rule?: string): RepeatOptions {
  if (!rule) return { freq: 'none' }
  const o = RRule.parseString(rule)
  const freq = (Object.entries(FREQS).find(([, f]) => f === o.freq)?.[0] ?? 'none') as RepeatFreq
  const byWeekday = o.byweekday
    ? (Array.isArray(o.byweekday) ? o.byweekday : [o.byweekday]).map((w) =>
        typeof w === 'number' ? w : (w as Weekday).weekday,
      )
    : undefined
  const until = o.until
    ? `${o.until.getUTCFullYear()}-${String(o.until.getUTCMonth() + 1).padStart(2, '0')}-${String(o.until.getUTCDate()).padStart(2, '0')}`
    : undefined
  return { freq, interval: o.interval ?? 1, byWeekday, until, count: o.count ?? undefined }
}

/** Texto curto em português para mostrar a regra. */
export function describeRRule(rule?: string): string {
  const o = parseRRule(rule)
  const n = o.interval && o.interval > 1 ? o.interval : 1
  const names = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
  let base: string
  switch (o.freq) {
    case 'none':
      return 'Não se repete'
    case 'daily':
      base = n === 1 ? 'Todos os dias' : `A cada ${n} dias`
      break
    case 'weekly':
      base = n === 1 ? 'Todas as semanas' : `A cada ${n} semanas`
      if (o.byWeekday?.length) base += ` (${o.byWeekday.map((d) => names[d]).join(', ')})`
      break
    case 'monthly':
      base = n === 1 ? 'Todos os meses' : `A cada ${n} meses`
      break
    case 'yearly':
      base = 'Todos os anos'
      break
  }
  if (o.until) base += ` até ${o.until.split('-').reverse().join('/')}`
  else if (o.count) base += `, ${o.count} vezes`
  return base
}

function toOccurrence(ev: CalendarEvent, start: Date, end: Date): Occurrence {
  return {
    key: `${ev.id}@${toDateKey(start)}`,
    source: 'event',
    eventId: ev.id,
    title: ev.title,
    start,
    end,
    allDay: ev.allDay,
    category: ev.category,
    transparent: ev.transparent ?? (ev.category === 'pausa' || ev.allDay),
    recurring: Boolean(ev.rrule || ev.recurringEventId),
    location: ev.location,
  }
}

/** Todas as ocorrências de um evento que tocam o intervalo [from, to). */
export function expandEvent(ev: CalendarEvent, from: Date, to: Date): Occurrence[] {
  const start = parseLocal(ev.start)
  const end = parseLocal(ev.end)
  const duration = Math.max(minutesBetween(start, end), 0)

  if (!ev.rrule) {
    const effectiveEnd = duration === 0 ? addMinutes(end, 1) : end
    return start < to && effectiveEnd > from ? [toOccurrence(ev, start, end)] : []
  }

  const rule = new RRule({ ...RRule.parseString(ev.rrule), dtstart: toFloating(start) })
  const exdates = new Set(ev.exdates ?? [])
  // Uma ocorrência que começa antes de "from" pode ainda estar a decorrer.
  const windowStart = toFloating(addMinutes(from, -duration))
  const windowEnd = toFloating(to)
  return rule
    .between(windowStart, windowEnd, true)
    .map(fromFloating)
    .filter((s) => !exdates.has(toDateKey(s)))
    .map((s) => toOccurrence(ev, s, addMinutes(s, duration)))
    .filter((o) => o.start < to && o.end > from)
}

export function expandEvents(events: CalendarEvent[], from: Date, to: Date): Occurrence[] {
  return events.flatMap((ev) => expandEvent(ev, from, to))
}
