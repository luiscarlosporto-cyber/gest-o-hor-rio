import { useMemo, useState } from 'react'
import { addDays, formatLongDate, parseLocal, toDateKey } from '../domain/dates'
import { addTask, groupTasks, parseQuickTask, PRIORITIES, removeTask, toggleTask, updateTask, type Priority, type Task } from '../domain/tasks'
import type { AppData } from '../domain/types'
import type { useCloud } from '../state/useCloud'
import { Suggestions } from './Suggestions'

interface Props {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
  now?: Date
  cloud?: ReturnType<typeof useCloud>
}

const dueLabel = (t: Pick<Task, 'due' | 'dueTime'>, today: string) => {
  if (!t.due) return null
  const d = parseLocal(t.due)
  const tomorrow = toDateKey(addDays(parseLocal(today), 1))
  const day = t.due === today ? 'Hoje' : t.due === tomorrow ? 'Amanhã' : d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })
  return t.dueTime ? `${day}, ${t.dueTime}` : day
}

export function TasksPage({ data, update, now = new Date(), cloud }: Props) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const today = toDateKey(now)
  const groups = useMemo(() => groupTasks(data.tasks, now), [data.tasks, now])
  const preview = text.trim() ? parseQuickTask(text, now) : null

  const setTasks = (fn: (t: Task[]) => Task[]) => update((d) => ({ ...d, tasks: fn(d.tasks) }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!preview?.title) return
    setTasks((t) => addTask(t, preview))
    setText('')
  }

  const sections: { id: keyof typeof groups; title: string; tone?: string }[] = [
    { id: 'overdue', title: 'Atrasadas', tone: 'danger' },
    { id: 'today', title: 'Hoje' },
    { id: 'upcoming', title: 'Próximas' },
    { id: 'someday', title: 'Sem data' },
  ]
  const open = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.someday.length

  return (
    <div className="page page-tasks">
      <header className="toolbar">
        <h1 className="toolbar-title">Tarefas</h1>
        <span className="muted">{open ? `${open} por fazer` : 'Tudo feito'}</span>
      </header>

      <form className="task-add card" onSubmit={submit}>
        <label className="sr-only" htmlFor="task-quick">
          Nova tarefa
        </label>
        <div className="task-add-row">
          <input
            id="task-quick"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nova tarefa… ex.: Entregar relatório sexta 14h !"
            autoComplete="off"
          />
          <button className="btn btn-primary" disabled={!preview?.title}>
            Adicionar
          </button>
        </div>
        {preview && (preview.due || preview.priority !== 'normal') && (
          <p className="small muted task-add-hint">
            <strong>{preview.title}</strong>
            {preview.due && ` · ${dueLabel(preview, today)}`}
            {preview.priority === 'alta' && ' · prioridade alta'}
          </p>
        )}
        {!preview && <p className="small muted task-add-hint">Escreve a data como "amanhã", "sexta", "25/12" e a hora como "14h". Um "!" marca prioridade alta.</p>}
      </form>

      {cloud && <Suggestions cloud={cloud} update={update} />}

      {open === 0 && <div className="empty card">Não há tarefas por fazer. Escreve uma em cima.</div>}

      {sections.map(
        (s) =>
          groups[s.id].length > 0 && (
            <section key={s.id} className="task-section" aria-labelledby={`ts-${s.id}`}>
              <h2 id={`ts-${s.id}`} className={`task-section-title${s.tone ? ` is-${s.tone}` : ''}`}>
                {s.title} <span className="muted">{groups[s.id].length}</span>
              </h2>
              <ul className="task-list">
                {groups[s.id].map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    today={today}
                    overdue={s.id === 'overdue'}
                    editing={editing === t.id}
                    onEdit={() => setEditing(editing === t.id ? null : t.id)}
                    onToggle={() => setTasks((all) => toggleTask(all, t.id))}
                    onSave={(patch) => {
                      setTasks((all) => updateTask(all, t.id, patch))
                      setEditing(null)
                    }}
                    onDelete={() => setTasks((all) => removeTask(all, t.id))}
                  />
                ))}
              </ul>
            </section>
          ),
      )}

      {groups.done.length > 0 && (
        <section className="task-section">
          <button className="btn btn-sm task-done-toggle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            {showDone ? 'Esconder concluídas' : `Ver concluídas (${groups.done.length})`}
          </button>
          {showDone && (
            <ul className="task-list">
              {groups.done.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  today={today}
                  editing={false}
                  onEdit={() => {}}
                  onToggle={() => setTasks((all) => toggleTask(all, t.id))}
                  onSave={() => {}}
                  onDelete={() => setTasks((all) => removeTask(all, t.id))}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

interface RowProps {
  task: Task
  today: string
  overdue?: boolean
  editing: boolean
  onEdit: () => void
  onToggle: () => void
  onSave: (patch: Partial<Task>) => void
  onDelete: () => void
}

function TaskRow({ task, today, overdue, editing, onEdit, onToggle, onSave, onDelete }: RowProps) {
  const due = dueLabel(task, today)
  return (
    <li className={`task${task.done ? ' is-done' : ''}${editing ? ' is-editing' : ''}`}>
      <div className="task-main">
        <input type="checkbox" className="task-check" checked={task.done} onChange={onToggle} aria-label={task.done ? `Reabrir ${task.title}` : `Concluir ${task.title}`} />
        <button className="task-body" onClick={onEdit} disabled={task.done} aria-expanded={editing}>
          <span className="task-title">
            {task.priority === 'alta' && <span className="prio prio-alta" title="Prioridade alta" aria-label="Prioridade alta" />}
            {task.priority === 'baixa' && <span className="prio prio-baixa" title="Prioridade baixa" aria-label="Prioridade baixa" />}
            {task.title}
          </span>
          {(due || task.notes || task.source === 'gmail') && (
            <span className="task-meta small">
              {due && <span className={overdue ? 'is-overdue' : undefined}>{due}</span>}
              {task.source === 'gmail' && <span className="muted">do Gmail</span>}
              {task.notes && <span className="muted task-notes">{task.notes}</span>}
            </span>
          )}
        </button>
        {task.done && (
          <button className="icon-btn" onClick={onDelete} aria-label={`Apagar ${task.title}`} title="Apagar">
            ×
          </button>
        )}
      </div>
      {editing && <TaskEditor task={task} onSave={onSave} onDelete={onDelete} onCancel={onEdit} />}
    </li>
  )
}

function TaskEditor({ task, onSave, onDelete, onCancel }: { task: Task; onSave: (p: Partial<Task>) => void; onDelete: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [due, setDue] = useState(task.due ?? '')
  const [dueTime, setDueTime] = useState(task.dueTime ?? '')
  const [priority, setPriority] = useState<Priority>(task.priority)
  const [notes, setNotes] = useState(task.notes ?? '')
  return (
    <form
      className="task-editor"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim()) return
        onSave({ title: title.trim(), due: due || undefined, dueTime: due && dueTime ? dueTime : undefined, priority, notes: notes.trim() || undefined })
      }}
    >
      <label className="field">
        <span>Título</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <div className="task-editor-row">
        <label className="field">
          <span>Data</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="field">
          <span>Hora</span>
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!due} />
        </label>
        <label className="field">
          <span>Prioridade</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Notas</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="row-actions">
        <button className="btn btn-primary">Guardar</button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-danger-ghost" onClick={onDelete}>
          Apagar
        </button>
      </div>
      {task.due && <p className="small muted">Prazo: {formatLongDate(parseLocal(task.due))}</p>}
    </form>
  )
}
