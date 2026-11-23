import { describe, expect, it } from 'vitest'
import { emptyData } from '../data/store'
import { defaultPaySettings } from './payroll'
import { checkPayslip, parsePayslip, ptNumber, settingsFromPayslip, slipKey, type SlipText } from './payslip'

// Talão fictício com a mesma disposição do talão da ULS (valores inventados).
const row = (y: number, ...cells: [number, string][]): SlipText[] => cells.map(([x, str]) => ({ x, y, str }))
const items: SlipText[] = [
  ...row(106, [14, 'Nr. Contribuinte'], [86, '123456789'], [236, 'Nº Mecanográfico'], [313, '11111']),
  ...row(129, [313, '5075 Enfermeiro especialista (EPE)']),
  ...row(166, [14, 'Relativo a'], [86, '2026 / Julho']),
  ...row(178, [14, 'Taxa IRS Mensal'], [88, '20,00']),
  ...row(214, [21, 'Abonos'], [156, 'TP'], [168, 'Quant.'], [200, 'Val. s/ Redu.'], [257, 'Val. c/ Redu.'], [318, 'Descontos'], [457, 'Incidência'], [507, 'Desconto']),
  ...row(237, [11, '101'], [30, '001'], [45, 'Remuneração base'], [139, '26/07'], [223, '2.000,00'], [278, '2.000,00']),
  ...row(236, [313, '300'], [328, '302'], [356, 'Adse (inc.S.Férias e'], [436, '26/07'], [472, '2.000,00'], [531, '70,00']),
  ...row(244, [356, 'S.Natal) (3,5%)']),
  ...row(249, [11, '211'], [30, '001'], [45, 'TN DUNotOEHosp'], [139, '26/06'], [179, '10,00'], [229, '66,00'], [284, '66,00']),
  ...row(261, [11, '211'], [30, '002'], [45, 'TN'], [139, '26/06'], [179, '7,00'], [229, '46,20'], [284, '46,20']),
  ...row(270, [45, 'Sáb>13DomFerDiuOEHosp']),
  ...row(290, [11, '356'], [45, 'Com.Grat.Serv.-País'], [183, '1,00']),
  ...row(300, [11, '220'], [30, '001'], [45, 'Sub. Refeição'], [139, '26/07'], [179, '20,00'], [229, '123,00'], [284, '123,00']),
  ...row(339, [11, '700'], [30, '001'], [45, 'E DUDiu1ªHosp'], [139, '26/06'], [158, 'a)'], [183, '1,00'], [232, '16,50'], [288, '16,50']),
  ...row(351, [11, '700'], [30, '002'], [45, 'E DUDiuSegHosp'], [139, '26/06'], [158, 'a)'], [179, '6,00'], [229, '118,80'], [284, '118,80']),
  ...row(362, [313, '400'], [328, '400'], [356, 'S.S.-regime geral (11%)'], [436, '26/07'], [472, '2.000,00'], [531, '220,00']),
  ...row(511, [283, '2.247,50']),
  ...row(512, [193, 'Total Ilíquido'], [521, '290,00']),
  ...row(513, [423, 'Total Descontos']),
  ...row(566, [110, 'PT50000000000000000000000'], [254, 'IRS']),
  ...row(581, [10, 'V. REL. JURÍDICA EMPREGO'], [254, 'INT. REMUNER.']),
  ...row(582, [112, '2.000,00'], [312, '31']),
]

describe('talão de vencimento', () => {
  it('lê o mês, a categoria, o índice, as rubricas e os totais, sem dados pessoais', () => {
    const s = parsePayslip(items)
    expect(s).toMatchObject({ year: 2026, month: 6, category: 'Enfermeiro especialista (EPE)', index: 31, irsRate: 20, gross: 2247.5, totalDeductions: 290, net: 1957.5 })
    expect(s.earnings.map((l) => [l.label, l.ref, l.qty, l.amount])).toEqual([
      ['Remuneração base', '2026-07', undefined, 2000],
      ['TN DUNotOEHosp', '2026-06', 10, 66],
      ['TN Sáb>13DomFerDiuOEHosp', '2026-06', 7, 46.2],
      ['Com.Grat.Serv.-País', undefined, 1, 0],
      ['Sub. Refeição', '2026-07', 20, 123],
      ['E DUDiu1ªHosp', '2026-06', 1, 16.5],
      ['E DUDiuSegHosp', '2026-06', 6, 118.8],
    ])
    expect(s.deductions.map((l) => [l.label, l.amount])).toEqual([
      ['Adse (inc.S.Férias e S.Natal) (3,5%)', 70],
      ['S.S.-regime geral (11%)', 220],
    ])
    const json = JSON.stringify(s)
    expect(json).not.toContain('123456789')
    expect(json).not.toContain('PT50')
    expect(json).not.toContain('11111')
  })

  it('classifica as rubricas de horas', () => {
    expect(slipKey('TN DUNotOEHosp')).toBe('weekdayNight')
    expect(slipKey('TN Sáb>13DomFerDiuOEHosp')).toBe('weekendDay')
    expect(slipKey('TN SábDomFerNotOEHosp')).toBe('weekendNight')
    expect(slipKey('E DUDiu1ªHosp')).toBe('dayWeekday.first')
    expect(slipKey('E DUNotSegHosp')).toBe('nightWeekday.next')
    expect(slipKey('E FerNot1ªHosp')).toBe('nightRest.first')
    expect(slipKey('E SábDomFerDiuSegHosp')).toBe('dayRest.next')
    expect(slipKey('Remuneração base')).toBeUndefined()
    expect(ptNumber('2.624,97')).toBe(2624.97)
    expect(ptNumber(',00')).toBe(0)
  })

  it('confronta as horas do talão com as do horário do mês a que se referem', () => {
    const data = { ...emptyData(), shiftDays: [{ date: '2026-06-01', code: 'N' }, { date: '2026-06-02', code: 'D' }, { date: '2026-06-30', code: 'M', extra: true }] }
    const rows = checkPayslip(data, parsePayslip(items), 2026, 5)
    expect(rows.find((r) => r.label === 'TN noturno em dia útil')).toEqual({ label: 'TN noturno em dia útil', app: 9, slip: 10, amount: 66 })
    expect(rows.find((r) => r.label.startsWith('E diurno dia útil, 1.ª'))).toMatchObject({ app: 1, slip: 1 })
    expect(rows.find((r) => r.label.startsWith('E diurno dia útil, seg'))).toMatchObject({ app: 6, slip: 6 })
  })

  it('preenche as definições de vencimento a partir do talão', () => {
    const { settings, changes } = settingsFromPayslip(parsePayslip(items), defaultPaySettings())
    expect(settings).toMatchObject({ category: 'Enfermeiro especialista', position: 3, level: 31, irsPct: 20, mealPerDay: 6.15 })
    expect(changes).toHaveLength(4)
    expect(settingsFromPayslip(parsePayslip(items), settings).changes).toEqual([])
  })
})
