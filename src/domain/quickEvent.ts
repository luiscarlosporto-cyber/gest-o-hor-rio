import { addDays, parseLocal } from './dates'
import { parseQuickTask } from './tasks'
import type { Category } from './types'

/**
 * Criação rápida de compromissos por escrita, em português.
 * Ex.: "Dentista sexta 10h" → sexta às 10:00, 1 hora; "Reunião amanhã 14h-15h30" → das 14:00 às 15:30;
 * "Jantar com a Ana 25/12 20h @ Porto" → local Porto; sem hora → dia inteiro.
 * Reaproveita o leitor das tarefas (hoje, amanhã, dias da semana, 25/12, 14h, 14h30, às 9).
 * Só preenche o editor: nada é gravado sem o utilizador confirmar.
 */
export interface QuickEvent {
  title: string
  start: Date
  end: Date
  allDay: boolean
  category: Category
  location?: string
}

const CATEGORY_WORDS: [Category, RegExp][] = [
  ['reuniao', /(?<![a-zà-ÿ])(reuni[ãa]o|forma[çc][ãa]o|webinar|aula|workshop|teams|zoom|confer[êe]ncia)(?![a-zà-ÿ])/i],
  ['trabalho', /(?<![a-zà-ÿ])(servi[çc]o|hospital|ucip|plant[ãa]o|escala|enfermaria)(?![a-zà-ÿ])/i],
]

const hhmm = (h: string, m?: string) => `${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`

export function parseQuickEvent(text: string, today: Date): QuickEvent {
  let rest = ` ${text.trim()} `
  let location: string | undefined
  const at = rest.match(/\s@\s*([^@]+?)\s*$/)
  if (at) {
    location = at[1].trim()
    rest = rest.slice(0, at.index) + ' '
  }

  // Intervalo "14h-15h30", "14:00–15:30", "das 14h às 16h"
  let endTime: string | undefined
  const range = rest.match(/\s(?:das\s)?(\d{1,2})(?:h|:)(\d{2})?\s*(?:-|–|a|às|as)\s*(\d{1,2})(?:h|:)?(\d{2})?(?=\s)/i)
  if (range && Number(range[1]) < 24 && Number(range[3]) < 24) {
    endTime = hhmm(range[3], range[4])
    rest = rest.replace(range[0], ` ${hhmm(range[1], range[2]).replace(':', 'h')} `)
  }

  const q = parseQuickTask(rest, today)
  const dateKey = q.due ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const title = q.title.replace(/\s+!+$/, '').trim() || text.trim()
  const category = CATEGORY_WORDS.find(([, re]) => re.test(title))?.[0] ?? 'pessoal'

  if (!q.dueTime) {
    const start = parseLocal(dateKey)
    return { title, start, end: addDays(start, 1), allDay: true, category, location }
  }
  const start = parseLocal(`${dateKey}T${q.dueTime}`)
  let end = endTime ? parseLocal(`${dateKey}T${endTime}`) : new Date(start.getTime() + 60 * 60_000)
  if (end <= start) end = addDays(end, 1) // "22h-2h" acaba no dia seguinte
  return { title, start, end, allDay: false, category, location }
}
