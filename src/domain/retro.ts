// Retroativos pagos aos poucos nos talões (ex.: prémio de 14,28% ganho em tribunal, rubrica 710 310).
// O "recebido" sai sempre das linhas dos talões carregados; o "devido" é o apuramento oficial por ano.

import type { Payslip } from './payslip'
import type { RetroClaim } from './types'

const round = (n: number) => Math.round(n * 100) / 100
const key = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`
const parseKey = (k: string) => ({ y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)) - 1 })

export interface RetroPayment {
  /** Mês a que se refere (AAAA-MM). */
  ref: string
  amount: number
  /** Talão onde veio (AAAA-MM). */
  slip: string
}

export type RetroStatus = 'pago' | 'abaixo' | 'falta'

export interface RetroMonth {
  ref: string
  paid: number
  /** Talões onde veio (pode vir e ser estornado noutro). */
  slips: string[]
  status: RetroStatus
}

export interface RetroYear {
  year: number
  official?: number
  paid: number
  /** Oficial − recebido (negativo = pago a mais). */
  missing?: number
  months: RetroMonth[]
}

export interface RetroSummary {
  official: number
  paid: number
  missing: number
  /** 0–1 */
  progress: number
  years: RetroYear[]
  monthsPaid: number
  monthsMissing: number
  /** Primeiro mês ainda por pagar (AAAA-MM). */
  nextMissing?: string
  /** Último talão com esta rubrica (AAAA-MM). */
  lastSlip?: string
  /** Meses pagos por talão, em média nos últimos 3 talões com retroativos. */
  pace?: number
  /** Talões que ainda faltam a esse ritmo, e o mês do último. */
  slipsLeft?: number
  forecast?: string
}

/** As linhas da rubrica do retroativo em todos os talões. */
export function retroPayments(slips: Payslip[], code: string): RetroPayment[] {
  const out: RetroPayment[] = []
  for (const s of slips) {
    for (const l of s.earnings) {
      if (l.code.replace(/\s+/g, ' ') !== code || !l.ref) continue
      out.push({ ref: l.ref, amount: l.amount, slip: key(s.year, s.month) })
    }
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref) || a.slip.localeCompare(b.slip))
}

/** Meses devidos, do primeiro ao último, sem os meses que não contam. */
export function dueMonths(claim: RetroClaim): string[] {
  const out: string[] = []
  const a = parseKey(claim.from)
  const b = parseKey(claim.until)
  for (let y = a.y, m = a.m; y < b.y || (y === b.y && m <= b.m); m === 11 ? ((m = 0), y++) : m++) {
    if (!claim.skipMonths.includes(m)) out.push(key(y, m))
  }
  return out
}

export function retroSummary(claim: RetroClaim, slips: Payslip[]): RetroSummary {
  const pays = retroPayments(slips, claim.code)
  const byRef = new Map<string, RetroMonth>()
  for (const ref of dueMonths(claim)) byRef.set(ref, { ref, paid: 0, slips: [], status: 'falta' })
  for (const p of pays) {
    const m = byRef.get(p.ref) ?? { ref: p.ref, paid: 0, slips: [], status: 'falta' as RetroStatus }
    m.paid = round(m.paid + p.amount)
    if (!m.slips.includes(p.slip)) m.slips.push(p.slip)
    byRef.set(p.ref, m)
  }
  const months = [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref))
  // "Abaixo": bem menos do que os meses pagos à volta (provável desconto de faltas).
  const paidMonths = months.filter((m) => m.paid > 0.005)
  paidMonths.forEach((m, i) => {
    const near = [paidMonths[i - 1]?.paid, paidMonths[i + 1]?.paid].filter((v): v is number => v !== undefined)
    m.status = near.length && m.paid < 0.98 * Math.min(...near) ? 'abaixo' : 'pago'
  })

  const yearsSet = new Set<number>([...Object.keys(claim.official).map(Number), ...months.map((m) => parseKey(m.ref).y)])
  const years: RetroYear[] = [...yearsSet]
    .sort((a, b) => a - b)
    .map((year) => {
      const ms = months.filter((m) => parseKey(m.ref).y === year)
      const paid = round(ms.reduce((a, m) => a + m.paid, 0))
      const official = claim.official[String(year)]
      return { year, official, paid, missing: official === undefined ? undefined : round(official - paid), months: ms }
    })

  const official = round(Object.values(claim.official).reduce((a, b) => a + b, 0))
  const paid = round(pays.reduce((a, p) => a + p.amount, 0))
  const missing = round(official - paid)
  const due = new Set(dueMonths(claim))
  const missingMonths = months.filter((m) => due.has(m.ref) && m.paid <= 0.005)

  // Ritmo: meses pagos por talão nos últimos 3 talões que trouxeram o retroativo.
  const slipKeys = [...new Set(pays.filter((p) => p.amount > 0).map((p) => p.slip))].sort()
  const recent = slipKeys.slice(-3)
  const recentRefs = new Set(pays.filter((p) => p.amount > 0 && recent.includes(p.slip)).map((p) => p.ref))
  const pace = recent.length ? round(recentRefs.size / recent.length) : undefined
  const lastSlip = slipKeys.at(-1)
  let slipsLeft: number | undefined
  let forecast: string | undefined
  if (pace && lastSlip && missingMonths.length) {
    slipsLeft = Math.ceil(missingMonths.length / pace)
    const l = parseKey(lastSlip)
    const t = l.y * 12 + l.m + slipsLeft
    forecast = key(Math.floor(t / 12), t % 12)
  }

  return {
    official,
    paid,
    missing,
    progress: official > 0 ? Math.min(1, Math.max(0, paid / official)) : 0,
    years,
    monthsPaid: months.filter((m) => m.paid > 0.005).length,
    monthsMissing: missingMonths.length,
    nextMissing: missingMonths[0]?.ref,
    lastSlip,
    pace,
    slipsLeft,
    forecast,
  }
}

/** Valores por omissão para um retroativo novo do prémio (o utilizador preenche o oficial por ano). */
export const defaultRetroClaim = (): RetroClaim => ({
  name: 'Prémio 14,28% — retroativos',
  code: '710 310',
  from: '2015-10',
  until: '2025-07',
  skipMonths: [5],
  official: {},
})
