// Leitura do horário mensal do SISQUAL (PDF "Horário Plano Inicial/Final") de um colaborador.
// Puro: recebe o texto com posições e uma função que diz se uma zona da página está a verde.
// O PDF é lido no próprio dispositivo (src/data/pdfRoster.ts); nada é enviado para fora.

import type { DateKey, ShiftDay, ShiftType } from './types'

export interface PdfText {
  str: string
  /** Canto superior esquerdo, em pontos, com y a crescer para baixo. */
  x: number
  y: number
  w: number
  h: number
}

export interface PdfPage {
  items: PdfText[]
  /** Fração da zona (x0..x1, y0..y1) pintada de verde (0..1). */
  greenRatio: (x0: number, x1: number, y0: number, y1: number) => number
}

export interface SisqualDay extends ShiftDay {
  /** Texto tal como está no PDF (ex.: "DS M", "6:30 T"). */
  raw: string
  /** O código não existe nos tipos de turno da app. */
  unknown?: boolean
}

export interface SisqualRoster {
  year: number
  month: number // 0-11
  kind: 'inicial' | 'final' | 'desconhecido'
  name?: string
  days: SisqualDay[]
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const pad = (n: number) => String(n).padStart(2, '0')

/** Interpreta o texto de uma célula: tira as marcas de horas ("2h", "4h") e escolhe o turno de trabalho, se houver. */
export function resolveCell(raw: string, types: ShiftType[]): { code: string; unknown: boolean; second: boolean } {
  const codes = new Set(types.map((t) => t.code))
  const work = new Set(types.filter((t) => t.work).map((t) => t.code))
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (codes.has(clean)) return { code: clean, unknown: false, second: false }
  const tokens = clean
    .split(' ')
    .filter((t) => !/^\d+h$/i.test(t))
    .map((t) => (codes.has(t) ? t : t.replace(/\d+h$/i, '')))
    .filter(Boolean)
  const joined = tokens.join(' ')
  if (codes.has(joined)) return { code: joined, unknown: false, second: false }
  // Dois códigos na mesma célula (ex.: "DS M", "DC N"): o segundo é o turno feito nesse dia.
  const expanded = tokens.flatMap((t) => {
    if (codes.has(t)) return [t]
    // "DN": saída da noite anterior + nova N (duas noites seguidas)
    // só descanso + trabalho (não separar códigos como "TL")
    for (const c of [...codes].filter((c) => !work.has(c)).sort((a, b) => b.length - a.length)) {
      if (t.startsWith(c) && work.has(t.slice(c.length))) return [c, t.slice(c.length)]
    }
    return [t]
  })
  const workCode = [...expanded].reverse().find((t) => work.has(t))
  if (workCode) return { code: workCode, unknown: false, second: expanded.length > 1 }
  const known = expanded.find((t) => codes.has(t))
  if (known) return { code: known, unknown: false, second: false }
  return { code: joined || clean, unknown: true, second: false }
}

/** Encontra e lê a linha do colaborador numa página. Devolve null se o número não estiver nesta página. */
export function parseSisqualPage(page: PdfPage, employee: string, types: ShiftType[], header?: string): SisqualRoster | null {
  const items = page.items.filter((i) => i.str.trim())
  const me = items.find((i) => i.str.trim() === employee.trim())
  if (!me) return null
  const all = [header ?? '', ...items.map((i) => i.str)].join(' ')
  const title = all.match(/-\s*(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/i)
  if (!title) throw new Error('Não encontrei o mês e o ano no PDF.')
  const month = MONTHS.indexOf(title[1].toLowerCase())
  const year = Number(title[2])
  const kind = /plano\s+final/i.test(all) ? 'final' : /plano\s+inicial/i.test(all) ? 'inicial' : 'desconhecido'

  // Linha dos dias: a linha acima do colaborador com mais números 1–31.
  const rowY = me.y
  const byLine = new Map<number, PdfText[]>()
  for (const i of items) {
    if (i.y >= rowY - 1) continue
    for (const part of splitNumbers(i)) {
      const k = Math.round(part.y)
      byLine.set(k, [...(byLine.get(k) ?? []), part])
    }
  }
  const header0 = [...byLine.values()].filter((l) => l.length >= 20).sort((a, b) => b.length - a.length || b[0].y - a[0].y)[0]
  if (!header0) throw new Error('Não encontrei a linha dos dias no PDF.')
  const cols = header0
    .map((i) => ({ cx: i.x + i.w / 2, n: Number(i.str.split('-')[0]) }))
    .sort((a, b) => a.cx - b.cx)
  const first = cols.findIndex((c) => c.n === 1)
  if (first < 0) throw new Error('Não encontrei o dia 1 no PDF.')
  const dates: DateKey[] = cols.map((c, i) => {
    const d = new Date(year, month + (i < first ? -1 : 0), c.n)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
  // Limites das colunas: a meio entre centros.
  const bounds = cols.map((c, i) => {
    const prev = cols[i - 1]?.cx ?? c.cx - (cols[1].cx - cols[0].cx)
    const next = cols[i + 1]?.cx ?? c.cx + (c.cx - prev)
    return { x0: (prev + c.cx) / 2, x1: (c.cx + next) / 2 }
  })

  // Texto da linha do colaborador, por coluna (pela ponta esquerda de cada palavra).
  const lineH = me.h || 5
  const cells: string[][] = cols.map(() => [])
  for (const i of items) {
    if (Math.abs(i.y - rowY) > lineH * 0.6) continue
    const colW = bounds[0].x1 - bounds[0].x0
    for (const word of i.w <= colW * 1.2 ? [i] : splitWords(i)) {
      const x = word.x + Math.min(1, word.w / 4)
      const k = bounds.findIndex((b) => x >= b.x0 && x < b.x1)
      if (k >= 0) cells[k].push(word.str)
    }
  }
  const name = items
    .filter((i) => Math.abs(i.y - rowY) < lineH * 0.6 && i.x > me.x + me.w && i.x < bounds[0].x0)
    .map((i) => i.str.trim())
    .join(' ')
    .trim()

  const days: SisqualDay[] = []
  cells.forEach((words, k) => {
    const raw = words.join(' ').trim()
    if (!raw || !dates[k].startsWith(`${year}-${pad(month + 1)}`)) return
    const r = resolveCell(raw, types)
    const b = bounds[k]
    const green = page.greenRatio(b.x0 + 0.5, b.x1 - 0.5, rowY - lineH * 0.3, rowY + lineH * 1.2) > 0.08
    const type = types.find((t) => t.code === r.code)
    const day: SisqualDay = { date: dates[k], code: r.code, raw }
    // Extra só quando a célula está a verde ("DN" = saída da noite anterior + nova N, não é extra por si).
    if (green && type?.work) day.extra = true
    if (r.unknown) day.unknown = true
    days.push(day)
  })
  return { year, month, kind, name: name || undefined, days }
}

/** Separa um item com vários números ("1 2 3") em partes com posição aproximada. */
function splitNumbers(i: PdfText): PdfText[] {
  return splitWords(i).filter((w) => /^\d{1,2}(-[a-zç]+)?$/i.test(w.str))
}

function splitWords(i: PdfText): PdfText[] {
  const parts = i.str.split(/(\s+)/)
  if (parts.length === 1) return [{ ...i, str: i.str.trim() }]
  const per = i.w / Math.max(1, i.str.length)
  const out: PdfText[] = []
  let at = 0
  for (const p of parts) {
    if (p.trim()) out.push({ ...i, str: p, x: i.x + at * per, w: p.length * per })
    at += p.length
  }
  return out
}

/** Grava o mês lido do PDF: substitui os dias desse mês e cria os códigos que faltam (como dia inteiro, sem trabalho). */
export function applyRoster<T extends { shiftDays: ShiftDay[]; shiftTypes: ShiftType[] }>(data: T, roster: SisqualRoster): T {
  const prefix = `${roster.year}-${pad(roster.month + 1)}-`
  const newTypes = [...new Set(roster.days.filter((d) => d.unknown).map((d) => d.code))]
    .filter((c) => !data.shiftTypes.some((t) => t.code === c))
    .map<ShiftType>((code) => ({ code, label: `${code} (do SISQUAL)`, color: '#D9D9D9', work: false }))
  const days = roster.days.map<ShiftDay>((d) => (d.extra ? { date: d.date, code: d.code, extra: true } : { date: d.date, code: d.code }))
  return {
    ...data,
    shiftTypes: newTypes.length ? [...data.shiftTypes, ...newTypes] : data.shiftTypes,
    shiftDays: [...data.shiftDays.filter((s) => !s.date.startsWith(prefix)), ...days].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/** Diferenças entre o que está na app e o que veio do PDF. */
export function rosterChanges(current: ShiftDay[], roster: SisqualRoster) {
  const byDate = new Map(current.map((d) => [d.date, d]))
  return roster.days.filter((d) => {
    const c = byDate.get(d.date)
    return !c || c.code !== d.code || Boolean(c.extra) !== Boolean(d.extra)
  })
}
