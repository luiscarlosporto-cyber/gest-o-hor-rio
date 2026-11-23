import { describe, expect, it } from 'vitest'
import { emptyData } from './store'
import { agendaCsv } from './account'
import { rowsToAppData } from './supabaseStore'
import { describeAudit } from '../ui/PrivacyCard'

describe('os meus dados', () => {
  it('CSV da agenda com ";" e aspas quando é preciso', () => {
    const data = {
      ...emptyData(),
      shiftDays: [{ date: '2026-11-27', code: 'M', extra: true }],
      events: [{ id: 'e', title: 'Jantar; Ana', start: '2026-11-28T20:00', end: '2026-11-28T22:00', allDay: false, category: 'pessoal' as const, createdAt: '', updatedAt: '' }],
      tasks: [{ id: 't', title: 'Pagar luz', priority: 'alta' as const, done: true, createdAt: '', updatedAt: '' }],
    }
    const lines = agendaCsv(data).replace('﻿', '').split('\r\n')
    expect(lines[0]).toBe('tipo;data;início;fim;título;categoria/código;local;notas;repetição;estado')
    expect(lines[1]).toMatch(/^turno;2026-11-27;08:30;15:30;.*;M;;extra;;$/)
    expect(lines[2]).toBe('compromisso;2026-11-28;20:00;22:00;"Jantar; Ana";pessoal;;;;')
    expect(lines[3]).toBe('tarefa;;;;Pagar luz;alta;;;;feita')
  })

  it('uma cópia diária volta a ser dados da app', () => {
    const d = rowsToAppData({
      events: [
        { id: 'e', user_id: 'u', title: 'Dentista', starts_at: '2026-11-26T10:00:00', ends_at: '2026-11-26T11:00:00', all_day: false, category: 'pessoal', location: null, notes: null, rrule: null, exdates: [], recurring_event_id: null, original_date: null, transparent: null, deleted_at: null },
      ],
      shift_days: [{ day: '2026-11-27', code: 'N', extra: false }],
      shift_types: [],
      tasks: [],
      profile: { pay_settings: null, reminder_settings: null },
      payslips: [],
    })
    expect(d.events[0]).toMatchObject({ title: 'Dentista', start: '2026-11-26T10:00', end: '2026-11-26T11:00' })
    expect(d.shiftDays).toEqual([{ date: '2026-11-27', code: 'N' }])
    expect(d.shiftTypes.length).toBeGreaterThan(0)
  })

  it('histórico em português', () => {
    expect(describeAudit({ created_at: '', actor: 'sync', action: 'update', entity: 'shift_days', detail: { day: '2026-11-27', code: 'N', before: 'T' } })).toMatch(/^mudou o turno de .*27.*: T → N$/)
    expect(describeAudit({ created_at: '', actor: 'user', action: 'done', entity: 'tasks', detail: { title: 'Pagar luz' } })).toBe('concluiu a tarefa "Pagar luz"')
    expect(describeAudit({ created_at: '', actor: 'ai', action: 'assistant_accept', entity: 'events', detail: { title: 'Dentista' } })).toBe('proposta aceite: "Dentista"')
  })
})
