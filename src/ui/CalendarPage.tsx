import { parseQuickEvent } from '../domain/quickEvent'
import { chipStyle } from '../domain/shiftFamily'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { findConflicts, freeSlots } from '../domain/conflicts'
import {
  addDays,
  addMonths,
  formatLongDate,
  formatMonthYear,
  formatRange,
  monthGrid,
  parseLocal,
  startOfDay,
  startOfWeek,
  timeOf,
  toDateKey,
} from '../domain/dates'
import {
  deleteEvent,
  editOccurrence,
  editSeries,
  occurrencesIn,
  searchOccurrences,
  upsertEvent,
  type EditScope,
  type EventDraft,
} from '../domain/operations'
import { describeRRule } from '../domain/recurrence'
import { mergeShiftDays } from '../domain/shifts'
import { CATEGORIES, type AppData, type Occurrence } from '../domain/types'
import { EventEditor, type EditorTarget } from './EventEditor'
import { MonthView } from './MonthView'
import { ScheduleImport } from './ScheduleImport'
import { TimeGrid } from './TimeGrid'

export type View = 'day' | 'week' | 'month'

interface Props {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
  cursor: Date
  setCursor: (d: Date) => void
  view: View
  setView: (v: View) => void
}

function rangeFor(view: View, cursor: Date): [Date, Date] {
  if (view === 'day') return [startOfDay(cursor), addDays(startOfDay(cursor), 1)]
  if (view === 'week') return [startOfWeek(cursor), addDays(startOfWeek(cursor), 7)]
  const g = monthGrid(cursor)
  return [g[0], addDays(g[41], 1)]
}

function title(view: View, cursor: Date): string {
  if (view === 'day') return formatLongDate(cursor).replace(/^./, (c) => c.toUpperCase())
  if (view === 'month') return formatMonthYear(cursor)
  const s = startOfWeek(cursor)
  const e = addDays(s, 6)
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()}–${e.getDate()} ${formatMonthYear(s).toLowerCase()}`
    : `${s.getDate()} ${formatMonthYear(s).slice(0, 3).toLowerCase()} – ${e.getDate()} ${formatMonthYear(e).slice(0, 3).toLowerCase()} ${e.getFullYear()}`
}

const FILTERS = [{ id: 'turno', label: 'Turnos' }, ...CATEGORIES]

export function CalendarPage({ data, update, cursor, setCursor, view, setView }: Props) {
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [quick, setQuick] = useState('')
  const [pasting, setPasting] = useState(false)
  const [shiftPick, setShiftPick] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<string[]>([])

  const [from, to] = useMemo(() => rangeFor(view, cursor), [view, cursor])
  const allInRange = useMemo(() => occurrencesIn(data, from, to), [data, from, to])
  const visible = useMemo(
    () => (filters.length ? searchOccurrences(allInRange, { text: '', categories: filters }) : allInRange),
    [allInRange, filters],
  )
  const conflicts = useMemo(() => findConflicts(allInRange), [allInRange])
  const conflictKeys = useMemo(() => new Set(conflicts.flatMap((c) => [c.a.key, c.b.key])), [conflicts])

  const searching = query.trim().length > 0
  const results = useMemo(() => {
    if (!searching) return []
    const today = startOfDay(new Date())
    return searchOccurrences(occurrencesIn(data, addDays(today, -180), addDays(today, 365)), { text: query, categories: filters })
  }, [data, query, filters, searching])

  const step = useCallback(
    (dir: 1 | -1) => {
      if (view === 'day') setCursor(addDays(cursor, dir))
      else if (view === 'week') setCursor(addDays(cursor, 7 * dir))
      else setCursor(addMonths(cursor, dir))
    },
    [cursor, setCursor, view],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (editor || shiftPick || pasting || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.metaKey || e.ctrlKey) return
      if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 't') setCursor(new Date())
      else if (e.key === 'd') setView('day')
      else if (e.key === 's') setView('week')
      else if (e.key === 'm') setView('month')
      else if (e.key === 'n') setEditor({ start: nextHalfHour(cursor) })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, shiftPick, pasting, step, setCursor, setView, cursor])

  const open = (o: Occurrence) => {
    if (o.source === 'shift' && o.shiftDate) return setShiftPick(o.shiftDate)
    const ev = data.events.find((e) => e.id === o.eventId)
    if (ev) setEditor({ event: ev, occurrence: ev.rrule ? o : undefined })
  }

  const save = (draft: EventDraft, scope: EditScope) => {
    const target = editor
    if (!target) return
    update((d) => {
      let events = d.events
      if (target.event?.rrule && target.occurrence) {
        events =
          scope === 'this'
            ? editOccurrence(events, target.event.id, toDateKey(target.occurrence.start), draft)
            : editSeries(events, target.event.id, draft, target.occurrence.start)
      } else {
        events = upsertEvent(events, draft)
      }
      return { ...d, events }
    })
    setEditor(null)
  }

  const remove = (scope: EditScope) => {
    const target = editor
    if (!target?.event) return
    update((d) => ({
      ...d,
      events: deleteEvent(d.events, target.event!.id, scope, target.occurrence ? toDateKey(target.occurrence.start) : undefined),
    }))
    setEditor(null)
  }

  const days = view === 'day' ? [startOfDay(cursor)] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i))
  const dayFree = view === 'day' ? freeSlots(allInRange, new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 8), new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 22)) : []

  return (
    <div className="page page-calendar">
      <header className="toolbar">
        <div className="toolbar-group">
          <button className="btn" onClick={() => setCursor(new Date())}>
            Hoje
          </button>
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Anterior">
            ‹
          </button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Seguinte">
            ›
          </button>
          <h1 className="toolbar-title">{title(view, cursor)}</h1>
        </div>
        <div className="toolbar-group">
          <input
            className="search"
            type="search"
            placeholder="Pesquisar"
            aria-label="Pesquisar"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="seg seg-compact" role="tablist" aria-label="Vista">
            {(['day', 'week', 'month'] as View[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={`seg-item${view === v ? ' is-on' : ''}`} onClick={() => setView(v)}>
                {v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => setEditor({ start: nextHalfHour(cursor) })}>
            + Novo
          </button>
        </div>
      </header>

      <form
        className="quick-event"
        onSubmit={(e) => {
          e.preventDefault()
          if (!quick.trim()) return
          const q = parseQuickEvent(quick, new Date())
          setEditor({ start: q.start, preset: { title: q.title, end: q.end, allDay: q.allDay, category: q.category, location: q.location } })
          setQuick('')
        }}
      >
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Escreve, por exemplo: dentista sexta 10h"
          aria-label="Criar compromisso por escrita"
          enterKeyHint="go"
        />
        <button className="btn btn-primary" type="submit" disabled={!quick.trim()}>
          Criar
        </button>
        <button className="btn" type="button" onClick={() => setPasting(true)}>
          Colar lista
        </button>
      </form>

      <div className="filters" role="group" aria-label="Filtros">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`filter cat-${f.id}${filters.includes(f.id) ? ' is-on' : ''}`}
            aria-pressed={filters.includes(f.id)}
            onClick={() => setFilters((cur) => (cur.includes(f.id) ? cur.filter((x) => x !== f.id) : [...cur, f.id]))}
          >
            <span className="seg-dot" />
            {f.label}
          </button>
        ))}
        {conflicts.length > 0 && (
          <span className="conflict-pill" role="status">
            {conflicts.length} {conflicts.length === 1 ? 'conflito' : 'conflitos'} nesta vista
          </span>
        )}
      </div>

      {searching ? (
        <section className="results">
          <h2>
            {results.length} {results.length === 1 ? 'resultado' : 'resultados'} para “{query.trim()}”
          </h2>
          <ul>
            {results.slice(0, 200).map((o) => (
              <li key={o.key}>
                <button
                  onClick={() => {
                    setCursor(o.start)
                    setView('day')
                    setQuery('')
                  }}
                >
                  <span className="res-date">{formatLongDate(o.start)}</span>
                  <span className="res-title">{o.title}</span>
                  <span className="muted">{formatRange(o.start, o.end, o.allDay)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className={`calendar-body${view === 'day' ? ' with-side' : ''}`}>
          {view === 'month' ? (
            <MonthView
              cursor={cursor}
              occurrences={visible}
              conflictKeys={conflictKeys}
              onDay={(d) => (setCursor(d), setView('day'))}
              onOpen={open}
            />
          ) : (
            <TimeGrid
              days={days}
              occurrences={visible}
              conflictKeys={conflictKeys}
              onSlot={(start) => setEditor({ start })}
              onOpen={open}
              onDayClick={(d) => (setCursor(d), setView('day'))}
            />
          )}
          {view === 'day' && (
            <aside className="side">
              <h3>Horários livres</h3>
              {dayFree.length === 0 ? (
                <p className="muted">Sem intervalos livres de 30 minutos.</p>
              ) : (
                <ul className="free">
                  {dayFree.map((s) => (
                    <li key={s.start.toISOString()}>
                      <button onClick={() => setEditor({ start: s.start })}>
                        {timeOf(s.start)}–{timeOf(s.end)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {conflicts.length > 0 && (
                <>
                  <h3>Conflitos</h3>
                  <ul className="conflicts">
                    {conflicts.map((c) => (
                      <li key={`${c.a.key}|${c.b.key}`}>
                        <strong>{c.a.title}</strong> e <strong>{c.b.title}</strong>
                        <span className="muted"> sobrepõem-se das {timeOf(c.b.start > c.a.start ? c.b.start : c.a.start)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <DayEvents occurrences={allInRange} onOpen={open} events={data.events} />
            </aside>
          )}
        </div>
      )}

      {editor && (
        <EventEditor target={editor} others={occurrencesIn(data, addDays(from, -7), addDays(to, 7))} onSave={save} onDelete={remove} onClose={() => setEditor(null)} />
      )}
      {pasting && (
        <ScheduleImport
          data={data}
          onClose={() => setPasting(false)}
          onSave={(drafts) => {
            update((d) => ({ ...d, events: drafts.reduce(upsertEvent, d.events) }))
            setPasting(false)
            if (drafts[0]) setCursor(parseLocal(drafts[0].start))
          }}
        />
      )}
      {shiftPick && (
        <ShiftPicker
          date={shiftPick}
          data={data}
          onPick={(code) => {
            update((d) => ({ ...d, shiftDays: mergeShiftDays(d.shiftDays, [{ date: shiftPick, code }]) }))
            setShiftPick(null)
          }}
          onClose={() => setShiftPick(null)}
        />
      )}
    </div>
  )
}

function DayEvents({ occurrences, onOpen, events }: { occurrences: Occurrence[]; onOpen: (o: Occurrence) => void; events: AppData['events'] }) {
  if (!occurrences.length) return <p className="muted">Nada marcado para este dia.</p>
  return (
    <>
      <h3>Agenda</h3>
      <ul className="agenda">
        {occurrences.map((o) => {
          const ev = events.find((e) => e.id === o.eventId)
          return (
            <li key={o.key}>
              <button onClick={() => onOpen(o)}>
                <span className="agenda-time">{formatRange(o.start, o.end, o.allDay)}</span>
                <span>{o.title}</span>
                {ev?.rrule && <span className="muted small">{describeRRule(ev.rrule)}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function ShiftPicker({ date, data, onPick, onClose }: { date: string; data: AppData; onPick: (code: string) => void; onClose: () => void }) {
  const current = data.shiftDays.find((d) => d.date === date)?.code
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-sm" role="dialog" aria-label="Alterar turno">
        <div className="modal-head">
          <h2>Turno de {date.split('-').reverse().join('/')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="shift-options">
          {data.shiftTypes.map((t) => (
            <button
              key={t.code}
              className={`chip chip-shift chip-lg${t.code === current ? ' is-current' : ''}`}
              style={chipStyle(t.color)}
              onClick={() => onPick(t.code)}
              title={t.label}
            >
              {t.code}
              <small>{t.start && t.end ? `${t.start}–${t.end}` : t.label}</small>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-danger-ghost" onClick={() => onPick('')}>
            Remover turno
          </button>
        </div>
      </div>
    </div>
  )
}

function nextHalfHour(day: Date): Date {
  const now = new Date()
  const base = toDateKey(day) === toDateKey(now) ? now : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9)
  const m = base.getMinutes()
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), base.getHours(), m < 30 ? 30 : 60)
}
