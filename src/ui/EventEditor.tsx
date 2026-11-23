import { useEffect, useMemo, useRef, useState } from 'react'
import { conflictsWith } from '../domain/conflicts'
import { addDays, formatRange, parseLocal, timeOf, toDateKey, toLocal } from '../domain/dates'
import { validateDraft, type EditScope, type EventDraft } from '../domain/operations'
import { buildRRule, parseRRule, type RepeatFreq } from '../domain/recurrence'
import { CATEGORIES, type CalendarEvent, type Category, type Occurrence } from '../domain/types'

export interface EditorTarget {
  /** Evento existente (série ou simples) ou nada para um novo. */
  event?: CalendarEvent
  /** Ocorrência clicada, quando se edita uma ocorrência de uma série. */
  occurrence?: Occurrence
  /** Início sugerido para um evento novo. */
  start?: Date
  /** Novo evento já preenchido (criação rápida por escrita); o utilizador confirma no editor. */
  preset?: { title: string; end: Date; allDay: boolean; category: Category; location?: string }
}

interface Props {
  target: EditorTarget
  others: Occurrence[]
  onSave: (draft: EventDraft, scope: EditScope) => void
  onDelete: (scope: EditScope) => void
  onClose: () => void
}

const DAY_LABELS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']
const DAY_NAMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

export function EventEditor({ target, others, onSave, onDelete, onClose }: Props) {
  const { event, occurrence, preset } = target
  const isSeries = Boolean(event?.rrule)
  const baseStart = occurrence?.start ?? (event ? parseLocal(event.start) : target.start ?? new Date())
  const baseEnd = occurrence?.end ?? (event ? parseLocal(event.end) : preset?.end ?? new Date(baseStart.getTime() + 60 * 60_000))
  const repeat = parseRRule(event?.rrule)

  const [title, setTitle] = useState(event?.title ?? preset?.title ?? '')
  const [category, setCategory] = useState<Category>(event?.category ?? preset?.category ?? 'reuniao')
  const [allDay, setAllDay] = useState(event?.allDay ?? preset?.allDay ?? false)
  const [date, setDate] = useState(toDateKey(baseStart))
  const [startTime, setStartTime] = useState(timeOf(baseStart))
  const [endTime, setEndTime] = useState(timeOf(baseEnd))
  const [endDate, setEndDate] = useState(toDateKey(allDay ? addDays(baseEnd, -1) : baseEnd))
  const [location, setLocation] = useState(event?.location ?? preset?.location ?? '')
  const [notes, setNotes] = useState(event?.notes ?? '')
  const [freq, setFreq] = useState<RepeatFreq>(repeat.freq)
  const [byWeekday, setByWeekday] = useState<number[]>(repeat.byWeekday ?? [(baseStart.getDay() + 6) % 7])
  const [until, setUntil] = useState(repeat.until ?? '')
  const [error, setError] = useState<string | null>(null)
  const [askScope, setAskScope] = useState<null | 'save' | 'delete'>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => titleRef.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const draft: EventDraft = useMemo(() => {
    let start: string
    let end: string
    if (allDay) {
      start = `${date}T00:00`
      const last = endDate < date ? date : endDate
      end = toLocal(addDays(parseLocal(last), 1))
    } else {
      start = `${date}T${startTime}`
      const e = parseLocal(`${date}T${endTime}`)
      // Acabar antes de começar = acaba no dia seguinte (ex.: noite).
      end = toLocal(e <= parseLocal(start) ? addDays(e, 1) : e)
    }
    return {
      id: event?.id,
      title: title.trim(),
      category,
      allDay,
      start,
      end,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      rrule: buildRRule({ freq, byWeekday, until: until || undefined }),
      exdates: event?.exdates,
      recurringEventId: event?.recurringEventId,
      originalDate: event?.originalDate,
      transparent: category === 'pausa' ? true : undefined,
    }
  }, [allDay, byWeekday, category, date, endDate, endTime, event, freq, location, notes, startTime, title, until])

  const clash = useMemo(() => {
    const candidate: Occurrence = {
      key: `draft@${draft.start}`,
      source: 'event',
      title: draft.title,
      start: parseLocal(draft.start),
      end: parseLocal(draft.end),
      allDay: draft.allDay,
      category: draft.category,
      transparent: draft.transparent ?? draft.allDay,
      recurring: false,
    }
    return conflictsWith(candidate, others, event?.id)
  }, [draft, others, event?.id])

  const crossesMidnight = !allDay && parseLocal(draft.end).getDate() !== parseLocal(draft.start).getDate() && endTime !== '00:00'

  const submit = (scope?: EditScope) => {
    const err = validateDraft(draft)
    if (err) return setError(err)
    if (isSeries && occurrence && !scope) return setAskScope('save')
    onSave(draft, scope ?? 'all')
  }

  const remove = (scope?: EditScope) => {
    if (isSeries && occurrence && !scope) return setAskScope('delete')
    onDelete(scope ?? 'all')
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-label={event ? 'Editar evento' : 'Novo evento'}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="modal-head">
          <input
            ref={titleRef}
            className="input-title"
            placeholder="Título"
            aria-label="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="seg" role="radiogroup" aria-label="Categoria">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={category === c.id}
              className={`seg-item cat-${c.id}${category === c.id ? ' is-on' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              <span className="seg-dot" />
              {c.label}
            </button>
          ))}
        </div>

        <div className="field-row">
          <label className="field">
            <span>Data</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {allDay ? (
            <label className="field">
              <span>Até</span>
              <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          ) : (
            <>
              <label className="field">
                <span>Início</span>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              </label>
              <label className="field">
                <span>Fim{crossesMidnight ? ' (+1 dia)' : ''}</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
              </label>
            </>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          Dia inteiro
        </label>

        <div className="field-row">
          <label className="field">
            <span>Repetir</span>
            <select value={freq} onChange={(e) => setFreq(e.target.value as RepeatFreq)} disabled={Boolean(event?.recurringEventId)}>
              <option value="none">Não se repete</option>
              <option value="daily">Todos os dias</option>
              <option value="weekly">Todas as semanas</option>
              <option value="monthly">Todos os meses</option>
              <option value="yearly">Todos os anos</option>
            </select>
          </label>
          {freq !== 'none' && (
            <label className="field">
              <span>Termina em</span>
              <input type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
            </label>
          )}
        </div>
        {freq === 'weekly' && (
          <div className="weekdays" role="group" aria-label="Dias da semana">
            {DAY_LABELS.map((l, i) => (
              <button
                key={i}
                type="button"
                aria-label={DAY_NAMES[i]}
                aria-pressed={byWeekday.includes(i)}
                className={`wd${byWeekday.includes(i) ? ' is-on' : ''}`}
                onClick={() =>
                  setByWeekday((cur) => (cur.includes(i) ? (cur.length > 1 ? cur.filter((x) => x !== i) : cur) : [...cur, i]))
                }
              >
                {l}
              </button>
            ))}
          </div>
        )}

        <label className="field">
          <span>Local</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Opcional" />
        </label>
        <label className="field">
          <span>Notas</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </label>

        {clash.length > 0 && (
          <div className="warn" role="status">
            <strong>Sobreposição:</strong>{' '}
            {clash
              .slice(0, 3)
              .map((o) => `${o.title} (${formatRange(o.start, o.end, o.allDay)})`)
              .join(', ')}
            {clash.length > 3 ? ` e mais ${clash.length - 3}` : ''}. Podes gravar na mesma.
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        {askScope ? (
          <div className="scope">
            <p>{askScope === 'save' ? 'Aplicar a alteração a:' : 'Apagar:'}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setAskScope(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => (askScope === 'save' ? submit('this') : remove('this'))}
              >
                Só esta ocorrência
              </button>
              <button
                type="button"
                className={askScope === 'delete' ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={() => (askScope === 'save' ? submit('all') : remove('all'))}
              >
                Toda a série
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-actions">
            {event && (
              <button type="button" className="btn btn-danger-ghost" onClick={() => remove()}>
                Apagar
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              Gravar
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
