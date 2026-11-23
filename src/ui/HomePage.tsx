import { useMemo } from 'react'
import { formatLongDate, formatRange, parseLocal, timeOf, toDateKey, weekdayShort } from '../domain/dates'
import { fmtHours, todayOverview } from '../domain/reports'
import { toggleTask } from '../domain/tasks'
import type { AppData, Occurrence } from '../domain/types'

interface Props {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
  now?: Date
  go: (page: 'calendar' | 'tasks' | 'shifts' | 'reports', date?: Date) => void
}

const greeting = (h: number) => (h < 6 ? 'Boa noite' : h < 13 ? 'Bom dia' : h < 20 ? 'Boa tarde' : 'Boa noite')

const relDay = (d: Date, now: Date) => {
  const diff = Math.round((parseLocal(toDateKey(d)).getTime() - parseLocal(toDateKey(now)).getTime()) / 864e5)
  return diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : `${weekdayShort(d).toLowerCase()}, ${d.getDate()}`
}

export function HomePage({ data, update, now = new Date(), go }: Props) {
  const o = useMemo(() => todayOverview(data, now), [data, now])
  const shiftLine = (s: Occurrence) => `${s.title} · ${formatRange(s.start, s.end, s.allDay)}`
  const pending = [...o.overdue, ...o.tasksDue]

  return (
    <div className="page page-home">
      <header className="toolbar">
        <div>
          <h1 className="toolbar-title home-title">{greeting(now.getHours())}</h1>
          <p className="muted home-date">{formatLongDate(now)}</p>
        </div>
      </header>

      <div className="home-grid">
        <section className="card home-now" aria-labelledby="h-now">
          <h2 id="h-now">Turno</h2>
          {o.currentShift ? (
            <>
              <p className="home-big">{o.currentShift.title}</p>
              <p className="muted">A decorrer, termina às {timeOf(o.currentShift.end)}</p>
            </>
          ) : o.nextShift ? (
            <>
              <p className="home-big">{o.nextShift.title}</p>
              <p className="muted">
                Próximo: {relDay(o.nextShift.start, now)} às {timeOf(o.nextShift.start)}
              </p>
            </>
          ) : (
            <p className="muted">Sem turnos marcados nas próximas duas semanas.</p>
          )}
          <dl className="home-facts">
            {o.restMinutes !== undefined && (
              <div className={o.restMinutes < 11 * 60 ? 'is-warn' : undefined}>
                <dt>Descanso até lá</dt>
                <dd>{fmtHours(o.restMinutes)}</dd>
              </div>
            )}
            {o.nextDayOff && (
              <div>
                <dt>Próxima folga</dt>
                <dd>{relDay(parseLocal(o.nextDayOff), now)}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="card" aria-labelledby="h-agenda">
          <div className="card-head">
            <h2 id="h-agenda">Hoje</h2>
            {o.conflicts > 0 && <span className="conflict-pill">{o.conflicts === 1 ? '1 sobreposição' : `${o.conflicts} sobreposições`}</span>}
          </div>
          {o.agenda.length === 0 ? (
            <p className="muted">Dia livre.</p>
          ) : (
            <ul className="home-agenda">
              {o.agenda.map((a) => (
                <li key={a.key}>
                  <span className="home-agenda-time">{a.allDay ? 'Dia' : timeOf(a.start)}</span>
                  <span
                    className={`chip${a.source === 'shift' ? ' chip-shift' : ` cat-${a.category}`}`}
                    style={a.color ? { ['--chip' as string]: a.color } : undefined}
                  >
                    {a.source === 'shift' ? shiftLine(a) : a.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button className="btn btn-sm home-link" onClick={() => go('calendar', now)}>
            Abrir o calendário
          </button>
        </section>

        <section className="card" aria-labelledby="h-tasks">
          <div className="card-head">
            <h2 id="h-tasks">Tarefas</h2>
            {o.overdue.length > 0 && <span className="conflict-pill">{o.overdue.length} em atraso</span>}
          </div>
          {pending.length === 0 ? (
            <p className="muted">Nada para hoje.</p>
          ) : (
            <ul className="home-tasks">
              {pending.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <label>
                    <input type="checkbox" checked={t.done} onChange={() => update((d) => ({ ...d, tasks: toggleTask(d.tasks, t.id) }))} />
                    <span>{t.title}</span>
                    {t.dueTime && <span className="muted small">{t.dueTime}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button className="btn btn-sm home-link" onClick={() => go('tasks')}>
            Ver todas
          </button>
        </section>
      </div>

      <section className="card" aria-labelledby="h-week">
        <h2 id="h-week">Próximos 7 dias</h2>
        <ol className="home-week">
          {o.week.map((d) => {
            const date = parseLocal(d.date)
            return (
              <li key={d.date}>
                <button className="home-day" onClick={() => go('calendar', date)} aria-label={`${formatLongDate(date)}: ${d.shift?.code ?? 'sem turno'}, ${d.events} eventos`}>
                  <span className="home-day-dow">{d.date === toDateKey(now) ? 'Hoje' : weekdayShort(date)}</span>
                  <span className="home-day-dom">{date.getDate()}</span>
                  {d.shift ? (
                    <span className="chip chip-shift" style={d.shift.color ? { ['--chip' as string]: d.shift.color } : undefined}>
                      {d.shift.code}
                    </span>
                  ) : (
                    <span className="chip home-day-empty">–</span>
                  )}
                  <span className="small muted">{d.events ? `${d.events} ev.` : ' '}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
