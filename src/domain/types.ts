import type { Payslip } from './payslip'
import type { Task } from './tasks'
import type { ReminderSettings } from './reminders'

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
  /**
   * Horas que contam (horário e vencimento), a partir do início.
   * Ex.: N das 22h às 09h conta 9h (22h–07h: 2h no dia da N, 7h na saída). Vazio = do início ao fim.
   */
  paidHours?: number
}

export interface ShiftDay {
  date: DateKey
  code: string
  /** Turno extra (trabalho suplementar, a verde no horário SISQUAL). */
  extra?: boolean
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

/** Dados para calcular o vencimento. Só ficam na conta do utilizador. */
export interface PaySettings {
  /** Número mecanográfico (para encontrar a linha no horário do SISQUAL). */
  employeeNumber?: string
  /** Categoria (texto livre; ex.: Enfermeiro, Enfermeiro especialista). */
  category: string
  /** Posição remuneratória na categoria (1, 2, 3…). */
  position?: number
  /** Índice remuneratório da TRU (ex.: 34); vem da categoria e posição. */
  level?: number
  /** Remuneração base mensal em euros; se vazio, usa a do nível. */
  monthly?: number
  /** Horas semanais (normalmente 35). */
  weeklyHours: number
  /** Feriados municipais, MM-DD (Penafiel: 11-11). */
  municipalHolidays: string[]
  /** Prémio mensal em % da remuneração base (ex.: 14,28). */
  bonusPct?: number
  /** Meses (0-11) do talão em que o prémio não é pago (ex.: junho = 5). */
  bonusSkipMonths?: number[]
  /** Subsídio de refeição por dia de trabalho, em euros. */
  mealPerDay?: number
  /** Desconto para a Segurança Social/CGA, em % (normalmente 11). */
  socialPct?: number
  /** Desconto para a ADSE, em % da base (normalmente 3,5; 0 se não tiver). */
  adsePct?: number
  /** Taxa de retenção de IRS, em % (do talão). */
  irsPct?: number
  /** Retroativos a receber (ex.: prémio ganho em tribunal), conferidos pelos talões. */
  retro?: RetroClaim
}

/** Um retroativo devido, pago aos poucos nos talões numa rubrica própria. */
export interface RetroClaim {
  /** Nome curto (ex.: "Prémio 14,28% — retroativos"). */
  name: string
  /** Código da rubrica no talão (ex.: "710 310"). */
  code: string
  /** Primeiro e último mês devidos (AAAA-MM). */
  from: string
  until: string
  /** Meses (0-11) que não contam (o prémio não é pago em junho = 5). */
  skipMonths: number[]
  /** Valor oficial devido por ano (do apuramento do processo), em euros. */
  official: Record<string, number>
}

export interface AppData {
  version: 1
  events: CalendarEvent[]
  shiftDays: ShiftDay[]
  shiftTypes: ShiftType[]
  tasks: Task[]
  pay?: PaySettings
  /** Talões de vencimento carregados (só rubricas e valores). */
  payslips?: Payslip[]
  /** Lembretes e notificações no telemóvel. */
  reminders?: ReminderSettings
}
