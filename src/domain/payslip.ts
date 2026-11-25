// Leitura do talão de vencimento (ULS / RHV) e confronto com o horário.
// Só se guardam rubricas, horas e valores. Nunca o nome, NIF, IBAN, n.º de beneficiário ou apólice.

import { CATEGORIES_ENF, positionsFor, premiumHours, TRU_2026, type ExtraBand, type PremiumHours } from './payroll'
import type { AppData, PaySettings } from './types'

export interface SlipText {
  str: string
  x: number
  y: number
}

export interface PayslipLine {
  code: string // ex.: "211 001"
  label: string // ex.: "TN DUNotOEHosp"
  /** Mês a que se refere (AAAA-MM), ex.: horas de junho pagas em julho. */
  ref?: string
  qty?: number
  amount: number
}

export interface Payslip {
  year: number
  month: number // 0-11, mês do talão
  category?: string
  index?: number
  irsRate?: number
  earnings: PayslipLine[]
  deductions: PayslipLine[]
  gross: number
  totalDeductions: number
  net: number
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "2.624,97" → 2624.97; ",00" → 0; "-6,15" → -6.15 */
export const ptNumber = (s: string) => Number(s.trim().replace(/\s*\*$/, '').replace(/\./g, '').replace(',', '.'))
/** Valores do talão; um "*" no fim marca o valor com redução (ex.: "165,93*"). */
const isAmount = (s: string) => /^-?[\d.]*,\d{2}\s*\*?$/.test(s.trim())
const isRef = (s: string) => /^\d{2}\/\d{2}$/.test(s.trim())
const refKey = (s: string) => `20${s.slice(0, 2)}-${s.slice(3, 5)}`

interface Row {
  y: number
  items: SlipText[]
}

function rows(items: SlipText[]): Row[] {
  const out: Row[] = []
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const r = out.find((r) => Math.abs(r.y - it.y) <= 2)
    if (r) r.items.push(it)
    else out.push({ y: it.y, items: [it] })
  }
  for (const r of out) r.items.sort((a, b) => a.x - b.x)
  return out
}

/** Lê as rubricas de uma coluna do talão (abonos ou descontos). */
function parseColumn(items: SlipText[], codeX: number, labelX: number, kind: 'earning' | 'deduction'): PayslipLine[] {
  const lines: (PayslipLine & { y: number })[] = []
  for (const r of rows(items)) {
    const first = r.items[0]
    const startsRow = /^\d{3}$/.test(first.str.trim()) && Math.abs(first.x - codeX) < 8
    if (!startsRow) {
      // Continuação do texto da rubrica de cima (ex.: "Sáb>13DomFerDiuOEHosp", "(3,5%)")
      const prev = lines.at(-1)
      const text = r.items.filter((i) => i.x >= labelX - 4 && !isAmount(i.str) && !isRef(i.str)).map((i) => i.str.trim())
      if (prev && r.y - prev.y < 14 && text.length) prev.label = `${prev.label} ${text.join(' ')}`.replace(/\s+/g, ' ').trim()
      continue
    }
    const rest = r.items.slice(1)
    const code2 = rest[0] && /^\d{3,4}$/.test(rest[0].str.trim()) && rest[0].x < labelX ? rest.shift()!.str.trim() : ''
    const ref = rest.find((i) => isRef(i.str))
    const nums = rest.filter((i) => isAmount(i.str) && (!ref || i.x > ref.x))
    const label = rest
      .filter((i) => i.x < (ref?.x ?? Infinity) && !isAmount(i.str) && i.str.trim() !== 'a)')
      .map((i) => i.str.trim())
      .join(' ')
    if (!nums.length && !ref) {
      lines.push({ y: r.y, code: `${first.str.trim()} ${code2}`.trim(), label, amount: 0 })
      continue
    }
    // Abonos: [quantidade] valor s/ redução, valor c/ redução. Descontos: incidência, desconto.
    // Só uma quantidade, sem valor (ex.: "Com.Grat.Serv." 1,00)
    if (kind === 'earning' && nums.length === 1 && nums[0].x < labelX + 150) {
      lines.push({ y: r.y, code: `${first.str.trim()} ${code2}`.trim(), label, ref: ref ? refKey(ref.str) : undefined, qty: ptNumber(nums[0].str), amount: 0 })
      continue
    }
    const amount = nums.length ? ptNumber(nums.at(-1)!.str) : 0
    const qty = kind === 'earning' && nums.length >= 3 ? ptNumber(nums[0].str) : undefined
    lines.push({ y: r.y, code: `${first.str.trim()} ${code2}`.trim(), label, ref: ref ? refKey(ref.str) : undefined, qty, amount })
  }
  return lines.map(({ y: _y, ...l }) => l)
}

export function parsePayslip(items: SlipText[], splitAt?: number): Payslip & { splitX: number } {
  const find = (re: RegExp) => items.find((i) => re.test(i.str.trim()))
  const rightOf = (label: SlipText | undefined, test: (s: string) => boolean, dy = 3) =>
    label ? items.filter((i) => Math.abs(i.y - label.y) <= dy && i.x > label.x && test(i.str)).sort((a, b) => a.x - b.x)[0] : undefined
  const below = (label: SlipText | undefined, test: (s: string) => boolean) =>
    label ? items.filter((i) => i.y > label.y && i.y - label.y < 6 && Math.abs(i.x - label.x) < 120 && test(i.str)).sort((a, b) => a.y - b.y)[0] : undefined

  const rel = rightOf(find(/^Relativo a$/), (s) => /^\d{4}\s*\/\s*\p{L}+$/u.test(s.trim()))
  const m = rel?.str.match(/(\d{4})\s*\/\s*(\p{L}+)/u)
  if (!m) throw new Error('Isto não parece um talão de vencimento (não encontrei "Relativo a").')
  const year = Number(m[1])
  const month = MONTHS.indexOf(m[2].toLowerCase())
  if (month < 0) throw new Error(`Não percebi o mês do talão (${m[2]}).`)

  const irs = rightOf(find(/^Taxa IRS Mensal$/), (s) => /^[\d,]+$/.test(s.trim()))
  const cat = items.find((i) => /^\d{4}\s+Enfermeir/i.test(i.str.trim()))
  const idx = below(find(/^INT\. REMUNER\.$/), (s) => /^\d{1,3}$/.test(s.trim()))

  const head = find(/^Abonos$/)
  const descHead = find(/^Descontos$/)
  const totalLabel = find(/^Total Ilíquido$/)
  // Nas páginas seguintes de um talão longo o título "Descontos" pode faltar: usa-se a coluna da 1.ª página.
  if (!head || !totalLabel || (!descHead && splitAt === undefined)) throw new Error('Não encontrei a tabela de abonos e descontos.')
  const splitX = descHead ? descHead.x - 8 : splitAt!
  const body = items.filter((i) => i.y > head.y + 4 && i.y < totalLabel.y - 4)
  const left = body.filter((i) => i.x < splitX)
  const right = body.filter((i) => i.x >= splitX)
  const codeXLeft = Math.min(...left.filter((i) => /^\d{3}$/.test(i.str.trim())).map((i) => i.x))
  const labelXLeft = Math.min(...left.filter((i) => /\p{L}/u.test(i.str)).map((i) => i.x))
  const codeXRight = Math.min(...right.filter((i) => /^\d{3}$/.test(i.str.trim())).map((i) => i.x))
  const labelXRight = Math.min(...right.filter((i) => /\p{L}/u.test(i.str)).map((i) => i.x))
  const earnings = parseColumn(left, codeXLeft, labelXLeft, 'earning')
  const deductions = right.length ? parseColumn(right, codeXRight, labelXRight, 'deduction') : []

  const near = (label: SlipText | undefined) =>
    label
      ? items
          .filter((i) => isAmount(i.str) && Math.abs(i.y - label.y) <= 3 && i.y >= totalLabel.y - 4)
          .sort((a, b) => Math.abs(a.x - label.x) - Math.abs(b.x - label.x))[0]
      : undefined
  const sum = (l: PayslipLine[]) => Math.round(l.reduce((a, x) => a + x.amount, 0) * 100) / 100
  const grossItem = near(totalLabel)
  const dedItem = near(find(/^Total Descontos$/))
  const gross = grossItem ? ptNumber(grossItem.str) : sum(earnings)
  const totalDeductions = dedItem ? ptNumber(dedItem.str) : sum(deductions)

  return {
    year,
    month,
    category: cat?.str.trim().replace(/^\d{4}\s+/, ''),
    index: idx ? Number(idx.str) : undefined,
    irsRate: irs ? ptNumber(irs.str) : undefined,
    earnings,
    deductions,
    gross,
    totalDeductions,
    net: Math.round((gross - totalDeductions) * 100) / 100,
    splitX,
  }
}

/**
 * Talão com várias páginas: cada página repete o cabeçalho e os totais, e continua a lista de abonos e descontos.
 * Lê cada página e junta as rubricas.
 */
export function parsePayslipPages(pages: SlipText[][]): Payslip {
  const first = parsePayslip(pages[0] ?? [])
  const parsed: Payslip[] = [first]
  // Páginas seguintes que não sejam do talão (ex.: uma folha em branco) ficam de fora.
  for (const items of pages.slice(1)) {
    try {
      const p = parsePayslip(items, first.splitX)
      if (p.year === first.year && p.month === first.month) parsed.push(p)
    } catch {
      /* página sem tabela */
    }
  }
  const { splitX: _splitX, ...slip } = first
  return { ...slip, earnings: parsed.flatMap((p) => p.earnings), deductions: parsed.flatMap((p) => p.deductions) }
}

// ---------- Confronto talão × horário ----------

export interface CheckRow {
  label: string
  app: number
  slip: number
  /** Valor pago no talão (€). */
  amount: number
}

type Key = 'weekdayNight' | 'weekendDay' | 'weekendNight' | `${ExtraBand}.${'first' | 'next'}`

/** Classifica uma rubrica de horas do talão (TN … / E …). */
export function slipKey(label: string): Key | undefined {
  const l = label.replace(/\s+/g, '')
  if (/^TN/i.test(l)) {
    if (/DUNot/i.test(l)) return 'weekdayNight'
    if (/Diu/i.test(l)) return 'weekendDay'
    if (/Not/i.test(l)) return 'weekendNight'
    return undefined
  }
  const e = l.match(/^E(DU|.+?)(Diu|Not)(1ª|1a|Seg)/i)
  if (!e) return undefined
  const weekday = e[1].toUpperCase() === 'DU'
  const night = e[2].toLowerCase() === 'not'
  const band: ExtraBand = night ? (weekday ? 'nightWeekday' : 'nightRest') : weekday ? 'dayWeekday' : 'dayRest'
  return `${band}.${/^1/.test(e[3]) ? 'first' : 'next'}`
}

const KEY_LABELS: Record<Key, string> = {
  weekdayNight: 'TN noturno em dia útil',
  weekendDay: 'TN sábado >13h, domingo e feriado, diurno',
  weekendNight: 'TN sábado, domingo e feriado, noturno',
  'dayWeekday.first': 'E diurno dia útil, 1.ª hora',
  'dayWeekday.next': 'E diurno dia útil, seguintes',
  'nightWeekday.first': 'E noturno dia útil, 1.ª hora',
  'nightWeekday.next': 'E noturno dia útil, seguintes',
  'dayRest.first': 'E diurno sáb./dom./feriado, 1.ª hora',
  'dayRest.next': 'E diurno sáb./dom./feriado, seguintes',
  'nightRest.first': 'E noturno sáb./dom./feriado, 1.ª hora',
  'nightRest.next': 'E noturno sáb./dom./feriado, seguintes',
}

const valueOf = (p: PremiumHours, k: Key) => {
  if (k === 'weekdayNight' || k === 'weekendDay' || k === 'weekendNight') return p[k]
  const [band, part] = k.split('.') as [ExtraBand, 'first' | 'next']
  return p.extra[band][part]
}

/** Compara as horas pagas no talão (de um mês de trabalho) com as do horário na app. */
export function checkPayslip(data: AppData, slip: Payslip, workYear: number, workMonth: number): CheckRow[] {
  const ref = `${workYear}-${String(workMonth + 1).padStart(2, '0')}`
  const p = premiumHours(data, workYear, workMonth)
  const slipBy = new Map<Key, { qty: number; amount: number }>()
  for (const l of slip.earnings) {
    if (l.ref !== ref || l.qty === undefined) continue
    const k = slipKey(l.label)
    if (!k) continue
    const cur = slipBy.get(k) ?? { qty: 0, amount: 0 }
    slipBy.set(k, { qty: cur.qty + l.qty, amount: cur.amount + l.amount })
  }
  return (Object.keys(KEY_LABELS) as Key[])
    .map((k) => ({ label: KEY_LABELS[k], app: Math.round(valueOf(p, k) * 100) / 100, slip: slipBy.get(k)?.qty ?? 0, amount: slipBy.get(k)?.amount ?? 0 }))
    .filter((r) => r.app > 0 || r.slip > 0)
}

// ---------- Definições a partir do talão ----------

/** Lê do talão a categoria, a posição (pelo índice), a taxa de IRS e o subsídio de refeição por dia. */
export function settingsFromPayslip(slip: Payslip, current: PaySettings): { settings: PaySettings; changes: string[] } {
  const next: PaySettings = { ...current }
  const changes: string[] = []
  const cat = slip.category ? [...CATEGORIES_ENF].sort((a, b) => b.length - a.length).find((c) => slip.category!.toLowerCase().startsWith(c.toLowerCase())) : undefined
  if (cat && cat !== current.category) {
    next.category = cat
    changes.push(`categoria: ${cat}`)
  }
  if (slip.index && TRU_2026[slip.index]) {
    const pos = positionsFor(next.category)
    const position = pos ? pos.indexOf(slip.index) + 1 : 0
    if (slip.index !== current.level || (position && position !== current.position)) {
      next.level = slip.index
      next.position = position || undefined
      next.monthly = undefined
      changes.push(position ? `posição ${position} (índice ${slip.index})` : `índice ${slip.index}`)
    }
  }
  if (slip.irsRate !== undefined && slip.irsRate !== current.irsPct) {
    next.irsPct = slip.irsRate
    changes.push(`IRS ${String(slip.irsRate).replace('.', ',')}%`)
  }
  const meal = slip.earnings.find((l) => /refei/i.test(l.label) && l.qty && l.amount > 0)
  if (meal?.qty) {
    const perDay = Math.round((meal.amount / meal.qty) * 100) / 100
    if (perDay !== current.mealPerDay) {
      next.mealPerDay = perDay
      changes.push(`refeição ${perDay.toFixed(2).replace('.', ',')} €/dia`)
    }
  }
  return { settings: next, changes }
}
