import { describe, expect, it } from 'vitest'
import {
  googleShift,
  googleToRow,
  originalStartParam,
  parseExdates,
  rowToGoogle,
  shiftToGoogle,
  toLocal,
  type EventRow,
} from '../../supabase/functions/_shared/gcal'

describe('conversões Google Calendar', () => {
  it('converte instantes para hora de Lisboa (inverno e verão)', () => {
    expect(toLocal('2026-11-23T10:00:00Z')).toBe('2026-11-23T10:00')
    expect(toLocal('2026-07-01T10:00:00Z')).toBe('2026-07-01T11:00')
    expect(toLocal('2026-07-01T10:00:00+02:00')).toBe('2026-07-01T09:00')
  })

  it('lê um evento com hora e um de dia inteiro', () => {
    const timed = googleToRow({
      id: 'g1',
      etag: '"1"',
      summary: 'Reunião',
      start: { dateTime: '2026-07-01T10:00:00+01:00' },
      end: { dateTime: '2026-07-01T11:30:00+01:00' },
      transparency: 'transparent',
    })
    expect(timed).toMatchObject({ starts_at: '2026-07-01T10:00', ends_at: '2026-07-01T11:30', all_day: false, transparent: true, google_event_id: 'g1', category: 'reuniao' })
    const allDay = googleToRow({ id: 'g2', summary: 'Congresso', start: { date: '2026-12-01' }, end: { date: '2026-12-03' } })
    expect(allDay).toMatchObject({ starts_at: '2026-12-01T00:00', ends_at: '2026-12-03T00:00', all_day: true })
  })

  it('lê a recorrência e as exceções do Google', () => {
    const row = googleToRow({
      id: 'g3',
      summary: 'Ginásio',
      start: { dateTime: '2026-11-23T18:30:00', timeZone: 'Europe/Lisbon' },
      end: { dateTime: '2026-11-23T19:30:00', timeZone: 'Europe/Lisbon' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'EXDATE;TZID=Europe/Lisbon:20261125T183000,20261130T183000'],
      extendedProperties: { private: { gh_category: 'pessoal' } },
    })
    expect(row).toMatchObject({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', exdates: ['2026-11-25', '2026-11-30'], category: 'pessoal', starts_at: '2026-11-23T18:30' })
    expect(parseExdates(['EXDATE;VALUE=DATE:20261224', 'EXDATE:20260701T230000Z'])).toEqual(['2026-07-02', '2026-12-24'])
  })

  it('reconhece os turnos que já estão no calendário (dia inteiro, título = código)', () => {
    const codes = ['MT2', 'M', 'N', 'D', 'Fe']
    expect(googleShift({ id: 's1', summary: 'MT2', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } }, codes)).toEqual({
      day: '2026-11-01',
      code: 'MT2',
      google_event_id: 's1',
      google_etag: null,
    })
    expect(googleShift({ id: 's2', summary: 'fe', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } }, codes)?.code).toBe('Fe')
    expect(googleShift({ id: 's3', summary: 'Natal', start: { date: '2026-12-25' }, end: { date: '2026-12-26' } }, codes)).toBeNull()
    expect(googleShift({ id: 's4', summary: 'N', start: { dateTime: '2026-11-01T22:00:00Z' }, end: { dateTime: '2026-11-02T09:00:00Z' } }, codes)).toBeNull()
  })

  it('escreve eventos e turnos no formato do Google', () => {
    const row: EventRow & { id: string } = {
      id: 'loc-1',
      title: 'Ginásio',
      starts_at: '2026-11-23T18:30',
      ends_at: '2026-11-23T19:30',
      all_day: false,
      category: 'pessoal',
      location: null,
      notes: null,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      exdates: ['2026-11-30'],
      transparent: null,
    }
    expect(rowToGoogle(row)).toEqual({
      summary: 'Ginásio',
      location: undefined,
      description: undefined,
      start: { dateTime: '2026-11-23T18:30:00', timeZone: 'Europe/Lisbon' },
      end: { dateTime: '2026-11-23T19:30:00', timeZone: 'Europe/Lisbon' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=Europe/Lisbon:20261130T183000'],
      transparency: 'opaque',
      extendedProperties: { private: { gh_category: 'pessoal', gh_id: 'loc-1' } },
    })
    expect(shiftToGoogle({ day: '2026-12-31', code: 'N' })).toMatchObject({ summary: 'N', start: { date: '2026-12-31' }, end: { date: '2027-01-01' } })
  })

  it('calcula o originalStart de uma instância em hora de inverno e de verão', () => {
    expect(originalStartParam('2026-11-30', '2026-11-23T18:30', false)).toBe('2026-11-30T18:30:00+00:00')
    expect(originalStartParam('2026-07-06', '2026-06-29T18:30', false)).toBe('2026-07-06T18:30:00+01:00')
    expect(originalStartParam('2026-07-06', '2026-06-29T00:00', true)).toBe('2026-07-06')
  })
})
