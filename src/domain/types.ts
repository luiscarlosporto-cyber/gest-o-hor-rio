/**
 * Tipos do domínio. As datas/horas são guardadas como "hora local flutuante"
 * (ex.: "2026-11-23T08:30"), interpretada no fuso Europe/Lisbon. Isto evita
 * surpresas com a mudança de hora e corresponde à forma como se pensa num horário.
 */

export type Category = 'trabalho' | 'reuniao' | 'pessoal' | 'pausa' | 'bloqueio'

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'trabalho', label: 'Trabalho' },
  { id: 'reuniao', label: 'Reunião' },
  { id: 'pessoal', label: 'Pessoal' },
  { id: 'pausa', label: 'Pausa' },
  { id: 'bloqueio', label: 'Bloqueio' },
]

/** Data local no formato YYYY-MM-DD. */
export type DateKey = string
/** Data e hora local no formato YYYY-MM-DDTHH:mm. */
export type LocalDateTime = string

export interface CalendarEvent {
  id: string
  title: string
  start: LocalDateTime
  end: LocalDateTime
  allDay: boolean
  category: Category
  location?: string
  notes?: string
  /** Regra de recorrência RFC 5545 sem DTSTART, ex.: "FREQ=WEEKLY;BYDAY=MO,WE". */
  rrule?: string
  /** Ocorrências removidas de uma série (data local de início). */
  exdates?: DateKey[]
  /** Quando é a exceção de uma série: id da série e data original da ocorrência. */
  recurringEventId?: string
  originalDate?: DateKey
  /** Eventos transparentes não ocupam tempo (não geram conflitos). */
  transparent?: boolean
  createdAt: string
  updatedAt: string
}

export interface ShiftType {
  code: string
  label: string
  /** HH:mm; sem horas = dia inteiro (descanso, folga, férias). */
  start?: string
  end?: string
  color: string
  /** Conta como tempo de trabalho (relatórios, conflitos). */
  work: boolean
}

export interface ShiftDay {
  date: DateKey
  code: string
}

/** Uma ocorrência concreta, pronta a mostrar e a comparar. */
export interface Occurrence {
  key: string
  source: 'event' | 'shift'
  eventId?: string
  shiftDate?: DateKey
  title: string
  start: Date
  end: Date
  allDay: boolean
  category: Category
  color?: string
  transparent: boolean
  recurring: boolean
  location?: string
}

export interface AppData {
  version: 1
  events: CalendarEvent[]
  shiftDays: ShiftDay[]
  shiftTypes: ShiftType[]
}
