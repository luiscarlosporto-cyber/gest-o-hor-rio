import { describe, expect, it } from 'vitest'
import { emptyData } from '../data/store'
import { monthReport, reportCsv, todayOverview, fmtHours } from './reports'
import { addTask } from './tasks'
import type { AppData } from './types'

const data = (): AppData => ({
  ...emptyData(),
  shiftDays: [
    { date: '2026-10-30', code: 'M' }, // outubro: 7h
    { date: '2026-11-21', code: 'N' }, // sábado à noite
    { date: '2026-11-22', code: 'D' },
    { date: '2026-11-23', code: 'MT2' },
    { date: '2026-11-24', code: 'M' },
    { date: '2026-11-25', code: 'N' },
    { date: '2026-11-26', code: 'D' },
  ],
  events: [
    { id: 'e1', title: 'Dentista', start: '2026-11-23T18:00', end: '2026-11-23T19:00', allDay: false, category: 'pessoal', createdAt: '', updatedAt: '' },
  ],
})

describe('painel de hoje', () => {
  it('mostra o turno atual, o próximo, a agenda, a semana e a próxima folga', () => {
    const now = new Date(2026, 10, 23, 10, 0) // segunda 10h, a meio do MT2
    const o = todayOverview(data(), now)
    expect(o.currentShift?.title).toBe('MT2')
    expect(o.nextShift?.title).toBe('M')
    expect(o.agenda.map((a) => a.title)).toEqual(['MT2', 'Dentista'])
    expect(o.conflicts).toBe(1) // dentista durante o MT2
    expect(o.week[0]).toMatchObject({ date: '2026-11-23', shift: { code: 'MT2', work: true }, events: 1 })
    expect(o.nextDayOff).toBe('2026-11-26')
  })
  it('calcula o descanso entre turnos quando não está a trabalhar', () => {
    const now = new Date(2026, 10, 22, 12, 0) // domingo, depois da noite de sábado
    const o = todayOverview(data(), now)
    expect(o.currentShift).toBeUndefined()
    expect(o.nextShift?.title).toBe('MT2')
    expect(o.restMinutes).toBe(23.5 * 60) // N acaba dom 09:00, MT2 começa seg 08:30
  })
})

describe('relatório mensal', () => {
  it('soma horas, noites, fins de semana e compara com o mês anterior', () => {
    let d = data()
    d = { ...d, tasks: addTask([], { title: 'x' }, new Date(2026, 10, 5)) }
    const r = monthReport(d, 2026, 10)
    expect(r.summary.workedMinutes).toBe((11 + 14 + 7 + 11) * 60)
    expect(r.deltaMinutes).toBe((43 - 7) * 60)
    expect(r.nights).toBe(2)
    expect(r.weekendsWorked).toBe(1)
    expect(r.daysOff).toBe(2)
    expect(r.longestStreak).toBe(3)
    expect(r.eventMinutes.pessoal).toBe(60)
    expect(r.tasksCreated).toBe(1)
    expect(r.weeks.find((w) => w.start === '2026-11-23')?.minutes).toBe((14 + 7 + 11) * 60)
    expect(fmtHours(r.deltaMinutes)).toBe('36h')
  })
  it('exporta CSV com separador ; e decimais com vírgula', () => {
    const csv = reportCsv(monthReport(data(), 2026, 10))
    expect(csv.startsWith('﻿Data;Dia da semana;Turno')).toBe(true)
    expect(csv).toContain('2026-11-23;segunda-feira;MT2;Manhã e tarde;14,00;;1')
    expect(csv).toContain('Total de horas;;;;43,00')
  })
})
