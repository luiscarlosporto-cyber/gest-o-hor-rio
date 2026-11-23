import { useEffect, useMemo, useRef, useState } from 'react'
import { askAssistant, assistantReady, logDecision } from '../data/assistant'
import { buildAssistantContext, checkProposal, type AssistantTurn, type Proposal } from '../domain/assistant'
import { formatRange, parseLocal } from '../domain/dates'
import { upsertEvent } from '../domain/operations'
import { addTask, PRIORITIES } from '../domain/tasks'
import type { AppData } from '../domain/types'

interface Props {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
  /** Há conta ligada (o assistente corre no servidor). */
  signedIn: boolean
}

interface Msg extends AssistantTurn {
  proposals?: { p: Proposal; state: 'open' | 'accepted' | 'dismissed' }[]
}

const CONSENT_KEY = 'gh-assistant-consent'
const readConsent = () => {
  try {
    return localStorage.getItem(CONSENT_KEY) === '1'
  } catch {
    return false
  }
}

const EXAMPLES = ['Quando tenho tempo livre esta semana para ir ao ginásio?', 'Marca dentista na próxima folga às 10h', 'Que turnos tenho nos próximos 7 dias?', 'Lembra-me de entregar o relatório na sexta']

export function AssistantPage({ data, update, signedIn }: Props) {
  const [ready, setReady] = useState<boolean | null>(null)
  const [consent, setConsent] = useState(readConsent)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!signedIn) return
    assistantReady()
      .then(setReady)
      .catch(() => setReady(false))
  }, [signedIn])

  useEffect(() => end.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' }), [msgs, busy])

  const send = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    setError(null)
    const history: Msg[] = [...msgs, { role: 'user', content: question }]
    setMsgs(history)
    setText('')
    setBusy(true)
    try {
      const turns = history.map(({ role, content }) => ({ role, content }))
      const a = await askAssistant(turns, buildAssistantContext(data))
      setMsgs((m) => [...m, { role: 'assistant', content: a.reply, proposals: a.proposals.map((p) => ({ p, state: 'open' as const })) }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const decide = (mi: number, pi: number, accept: boolean) => {
    const item = msgs[mi]?.proposals?.[pi]
    if (!item || item.state !== 'open') return
    if (accept) {
      const c = checkProposal(data, item.p)
      if (c.kind === 'invalid') return
      if (c.kind === 'event') update((d) => ({ ...d, events: upsertEvent(d.events, c.draft) }))
      else update((d) => ({ ...d, tasks: addTask(d.tasks, { ...c.task, source: 'manual' }) }))
    }
    logDecision(item.p.kind, item.p.title, accept ? 'accepted' : 'dismissed')
    setMsgs((m) => m.map((x, i) => (i !== mi ? x : { ...x, proposals: x.proposals?.map((y, j) => (j === pi ? { ...y, state: accept ? 'accepted' : 'dismissed' } : y)) })))
  }

  const header = (
    <header className="toolbar">
      <h1 className="toolbar-title">Assistente</h1>
      {msgs.length > 0 && (
        <button className="btn btn-sm" onClick={() => setMsgs([])} disabled={busy}>
          Nova conversa
        </button>
      )}
    </header>
  )

  if (!signedIn || ready === false) {
    return (
      <div className="page page-assistant">
        {header}
        <section className="card">
          <h2>O assistente ainda não está ligado</h2>
          <p className="small muted">
            {signedIn
              ? 'Falta guardar a chave da Anthropic no Supabase. Assim que estiver, esta página passa a responder.'
              : 'O assistente corre no servidor e precisa de uma conta. Entra em Definições.'}
          </p>
        </section>
      </div>
    )
  }

  if (!consent) {
    return (
      <div className="page page-assistant">
        {header}
        <section className="card">
          <h2>Antes de começar</h2>
          <p className="small">
            Para responder, as tuas perguntas e um resumo da agenda das próximas 3 semanas (turnos, títulos e horas dos compromissos, tarefas por fazer) são enviados para a Anthropic, a
            empresa do modelo Claude. Não são enviados vencimento, talões, emails nem dados da conta.
          </p>
          <p className="small">O assistente só propõe. Nada é criado, mudado ou apagado sem carregares em “Adicionar”.</p>
          <button
            className="btn btn-primary"
            onClick={() => {
              try {
                localStorage.setItem(CONSENT_KEY, '1')
              } catch {
                /* sem armazenamento: pergunta outra vez da próxima */
              }
              setConsent(true)
            }}
          >
            Percebi, continuar
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="page page-assistant">
      {header}
      <div className="chat" aria-live="polite">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <p className="muted">Pergunta sobre a tua agenda ou pede para marcar algo. Exemplos:</p>
            <div className="ex-chips">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="ex-chip" onClick={() => send(ex)} disabled={ready === null}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, mi) => (
          <div key={mi} className={`bubble bubble-${m.role}`}>
            <p>{m.content}</p>
            {m.proposals?.map((x, pi) => (
              <ProposalCard key={pi} data={data} item={x} onAccept={() => decide(mi, pi, true)} onDismiss={() => decide(mi, pi, false)} />
            ))}
          </div>
        ))}
        {busy && <div className="bubble bubble-assistant is-thinking">A pensar…</div>}
        {error && <p className="warn">{error}</p>}
        <div ref={end} />
      </div>
      <form
        className="chat-input card"
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
      >
        <label className="sr-only" htmlFor="assistant-q">
          Pergunta ao assistente
        </label>
        <textarea
          id="assistant-q"
          rows={2}
          value={text}
          maxLength={2000}
          placeholder="Ex.: marca jantar com a Ana no sábado às 20h"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(text)
            }
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !text.trim() || ready === null}>
          Enviar
        </button>
      </form>
    </div>
  )
}

function ProposalCard({ data, item, onAccept, onDismiss }: { data: AppData; item: { p: Proposal; state: string }; onAccept: () => void; onDismiss: () => void }) {
  const c = useMemo(() => checkProposal(data, item.p), [data, item.p])
  const when =
    c.kind === 'event'
      ? formatRange(parseLocal(c.draft.start), parseLocal(c.draft.end), c.draft.allDay)
      : c.kind === 'task'
        ? c.task.due
          ? `Até ${parseLocal(c.task.due).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })}${c.task.dueTime ? `, ${c.task.dueTime}` : ''}`
          : 'Sem data'
        : ''
  return (
    <div className={`proposal is-${item.state}`}>
      <div className="proposal-kind">{item.p.kind === 'event' ? 'Compromisso' : 'Tarefa'}</div>
      <strong>{item.p.title}</strong>
      {when && <div className="small">{when}</div>}
      {c.kind === 'task' && c.task.priority !== 'normal' && <div className="small muted">Prioridade {PRIORITIES.find((x) => x.id === c.task.priority)?.label.toLowerCase()}</div>}
      {c.kind === 'event' && c.draft.location && <div className="small muted">{c.draft.location}</div>}
      {item.p.why && <div className="small muted">{item.p.why}</div>}
      {c.kind === 'invalid' && <div className="small warn">{c.error}</div>}
      {c.kind === 'event' && c.conflicts.length > 0 && item.state === 'open' && (
        <div className="small pay-warn">Colide com: {c.conflicts.map((o) => o.title).join(', ')}</div>
      )}
      {item.state === 'open' ? (
        <div className="row-actions">
          <button className="btn btn-sm btn-primary" onClick={onAccept} disabled={c.kind === 'invalid'}>
            Adicionar
          </button>
          <button className="btn btn-sm" onClick={onDismiss}>
            Ignorar
          </button>
        </div>
      ) : (
        <div className="small muted">{item.state === 'accepted' ? 'Adicionado.' : 'Ignorado.'}</div>
      )}
    </div>
  )
}
