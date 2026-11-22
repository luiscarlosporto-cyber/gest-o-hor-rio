import { addDays, isSameDay, monthGrid, startOfDay, timeOf, toDateKey } from '../domain/dates'
import type { Occurrence } from '../domain/types'

interface Props {
  cursor: Date
  occurrences: Occurrence[]
  conflictKeys: Set<string>
  onDay: (d: Date) => void
  onOpen: (o: Occurrence) => void
}

const HEAD = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const MAX = 3

export function MonthView({ cursor, occurrences, conflictKeys, onDay, onOpen }: Props) {
  const grid = monthGrid(cursor)
  const today = new Date()
  return (
    <div className="month">
      <div className="month-head">
        {HEAD.map((h) => (
          <div key={h}>{h}</div>
        ))}
      </div>
      <div className="month-grid">
        {grid.map((d) => {
          const s = startOfDay(d)
          const e = addDays(s, 1)
          // Cada ocorrência aparece só no dia em que começa (a noite fica no dia em que começa).
          const list = occurrences.filter((o) => o.start >= s && o.start < e)
          const shift = list.find((o) => o.source === 'shift')
          const others = list.filter((o) => o.source !== 'shift')
          const outside = d.getMonth() !== cursor.getMonth()
          const hasConflict = list.some((o) => conflictKeys.has(o.key))
          return (
            <div
              key={toDateKey(d)}
              className={`month-cell${outside ? ' is-outside' : ''}${isSameDay(d, today) ? ' is-today' : ''}`}
              onClick={(ev) => ev.target === ev.currentTarget && onDay(d)}
            >
              <div className="month-cell-top">
                <button type="button" className="month-dom" onClick={() => onDay(d)} aria-label={`Abrir dia ${d.getDate()}`}>
                  {d.getDate()}
                </button>
                {hasConflict && <span className="dot-conflict" title="Conflito neste dia" />}
                {shift && (
                  <button
                    type="button"
                    className="chip chip-shift"
                    style={shift.color ? { ['--chip' as string]: shift.color } : undefined}
                    onClick={() => onOpen(shift)}
                  >
                    {shift.title}
                  </button>
                )}
              </div>
              {others.slice(0, MAX).map((o) => (
                <button
                  type="button"
                  key={o.key}
                  className={`month-event cat-${o.category}${conflictKeys.has(o.key) ? ' is-conflict' : ''}`}
                  onClick={() => onOpen(o)}
                >
                  <span className="month-event-dot" />
                  {!o.allDay && <span className="month-event-time">{timeOf(o.start)}</span>}
                  <span className="month-event-title">{o.title}</span>
                </button>
              ))}
              {others.length > MAX && (
                <button type="button" className="month-more" onClick={() => onDay(d)}>
                  +{others.length - MAX} mais
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
