import { addDays, toDateKey } from './dates'
import { newId } from './operations'
import type { DateKey } from './types'

export type Priority = 'alta' | 'normal' | 'baixa'

export interface Task {
  id: string
  title: string
  notes?: string
  /** Data limite (YYYY-MM-DD). */
  due?: DateKey
  /** Hora limite (HH:mm), só com data. */
  dueTime?: string
  priority: Priority
  done: boolean
  doneAt?: string
  /** De onde veio: escrita à mão ou sugerida a partir de um email. */
  source?: 'manual' | 'gmail'
  createdAt: string
  updatedAt: string
}

export const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'alta', label: 'Alta' },
  { id: 'normal', label: 'Normal' },
  { id: 'baixa', label: 'Baixa' },
]

const WEEKDAYS: Record<string, number> = {
  dom: 0, domingo: 0,
  seg: 1, segunda: 1, 'segunda-feira': 1,
  terca: 2, terça: 2, 'terça-feira': 2, 'terca-feira': 2,
  qua: 3, quarta: 3, 'quarta-feira': 3,
  qui: 4, quinta: 4, 'quinta-feira': 4,
  sex: 5, sexta: 5, 'sexta-feira': 5,
  sab: 6, sáb: 6, sabado: 6, sábado: 6,
}

const WEEKDAY_RE = new RegExp(
  `\\s(?:na\\s|no\\s|pr[óo]xim[ao]\\s)?(${Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|')})(?=\\s)`,
  'i',
)

export interface QuickTask {
  title: string
  due?: DateKey
  dueTime?: string
  priority: Priority
}

/**
 * Lê uma frase rápida e tira dela data, hora e prioridade.
 * Ex.: "Ligar à Ana amanhã 14h !" → título "Ligar à Ana", amanhã às 14:00, prioridade alta.
 * Entende: hoje, amanhã, depois de amanhã, dias da semana (seg…dom, "sexta"), 25/12, 25/12/2027,
 * horas (14h, 14h30, 14:30, às 9) e "!" para prioridade alta.
 */
export function parseQuickTask(text: string, today: Date): QuickTask {
  let rest = ` ${text.trim()} `
  let due: DateKey | undefined
  let dueTime: string | undefined
  let priority: Priority = 'normal'

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean) => {
    const m = rest.match(re)
    if (m && fn(m)) rest = rest.replace(m[0], ' ')
  }

  take(/\s!+(?=\s)/, () => ((priority = 'alta'), true))

  take(/\s(?:às\s|as\s)?(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?=\s)/i, (m) => {
    const h = Number(m[1])
    const min = Number(m[2] ?? m[3] ?? 0)
    if (h > 23 || min > 59) return false
    dueTime = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    return true
  })
  if (!dueTime)
    take(/\s(?:às|as)\s(\d{1,2})(?=\s)/i, (m) => {
      const h = Number(m[1])
      if (h > 23) return false
      dueTime = `${String(h).padStart(2, '0')}:00`
      return true
    })

  take(/\sdepois de amanh[ãa](?=\s)/i, () => ((due = toDateKey(addDays(today, 2))), true))
  if (!due) take(/\samanh[ãa](?=\s)/i, () => ((due = toDateKey(addDays(today, 1))), true))
  if (!due) take(/\shoje(?=\s)/i, () => ((due = toDateKey(today)), true))
  if (!due)
    take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, (m) => {
      const d = Number(m[1])
      const mo = Number(m[2])
      if (d < 1 || d > 31 || mo < 1 || mo > 12) return false
      let y = m[3] ? Number(m[3]) : today.getFullYear()
      if (y < 100) y += 2000
      let date = new Date(y, mo - 1, d)
      if (!m[3] && date < new Date(today.getFullYear(), today.getMonth(), today.getDate())) date = new Date(y + 1, mo - 1, d)
      if (date.getDate() !== d) return false
      due = toDateKey(date)
      return true
    })
  if (!due)
    take(WEEKDAY_RE, (m) => {
      const w = WEEKDAYS[m[1].toLowerCase()]
      const diff = (w - today.getDay() + 7) % 7 || 7
      due = toDateKey(addDays(today, diff))
      return true
    })

  if (dueTime && !due) due = toDateKey(today)
  const title = rest.replace(/\s+/g, ' ').trim()
  return { title: title || text.trim(), due, dueTime, priority }
}

export function addTask(tasks: Task[], input: Partial<Task> & { title: string }, now = new Date()): Task[] {
  const stamp = now.toISOString()
  const task: Task = {
    id: input.id ?? newId(),
    title: input.title.trim(),
    notes: input.notes || undefined,
    due: input.due || undefined,
    dueTime: input.due ? input.dueTime || undefined : undefined,
    priority: input.priority ?? 'normal',
    done: false,
    source: input.source ?? 'manual',
    createdAt: stamp,
    updatedAt: stamp,
  }
  return [...tasks, task]
}

export function updateTask(tasks: Task[], id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>, now = new Date()): Task[] {
  return tasks.map((t) => {
    if (t.id !== id) return t
    const next: Task = { ...t, ...patch, updatedAt: now.toISOString() }
    if (!next.due) next.dueTime = undefined
    if ('done' in patch) next.doneAt = patch.done ? now.toISOString() : undefined
    return next
  })
}

export const toggleTask = (tasks: Task[], id: string, now = new Date()) => {
  const t = tasks.find((x) => x.id === id)
  return t ? updateTask(tasks, id, { done: !t.done }, now) : tasks
}

export const removeTask = (tasks: Task[], id: string) => tasks.filter((t) => t.id !== id)

const PRIO_ORDER: Record<Priority, number> = { alta: 0, normal: 1, baixa: 2 }

export function compareTasks(a: Task, b: Task): number {
  const da = `${a.due ?? '9999-99-99'}T${a.dueTime ?? '99:99'}`
  const db = `${b.due ?? '9999-99-99'}T${b.dueTime ?? '99:99'}`
  return da.localeCompare(db) || PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] || a.createdAt.localeCompare(b.createdAt)
}

export interface TaskGroups {
  overdue: Task[]
  today: Task[]
  upcoming: Task[]
  someday: Task[]
  done: Task[]
}

/** Agrupa como uma lista de tarefas: atrasadas, hoje, próximas, sem data e concluídas (as últimas 30). */
export function groupTasks(tasks: Task[], now: Date): TaskGroups {
  const today = toDateKey(now)
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const g: TaskGroups = { overdue: [], today: [], upcoming: [], someday: [], done: [] }
  for (const t of tasks) {
    if (t.done) g.done.push(t)
    else if (!t.due) g.someday.push(t)
    else if (t.due < today || (t.due === today && t.dueTime && t.dueTime < time)) g.overdue.push(t)
    else if (t.due === today) g.today.push(t)
    else g.upcoming.push(t)
  }
  g.overdue.sort(compareTasks)
  g.today.sort(compareTasks)
  g.upcoming.sort(compareTasks)
  g.someday.sort((a, b) => PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] || a.createdAt.localeCompare(b.createdAt))
  g.done.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
  g.done = g.done.slice(0, 30)
  return g
}

/** Quantas tarefas pedem atenção (atrasadas + hoje), para o número no menu. */
export const pendingCount = (tasks: Task[], now: Date) => {
  const g = groupTasks(tasks, now)
  return g.overdue.length + g.today.length
}
