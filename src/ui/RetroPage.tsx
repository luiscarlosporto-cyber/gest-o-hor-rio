import { useMemo, useRef, useState } from 'react'
import { defaultPaySettings } from '../domain/payroll'
import { defaultRetroClaim, retroSummary, type RetroMonth } from '../domain/retro'
import type { Payslip } from '../domain/payslip'
import type { AppData, RetroClaim } from '../domain/types'

interface Props {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
}

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const euro = (n: number) => n.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
/** Na tabela, sem o símbolo (o cabeçalho diz €) para caber no telemóvel. */
const num = (n: number) => n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Diferenças de cêntimos (arredondamentos do apuramento) contam como certo. */
const CENTS = 1
const monthLabel = (k: string) => `${MONTHS_SHORT[Number(k.slice(5, 7)) - 1]}/${k.slice(0, 4)}`
const STATUS: Record<RetroMonth['status'], string> = { pago: 'pago', abaixo: 'abaixo do habitual', falta: 'em falta' }

export function RetroPage({ data, update }: Props) {
  const claim = data.pay?.retro
  const payslips = data.payslips
  const slips = payslips ?? []
  const s = useMemo(() => (claim ? retroSummary(claim, payslips ?? []) : undefined), [claim, payslips])
  const [open, setOpen] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const saveClaim = (c: RetroClaim | undefined) => update((d) => ({ ...d, pay: { ...(d.pay ?? defaultPaySettings()), retro: c } }))

  const load = async (files: FileList) => {
    setBusy(true)
    setError(null)
    setNote(null)
    const { readPayslipPdf } = await import('../data/pdfPayslip')
    const read: Payslip[] = []
    const failed: string[] = []
    for (const f of Array.from(files)) {
      try {
        read.push(await readPayslipPdf(f))
      } catch (e) {
        failed.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (read.length) {
      update((d) => ({
        ...d,
        payslips: [...(d.payslips ?? []).filter((x) => !read.some((r) => r.year === x.year && r.month === x.month)), ...read],
      }))
      setNote(`${read.length === 1 ? '1 talão guardado' : `${read.length} talões guardados`} (só rubricas e valores).`)
    }
    if (failed.length) setError(`Não consegui ler: ${failed.join('; ')}`)
    setBusy(false)
    if (file.current) file.current.value = ''
  }

  return (
    <div className="page page-retro">
      <header className="toolbar">
        <h1 className="toolbar-title">Retroativos</h1>
        <div className="toolbar-group">
          <input ref={file} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => e.target.files?.length && load(e.target.files)} />
          <button className="btn btn-primary" onClick={() => file.current?.click()} disabled={busy}>
            {busy ? 'A ler…' : 'Carregar talões (PDF)'}
          </button>
        </div>
      </header>
      <p className="small muted">
        Os PDFs são lidos só neste aparelho e podes escolher vários de uma vez. A app guarda apenas as rubricas e os valores (nunca nome, NIF, IBAN nem n.º de beneficiário).
      </p>
      {error && <p className="warn">{error}</p>}
      {note && <p className="small">{note}</p>}

      {!claim || editing ? (
        <ClaimEditor
          claim={claim ?? defaultRetroClaim()}
          isNew={!claim}
          onSave={(c) => {
            saveClaim(c)
            setEditing(false)
          }}
          onCancel={claim ? () => setEditing(false) : undefined}
          onRemove={claim ? () => (saveClaim(undefined), setEditing(false)) : undefined}
        />
      ) : (
        s && (
          <>
            <section className="card retro-head" aria-labelledby="retro-name">
              <div className="card-head">
                <h2 id="retro-name">{claim.name}</h2>
                <button className="btn btn-sm" onClick={() => setEditing(true)}>
                  Editar
                </button>
              </div>
              <div className="retro-stats">
                <div>
                  <span className="stat-label">Devido</span>
                  <strong className="retro-value">{euro(s.official)}</strong>
                </div>
                <div>
                  <span className="stat-label">Recebido</span>
                  <strong className="retro-value is-paid">{euro(s.paid)}</strong>
                </div>
                <div>
                  <span className="stat-label">Falta</span>
                  <strong className="retro-value is-missing">{euro(s.missing)}</strong>
                </div>
              </div>
              <div className="retro-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress * 100)} aria-label="Recebido do total devido">
                <span style={{ width: `${s.progress * 100}%` }} />
              </div>
              <p className="small muted">
                {Math.round(s.progress * 100)}% recebido · {s.monthsPaid === 1 ? '1 mês pago' : `${s.monthsPaid} meses pagos`}, {s.monthsMissing} em falta
                {s.nextMissing && ` (a partir de ${monthLabel(s.nextMissing)})`}.
                {s.pace && s.slipsLeft && s.forecast
                  ? ` Ao ritmo atual (${String(s.pace).replace('.', ',')} ${s.pace === 1 ? 'mês' : 'meses'} por talão) faltam cerca de ${s.slipsLeft} talões, até ${monthLabel(s.forecast)}.`
                  : ''}
              </p>
              {slips.length === 0 && <p className="small">Ainda não há talões na app. Carrega os talões com retroativos para preencher o recebido.</p>}
            </section>

            <section className="card" aria-labelledby="retro-years">
              <h2 id="retro-years">Por ano</h2>
              <table className="report-table retro-table">
                <thead>
                  <tr>
                    <th scope="col">Ano</th>
                    <th scope="col" className="num">
                      Oficial (€)
                    </th>
                    <th scope="col" className="num">
                      Recebido (€)
                    </th>
                    <th scope="col" className="num">
                      Falta (€)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.years.map((y) => (
                    <YearRows key={y.year} y={y} open={open === y.year} toggle={() => setOpen(open === y.year ? null : y.year)} />
                  ))}
                  <tr className="retro-total">
                    <th scope="row">Total</th>
                    <td className="num">{num(s.official)}</td>
                    <td className="num">{num(s.paid)}</td>
                    <td className="num">{num(s.missing)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="small muted">Toca num ano para ver os meses. Falta negativa = pago a mais nesse ano; diferenças abaixo de 1 € contam como certo. Estornos entram como valor negativo.</p>
            </section>
          </>
        )
      )}
    </div>
  )
}

function YearRows({ y, open, toggle }: { y: ReturnType<typeof retroSummary>['years'][number]; open: boolean; toggle: () => void }) {
  const missing = y.missing ?? 0
  return (
    <>
      <tr className="retro-year" onClick={toggle}>
        <th scope="row">
          <button className="link-btn" aria-expanded={open} onClick={(e) => (e.stopPropagation(), toggle())}>
            {open ? '▾' : '▸'} {y.year}
          </button>
        </th>
        <td className="num">{y.official === undefined ? '—' : num(y.official)}</td>
        <td className="num">{num(y.paid)}</td>
        <td className={`num${missing >= CENTS ? ' is-missing' : missing <= -CENTS ? ' is-over' : ''}`}>
          {y.missing === undefined ? '—' : Math.abs(missing) < CENTS ? 'certo' : num(y.missing)}
        </td>
      </tr>
      {open &&
        y.months.map((m) => (
          <tr key={m.ref} className={`retro-month is-${m.status}`}>
            <td>{monthLabel(m.ref)}</td>
            <td className="small muted" colSpan={2}>
              {STATUS[m.status]}
              {m.slips.length > 0 && ` · talão ${m.slips.map(monthLabel).join(', ')}`}
            </td>
            <td className="num">{m.paid ? num(m.paid) : '—'}</td>
          </tr>
        ))}
    </>
  )
}

function ClaimEditor({
  claim,
  isNew,
  onSave,
  onCancel,
  onRemove,
}: {
  claim: RetroClaim
  isNew: boolean
  onSave: (c: RetroClaim) => void
  onCancel?: () => void
  onRemove?: () => void
}) {
  const [c, setC] = useState(claim)
  const firstYear = Number(c.from.slice(0, 4))
  const lastYear = Number(c.until.slice(0, 4))
  const years = firstYear && lastYear && lastYear >= firstYear && lastYear - firstYear < 40 ? Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i) : []
  const num = (v: string) => Number(v.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'))
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(claim.official).map(([y, v]) => [y, v.toLocaleString('pt-PT', { minimumFractionDigits: 2 })])),
  )
  const save = () => {
    const official: Record<string, number> = {}
    for (const y of years) {
      const t = texts[String(y)]?.trim()
      if (t && Number.isFinite(num(t))) official[String(y)] = Math.round(num(t) * 100) / 100
    }
    onSave({ ...c, official })
  }
  return (
    <section className="card" aria-labelledby="retro-edit">
      <h2 id="retro-edit">{isNew ? 'Novo retroativo' : 'Editar retroativo'}</h2>
      {isNew && <p className="small muted">Indica o período e o valor oficial por ano (do apuramento do processo). O recebido sai dos talões.</p>}
      <div className="field-row">
        <label className="field">
          <span>Nome</span>
          <input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Rubrica no talão</span>
          <input value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.replace(/\s+/g, ' ') })} inputMode="numeric" />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Primeiro mês devido</span>
          <input type="month" value={c.from} onChange={(e) => e.target.value && setC({ ...c, from: e.target.value })} />
        </label>
        <label className="field">
          <span>Último mês devido</span>
          <input type="month" value={c.until} onChange={(e) => e.target.value && setC({ ...c, until: e.target.value })} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={c.skipMonths.includes(5)} onChange={(e) => setC({ ...c, skipMonths: e.target.checked ? [5] : [] })} /> Junho não conta (prémio de 11 meses)
      </label>
      <h3 className="sub-h">Valor oficial por ano (€)</h3>
      <div className="retro-official">
        {years.map((y) => (
          <label className="field" key={y}>
            <span>{y}</span>
            <input inputMode="decimal" placeholder="0,00" value={texts[String(y)] ?? ''} onChange={(e) => setTexts({ ...texts, [String(y)]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="toolbar-group">
        <button className="btn btn-primary" onClick={save}>
          Guardar
        </button>
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            Cancelar
          </button>
        )}
        {onRemove && (
          <button className="btn btn-danger-ghost" onClick={onRemove}>
            Apagar este retroativo
          </button>
        )}
      </div>
    </section>
  )
}
