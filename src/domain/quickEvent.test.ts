import { describe, expect, it } from 'vitest'
import { toLocal } from './dates'
import { parseQuickEvent } from './quickEvent'

const today = new Date(2026, 10, 23, 9, 0) // segunda

describe('criação rápida de compromissos', () => {
  it('dia da semana e hora: 1 hora por omissão', () => {
    const e = parseQuickEvent('Dentista sexta 10h', today)
    expect(e.title).toBe('Dentista')
    expect(toLocal(e.start)).toBe('2026-11-27T10:00')
    expect(toLocal(e.end)).toBe('2026-11-27T11:00')
    expect(e.allDay).toBe(false)
    expect(e.category).toBe('pessoal')
  })
  it('intervalo de horas e categoria pela palavra', () => {
    const e = parseQuickEvent('Reunião de serviço amanhã 14h-15h30', today)
    expect(e.title).toBe('Reunião de serviço')
    expect(toLocal(e.start)).toBe('2026-11-24T14:00')
    expect(toLocal(e.end)).toBe('2026-11-24T15:30')
    expect(e.category).toBe('reuniao')
  })
  it('data, local com @ e sem hora fica dia inteiro', () => {
    const e = parseQuickEvent('Jantar de Natal 19/12 @ Penafiel', today)
    expect(e.title).toBe('Jantar de Natal')
    expect(e.location).toBe('Penafiel')
    expect(e.allDay).toBe(true)
    expect(toLocal(e.start)).toBe('2026-12-19T00:00')
  })
  it('só hora: é hoje; um intervalo que passa a meia-noite acaba no dia seguinte', () => {
    const e = parseQuickEvent('Festa 22h-2h', today)
    expect(toLocal(e.start)).toBe('2026-11-23T22:00')
    expect(toLocal(e.end)).toBe('2026-11-24T02:00')
  })
})
