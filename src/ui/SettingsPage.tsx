import { useRef, useState } from 'react'
import { exportJson, importJson, type DataStore } from '../data/store'
import type { AppData } from '../domain/types'

export type Theme = 'system' | 'light' | 'dark'

interface Props {
  data: AppData
  store: DataStore
  theme: Theme
  setTheme: (t: Theme) => void
  update: (fn: (d: AppData) => AppData) => void
}

export function SettingsPage({ data, store, theme, setTheme, update }: Props) {
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
