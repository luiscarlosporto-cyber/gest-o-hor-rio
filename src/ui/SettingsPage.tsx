import { useRef, useState } from 'react'
import { exportJson, importJson, type DataStore } from '../data/store'
import { signInWithGoogle, supabase } from '../data/supabase'
import { CATEGORIES_ENF, defaultPaySettings, hourlyRate, monthlyBase, positionsFor, TRU_2026 } from '../domain/payroll'
import type { AppData, PaySettings } from '../domain/types'
import type { useCloud } from '../state/useCloud'
import { PrivacyCard } from './PrivacyCard'
import { RemindersCard } from './RemindersCard'

export type Theme = 'system' | 'light' | 'dark'

interface Props {
  data: AppData
  store: DataStore
  theme: Theme
  setTheme: (t: Theme) => void
  update: (fn: (d: AppData) => AppData) => void
  cloud?: ReturnType<typeof useCloud>
}

export function SettingsPage({ data, store, theme, setTheme, update, cloud }: Props) {
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const download = () => {
    const blob = new Blob([exportJson(data)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `gestao-horario-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const load = async (f: File) => {
    try {
      const next = importJson(await f.text())
      update(() => next)
      setMsg(`Importados ${next.events.length} eventos e ${next.shiftDays.length} dias de turno.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="page">
      <header className="toolbar">
        <h1 className="toolbar-title">Definições</h1>
      </header>
      {supabase && cloud && <GoogleCard cloud={cloud} />}
      <RemindersCard data={data} update={update} />
      <PayCard pay={data.pay} onChange={(pay) => update((d) => ({ ...d, pay }))} />
      <section className="card">
        <h2>Aspeto</h2>
        <div className="seg seg-compact" role="radiogroup" aria-label="Tema">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} role="radio" aria-checked={theme === t} className={`seg-item${theme === t ? ' is-on' : ''}`} onClick={() => setTheme(t)}>
              {t === 'system' ? 'Automático' : t === 'light' ? 'Claro' : 'Escuro'}
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Dados</h2>
        <p className="muted">
          {store.kind === 'local'
            ? 'Os dados estão guardados apenas neste browser. Faz uma cópia de segurança de vez em quando; quando a app ligar ao Supabase passam a estar sincronizados entre dispositivos.'
            : 'Os dados estão guardados no Supabase.'}
        </p>
        <p>
          {data.events.length} eventos · {data.shiftDays.length} dias de turno · {data.shiftTypes.length} tipos de turno
        </p>
        <div className="row-actions">
          <button className="btn" onClick={download}>
            Exportar cópia (JSON)
          </button>
          <button className="btn" onClick={() => file.current?.click()}>
            Importar cópia
          </button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </div>
        {msg && <p className="muted">{msg}</p>}
      </section>
      {store.kind === 'supabase' && cloud?.session && <PrivacyCard data={data} update={update} />}
      <section className="card">
        <h2>Atalhos de teclado</h2>
        <ul className="shortcuts">
          <li><kbd>←</kbd> <kbd>→</kbd> anterior e seguinte</li>
          <li><kbd>t</kbd> hoje</li>
          <li><kbd>d</kbd> dia · <kbd>s</kbd> semana · <kbd>m</kbd> mês</li>
          <li><kbd>n</kbd> novo evento</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> desfazer</li>
        </ul>
      </section>
    </div>
  )
}

function GoogleCard({ cloud }: { cloud: ReturnType<typeof useCloud> }) {
  const [confirmOff, setConfirmOff] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const last = cloud.google?.last_synced_at ? new Date(cloud.google.last_synced_at) : null
  return (
    <section className="card">
      <h2>Google Calendar</h2>
      {!cloud.session ? (
        <>
          <p className="muted">
            Entra com a tua conta Google para guardar os dados na nuvem e sincronizar com o Google Calendar nos dois sentidos. Os turnos aparecem no
            Google como eventos de dia inteiro com o código (MT2, N, D…), tal como já fazes.
          </p>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={() => signInWithGoogle().catch((e) => setErr(String(e)))}>
              Entrar com Google
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            Sessão: <strong>{cloud.session.user.email}</strong>
          </p>
          {cloud.google ? (
            <p className="muted">
              Calendário principal ligado{last ? `, última sincronização às ${last.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })} de ${last.toLocaleDateString('pt-PT')}` : ''}.
            </p>
          ) : (
            <p className="muted">O Google Calendar não está ligado. Sai e volta a entrar com o Google para dar autorização ao calendário.</p>
          )}
          {cloud.google?.last_error && <div className="error">{cloud.google.last_error}</div>}
          {cloud.syncMessage && <p className="muted">{cloud.syncMessage}</p>}
          <div className="row-actions">
            {cloud.google && (
              <button className="btn" onClick={() => cloud.syncNow()} disabled={cloud.sync === 'syncing'}>
                {cloud.sync === 'syncing' ? 'A sincronizar…' : 'Sincronizar agora'}
              </button>
            )}
            {cloud.google &&
              (confirmOff ? (
                <>
                  <span className="muted">Os eventos ficam nos dois lados, mas deixam de sincronizar.</span>
                  <button className="btn btn-danger" onClick={() => cloud.disconnectGoogle().then(() => setConfirmOff(false))}>
                    Desligar
                  </button>
                  <button className="btn" onClick={() => setConfirmOff(false)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <button className="btn btn-danger-ghost" onClick={() => setConfirmOff(true)}>
                  Desligar o Google
                </button>
              ))}
            <button className="btn" onClick={() => cloud.signOut()}>
              Terminar sessão
            </button>
          </div>
        </>
      )}
      {err && <div className="error">{err}</div>}
    </section>
  )
}

const euro = (n: number) => n.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })

function PayCard({ pay, onChange }: { pay?: PaySettings; onChange: (p: PaySettings) => void }) {
  const p = { ...defaultPaySettings(), ...pay }
  const set = (patch: Partial<PaySettings>) => onChange({ ...p, ...patch })
  const base = monthlyBase(p)
  const custom = !CATEGORIES_ENF.includes(p.category as (typeof CATEGORIES_ENF)[number])
  const positions = positionsFor(p.category)
  const setCategory = (category: string) => {
    const pos = positionsFor(category)
    const position = pos && p.position && p.position <= pos.length ? p.position : undefined
    set({ category, position, level: pos && position ? pos[position - 1] : custom ? p.level : undefined })
  }
  return (
    <section className="card" aria-labelledby="s-pay">
      <h2 id="s-pay">Vencimento</h2>
      <p className="small muted">Serve para o relatório estimar em euros os acréscimos e o trabalho suplementar. Fica só na tua conta.</p>
      <div className="pay-form">
        <label className="field">
          <span>Categoria</span>
          <select value={custom ? '' : p.category} onChange={(e) => setCategory(e.target.value || 'Outra')}>
            {CATEGORIES_ENF.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="">Outra…</option>
          </select>
        </label>
        {custom && (
          <label className="field">
            <span>Qual categoria</span>
            <input value={p.category === 'Outra' ? '' : p.category} onChange={(e) => set({ category: e.target.value || 'Outra' })} />
          </label>
        )}
        {positions ? (
          <label className="field">
            <span>Posição remuneratória</span>
            <select
              value={p.position ?? ''}
              onChange={(e) => {
                const position = e.target.value ? Number(e.target.value) : undefined
                set({ position, level: position ? positions[position - 1] : undefined })
              }}
            >
              <option value="">Escolher…</option>
              {positions.map((lvl, i) => (
                <option key={lvl} value={i + 1}>
                  {i + 1}.ª · índice {lvl} · {euro(TRU_2026[lvl])}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            <span>Índice remuneratório</span>
            <select value={p.level ?? ''} onChange={(e) => set({ level: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Escolher…</option>
              {Object.entries(TRU_2026).map(([lvl, val]) => (
                <option key={lvl} value={lvl}>
                  Índice {lvl} · {euro(val)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Remuneração base (se for diferente)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={p.monthly ?? ''}
            placeholder={p.level ? String(TRU_2026[p.level]) : ''}
            onChange={(e) => set({ monthly: e.target.value ? Number(e.target.value) : undefined })}
          />
        </label>
        <label className="field">
          <span>Horas por semana</span>
          <input type="number" min="1" max="60" value={p.weeklyHours} onChange={(e) => set({ weeklyHours: Number(e.target.value) || 35 })} />
        </label>
        <label className="field">
          <span>Feriado municipal (dia-mês)</span>
          <input
            value={p.municipalHolidays.map((md) => md.split('-').reverse().join('/')).join(', ')}
            placeholder="11/11"
            onChange={(e) =>
              set({
                municipalHolidays: e.target.value
                  .split(/[,;\s]+/)
                  .map((x) => x.match(/^(\d{1,2})[/-](\d{1,2})$/))
                  .filter((m): m is RegExpMatchArray => Boolean(m))
                  .map((m) => `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`),
              })
            }
          />
        </label>
      </div>
      <h3 className="pay-sub">Para a projeção do talão</h3>
      <div className="pay-form">
        <NumField label="Prémio (% da base)" value={p.bonusPct} step="0.01" onChange={(bonusPct) => set({ bonusPct })} />
        <NumField label="Subsídio de refeição por dia (€)" value={p.mealPerDay} step="0.01" onChange={(mealPerDay) => set({ mealPerDay })} />
        <NumField label="Segurança Social / CGA (%)" value={p.socialPct} step="0.1" onChange={(socialPct) => set({ socialPct })} />
        <NumField label="ADSE (%)" value={p.adsePct} step="0.1" onChange={(adsePct) => set({ adsePct })} />
        <NumField label="Taxa de IRS do talão (%)" value={p.irsPct} step="0.1" onChange={(irsPct) => set({ irsPct })} />
      </div>
      <fieldset className="month-chips">
        <legend className="small">Meses em que o prémio não é pago</legend>
        {MONTHS_SHORT.map((m, i) => {
          const on = (p.bonusSkipMonths ?? []).includes(i)
          return (
            <button
              key={m}
              type="button"
              className={`chip-toggle${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => set({ bonusSkipMonths: on ? (p.bonusSkipMonths ?? []).filter((x) => x !== i) : [...(p.bonusSkipMonths ?? []), i].sort((a, b) => a - b) })}
            >
              {m}
            </button>
          )
        })}
      </fieldset>
      {base ? (
        <p className="small">
          Valor/hora (R): <strong>{euro(hourlyRate(base, p.weeklyHours))}</strong> · base {euro(base)}
        </p>
      ) : (
        <p className="small muted">Escolhe a posição para ver o valor/hora.</p>
      )}
    </section>
  )
}

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function NumField({ label, value, step, onChange }: { label: string; value?: number; step: string; onChange: (v: number | undefined) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="decimal" min="0" step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    </label>
  )
}
