import { addMinutes, toLocal } from './dates'
import type { Category } from './types'

/**
 * Lista de horários colada (ex.: SMS do ginásio, fisioterapia, explicações):
 *
 *   Treinos de 11/2026:
 *   4/11 16h
 *   12/11 15h30
 *
 * Cada linha com dia/mês e hora vira uma sessão. Tudo é processado no dispositivo;
 * nada é gravado sem confirmação.
 */
export interface ScheduleItem {
  start: Date
  /** Linha original, para o utilizador conferir. */
  line: string
}

export interface ScheduleList {
  items: ScheduleItem[]
  /** Título sugerido a partir do texto ("Treino" quando fala em treinos). */
  title: string
  category: Category
  /** Linhas que parecem ter uma data mas não foi possível ler a hora. */
  skipped: string[]
}

const DATE = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/
const TIME = /\b(\d{1,2})(?:[h:](\d{2})?|\s*horas?)\b/i

function guessTitle(text: string): { title: string; category: Category } {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/\btreino|ginasio|\bpt\b|personal/.test(t)) return { title: 'Treino', category: 'pessoal' }
  if (/fisio/.test(t)) return { title: 'Fisioterapia', category: 'pessoal' }
  if (/explica/.test(t)) return { title: 'Explicação', category: 'pessoal' }
  if (/consulta/.test(t)) return { title: 'Consulta', category: 'pessoal' }
  return { title: 'Sessão', category: 'pessoal' }
}

/** Ano de referência: "de 11/2026" no cabeçalho, ou o mais próximo de hoje. */
function headerYear(text: string): number | undefined {
  const m = text.match(/\b(\d{1,2})[/.-](20\d{2})\b/)
  return m ? Number(m[2]) : undefined
}

function pickYear(day: number, month: number, today: Date, hinted?: number): number {
  if (hinted) return hinted
  const y = today.getFullYear()
  // Uma data mais de dois meses no passado é do ano seguinte (ex.: lista de janeiro recebida em dezembro).
  const candidate = new Date(y, month - 1, day)
  return candidate.getTime() < today.getTime() - 60 * 864e5 ? y + 1 : y
}

export function parseScheduleList(text: string, today: Date): ScheduleList {
  const year = headerYear(text)
  const items: ScheduleItem[] = []
  const skipped: string[] = []
  const seen = new Set<string>()

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const d = line.match(DATE)
    if (!d) continue
    // Cabeçalho "Treinos de 11/2026": mês/ano, não é uma sessão.
    if (!d[3] && Number(d[2]) > 12) continue
    const day = Number(d[1])
    const month = Number(d[2])
    if (day < 1 || day > 31 || month < 1 || month > 12) continue
    const rest = line.slice((d.index ?? 0) + d[0].length)
    const t = rest.match(TIME)
    if (!t) {
      skipped.push(line)
      continue
    }
    const hh = Number(t[1])
    const mm = Number(t[2] ?? 0)
    if (hh > 23 || mm > 59) {
      skipped.push(line)
      continue
    }
    let y = d[3] ? Number(d[3]) : pickYear(day, month, today, year)
    if (y < 100) y += 2000
    const start = new Date(y, month - 1, day, hh, mm)
    if (start.getMonth() !== month - 1) {
      skipped.push(line)
      continue
    }
    const k = toLocal(start)
    if (seen.has(k)) continue
    seen.add(k)
    items.push({ start, line })
  }

  items.sort((a, b) => a.start.getTime() - b.start.getTime())
  return { items, skipped, ...guessTitle(text) }
}

export const endOf = (start: Date, minutes: number) => addMinutes(start, minutes)
