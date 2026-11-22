import { useEffect, useMemo, useRef } from 'react'
import { addDays, formatRange, isSameDay, minutesBetween, startOfDay, toDateKey, weekdayShort } from '../domain/dates'
import type { Occurrence } from '../domain/types'

const HOUR = 48 // px por hora

interface Props {
  days: Date[]
  occurrences: Occurrence[]
  conflictKeys: Set<string>
  onSlot: (start: Date) => void
  onOpen: (o: Occurrence) => void
  onDayClick?: (d: Date) => void
}

interface Placed {
  occ: Occurrence
  top: number
  height: number
  col: number
  cols: number
  continuesBefore: boolean
  continuesAfter: boolean
}

/** Distribui eventos sobrepostos em colunas lado a lado. */
function layoutDay(day: Date, occs: Occurrence[]): Placed[] {
  const dayStart = startOfDay(day)
  const dayEnd = addDays(dayStart, 1)
  const items = occs
    .filter((o) => !o.allDay && o.start < dayEnd && o.end > dayStart)
    .map((occ) => {
      const s = occ.start < dayStart ? dayStart : occ.start
      const e = occ.end > dayEnd ? dayEnd : occ.end
      return {
        occ,
        s,
        e,
        continuesBefore: occ.start < dayStart,
        continuesAfter: occ.end > dayEnd,
      }
    })
    .sort((a, b) => a.s.getTime() - b.s.getTime() || b.e.getTime() - a.e.getTime())

  const placed: Placed[] = []
  let cluster: (Placed & { e: Date })[] = []
  let clusterEnd = 0
  const flush = () => {
    const cols = Math.max(0, ...cluster.map((p) => p.col)) + 1
    cluster.forEach((p) => placed.push({ ...p, cols }))
    cluster = []
  }
  for (const it of items) {
    if (cluster.length && it.s.getTime() >= clusterEnd) flush()
    const used = new Set(cluster.filter((p) => p.e > it.s).map((p) => p.col))
    let col = 0
    while (used.has(col)) col++
    const top = (minutesBetween(dayStart, it.s) / 60) * HOUR
    const height = Math.max((minutesBetween(it.s, it.e) / 60) * HOUR, 20)
    cluster.push({ occ: it.occ, top, height, col, cols: 1, continuesBefore: it.continuesBefore, continuesAfter: it.continuesAfter, e: it.e })
    clusterEnd = Math.max(clusterEnd, it.e.getTime())
  }
  if (cluster.length) flush()
  return placed
}

export function TimeGrid({ days, occurrences, conflictKeys, onSlot, onOpen, onDayClick }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const today = new Date()

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR
  }, [])

  const allDayByDay = useMemo(
    () =>
      days.map((d) => {
        const s = startOfDay(d)
        const e = addDays(s, 1)
        return occurrences.filter((o) => o.allDay && o.start < e && o.end > s)
      }),
    [days, occurrences],
  )
  const timedByDay = useMemo(() => days.map((d) => layoutDay(d, occurrences)), [days, occurrences])
  const hasAllDay = allDayByDay.some((l) => l.length > 0)

  const nowTop = ((today.getHours() * 60 + today.getMinutes()) / 60) * HOUR

  return (
    <div className="timegrid" style={{ ['--days' as string]: days.length }}>
      <div className="tg-head">
        <div className="tg-gutter" />
        {days.map((d) => (
          <button
            key={toDateKey(d)}
            className={`tg-dayhead${isSameDay(d, today) ? ' is-today' : ''}`}
            onClick={() => onDayClick?.(d)}
            type="button"
          >
            <span className="tg-dow">{weekdayShort(d)}</span>
            <span className="tg-dom">{d.getDate()}</span>
          </button>
        ))}
      </div>
      {hasAllDay && (
        <div className="tg-allday">
          <div className="tg-gutter tg-allday-label">dia</div>
          {allDayByDay.map((list, i) => (
            <div key={i} className="tg-allday-cell">
              {list.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`chip${o.source === 'shift' ? ' chip-shift' : ` cat-${o.category}`}`}
                  style={o.color ? { ['--chip' as string]: o.color } : undefined}
                  onClick={() => onOpen(o)}
                  title={o.title}
                >
                  {o.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="tg-body" ref={scroller}>
        <div className="tg-hours">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="tg-hour" style={{ height: HOUR }}>
              {h > 0 && <span>{String(h).padStart(2, '0')}:00</span>}
            </div>
          ))}
        </div>
        {days.map((d, i) => (
          <div
            key={toDateKey(d)}
            className={`tg-col${isSameDay(d, today) ? ' is-today' : ''}`}
            style={{ height: 24 * HOUR }}
            onClick={(e) => {
              if (e.target !== e.currentTarget) return
              const y = e.nativeEvent.offsetY
              const minutes = Math.floor((y / HOUR) * 2) * 30
              const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes)
              onSlot(start)
            }}
            role="grid"
            aria-label={`Dia ${d.getDate()}`}
          >
            {timedByDay[i].map((p) => {
              const o = p.occ
              const conflict = conflictKeys.has(o.key)
              return (
                <button
                  type="button"
                  key={o.key}
                  className={`tg-event${o.source === 'shift' ? ' is-shift' : ` cat-${o.category}`}${conflict ? ' is-conflict' : ''}${o.transparent ? ' is-transparent' : ''}`}
                  style={{
                    top: p.top,
                    height: p.height - 2,
                    left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                    width: `calc(${100 / p.cols}% - 4px)`,
                    ...(o.color ? { ['--chip' as string]: o.color } : {}),
                  }}
                  onClick={() => onOpen(o)}
                  title={`${o.title} · ${formatRange(o.start, o.end, o.allDay)}`}
                >
                  <span className="tg-event-title">
                    {o.recurring && <span aria-label="recorrente">↻ </span>}
                    {o.title}
                  </span>
                  {p.height > 34 && (
                    <span className="tg-event-time">
                      {p.continuesBefore ? '… ' : ''}
                      {formatRange(o.start, o.end, false)}
                      {o.location ? ` · ${o.location}` : ''}
                    </span>
                  )}
                </button>
              )
            })}
            {isSameDay(d, today) && <div className="tg-now" style={{ top: nowTop }} />}
          </div>
        ))}
      </div>
    </div>
  )
}
