import { useRef, useState } from 'react'
import { formatMonthYear } from '../domain/dates'
import { defaultPaySettings } from '../domain/payroll'
import { applyRoster, rosterChanges, type SisqualRoster } from '../domain/sisqual'
import type { AppData } from '../domain/types'

interface Props {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
  onApplied: (month: Date) => void
}

export function SisqualImport({ data, update, onApplied }: Props) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roster, setRoster] = useState<SisqualRoster | null>(null)
  const employee = data.pay?.employeeNumber ?? ''

  const setEmployee = (employeeNumber: string) => update((d) => ({ ...d, pay: { ...(d.pay ?? defaultPaySettings()), employeeNumber: employeeNumber.trim() || undefined } }))

  const read = async (f: File) => {
    setError(null)
    setRoster(null)
    if (!employee) return setError('Escreve primeiro o teu número mecanográfico.')
    setBusy(true)
    try {
      const { readSisqualPdf } = await import('../data/pdfRoster')
      setRoster(await readSisqualPdf(f, employee, data.shiftTypes))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  const changes = roster ? rosterChanges(data.shiftDays, roster) : []
  const extras = roster?.days.filter((d) => d.extra) ?? []
  const unknown = [...new Set(roster?.days.filter((d) => d.unknown).map((d) => d.raw) ?? [])]

  return (
    <div className="sisqual">
      <h3>Horário do SISQUAL (PDF)</h3>
      <p className="small muted">Inicial ou final. O PDF é lido só neste aparelho: a app guarda apenas os teus turnos. Os turnos a verde ficam marcados como extra.</p>
      <div className="sisqual-row">
        <label className="field">
          <span>N.º mecanográfico</span>
          <input value={employee} onChange={(e) => setEmployee(e.target.value)} inputMode="numeric" placeholder="ex.: 71402" />
        </label>
        <input ref={file} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        <button className="btn btn-primary" onClick={() => file.current?.click()} disabled={busy || !employee}>
          {busy ? 'A ler…' : 'Escolher PDF'}
        </button>
      </div>
      {error && <p className="warn">{error}</p>}
      {roster && (
        <div className="preview">
          <p>
            <strong>
              Horário {roster.kind === 'desconhecido' ? '' : `plano ${roster.kind} `}de {formatMonthYear(new Date(roster.year, roster.month, 1))}
            </strong>
            {roster.name && <span className="muted"> · {roster.name}</span>}
          </p>
          <p className="small">
            {roster.days.length} dias, {extras.length} {extras.length === 1 ? 'extra' : 'extras'}. {changes.length === 0 ? 'Igual ao que já tens.' : `${changes.length} ${changes.length === 1 ? 'dia muda' : 'dias mudam'}.`}
          </p>
          {unknown.length > 0 && (
            <p className="warn">
              Códigos novos: <strong>{unknown.join(', ')}</strong>. Ficam como dia sem trabalho; podes acertar as horas em baixo.
            </p>
          )}
          <div className="preview-strip">
            {roster.days.map((d) => {
              const t = data.shiftTypes.find((x) => x.code === d.code)
              const changed = changes.includes(d)
              return (
                <span
                  key={d.date}
                  className={`badge${t ? '' : ' is-unknown'}${changed ? ' is-changed' : ''}`}
                  style={t ? { ['--chip' as string]: t.color } : undefined}
                  title={d.raw !== d.code ? `${d.date}: ${d.raw}` : d.date}
                >
                  <small>{Number(d.date.slice(8))}</small>
                  {d.code}
                  {d.extra && <span className="extra-pill">extra</span>}
                </span>
              )
            })}
          </div>
          <div className="row-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                update((d) => applyRoster(d, roster))
                onApplied(new Date(roster.year, roster.month, 1))
                setRoster(null)
              }}
            >
              Gravar o mês
            </button>
            <button className="btn" onClick={() => setRoster(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
