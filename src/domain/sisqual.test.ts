import { describe, expect, it } from 'vitest'
import { applyRoster, parseSisqualPage, resolveCell, rosterChanges, type PdfText } from './sisqual'
import { DEFAULT_SHIFT_TYPES } from './shifts'

const types = DEFAULT_SHIFT_TYPES

describe('células do SISQUAL', () => {
  it('lê códigos simples, com horas e dois códigos na mesma célula', () => {
    expect(resolveCell('MT2', types)).toEqual({ code: 'MT2', unknown: false, second: false })
    expect(resolveCell('6:30 T', types).code).toBe('6:30 T')
    expect(resolveCell('DS M', types)).toMatchObject({ code: 'M', second: true })
    expect(resolveCell('DN', types)).toMatchObject({ code: 'N', second: true })
    expect(resolveCell('DS2h', types).code).toBe('DS')
    expect(resolveCell('F 2h', types).code).toBe('F')
    expect(resolveCell('4h T', types).code).toBe('T')
    expect(resolveCell('TL', types)).toMatchObject({ code: 'TL', unknown: true })
  })
})

describe('página do horário', () => {
  // Dezembro de 2026: primeira coluna é 30 de novembro; colunas de 13 pontos a partir de x=150.
  const colX = (i: number) => 150 + i * 13
  const header: PdfText[] = ['30', '1-dez', ...Array.from({ length: 30 }, (_, i) => String(i + 2))].map((s, i) => ({ str: s, x: colX(i) + 2, y: 100, w: 6, h: 4 }))
  const codes = ['L', 'Fe', 'L', 'L', 'L', 'DC', 'DS', 'L', 'Fe', 'N', 'D', '6:30 T', 'DC', 'MT2', 'N', 'D', 'DS', 'DC', 'MT2', 'N', 'D', 'DS', 'M', 'MT2', 'DC', 'Fe', 'N', 'D', 'MT2', 'DS', 'M', 'N']
  const row: PdfText[] = [
    { str: '71402', x: 39, y: 200, w: 12, h: 4 },
    { str: 'LUIS', x: 71, y: 200, w: 9, h: 4 },
    { str: 'JOAO', x: 82, y: 200, w: 10, h: 4 },
    ...codes.map((s, i) => ({ str: s, x: colX(i) + 1, y: 200, w: s.length * 2.5, h: 4 })),
    { str: '161:00', x: colX(32) + 2, y: 200, w: 12, h: 4 },
  ]
  const greenCols = new Set([11, 22, 30]) // 11, 22 e 30 de dezembro
  const page = {
    items: [{ str: '2009Enf | Enfermeiros - UCIP -dezembro de 2026', x: 10, y: 10, w: 200, h: 5 }, { str: 'Horário Plano Inicial gravado por 70859', x: 10, y: 18, w: 200, h: 5 }, ...header, ...row],
    greenRatio: (x0: number, x1: number) => {
      const i = Math.round(((x0 + x1) / 2 - 150 - 6.5) / 13)
      return greenCols.has(i) ? 0.4 : 0
    },
  }

  it('encontra a linha do colaborador, o mês, os dias e os extras a verde', () => {
    const r = parseSisqualPage(page, '71402', types)!
    expect(r).toMatchObject({ year: 2026, month: 11, kind: 'inicial', name: 'LUIS JOAO' })
    expect(r.days).toHaveLength(31)
    expect(r.days[0]).toMatchObject({ date: '2026-12-01', code: 'Fe' })
    expect(r.days.find((d) => d.date === '2026-12-11')).toMatchObject({ code: '6:30 T', extra: true })
    expect(r.days.filter((d) => d.extra).map((d) => d.date)).toEqual(['2026-12-11', '2026-12-22', '2026-12-30'])
    expect(r.days.at(-1)).toMatchObject({ date: '2026-12-31', code: 'N' })
  })

  it('não encontra quem não está na página', () => {
    expect(parseSisqualPage(page, '99999', types)).toBeNull()
  })

  it('grava o mês por cima do que havia e diz o que muda', () => {
    const r = parseSisqualPage(page, '71402', types)!
    const before = { shiftTypes: types, shiftDays: [{ date: '2026-12-11', code: 'T' }, { date: '2026-11-30', code: 'L' }] }
    expect(rosterChanges(before.shiftDays, r)).toHaveLength(31)
    const after = applyRoster(before, r)
    expect(after.shiftDays).toHaveLength(32)
    expect(after.shiftDays.find((d) => d.date === '2026-12-11')).toEqual({ date: '2026-12-11', code: '6:30 T', extra: true })
    expect(rosterChanges(after.shiftDays, r)).toHaveLength(0)
  })
})
