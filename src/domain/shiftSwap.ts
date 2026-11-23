import { addDays, parseLocal, toDateKey } from './dates'
import { findType, mergeShiftDays, NIGHT_EXIT_CODE, shiftErrors, shiftTimes } from './shifts'
import type { DateKey, ShiftDay, ShiftType } from './types'

/**
 * Trocas de turno: "dia 4 faço T, 5 M, 6 N".
 * Tudo é calculado antes de gravar; o utilizador vê o antes e o depois e confirma.
 */
export interface SwapChange {
  date: DateKey
  /** Código novo; vazio = fica sem turno. */
  code: string
}

export interface SwapRow {
  date: DateKey
  before: string
  after: string
  /** Acrescentado pela app (ex.: a saída D depois de uma noite nova). */
  auto?: string
}

export interface SwapPlan {
  rows: SwapRow[]
  warnings: { date: DateKey; message: string }[]
  /** Códigos escritos que não correspondem a nenhum tipo de turno. */
  unknown: string[]
}

const OFF_WORDS = /^(folga|livre|nada|sem|-|–)$/i

/**
 * Lê "4 T, 5 M, 6 N", "dia 4 faço T", "4/12 M" ou "4-T". Dias sem mês ficam no mês de referência
 * (o mês aberto em Turnos).
 */
export function parseSwapText(text: string, year: number, monthIndex: number, types: ShiftType[]): { changes: SwapChange[]; unknown: string[] } {
  const re = /(?:dia\s+)?(\d{1,2})(?:\s*[/.]\s*(\d{1,2}))?\s*(?:fa[çc]o|fazer|passa\s+a|=|:|-|–|→|>)?\s*([A-Za-zÀ-ú]+\d?|-|–)/gi
  const changes = new Map<DateKey, string>()
  const unknown: string[] = []
  for (const m of text.matchAll(re)) {
    const day = Number(m[1])
    const month = m[2] ? Number(m[2]) - 1 : monthIndex
    const date = new Date(year, month, day)
    if (day < 1 || month < 0 || month > 11 || date.getMonth() !== month) continue
    const word = m[3]
    let code: string | undefined
    if (/^(folga|livre)$/i.test(word)) code = types.find((t) => /folga/i.test(t.label))?.code ?? ''
    else if (OFF_WORDS.test(word)) code = ''
    else code = findType(types, word)?.code
    if (code === undefined) {
      unknown.push(`${day} ${word}`)
      continue
    }
    changes.set(toDateKey(date), code)
  }
  return { changes: [...changes].map(([date, code]) => ({ date, code })), unknown }
}

const crossesMidnight = (t?: ShiftType) => Boolean(t?.work && t.start && t.end && t.end <= t.start)
const nextDay = (d: DateKey) => toDateKey(addDays(parseLocal(d), 1))
const prevDay = (d: DateKey) => toDateKey(addDays(parseLocal(d), -1))

/** Descanso mínimo entre turnos que a app assinala (não é uma regra calculada no vencimento). */
export const MIN_REST_HOURS = 11

/** Antes/depois de uma troca, com a saída D tratada e avisos de descanso curto e D sem noite. */
export function planSwap(days: ShiftDay[], types: ShiftType[], changes: SwapChange[]): SwapPlan {
  const current = new Map(days.map((d) => [d.date, d.code]))
  const next = new Map(current)
  const explicit = new Set(changes.map((c) => c.date))
  const auto = new Map<DateKey, string>()

  for (const c of changes) {
    if (c.code) next.set(c.date, c.code)
    else next.delete(c.date)
  }
  // Uma noite nova traz a saída D no dia seguinte; uma noite que sai deixa o D seguinte sem sentido.
  for (const c of [...changes].sort((a, b) => a.date.localeCompare(b.date))) {
    const after = nextDay(c.date)
    if (explicit.has(after)) continue
    const isNight = crossesMidnight(findType(types, c.code))
    const wasNight = crossesMidnight(findType(types, current.get(c.date) ?? ''))
    if (isNight && next.get(after) !== NIGHT_EXIT_CODE) {
      next.set(after, NIGHT_EXIT_CODE)
      auto.set(after, 'saída da noite')
    } else if (!isNight && wasNight && next.get(after) === NIGHT_EXIT_CODE) {
      next.delete(after)
      auto.set(after, 'já não há noite antes: indica o que fazes')
    }
  }

  const touched = [...new Set([...explicit, ...auto.keys()])].sort()
  const rows: SwapRow[] = touched
    .map((date) => ({ date, before: current.get(date) ?? '', after: next.get(date) ?? '', auto: auto.get(date) }))
    .filter((r) => r.before !== r.after || r.auto)

  const result = [...next].map(([date, code]) => ({ date, code }))
  const near = new Set(touched.flatMap((d) => [prevDay(d), d, nextDay(d)]))
  const warnings = shiftErrors(result, types).filter((e) => near.has(e.date))
  for (const date of [...near].sort()) {
    const a = findType(types, next.get(date) ?? '')
    const bDate = nextDay(date)
    const b = findType(types, next.get(bDate) ?? '')
    if (!a?.work || !b?.work || !a.start || !b.start) continue
    const gap = (shiftTimes(bDate, b).start.getTime() - shiftTimes(date, a).end.getTime()) / 3600_000
    if (gap < MIN_REST_HOURS && (near.has(bDate) || near.has(date))) {
      warnings.push({ date: bDate, message: `Só ${Math.max(0, Math.round(gap * 10) / 10).toString().replace('.', ',')} h de descanso entre ${a.code} e ${b.code}` })
    }
  }
  warnings.sort((x, y) => x.date.localeCompare(y.date))
  return { rows, warnings, unknown: [] }
}

/** Aplica o plano (mantém a marca de extra dos dias que já a tinham). */
export function applySwap(days: ShiftDay[], plan: SwapPlan): ShiftDay[] {
  const extra = new Set(days.filter((d) => d.extra).map((d) => d.date))
  return mergeShiftDays(
    days,
    plan.rows.map((r) => (extra.has(r.date) && r.after ? { date: r.date, code: r.after, extra: true } : { date: r.date, code: r.after })),
  )
}
