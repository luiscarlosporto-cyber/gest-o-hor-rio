import { overlaps } from './dates'
import type { Occurrence } from './types'

export interface Conflict {
  a: Occurrence
  b: Occurrence
}

/** Ocorrências que ocupam tempo (não transparentes e não de dia inteiro). */
const busy = (o: Occurrence) => !o.transparent && !o.allDay

/** Pares de ocorrências que se sobrepõem. O(n log n + k). */
export function findConflicts(occurrences: Occurrence[]): Conflict[] {
  const list = occurrences.filter(busy).sort((x, y) => x.start.getTime() - y.start.getTime())
  const conflicts: Conflict[] = []
  const active: Occurrence[] = []
  for (const cur of list) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end <= cur.start) active.splice(i, 1)
    }
    for (const other of active) {
      if (overlaps(other.start, other.end, cur.start, cur.end)) conflicts.push({ a: other, b: cur })
    }
    active.push(cur)
  }
  return conflicts
}

/** Conflitos de uma ocorrência candidata (ex.: no editor, antes de gravar). */
export function conflictsWith(candidate: Occurrence, others: Occurrence[], ignoreEventId?: string): Occurrence[] {
  if (!busy(candidate)) return []
  return others.filter(
    (o) =>
      busy(o) &&
      o.key !== candidate.key &&
      (!ignoreEventId || o.eventId !== ignoreEventId) &&
      overlaps(o.start, o.end, candidate.start, candidate.end),
  )
}

/** Intervalos livres num dia, entre "dayStart" e "dayEnd" (ex.: 08:00–20:00). */
export function freeSlots(occurrences: Occurrence[], dayStart: Date, dayEnd: Date, minMinutes = 30): { start: Date; end: Date }[] {
  const busyList = occurrences
    .filter((o) => busy(o) && overlaps(o.start, o.end, dayStart, dayEnd))
    .sort((x, y) => x.start.getTime() - y.start.getTime())
  const slots: { start: Date; end: Date }[] = []
  let cursor = dayStart
  for (const o of busyList) {
    if (o.start > cursor && (o.start.getTime() - cursor.getTime()) / 60_000 >= minMinutes) {
      slots.push({ start: cursor, end: o.start })
    }
    if (o.end > cursor) cursor = o.end
  }
  if (dayEnd > cursor && (dayEnd.getTime() - cursor.getTime()) / 60_000 >= minMinutes) slots.push({ start: cursor, end: dayEnd })
  return slots
}
