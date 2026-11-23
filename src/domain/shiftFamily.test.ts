import { describe, expect, it } from 'vitest'
import { DEFAULT_SHIFT_TYPES, findType } from './shifts'
import { countdown, dayPart, shiftFamily } from './shiftFamily'

const fam = (code: string) => shiftFamily(findType(DEFAULT_SHIFT_TYPES, code))

describe('famílias de turno (cores da Ritmia)', () => {
  it('classifica os turnos da UCIP pelas horas', () => {
    expect(fam('M')).toBe('morning')
    expect(fam('T')).toBe('afternoon')
    expect(fam('6:30 T')).toBe('afternoon')
    expect(fam('MT2')).toBe('long')
    expect(fam('N')).toBe('night')
  })
  it('separa descanso, férias e feriado', () => {
    expect(fam('D')).toBe('rest')
    expect(fam('DS')).toBe('rest')
    expect(fam('L')).toBe('leave')
    expect(fam('Fe')).toBe('holiday')
    expect(shiftFamily(undefined)).toBe('other')
  })
  it('funciona com tipos criados pelo utilizador', () => {
    expect(shiftFamily({ code: 'X', label: 'Noite curta', start: '20:00', end: '08:00', color: '#000', work: true })).toBe('night')
    expect(shiftFamily({ code: 'Y', label: 'Manhã curta', start: '07:00', end: '13:00', color: '#000', work: true })).toBe('morning')
  })
})

describe('partes do dia e contagem decrescente', () => {
  it('manhã até às 13h, tarde até às 20h, depois noite', () => {
    expect(dayPart(new Date(2026, 10, 23, 12, 59))).toBe('morning')
    expect(dayPart(new Date(2026, 10, 23, 13, 0))).toBe('afternoon')
    expect(dayPart(new Date(2026, 10, 23, 20, 0))).toBe('night')
  })
  it('escreve a duração em português', () => {
    const a = new Date(2026, 10, 23, 8, 0)
    expect(countdown(a, new Date(2026, 10, 23, 8, 45))).toBe('45 min')
    expect(countdown(a, new Date(2026, 10, 23, 11, 20))).toBe('3 h 20 min')
    expect(countdown(a, new Date(2026, 10, 24, 8, 0))).toBe('1 dia')
    expect(countdown(a, new Date(2026, 10, 25, 14, 0))).toBe('2 d 6 h')
  })
})
