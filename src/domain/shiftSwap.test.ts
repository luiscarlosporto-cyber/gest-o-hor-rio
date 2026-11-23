import { describe, expect, it } from 'vitest'
import { applySwap, parseSwapText, planSwap } from './shiftSwap'
import { DEFAULT_SHIFT_TYPES as T } from './shifts'
import type { ShiftDay } from './types'

const roster: ShiftDay[] = [
  { date: '2026-12-03', code: 'M' },
  { date: '2026-12-04', code: 'M' },
  { date: '2026-12-05', code: 'N' },
  { date: '2026-12-06', code: 'D' },
  { date: '2026-12-07', code: 'F' },
  { date: '2026-12-08', code: 'T', extra: true },
]

describe('parseSwapText', () => {
  it('lê o que se escreve no telemóvel', () => {
    const r = parseSwapText('dia 4 faço t, 5 m, 6 n', 2026, 11, T)
    expect(r.changes).toEqual([
      { date: '2026-12-04', code: 'T' },
      { date: '2026-12-05', code: 'M' },
      { date: '2026-12-06', code: 'N' },
    ])
    expect(r.unknown).toEqual([])
  })

  it('aceita mês explícito, folga e códigos compostos; aponta códigos desconhecidos', () => {
    const r = parseSwapText('3/1 MT2; 9 folga; 10 XPTO', 2026, 11, T)
    expect(r.changes).toEqual([
      { date: '2026-01-03', code: 'MT2' },
      { date: '2026-12-09', code: 'F' },
    ])
    expect(r.unknown).toEqual(['10 XPTO'])
  })
})

describe('planSwap', () => {
  it('mostra o antes e o depois, mete a saída D depois da noite nova e tira a D da noite que saiu', () => {
    const { changes } = parseSwapText('4 T, 5 M, 6 N', 2026, 11, T)
    const plan = planSwap(roster, T, changes)
    expect(plan.rows).toEqual([
      { date: '2026-12-04', before: 'M', after: 'T', auto: undefined },
      { date: '2026-12-05', before: 'N', after: 'M', auto: undefined },
      { date: '2026-12-06', before: 'D', after: 'N', auto: undefined },
      { date: '2026-12-07', before: 'F', after: 'D', auto: 'saída da noite' },
    ])
    // T às 22:30 e M às 08:30 no dia seguinte: 10 h de descanso.
    expect(plan.warnings).toEqual([{ date: '2026-12-05', message: 'Só 10 h de descanso entre T e M' }])
  })

  it('uma noite trocada por manhã deixa o D seguinte por preencher', () => {
    const plan = planSwap(roster, T, [{ date: '2026-12-05', code: 'M' }])
    expect(plan.rows[1]).toEqual({ date: '2026-12-06', before: 'D', after: '', auto: 'já não há noite antes: indica o que fazes' })
  })

  it('grava só os dias alterados e mantém a marca de extra', () => {
    const plan = planSwap(roster, T, [{ date: '2026-12-08', code: 'M' }])
    const days = applySwap(roster, plan)
    expect(days.find((d) => d.date === '2026-12-08')).toEqual({ date: '2026-12-08', code: 'M', extra: true })
    expect(days).toHaveLength(roster.length)
  })
})
