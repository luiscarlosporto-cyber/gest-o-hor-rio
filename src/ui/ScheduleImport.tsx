import { useMemo, useState } from 'react'
import { conflictsWith } from '../domain/conflicts'
import { addDays, addMinutes, formatLongDate, timeOf, toLocal } from '../domain/dates'
import { occurrencesIn, type EventDraft } from '../domain/operations'
import { parseScheduleList } from '../domain/scheduleImport'
import { CATEGORIES, type AppData, type Category } from '../domain/types'

interface Props {
  data: AppData
  onSave: (drafts: EventDraft[]) => void
  onClose: () => void
}

interface Prefs {
  title: string
  minutes: number
  category: Category
}

/** Últimas escolhas por tipo de mensagem (Treino, Consulta…), só neste dispositivo. */
const PREFS_KEY = 'ritmia:colar-horarios'
function loadPrefs(): Record<string, Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, Prefs>
  } catch {
    return {}
  }
}
function savePrefs(kind: string, p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), [kind]: p }))
  } catch {
    /* sem armazenamento: não faz mal */
  }
}

const DURATIONS = [30, 45, 60, 75, 90, 120]

/**
 * Colar uma lista de horários (ginásio, fisioterapia, explicações, consultas…)
 * e criar todas as marcações de uma vez.
 */
export function ScheduleImport({ data, onSave, onClose }: Props) {
  const [text, setText] = useState('')
  const parsed = useMemo(() => parseScheduleList(text, new Date()), [text])
  const remembered = useMemo(() => loadPrefs()[parsed.title], [parsed.title])
  const [title, setTitle] = useState<string | null>(null)
  const [category, setCategory] = useState<Category | null>(null)
  const [minutesPick, setMinutes] = useState<number | null>(null)
  const [off, setOff] = useState<Set<string>>(new Set())
  const name = title ?? remembered?.title ?? parsed.title
  const cat = category ?? remembered?.category ?? parsed.category
  const minutes = minutesPick ?? remembered?.minutes ?? 60

  const rows = useMemo(() => {
    if (!parsed.items.length) return []
    const first = parsed.items[0].start
    const last = parsed.items[parsed.items.length - 1].start
    const others = occurrencesIn(data, addDays(first, -1), addDays(last, 2))
    return parsed.items.map((it) => {
      const key = toLocal(it.start)
      const end = it.end ?? addMinutes(it.start, minutes)
      const rowTitle = it.title ?? name
      const duplicate = data.events.some((e) => e.start === key && e.title.trim().toLowerCase() === rowTitle.trim().toLowerCase())
      const clash = conflictsWith(
        { key: `new-${key}`, source: 'event', title: rowTitle, start: it.start, end, allDay: false, category: cat, transparent: false, recurring: false },
        others,
      )
      return { key, start: it.start, end, title: rowTitle, own: Boolean(it.title), location: it.location, duplicate, clash }
    })
  }, [parsed, data, minutes, name, cat])

  const chosen = rows.filter((r) => !r.duplicate && !off.has(r.key))

  const save = () => {
    savePrefs(parsed.title, { title: name.trim() || parsed.title, minutes, category: cat })
    onSave(
      chosen.map((r) => ({
        title: r.own ? r.title : name.trim() || 'Sessão',
        start: r.key,
        end: toLocal(r.end),
        allDay: false,
        category: cat,
        ...(r.location ? { location: r.location } : {}),
      })),
    )
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal schedule-import" role="dialog" aria-modal="true" aria-label="Colar horários">
        <div className="modal-head">
          <h2>Colar horários</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <p className="muted small">
          Cola uma mensagem com datas e horas: ginásio, fisioterapia, explicações, consultas. Cada linha pode ter hora de fim, título e
          local, por exemplo “12/11 15h-16h Dentista @ Penafiel”. Nada é gravado até carregares em Adicionar.
        </p>
        <textarea
          className="input"
          rows={6}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOff(new Set())
          }}
          placeholder={'Treinos de 11/2026:\n4/11 16h\n12/11 15h-16h Dentista @ Penafiel'}
          aria-label="Texto com os horários"
          autoFocus
        />

        {rows.length > 0 && (
          <>
            <div className="field-row">
              <label className="field">
                <span>Título{rows.some((r) => r.own) ? ' (linhas sem título)' : ''}</span>
                <input className="input" value={name} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="field">
                <span>Duração{rows.some((r) => r.end.getTime() !== addMinutes(r.start, minutes).getTime()) ? ' (sem hora de fim)' : ''}</span>
                <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {DURATIONS.map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Categoria</span>
                <select className="input" value={cat} onChange={(e) => setCategory(e.target.value as Category)}>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ul className="schedule-rows" aria-label="Marcações encontradas">
              {rows.map((r) => (
                <li key={r.key} className={r.clash.length ? 'is-warn' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={r.duplicate}
                      checked={!r.duplicate && !off.has(r.key)}
                      onChange={() =>
                        setOff((cur) => {
                          const n = new Set(cur)
                          if (n.has(r.key)) n.delete(r.key)
                          else n.add(r.key)
                          return n
                        })
                      }
                    />
                    <span>
                      {r.own && <strong>{r.title} · </strong>}
                      {formatLongDate(r.start)}, {timeOf(r.start)}–{timeOf(r.end)}
                      {r.location && <span className="muted"> · {r.location}</span>}
                    </span>
                  </label>
                  {r.duplicate ? (
                    <span className="muted small">Já está na agenda</span>
                  ) : (
                    r.clash.length > 0 && (
                      <span className="small schedule-clash">
                        Coincide com {r.clash.map((c) => (c.source === 'shift' ? `o turno ${c.title}` : c.title)).join(', ')}
                      </span>
                    )
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {text.trim() && rows.length === 0 && <p className="muted">Não encontrei datas com hora. Cada linha deve ter, por exemplo, “4/11 16h”.</p>}
        {parsed.skipped.length > 0 && (
          <p className="muted small">Sem hora ou data inválida: {parsed.skipped.join('; ')}</p>
        )}

        <div className="modal-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={chosen.length === 0} onClick={save}>
            {chosen.length === 1 ? 'Adicionar 1 marcação' : `Adicionar ${chosen.length} marcações`}
          </button>
        </div>
      </div>
    </div>
  )
}
