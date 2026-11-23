import { useCallback, useEffect, useState } from 'react'
import { addMinutes, parseLocal, toLocal } from '../domain/dates'
import { upsertEvent } from '../domain/operations'
import { addTask } from '../domain/tasks'
import type { AppData } from '../domain/types'
import { signInWithGoogle, supabase } from '../data/supabase'
import type { useCloud } from '../state/useCloud'

export interface SuggestionRow {
  id: string
  kind: 'event' | 'task'
  title: string
  date: string | null
  time: string | null
  sender: string | null
  subject: string | null
  snippet: string | null
}

interface Props {
  cloud: ReturnType<typeof useCloud>
  update: (fn: (d: AppData) => AppData) => void
}

const when = (s: SuggestionRow) => {
  if (!s.date) return ''
  const d = parseLocal(s.date).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })
  return s.time ? `${d}, ${s.time.slice(0, 5)}` : d
}

/** Transforma uma sugestão aceite numa alteração aos dados (evento de 1 hora ou tarefa). */
export function applySuggestion(d: AppData, s: SuggestionRow, as: 'event' | 'task'): AppData {
  const note = [s.sender && `De: ${s.sender}`, s.subject && `Assunto: ${s.subject}`].filter(Boolean).join('\n') || undefined
  if (as === 'event' && s.date) {
    const start = s.time ? `${s.date}T${s.time.slice(0, 5)}` : `${s.date}T00:00`
    const end = s.time ? toLocal(addMinutes(parseLocal(start), 60)) : `${s.date}T00:00`
    return { ...d, events: upsertEvent(d.events, { title: s.title, start, end, allDay: !s.time, category: 'reuniao', notes: note }) }
  }
  return { ...d, tasks: addTask(d.tasks, { title: s.title, due: s.date ?? undefined, dueTime: s.time?.slice(0, 5), notes: note, source: 'gmail' }) }
}

export function Suggestions({ cloud, update }: Props) {
  const [items, setItems] = useState<SuggestionRow[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const enabled = Boolean(cloud.google?.gmail_enabled)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase
      .from('suggestions')
      .select('id, kind, title, date, time, sender, subject, snippet')
      .eq('status', 'pending')
      .order('date', { ascending: true, nullsFirst: false })
      .limit(30)
    setItems((data as SuggestionRow[]) ?? [])
  }, [])

  const scan = useCallback(async () => {
    setBusy(true)
    const r = await cloud.scanGmail()
    setBusy(false)
    if (r.error) setMsg(r.error)
    else setMsg(r.found ? `${r.found} sugestões novas.` : 'Nada de novo nos emails.')
    load()
  }, [cloud, load])

  useEffect(() => {
    if (!enabled) return
    load()
    // Ler o Gmail no máximo de hora a hora ao abrir.
    const last = cloud.google?.gmail_scanned_at ? Date.parse(cloud.google.gmail_scanned_at) : 0
    if (Date.now() - last > 3600_000) scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const decide = async (s: SuggestionRow, status: 'accepted' | 'dismissed', as?: 'event' | 'task') => {
    if (status === 'accepted' && as) update((d) => applySuggestion(d, s, as))
    setItems((list) => list.filter((x) => x.id !== s.id))
    await supabase?.from('suggestions').update({ status }).eq('id', s.id)
  }

  if (!cloud.session || !cloud.google) return null

  if (!enabled)
    return (
      <section className="card suggest">
        <h2>Compromissos nos emails</h2>
        <p className="muted small">
          A app pode ler os teus emails recentes (só leitura) e sugerir reuniões e prazos para aceitares ou ignorares. Nunca envia, apaga nem altera emails.
        </p>
        <div className="row-actions">
          <button className="btn" onClick={() => signInWithGoogle({ gmail: true }).catch((e) => setMsg(String(e)))}>
            Ligar o Gmail
          </button>
        </div>
        {msg && <p className="small error">{msg}</p>}
      </section>
    )

  return (
    <section className="card suggest" aria-labelledby="suggest-title">
      <div className="suggest-head">
        <h2 id="suggest-title">Sugestões do Gmail {items.length > 0 && <span className="muted">{items.length}</span>}</h2>
        <button className="btn btn-sm" onClick={scan} disabled={busy}>
          {busy ? 'A ler…' : 'Procurar agora'}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted small">{msg ?? 'Sem sugestões pendentes.'}</p>
      ) : (
        <ul className="suggest-list">
          {items.map((s) => (
            <li key={s.id} className="suggest-item">
              <div className="suggest-text">
                <strong>{s.title}</strong>
                <span className="small muted">
                  {when(s)}
                  {s.sender && ` · ${s.sender}`}
                </span>
                {s.snippet && <span className="small muted suggest-snippet">{s.snippet}</span>}
              </div>
              <div className="row-actions">
                {s.kind === 'event' ? (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => decide(s, 'accepted', 'event')}>
                      Pôr no calendário
                    </button>
                    <button className="btn btn-sm" onClick={() => decide(s, 'accepted', 'task')}>
                      Tarefa
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => decide(s, 'accepted', 'task')}>
                      Criar tarefa
                    </button>
                    <button className="btn btn-sm" onClick={() => decide(s, 'accepted', 'event')}>
                      Evento
                    </button>
                  </>
                )}
                <button className="btn btn-sm btn-danger-ghost" onClick={() => decide(s, 'dismissed')}>
                  Ignorar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
