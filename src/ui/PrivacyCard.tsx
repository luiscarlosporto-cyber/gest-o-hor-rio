import { useEffect, useState } from 'react'
import { agendaCsv, deleteAccount, exportEverything, listAudit, listBackups, loadBackup, type AuditEntry, type BackupInfo } from '../data/account'
import type { AppData } from '../domain/types'

interface Props {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
}

const save = (name: string, text: string, type: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}
const today = () => new Date().toISOString().slice(0, 10)
const dayLabel = (d: string) => new Date(`${d}T12:00`).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })

const ACTIONS: Record<string, string> = {
  create: 'criou',
  update: 'mudou',
  delete: 'apagou',
  done: 'concluiu',
  google_connect: 'ligou o Google',
  google_disconnect: 'desligou o Google',
  gmail_scan: 'leu o Gmail à procura de compromissos',
  push_test: 'enviou uma notificação de teste',
  assistant_ask: 'respondeu a uma pergunta',
  assistant_accept: 'proposta aceite',
  assistant_dismiss: 'proposta ignorada',
}
const ENTITIES: Record<string, string> = { events: 'compromisso', shift_days: 'turno', tasks: 'tarefa' }
const ACTORS: Record<AuditEntry['actor'], string> = { user: 'Tu', sync: 'Google', ai: 'Assistente' }

export function describeAudit(e: AuditEntry): string {
  const d = (e.detail ?? {}) as Record<string, unknown>
  const what = ENTITIES[e.entity]
  if (what && ['create', 'update', 'delete', 'done'].includes(e.action)) {
    if (e.entity === 'shift_days') {
      const day = typeof d.day === 'string' ? dayLabel(d.day) : ''
      return e.action === 'update' && d.before ? `${ACTIONS[e.action]} o turno de ${day}: ${d.before} → ${d.code}` : `${ACTIONS[e.action]} o turno ${d.code ?? ''} de ${day}`
    }
    return `${ACTIONS[e.action]} ${e.entity === 'tasks' ? 'a' : 'o'} ${what} "${d.title ?? ''}"`
  }
  const base = ACTIONS[e.action] ?? e.action
  return d.title ? `${base}: "${d.title}"` : base
}

export function PrivacyCard({ data, update }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [pick, setPick] = useState('')
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [audit, setAudit] = useState<AuditEntry[] | null>(null)
  const [del, setDel] = useState(false)
  const [word, setWord] = useState('')

  useEffect(() => {
    listBackups()
      .then((b) => {
        setBackups(b)
        setPick(b[0]?.day ?? '')
      })
      .catch(() => setBackups([]))
  }, [])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card" aria-labelledby="privacy-h">
      <h2 id="privacy-h">Os meus dados</h2>
      <p className="small muted">Podes descarregar tudo o que a app guarda sobre ti, ver o que mudou e apagar a conta. Os tokens do Google e as chaves nunca saem do servidor.</p>

      <h3 className="sub-h">Descarregar</h3>
      <div className="row-actions">
        <button className="btn" disabled={busy !== null} onClick={() => run('json', async () => save(`gestao-horario-tudo-${today()}.json`, JSON.stringify(await exportEverything(), null, 2), 'application/json'))}>
          {busy === 'json' ? 'A preparar…' : 'Tudo (JSON)'}
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => save(`gestao-horario-agenda-${today()}.csv`, agendaCsv(data), 'text/csv;charset=utf-8')}>
          Agenda (Excel, CSV)
        </button>
      </div>

      <h3 className="sub-h">Cópias de segurança</h3>
      {backups === null ? (
        <p className="small muted">A ver as cópias…</p>
      ) : backups.length === 0 ? (
        <p className="small muted">O servidor faz uma cópia por dia, de madrugada, e guarda as dos últimos 14 dias. Ainda não há nenhuma.</p>
      ) : (
        <>
          <p className="small muted">Uma cópia por dia, de madrugada; ficam as dos últimos 14 dias.</p>
          <div className="row-actions">
            <label className="sr-only" htmlFor="backup-day">
              Cópia
            </label>
            <select id="backup-day" value={pick} onChange={(e) => (setPick(e.target.value), setConfirmRestore(false))}>
              {backups.map((b) => (
                <option key={b.day} value={b.day}>
                  {dayLabel(b.day)}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!pick || busy !== null}
              onClick={() => run('dl', async () => save(`gestao-horario-copia-${pick}.json`, JSON.stringify(await loadBackup(pick), null, 2), 'application/json'))}
            >
              Descarregar
            </button>
            {!confirmRestore ? (
              <button className="btn" disabled={!pick || busy !== null} onClick={() => setConfirmRestore(true)}>
                Repor…
              </button>
            ) : (
              <button
                className="btn btn-danger"
                disabled={busy !== null}
                onClick={() =>
                  run('restore', async () => {
                    const restored = await loadBackup(pick)
                    update(() => restored)
                    setConfirmRestore(false)
                    setMsg(`Reposta a cópia de ${dayLabel(pick)}: ${restored.events.length} compromissos, ${restored.shiftDays.length} turnos e ${restored.tasks.length} tarefas. Para desfazer, usa Ctrl+Z ou repõe outra cópia.`)
                  })
                }
              >
                {busy === 'restore' ? 'A repor…' : `Repor a de ${dayLabel(pick)}`}
              </button>
            )}
          </div>
          {confirmRestore && <p className="small pay-warn">Repor substitui os compromissos, turnos e tarefas atuais pelos dessa cópia, também no Google Calendar.</p>}
        </>
      )}

      <h3 className="sub-h">Histórico de alterações</h3>
      {audit === null ? (
        <button className="btn btn-sm" disabled={busy !== null} onClick={() => run('audit', async () => setAudit(await listAudit()))}>
          {busy === 'audit' ? 'A carregar…' : 'Ver as últimas alterações'}
        </button>
      ) : audit.length === 0 ? (
        <p className="small muted">Ainda não há alterações registadas.</p>
      ) : (
        <ul className="audit-list">
          {audit.map((e, i) => (
            <li key={i}>
              <span className="audit-when">{new Date(e.created_at).toLocaleString('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <span className={`audit-who is-${e.actor}`}>{ACTORS[e.actor] ?? e.actor}</span>
              <span>{describeAudit(e)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="sub-h">Apagar a conta</h3>
      {!del ? (
        <button className="btn btn-danger btn-sm" onClick={() => setDel(true)}>
          Apagar a conta e todos os dados…
        </button>
      ) : (
        <div className="danger-zone">
          <p className="small">
            Isto apaga para sempre os teus turnos, compromissos, tarefas, talões, cópias e histórico, e retira o acesso da app ao teu Google. Os eventos que já estão no Google Calendar ficam lá. Descarrega primeiro
            uma cópia se a quiseres guardar.
          </p>
          <label className="small" htmlFor="del-word">
            Escreve <strong>APAGAR</strong> para confirmar
          </label>
          <div className="row-actions">
            <input id="del-word" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
            <button
              className="btn btn-danger"
              disabled={word !== 'APAGAR' || busy !== null}
              onClick={() =>
                run('delete', async () => {
                  await deleteAccount(word)
                  window.location.reload()
                })
              }
            >
              {busy === 'delete' ? 'A apagar…' : 'Apagar para sempre'}
            </button>
            <button className="btn" onClick={() => (setDel(false), setWord(''))}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {msg && <p className="small">{msg}</p>}
    </section>
  )
}
