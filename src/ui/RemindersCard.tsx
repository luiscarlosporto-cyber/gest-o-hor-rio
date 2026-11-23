import { useEffect, useState } from 'react'
import { deviceSubscribed, disableOnDevice, enableOnDevice, pushSupport, sendTest } from '../data/push'
import { buildReminders, defaultReminderSettings, type ReminderSettings } from '../domain/reminders'
import type { AppData } from '../domain/types'

interface Props {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
}

const LEADS = [0, 15, 30, 60, 120, 180, 240]
const leadLabel = (m: number) => (m === 0 ? 'Sem aviso' : m < 60 ? `${m} min antes` : `${m / 60} h antes`)

export function RemindersCard({ data, update }: Props) {
  const s = data.reminders ?? defaultReminderSettings()
  const set = (patch: Partial<ReminderSettings>) => update((d) => ({ ...d, reminders: { ...(d.reminders ?? defaultReminderSettings()), ...patch } }))
  const support = pushSupport()
  const [onDevice, setOnDevice] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    deviceSubscribed().then(setOnDevice).catch(() => setOnDevice(false))
  }, [])
  const next = buildReminders(data, { ...s, enabled: true }, new Date(), 14)

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setMsg(null)
    try {
      const m = await fn()
      if (m) setMsg(m)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" aria-labelledby="s-rem">
      <h2 id="s-rem">Lembretes</h2>
      {support === 'no-account' ? (
        <p className="muted">Entra com a tua conta Google para receber lembretes no telemóvel.</p>
      ) : support === 'ios-install' ? (
        <p className="muted">No iPhone, primeiro adiciona a app ao ecrã principal (Partilhar → Adicionar ao ecrã principal) e abre-a a partir daí.</p>
      ) : support === 'no-browser' ? (
        <p className="muted">Este navegador não suporta notificações. No Android usa o Chrome.</p>
      ) : (
        <div className="row-actions">
          {onDevice ? (
            <>
              <span className="small">Ativos neste aparelho.</span>
              <button className="btn btn-sm" disabled={busy} onClick={() => run(async () => { const r = await sendTest(); return r.delivered ? 'Notificação de teste enviada. Deve aparecer dentro de segundos.' : 'O servidor não conseguiu entregar a notificação. Desativa e volta a ativar.' })}>
                Enviar teste
              </button>
              <button className="btn btn-sm" disabled={busy} onClick={() => run(async () => { await disableOnDevice(); setOnDevice(false); return 'Desativados neste aparelho.' })}>
                Desativar neste aparelho
              </button>
            </>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { await enableOnDevice(); setOnDevice(true); if (!s.enabled) set({ enabled: true }); return 'Ativados. Usa "Enviar teste" para confirmar.' })}>
              Ativar notificações neste aparelho
            </button>
          )}
        </div>
      )}
      {msg && <p className="small">{msg}</p>}

      <label className="check">
        <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enviar lembretes
      </label>
      <div className="pay-form">
        <label className="field">
          <span>Turnos de trabalho</span>
          <select value={s.shiftLead} onChange={(e) => set({ shiftLead: Number(e.target.value) })} disabled={!s.enabled}>
            {LEADS.map((m) => (
              <option key={m} value={m}>
                {leadLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Compromissos</span>
          <select value={s.eventLead} onChange={(e) => set({ eventLead: Number(e.target.value) })} disabled={!s.enabled}>
            {LEADS.map((m) => (
              <option key={m} value={m}>
                {leadLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Resumo do dia</span>
          <input type="time" value={s.dailySummary ?? ''} onChange={(e) => set({ dailySummary: e.target.value || undefined })} disabled={!s.enabled} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.tasks} onChange={(e) => set({ tasks: e.target.checked })} disabled={!s.enabled} /> Tarefas na hora limite (ou às 9h do dia)
      </label>
      {s.enabled && (
        <p className="small muted">
          {next.length} {next.length === 1 ? 'aviso marcado' : 'avisos marcados'} para os próximos 14 dias
          {next[0] ? `; o próximo: ${next[0].title}, ${next[0].fireAt.toLocaleString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. A lista atualiza sempre que abres a app.
        </p>
      )}
    </section>
  )
}
