import { addMinutes, minutesBetween, parseLocal, toDateKey, toLocal } from './dates'
import { expandEvents } from './recurrence'
import { shiftOccurrences } from './shifts'
import type { AppData, CalendarEvent, DateKey, Occurrence } from './types'

export type EditScope = 'this' | 'all'

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const now = () => new Date().toISOString()

export type EventDraft = Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

export function validateDraft(d: EventDraft): string | null {
  if (!d.title.trim()) return 'Indica um título.'
  if (parseLocal(d.end) < parseLocal(d.start)) return 'O fim tem de ser depois do início.'
  return null
}

/** Cria ou atualiza um evento simples ou uma série inteira. */
export function upsertEvent(events: CalendarEvent[], draft: EventDraft): CalendarEvent[] {
  const ts = now()
  if (draft.id) {
    return events.map((e) => (e.id === draft.id ? { ...e, ...draft, id: e.id, updatedAt: ts } : e))
  }
  return [...events, { ...draft, id: newId(), createdAt: ts, updatedAt: ts }]
}

/**
 * Edita só uma ocorrência de uma série: a data original é excluída da série e
 * passa a existir um evento próprio ligado à série (mesmo modelo do Google Calendar).
 */
export function editOccurrence(
  events: CalendarEvent[],
  seriesId: string,
  originalDate: DateKey,
  draft: EventDraft,
): CalendarEvent[] {
  const ts = now()
  const exception: CalendarEvent = {
    ...draft,
    id: newId(),
    rrule: undefined,
    exdates: undefined,
    recurringEventId: seriesId,
    originalDate,
    createdAt: ts,
    updatedAt: ts,
  }
  return [
    ...events.map((e) =>
      e.id === seriesId ? { ...e, exdates: [...new Set([...(e.exdates ?? []), originalDate])], updatedAt: ts } : e,
    ),
    exception,
  ]
}

/**
 * Edita a série toda. Mantém a hora alterada mas não a data, para que mudar
 * "das 9h para as 10h" numa ocorrência de terça não desloque a série.
 */
export function editSeries(events: CalendarEvent[], seriesId: string, draft: EventDraft, occurrenceStart: Date): CalendarEvent[] {
  const series = events.find((e) => e.id === seriesId)
  if (!series) return events
  const seriesStart = parseLocal(series.start)
  const newStart = parseLocal(draft.start)
  const shift = minutesBetween(occurrenceStart, newStart)
  const duration = minutesBetween(newStart, parseLocal(draft.end))
  const start = addMinutes(seriesStart, shift)
  return upsertEvent(events, {
    ...draft,
    id: seriesId,
    start: toLocal(start),
    end: toLocal(addMinutes(start, duration)),
    exdates: series.exdates,
  })
}

export function deleteEvent(events: CalendarEvent[], eventId: string, scope: EditScope, occurrenceDate?: DateKey): CalendarEvent[] {
  const ev = events.find((e) => e.id === eventId)
  if (!ev) return events
  if (scope === 'this' && ev.rrule && occurrenceDate) {
    return events.map((e) =>
      e.id === eventId ? { ...e, exdates: [...new Set([...(e.exdates ?? []), occurrenceDate])], updatedAt: now() } : e,
    )
  }
  // Apagar uma série apaga também as suas exceções.
  return events.filter((e) => e.id !== eventId && e.recurringEventId !== eventId)
}

/** Ocorrências de eventos e turnos num intervalo, ordenadas por início. */
export function occurrencesIn(data: AppData, from: Date, to: Date): Occurrence[] {
  return [
    ...shiftOccurrences(data.shiftDays, data.shiftTypes, from, to),
    ...expandEvents(data.events, from, to),
  ].sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay))
}

export interface SearchFilters {
  text: string
  categories: string[]
}

export function searchOccurrences(occs: Occurrence[], f: SearchFilters): Occurrence[] {
  const q = f.text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  return occs.filter((o) => {
    if (f.categories.length && !f.categories.includes(o.source === 'shift' ? 'turno' : o.category)) return false
    if (!q) return true
    const hay = `${o.title} ${o.location ?? ''}`.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    return hay.includes(q)
  })
}

export const occurrenceDate = (o: Occurrence) => toDateKey(o.start)
