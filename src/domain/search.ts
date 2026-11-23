// Pesquisa global: compromissos, turnos e tarefas num só campo.

import { addDays, startOfDay } from 'date-fns'
import { occurrencesIn } from './operations'
import type { Task } from './tasks'
import type { AppData, Occurrence } from './types'

export const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()

export interface SearchResults {
  /** Próximos primeiro, depois os passados mais recentes. Séries repetidas aparecem uma vez (a próxima). */
  events: Occurrence[]
  shifts: Occurrence[]
  tasks: Task[]
  total: number
}

/** Procura em 6 meses para trás e 12 para a frente. Turnos por código ou nome do tipo (ex.: "N", "noite"). */
export function globalSearch(data: AppData, query: string, now = new Date(), limit = 8): SearchResults {
  const q = normalize(query)
  if (!q) return { events: [], shifts: [], tasks: [], total: 0 }
  const today = startOfDay(now)
  const occs = occurrencesIn(data, addDays(today, -183), addDays(today, 366))
  const byTime = (a: Occurrence, b: Occurrence) => {
    const fa = a.end >= now
    const fb = b.end >= now
    if (fa !== fb) return fa ? -1 : 1
    return fa ? a.start.getTime() - b.start.getTime() : b.start.getTime() - a.start.getTime()
  }

  const seen = new Set<string>()
  const events = occs
    .filter((o) => o.source === 'event' && normalize(`${o.title} ${o.location ?? ''}`).includes(q))
    .sort(byTime)
    .filter((o) => {
      const k = o.eventId ?? o.key
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

  const types = new Map(data.shiftTypes.map((t) => [t.code, t]))
  const shifts = occs
    .filter((o) => {
      if (o.source !== 'shift') return false
      const code = o.title
      const t = types.get(code)
      return normalize(code) === q || (q.length >= 3 && normalize(t?.label ?? '').includes(q))
    })
    .sort(byTime)

  const tasks = data.tasks
    .filter((t) => normalize(`${t.title} ${t.notes ?? ''}`).includes(q))
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? '9999').localeCompare(b.due ?? '9999'))

  return { events: events.slice(0, limit), shifts: shifts.slice(0, limit), tasks: tasks.slice(0, limit), total: events.length + shifts.length + tasks.length }
}
