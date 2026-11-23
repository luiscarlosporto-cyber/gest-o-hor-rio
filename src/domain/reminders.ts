// Lembretes: calcula, no aparelho, os avisos dos próximos dias. O servidor só os envia à hora marcada.
// Assim as regras (séries repetidas, turnos, saída da noite) ficam num só sítio e testadas.

import { addDays, addMinutes, formatRange, parseLocal, startOfDay, timeOf, toDateKey } from './dates'
import { expandEvents } from './recurrence'
import { findType, NIGHT_EXIT_CODE, shiftTimes } from './shifts'
import type { AppData } from './types'

export interface ReminderSettings {
  enabled: boolean
  /** Minutos antes do início de um turno de trabalho (0 = sem aviso). */
  shiftLead: number
  /** Minutos antes de um compromisso com hora (0 = sem aviso). */
  eventLead: number
  /** Avisar tarefas na hora limite (ou às 9h do dia, se não tiver hora). */
  tasks: boolean
  /** Hora do resumo do dia (HH:mm) ou vazio para não enviar. */
  dailySummary?: string
}

export const defaultReminderSettings = (): ReminderSettings => ({ enabled: false, shiftLead: 120, eventLead: 30, tasks: true, dailySummary: '07:00' })

export interface Reminder {
  /** Chave estável: o mesmo aviso nunca é enviado duas vezes. */
  key: string
  fireAt: Date
  title: string
  body: string
  /** Ecrã a abrir ao tocar. */
  url: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const leadText = (min: number) => (min < 60 ? `daqui a ${min} min` : min % 60 ? `daqui a ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `daqui a ${min / 60}h`)

/** Avisos entre agora e `days` dias à frente, por ordem de hora. */
export function buildReminders(data: AppData, s: ReminderSettings, now = new Date(), days = 14): Reminder[] {
  if (!s.enabled) return []
  const until = addDays(startOfDay(now), days + 1)
  const out: Reminder[] = []
  const push = (r: Reminder) => r.fireAt > now && r.fireAt < until && out.push(r)

  // Turnos de trabalho (a saída da noite, D, não é um início de turno).
  if (s.shiftLead > 0) {
    for (const day of data.shiftDays) {
      const type = findType(data.shiftTypes, day.code)
      if (!type?.work || type.code === NIGHT_EXIT_CODE) continue
      const t = shiftTimes(day.date, type)
      if (t.allDay) continue
      push({
        key: `shift:${day.date}:${type.code}`,
        fireAt: addMinutes(t.start, -s.shiftLead),
        title: `${type.code}${day.extra ? ' (extra)' : ''} ${leadText(s.shiftLead)}`,
        body: `${type.label}, ${formatRange(t.start, t.end, false)}`,
        url: `turnos/${day.date}`,
      })
    }
  }

  // Compromissos com hora (as séries são expandidas aqui).
  const occs = expandEvents(data.events, startOfDay(now), until)
  if (s.eventLead > 0) {
    for (const o of occs) {
      if (o.allDay) continue
      push({
        key: `ev:${o.eventId ?? o.key}:${toDateKey(o.start)}T${timeOf(o.start)}`,
        fireAt: addMinutes(o.start, -s.eventLead),
        title: o.title,
        body: `${leadText(s.eventLead)}, às ${timeOf(o.start)}${o.location ? ` · ${o.location}` : ''}`,
        url: `dia/${toDateKey(o.start)}`,
      })
    }
  }

  // Tarefas com data.
  if (s.tasks) {
    for (const t of data.tasks) {
      if (t.done || !t.due) continue
      push({
        key: `task:${t.id}:${t.due}${t.dueTime ? `T${t.dueTime}` : ''}`,
        fireAt: parseLocal(`${t.due}T${t.dueTime ?? '09:00'}`),
        title: t.dueTime ? `Tarefa para agora: ${t.title}` : `Tarefa para hoje: ${t.title}`,
        body: t.priority === 'alta' ? 'Prioridade alta' : 'Toca para abrir as tarefas',
        url: 'tarefas',
      })
    }
  }

  // Resumo do dia.
  if (s.dailySummary && /^\d{2}:\d{2}$/.test(s.dailySummary)) {
    for (let i = 0; i <= days; i++) {
      const date = addDays(startOfDay(now), i)
      const key = toDateKey(date)
      const shift = data.shiftDays.find((d) => d.date === key)
      const type = shift && findType(data.shiftTypes, shift.code)
      const dayEvents = occs.filter((o) => toDateKey(o.start) === key)
      const dayTasks = data.tasks.filter((t) => !t.done && t.due === key)
      const parts = [
        type?.code === NIGHT_EXIT_CODE
          ? 'D · saída da noite até às 09:00'
          : type ? (type.start ? `${type.code} ${formatRange(shiftTimes(key, type).start, shiftTimes(key, type).end, false)}` : `${type.code} · ${type.label}`) : 'sem turno marcado',
        dayEvents.length ? plural(dayEvents.length, 'compromisso', 'compromissos') : '',
        dayTasks.length ? plural(dayTasks.length, 'tarefa', 'tarefas') : '',
      ].filter(Boolean)
      push({ key: `daily:${key}`, fireAt: parseLocal(`${key}T${s.dailySummary}`), title: 'O teu dia', body: parts.join(' · '), url: '' })
    }
  }

  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
}
