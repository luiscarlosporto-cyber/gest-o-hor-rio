import { describe, expect, it } from 'vitest'
import type { Payslip, PayslipLine } from './payslip'
import { dueMonths, retroPayments, retroSummary } from './retro'
import type { RetroClaim } from './types'

// Valores inventados.
const claim: RetroClaim = {
  name: 'Prémio — teste',
  code: '710 310',
  from: '2020-04',
  until: '2020-09',
  skipMonths: [5],
  official: { '2020': 500 },
}
const line = (ref: string, amount: number): PayslipLine => ({ code: '710 310', label: 'Prémio (em valor) - retro', ref, amount })
const slip = (year: number, month: number, earnings: PayslipLine[]): Payslip => ({ year, month, earnings, deductions: [], gross: 0, totalDeductions: 0, net: 0 })

const slips = [
  slip(2026, 0, [line('2020-04', 100), line('2020-05', 100), { code: '710 009', label: 'Prémio 14,28%', ref: '2026-01', amount: 300 }]),
  slip(2026, 1, [line('2020-04', -100), line('2020-07', 60)]),
  slip(2026, 2, [line('2020-04', 100)]),
]

describe('retroativos', () => {
  it('lista os meses devidos sem junho', () => {
    expect(dueMonths(claim)).toEqual(['2020-04', '2020-05', '2020-07', '2020-08', '2020-09'])
  })

  it('só conta a rubrica do retroativo', () => {
    expect(retroPayments(slips, '710 310')).toHaveLength(5)
  })

  it('soma o recebido, o que falta e os estornos', () => {
    const s = retroSummary(claim, slips)
    expect(s).toMatchObject({ official: 500, paid: 260, missing: 240, monthsPaid: 3, monthsMissing: 2, nextMissing: '2020-08', lastSlip: '2026-03' })
    const y = s.years[0]
    expect(y).toMatchObject({ year: 2020, official: 500, paid: 260, missing: 240 })
    expect(y.months.map((m) => [m.ref, m.paid, m.status])).toEqual([
      ['2020-04', 100, 'pago'],
      ['2020-05', 100, 'pago'],
      ['2020-07', 60, 'abaixo'],
      ['2020-08', 0, 'falta'],
      ['2020-09', 0, 'falta'],
    ])
    expect(y.months[0].slips).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('prevê quantos talões faltam ao ritmo dos últimos', () => {
    const s = retroSummary(claim, slips)
    // 3 talões com 3 meses distintos = 1 mês por talão; faltam 2 → 2 talões, até mai/2026.
    expect(s).toMatchObject({ pace: 1, slipsLeft: 2, forecast: '2026-05' })
  })

  it('sem talões: tudo em falta', () => {
    const s = retroSummary(claim, [])
    expect(s).toMatchObject({ paid: 0, missing: 500, progress: 0, monthsMissing: 5, forecast: undefined })
  })
})
