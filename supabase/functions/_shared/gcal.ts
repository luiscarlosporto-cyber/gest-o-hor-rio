// Conversões entre o Google Calendar e as linhas da base de dados.
// Puro (sem Deno nem rede), para ser testado com vitest e usado pelas Edge Functions.

export const TIME_ZONE = 'Europe/Lisbon'

export type Category = 'trabalho' | 'reuniao' | 'pessoal' | 'pausa' | 'bloqueio'
const CATEGORIES: Category[] = ['trabalho', 'reuniao', 'pessoal', 'pausa', 'bloqueio']

export interface GDateTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface GEvent {
  id: string
  etag?: string
  status?: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  description?: string
  location?: string
  start?: GDateTime
  end?: GDateTime
  recurrence?: string[]
  recurringEventId?: string
  originalStartTime?: GDateTime
  transparency?: 'opaque' | 'transparent'
  updated?: string
  extendedProperties?: { private?: Record<string, string> }
}

/** Linha da tabela public.events (só as colunas que a sincronização mexe). */
export interface EventRow {
  id?: string
  user_id?: string
  title: string
  starts_at: string // YYYY-MM-DDTHH:mm (hora local)
  ends_at: string
  all_day: boolean
  category: Category
  location: string | null
  notes: string | null
  rrule: string | null
  exdates: string[]
  recurring_event_id?: string | null
  original_date?: string | null
  transparent: boolean | null
  google_event_id?: string | null
  google_etag?: string | null
  google_calendar_id?: string | null
}

export interface ShiftRow {
  day: string
  code: string
  google_event_id?: string | null
  google_etag?: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Instante (ISO com fuso) → hora local de Lisboa "YYYY-MM-DDTHH:mm". */
export function toLocal(iso: string, timeZone = TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

function gTimeToLocal(t: GDateTime | undefined): { local: string; allDay: boolean } | null {
  if (!t) return null
  if (t.date) return { local: `${t.date}T00:00`, allDay: true }
  if (t.dateTime) {
    // "2026-11-23T10:00:00" sem fuso vem acompanhado de timeZone
    const hasOffset = /([zZ]|[+-]\d\d:?\d\d)$/.test(t.dateTime)
    if (!hasOffset) {
      if (!t.timeZone || t.timeZone === TIME_ZONE) return { local: t.dateTime.slice(0, 16), allDay: false }
      // Hora local noutro fuso: aproximação suficiente para o uso pessoal (Lisboa).
      return { local: t.dateTime.slice(0, 16), allDay: false }
    }
    return { local: toLocal(t.dateTime), allDay: false }
  }
  return null
}

/** Data local (YYYY-MM-DD) de uma ocorrência original de uma série. */
export function originalDateKey(t: GDateTime | undefined): string | null {
  const r = gTimeToLocal(t)
  return r ? r.local.slice(0, 10) : null
}

/** Lê as linhas EXDATE do Google e devolve datas locais. */
export function parseExdates(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    if (!line.toUpperCase().startsWith('EXDATE')) continue
    const [head, values = ''] = line.split(/:(.*)/s)
    const tzid = /TZID=([^;:]+)/i.exec(head)?.[1]
    for (const v of values.split(',').map((s) => s.trim()).filter(Boolean)) {
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v)
      if (!m) continue
      const [, y, mo, d, h, mi, , z] = m
      if (!h) out.push(`${y}-${mo}-${d}`)
      else if (z) out.push(toLocal(`${y}-${mo}-${d}T${h}:${mi}:00Z`).slice(0, 10))
      else if (!tzid || tzid === TIME_ZONE) out.push(`${y}-${mo}-${d}`)
      else out.push(`${y}-${mo}-${d}`)
    }
  }
  return [...new Set(out)].sort()
}

export function extractRRule(recurrence: string[] | undefined): string | null {
  const line = recurrence?.find((l) => l.toUpperCase().startsWith('RRULE:'))
  return line ? line.slice(6) : null
}

/** Evento do Google → linha local. Devolve null se não tiver datas utilizáveis. */
export function googleToRow(ev: GEvent): EventRow | null {
  const s = gTimeToLocal(ev.start)
  const e = gTimeToLocal(ev.end)
  if (!s || !e) return null
  const cat = ev.extendedProperties?.private?.gh_category as Category | undefined
  return {
    title: (ev.summary ?? '(sem título)').slice(0, 300) || '(sem título)',
    starts_at: s.local,
    ends_at: e.local < s.local ? s.local : e.local,
    all_day: s.allDay,
    category: cat && CATEGORIES.includes(cat) ? cat : 'reuniao',
    location: ev.location ?? null,
    notes: ev.description ?? null,
    rrule: ev.recurringEventId ? null : extractRRule(ev.recurrence),
    exdates: ev.recurringEventId ? [] : parseExdates(ev.recurrence ?? []),
    transparent: ev.transparency === 'transparent' ? true : null,
    google_event_id: ev.id,
    google_etag: ev.etag ?? null,
  }
}

/** Um evento de dia inteiro, de um só dia, cujo título é um código de turno, é um turno. */
export function googleShift(ev: GEvent, codes: string[]): ShiftRow | null {
  if (!ev.start?.date || !ev.end?.date || ev.recurrence?.length || ev.recurringEventId) return null
  if (addDaysKey(ev.start.date, 1) !== ev.end.date) return null
  const title = (ev.summary ?? '').trim()
  const code = codes.find((c) => c === title) ?? codes.find((c) => c.toLowerCase() === title.toLowerCase())
  if (!code) return null
  return { day: ev.start.date, code, google_event_id: ev.id, google_etag: ev.etag ?? null }
}

const basic = (local: string) => local.replaceAll('-', '').replace(':', '') + '00' // YYYYMMDDTHHMMSS

/** Linha local → corpo para inserir/atualizar no Google. */
export function rowToGoogle(row: EventRow & { id: string }, keepExdates: string[] = row.exdates): Record<string, unknown> {
  const time = (local: string): GDateTime =>
    row.all_day ? { date: local.slice(0, 10) } : { dateTime: `${local}:00`, timeZone: TIME_ZONE }
  const startTime = row.starts_at.slice(11, 16)
  const recurrence: string[] = []
  if (row.rrule) {
    recurrence.push(`RRULE:${row.rrule}`)
    for (const d of keepExdates) {
      recurrence.push(
        row.all_day ? `EXDATE;VALUE=DATE:${d.replaceAll('-', '')}` : `EXDATE;TZID=${TIME_ZONE}:${basic(`${d}T${startTime}`)}`,
      )
    }
  }
  return {
    summary: row.title,
    location: row.location ?? undefined,
    description: row.notes ?? undefined,
    start: time(row.starts_at),
    end: time(row.ends_at),
    ...(row.rrule ? { recurrence } : {}),
    transparency: row.transparent ? 'transparent' : 'opaque',
    extendedProperties: { private: { gh_category: row.category, gh_id: row.id } },
  }
}

export function shiftToGoogle(shift: ShiftRow): Record<string, unknown> {
  return {
    summary: shift.code,
    start: { date: shift.day },
    end: { date: addDaysKey(shift.day, 1) },
    extendedProperties: { private: { gh_shift: '1' } },
  }
}

/** originalStart para pedir a instância de uma série (RFC 3339). */
export function originalStartParam(day: string, masterStartsAt: string, allDay: boolean): string {
  if (allDay) return day
  const local = `${day}T${masterStartsAt.slice(11, 16)}:00`
  // Converter hora local de Lisboa em UTC: tenta os dois desvios possíveis (0 e +1h).
  for (const offset of ['+00:00', '+01:00']) {
    const iso = `${local}${offset}`
    if (toLocal(iso) === local.slice(0, 16)) return iso
  }
  return `${local}+00:00`
}
