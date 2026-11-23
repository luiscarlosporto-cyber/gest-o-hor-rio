// Assistente IA: o que a app envia (agenda resumida) e como transforma as propostas em dados.
// As propostas nunca são gravadas sem o utilizador carregar em "Adicionar".

import { conflictsWith, freeSlots } from './conflicts'
import { addDays, parseLocal, startOfDay, timeOf, toDateKey, toLocal, weekdayName } from './dates'
import { occurrencesIn, type EventDraft } from './operations'
import { compareTasks, type Priority } from './tasks'
import type { AppData, Category, Occurrence } from './types'

export interface AssistantTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Proposta tal como vem do servidor (campos que não se aplicam vêm a null). */
export interface Proposal {
  kind: 'event' | 'task'
  title: string
  start: string | null
  end: string | null
  allDay: boolean | null
  category: Category | null
  location: string | null
  due: string | null
  dueTime: string | null
  priority: Priority | null
  notes: string | null
  why: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const TIME = /^\d{2}:\d{2}$/
const CATS: Category[] = ['trabalho', 'reuniao', 'pessoal', 'pausa', 'bloqueio']

const span = (o: Occurrence) => (o.allDay ? 'dia inteiro' : `${timeOf(o.start)}–${timeOf(o.end)}`)

/**
 * Resumo da agenda para o assistente: turnos, compromissos e intervalos livres (8:00–22:00) de cada dia,
 * e as tarefas por fazer. Não inclui vencimento, talões nem dados da conta.
 */
export function buildAssistantContext(data: AppData, now = new Date(), days = 21): string {
  const from = startOfDay(now)
  const to = addDays(from, days)
  const occs = occurrencesIn(data, addDays(from, -1), to)
  const lines: string[] = [`Agora: ${weekdayName(now)}, ${toLocal(now).replace('T', ' ')} (Lisboa).`, '', `Turnos e compromissos de ${toDateKey(from)} a ${toDateKey(addDays(to, -1))}:`]
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i)
    const next = addDays(day, 1)
    const items = occs.filter((o) => o.start < next && o.end > day && !(o.allDay && o.source === 'shift' && toDateKey(o.start) !== toDateKey(day)))
    const parts = items.map((o) => {
      const label = o.source === 'shift' ? `turno ${data.shiftDays.find((s) => s.date === o.shiftDate)?.code ?? ''} (${o.title})` : `"${o.title}" [${o.category}]${o.transparent ? ' (não ocupa)' : ''}`
      const cont = !o.allDay && o.start < day ? ' (vem do dia anterior)' : ''
      return `${span(o)} ${label}${cont}`
    })
    const free = freeSlots(items, new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8), new Date(day.getFullYear(), day.getMonth(), day.getDate(), 22), 60)
    const freeTxt = free.length ? `livre ${free.map((f) => `${timeOf(f.start)}–${timeOf(f.end)}`).join(', ')}` : 'sem intervalos livres de 1 h'
    lines.push(`- ${toDateKey(day)} ${weekdayName(day)}: ${parts.length ? parts.join('; ') : 'nada marcado'}. ${freeTxt}.`)
  }
  const open = data.tasks.filter((t) => !t.done).sort(compareTasks).slice(0, 40)
  lines.push('', open.length ? 'Tarefas por fazer:' : 'Sem tarefas por fazer.')
  for (const t of open) lines.push(`- "${t.title}"${t.due ? ` até ${t.due}${t.dueTime ? ` ${t.dueTime}` : ''}` : ''}${t.priority === 'alta' ? ' (prioridade alta)' : ''}`)
  const legend = data.shiftTypes.map((t) => `${t.code}=${t.label}${t.start && t.end ? ` ${t.start}–${t.end}` : ''}`).join(', ')
  lines.push('', `Códigos de turno: ${legend}.`)
  return lines.join('\n')
}

export type Checked =
  | { kind: 'event'; draft: EventDraft; conflicts: Occurrence[] }
  | { kind: 'task'; task: { title: string; due?: string; dueTime?: string; priority: Priority; notes?: string } }
  | { kind: 'invalid'; error: string }

/** Valida uma proposta e, num compromisso, procura colisões com turnos e outros compromissos. */
export function checkProposal(data: AppData, p: Proposal): Checked {
  const title = (p.title ?? '').trim()
  if (!title) return { kind: 'invalid', error: 'Proposta sem título.' }
  const notes = p.notes?.trim() || undefined
  if (p.kind === 'task') {
    const due = p.due && DATE.test(p.due) ? p.due : undefined
    const dueTime = due && p.dueTime && TIME.test(p.dueTime) ? p.dueTime : undefined
    const priority: Priority = p.priority === 'alta' || p.priority === 'baixa' ? p.priority : 'normal'
    return { kind: 'task', task: { title, due, dueTime, priority, notes } }
  }
  const allDay = Boolean(p.allDay)
  let start: string
  let end: string
  if (allDay) {
    const s = p.start?.slice(0, 10) ?? ''
    const e = p.end?.slice(0, 10) || s
    if (!DATE.test(s) || !DATE.test(e)) return { kind: 'invalid', error: 'A proposta não tem uma data válida.' }
    start = `${s}T00:00`
    end = toLocal(addDays(parseLocal(e < s ? s : e), 1))
  } else {
    if (!p.start || !DATETIME.test(p.start) || !p.end || !DATETIME.test(p.end)) return { kind: 'invalid', error: 'A proposta não tem data e hora válidas.' }
    start = p.start
    end = p.end
    if (parseLocal(end) <= parseLocal(start)) return { kind: 'invalid', error: 'O fim da proposta é antes do início.' }
  }
  const category: Category = p.category && CATS.includes(p.category) ? p.category : 'pessoal'
  const draft: EventDraft = { title, start, end, allDay, category, location: p.location?.trim() || undefined, notes, transparent: allDay || undefined }
  const s = parseLocal(start)
  const e = parseLocal(end)
  const candidate: Occurrence = { key: 'proposta', source: 'event', title, start: s, end: e, allDay, category, transparent: allDay || category === 'pausa', recurring: false }
  const conflicts = conflictsWith(candidate, occurrencesIn(data, addDays(s, -1), addDays(e, 1)))
  return { kind: 'event', draft, conflicts }
}
