import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { parseLocal } from '../domain/dates'
import { globalSearch } from '../domain/search'
import type { Task } from '../domain/tasks'
import type { AppData, Occurrence } from '../domain/types'

interface Props {
  data: AppData
  onClose: () => void
  openDay: (date: Date) => void
  openShifts: (date: Date) => void
  openTasks: () => void
}

type Item = { key: string; title: string; meta: string; go: () => void }

const when = (o: Occurrence) => (o.allDay ? format(o.start, "EEE, d 'de' MMM yyyy", { locale: pt }) : format(o.start, "EEE, d 'de' MMM yyyy 'às' HH:mm", { locale: pt }))

export function GlobalSearch({ data, onClose, openDay, openShifts, openTasks }: Props) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const r = useMemo(() => globalSearch(data, q), [data, q])
  const groups: { label: string; items: Item[] }[] = [
    { label: 'Compromissos', items: r.events.map((o) => ({ key: o.key, title: o.title, meta: `${when(o)}${o.location ? ` · ${o.location}` : ''}${o.recurring ? ' · repete-se' : ''}`, go: () => openDay(o.start) })) },
    {
      label: 'Turnos',
      items: r.shifts.map((o) => {
        const label = data.shiftTypes.find((t) => t.code === o.title)?.label
        return { key: o.key, title: `${o.title}${label ? ` · ${label}` : ''}`, meta: when({ ...o, allDay: true }), go: () => openShifts(o.start) }
      }),
    },
    {
      label: 'Tarefas',
      items: r.tasks.map((t: Task) => ({
        key: t.id,
        title: t.title,
        meta: [t.done ? 'concluída' : 'por fazer', t.due ? format(parseLocal(t.due), "d 'de' MMM", { locale: pt }) + (t.dueTime ? ` às ${t.dueTime}` : '') : ''].filter(Boolean).join(' · '),
        go: openTasks,
      })),
    },
  ].filter((g) => g.items.length)
  const flat = groups.flatMap((g) => g.items)

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(flat.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter' && flat[active]) {
      flat[active].go()
      onClose()
    }
  }

  let i = -1
  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal search-modal" role="dialog" aria-modal="true" aria-label="Pesquisar em toda a app" onKeyDown={onKey}>
        <input
          ref={input}
          className="search-input"
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          placeholder="Compromissos, turnos (ex.: N) e tarefas…"
          aria-label="Pesquisar"
          enterKeyHint="search"
        />
        {q.trim() && (
          <p className="small muted" role="status">
            {r.total === 0 ? 'Sem resultados.' : `${r.total} ${r.total === 1 ? 'resultado' : 'resultados'}`}
          </p>
        )}
        {groups.map((g) => (
          <section key={g.label} className="search-group">
            <h3>{g.label}</h3>
            <ul>
              {g.items.map((it) => {
                i++
                const idx = i
                return (
                  <li key={it.key}>
                    <button
                      className={`search-item${idx === active ? ' is-active' : ''}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        it.go()
                        onClose()
                      }}
                    >
                      <span className="search-title">{it.title}</span>
                      <span className="small muted">{it.meta}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
        {!q.trim() && <p className="small muted">Dica: no computador, abre com Ctrl+K ou com a tecla /.</p>}
      </div>
    </div>
  )
}
