import { useEffect, useMemo, useState } from 'react'
import { formatLongDate, monthName, parseLocal, timeOf, toDateKey, weekdayShort } from '../domain/dates'
import { projectSalary } from '../domain/payroll'
import { fmtHours, todayOverview } from '../domain/reports'
import { countdown, dayPart, FAMILY_LABEL, shiftFamily, type DayPart, type ShiftFamily } from '../domain/shiftFamily'
import { findType, summarizeMonth } from '../domain/shifts'
import { toggleTask } from '../domain/tasks'
import type { AppData, Occurrence } from '../domain/types'

interface Props {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
  /** Só para testes; sem ele a página atualiza-se sozinha a cada 30 s (contagem decrescente). */
  now?: Date
  go: (page: 'calendar' | 'tasks' | 'shifts' | 'reports', date?: Date) => void
}

const greeting = (h: number) => (h < 6 ? 'Boa noite' : h < 13 ? 'Bom dia' : h < 20 ? 'Boa tarde' : 'Boa noite')

const relDay = (d: Date, now: Date) => {
  const diff = Math.round((parseLocal(toDateKey(d)).getTime() - parseLocal(toDateKey(now)).getTime()) / 864e5)
  return diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : `${weekdayShort(d).toLowerCase()}, ${d.getDate()}`
}

const PARTS: { key: DayPart; label: string }[] = [
  { key: 'morning', label: 'Manhã' },
  { key: 'afternoon', label: 'Tarde' },
  { key: 'night', label: 'Noite' },
]

function useNow(fixed?: Date) {
  const [now, setNow] = useState(() => fixed ?? new Date())
  useEffect(() => {
    if (fixed) return
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [fixed])
  return fixed ?? now
}

export function HomePage({ data, update, now: fixedNow, go }: Props) {
  const now = useNow(fixedNow)
  const minuteKey = Math.floor(now.getTime() / 60_000)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const o = useMemo(() => todayOverview(data, now), [data, minuteKey])
  const pending = [...o.overdue, ...o.tasksDue]

  const shiftInfo = (s: Occurrence | undefined) => {
    if (!s?.shiftDate) return undefined
    const day = data.shiftDays.find((d) => d.date === s.shiftDate)
    const type = day ? findType(data.shiftTypes, day.code) : undefined
    return { code: day?.code ?? s.title, family: shiftFamily(type), label: type?.label, extra: Boolean(day?.extra) }
  }
  const famOfCode = (code: string): ShiftFamily => shiftFamily(findType(data.shiftTypes, code))

  const hero = o.currentShift ?? o.nextShift
  const heroInfo = shiftInfo(hero)
  const month = useMemo(() => summarizeMonth(data.shiftDays, data.shiftTypes, now.getFullYear(), now.getMonth()), [data, now.getFullYear(), now.getMonth()]) // eslint-disable-line react-hooks/exhaustive-deps

  // O talão do mês seguinte paga o trabalho deste mês. Só aparece com o nível ou o valor base definido.
  const payslipDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const salary = useMemo(() => projectSalary(data, payslipDate.getFullYear(), payslipDate.getMonth()), [data, payslipDate.getFullYear(), payslipDate.getMonth()]) // eslint-disable-line react-hooks/exhaustive-deps
  const eur = (n: number) => n.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

  const allDay = o.agenda.filter((a) => a.allDay)
  const timed = o.agenda.filter((a) => !a.allDay)
  const today = parseLocal(toDateKey(now))

  return (
    <div className="page page-home">
      <header className="toolbar">
        <div>
          <h1 className="toolbar-title home-title">{greeting(now.getHours())}</h1>
          <p className="muted home-date">{formatLongDate(now)}</p>
        </div>
      </header>

      <div className="home-grid">
        <section className={`card home-hero fam-${heroInfo?.family ?? 'other'}`} aria-labelledby="h-now">
          <h2 id="h-now" className="home-eyebrow">
            {o.currentShift ? 'Turno a decorrer' : 'Próximo turno'}
          </h2>
          {hero && heroInfo ? (
            <>
              <div className="home-hero-main">
                <span className="home-hero-code">{hero.title}</span>
                <span className="home-hero-label">
                  {heroInfo.label ?? FAMILY_LABEL[heroInfo.family]}
                  {heroInfo.extra && <span className="pill pill-extra">Extra</span>}
                </span>
              </div>
              <p className="home-hero-when">
                {relDay(hero.start, now)}, {timeOf(hero.start)} – {timeOf(hero.end)}
              </p>
              <p className="home-countdown" aria-live="polite">
                {o.currentShift ? `Termina daqui a ${countdown(now, hero.end)}` : `Começa daqui a ${countdown(now, hero.start)}`}
              </p>
            </>
          ) : (
            <p className="home-hero-empty">Sem turnos marcados nas próximas duas semanas.</p>
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

        <section className="card home-tasks-card" aria-labelledby="h-tasks">
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

        <section className="card home-day-card" aria-labelledby="h-agenda">
          <div className="card-head">
            <h2 id="h-agenda">O teu dia</h2>
            {o.conflicts > 0 && <span className="conflict-pill">{o.conflicts === 1 ? '1 sobreposição' : `${o.conflicts} sobreposições`}</span>}
          </div>
          {allDay.length > 0 && (
            <ul className="home-allday">
              {allDay.map((a) => (
                <li key={a.key} className={`home-item${a.source === 'shift' ? ` fam-${shiftInfo(a)?.family}` : ` cat-${a.category}`}`}>
                  {a.source === 'shift' ? `${a.title} · dia inteiro` : a.title}
                </li>
              ))}
            </ul>
          )}
          <div className="home-parts">
            {PARTS.map((p) => {
              // Uma noite que começou ontem aparece na manhã de hoje (é quando acaba).
              const items = timed.filter((a) => dayPart(a.start < today ? today : a.start) === p.key)
              return (
                <div key={p.key} className={`home-part part-${p.key}`}>
                  <h3>{p.label}</h3>
                  {items.length === 0 ? (
                    <p className="muted small">Livre</p>
                  ) : (
                    <ul>
                      {items.map((a) => (
                        <li key={a.key} className={`home-item${a.source === 'shift' ? ` fam-${shiftInfo(a)?.family}` : ` cat-${a.category}`}`}>
                          <span className="home-item-time">{timeOf(a.start)}</span>
                          <span className="home-item-title">{a.source === 'shift' ? `Turno ${a.title}` : a.title}</span>
                          {a.location && <span className="muted small">{a.location}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
          <button className="btn btn-sm home-link" onClick={() => go('calendar', now)}>
            Abrir o calendário
          </button>
        </section>

        <section className="card home-month" aria-labelledby="h-month">
          <h2 id="h-month">Este mês</h2>
          {month.workDays === 0 ? (
            <p className="muted">Ainda sem turnos neste mês.</p>
          ) : (
            <>
              <p className="home-month-big">
                <strong>{month.workDays}</strong> turnos · <strong>{fmtHours(month.workedMinutes)}</strong>
              </p>
              <ul className="home-month-counts">
                {month.counts.slice(0, 6).map((c) => (
                  <li key={c.code} className={`fam-${famOfCode(c.code)}`}>
                    <span className="dot" aria-hidden />
                    {c.code} <span className="muted">×{c.days}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {salary && (
            <p className="home-salary">
              <span className="muted small">Talão de {monthName(salary.month).toLowerCase()} (previsto)</span>
              <span>
                <strong>{eur(salary.gross)}</strong> bruto
                {salary.notes.some((n) => n.startsWith('Sem taxa de IRS')) ? null : (
                  <>
                    {' · '}
                    <strong>{eur(salary.net)}</strong> líquido
                  </>
                )}
              </span>
            </p>
          )}
          <button className="btn btn-sm home-link" onClick={() => go('reports')}>
            Relatórios e vencimento
          </button>
        </section>
      </div>

      <section className="card" aria-labelledby="h-week">
        <h2 id="h-week">Próximos 7 dias</h2>
        <ol className="home-week">
          {o.week.map((d) => {
            const date = parseLocal(d.date)
            const extra = data.shiftDays.find((s) => s.date === d.date)?.extra
            return (
              <li key={d.date}>
                <button className="home-day" onClick={() => go('calendar', date)} aria-label={`${formatLongDate(date)}: ${d.shift?.code ?? 'sem turno'}${extra ? ' (extra)' : ''}, ${d.events} eventos`}>
                  <span className="home-day-dow">{d.date === toDateKey(now) ? 'Hoje' : weekdayShort(date)}</span>
                  <span className="home-day-dom">{date.getDate()}</span>
                  {d.shift ? (
                    <span className={`shift-pill fam-${famOfCode(d.shift.code)}${extra ? ' is-extra' : ''}`}>{d.shift.label}</span>
                  ) : (
                    <span className="chip home-day-empty">–</span>
                  )}
                  <span className="small muted">{d.events ? `${d.events} ev.` : ' '}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
