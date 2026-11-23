import { useRef, useState } from 'react'
import { addMonths, formatMonthYear } from '../domain/dates'
import { defaultPaySettings, projectSalary } from '../domain/payroll'
import { checkPayslip, settingsFromPayslip, type Payslip } from '../domain/payslip'
import type { AppData } from '../domain/types'

interface Props {
  data: AppData
  update: (fn: (d: AppData) => AppData) => void
  /** Mês de trabalho mostrado no relatório; o talão é o do mês seguinte. */
  cursor: Date
  setCursor: (d: Date) => void
}

const euro = (n: number) => n.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
const dec = (h: number) => h.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function PayslipCheck({ data, update, cursor, setCursor }: Props) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const payDate = addMonths(cursor, 1)
  const slip = data.payslips?.find((s) => s.year === payDate.getFullYear() && s.month === payDate.getMonth())

  const read = async (f: File) => {
    setError(null)
    setNote(null)
    setBusy(true)
    try {
      const { readPayslipPdf } = await import('../data/pdfPayslip')
      const s = await readPayslipPdf(f)
      update((d) => ({ ...d, payslips: [...(d.payslips ?? []).filter((x) => x.year !== s.year || x.month !== s.month), s] }))
      const work = new Date(s.year, s.month - 1, 1)
      if (work.getFullYear() !== cursor.getFullYear() || work.getMonth() !== cursor.getMonth()) setCursor(work)
      setNote(`Talão de ${formatMonthYear(new Date(s.year, s.month, 1)).toLowerCase()} guardado.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  const remove = (s: Payslip) => {
    update((d) => ({ ...d, payslips: (d.payslips ?? []).filter((x) => x.year !== s.year || x.month !== s.month) }))
    setNote(null)
  }

  const rows = slip ? checkPayslip(data, slip, cursor.getFullYear(), cursor.getMonth()) : []
  const fromSlip = slip ? settingsFromPayslip(slip, data.pay ?? defaultPaySettings()) : undefined
  const projection = slip ? projectSalary(data, slip.year, slip.month) : undefined
  const differs = rows.filter((r) => Math.abs(r.app - r.slip) >= 0.1)

  return (
    <section className="card" aria-labelledby="r-slip">
      <div className="card-head">
        <h2 id="r-slip">Talão de {formatMonthYear(payDate).toLowerCase()} × horário final</h2>
        <input ref={file} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        <button className="btn btn-sm no-print" onClick={() => file.current?.click()} disabled={busy}>
          {busy ? 'A ler…' : slip ? 'Trocar talão' : 'Carregar talão (PDF)'}
        </button>
      </div>
      <p className="small muted">
        O PDF é lido só neste aparelho. A app guarda apenas as rubricas, horas e valores (nunca nome, NIF, IBAN nem n.º de beneficiário). As horas de {formatMonthYear(cursor).toLowerCase()} pagas neste talão são
        comparadas com os turnos da app.
      </p>
      {error && <p className="warn">{error}</p>}
      {note && <p className="small">{note}</p>}

      {slip && (
        <>
          {rows.length === 0 ? (
            <p className="small muted">Este talão não tem horas de {formatMonthYear(cursor).toLowerCase()} com acréscimo, e o horário também não.</p>
          ) : (
            <table className="report-table pay-table">
              <thead>
                <tr>
                  <th scope="col">Rubrica</th>
                  <th scope="col" className="num">
                    Horário
                  </th>
                  <th scope="col" className="num">
                    Talão
                  </th>
                  <th scope="col" className="num">
                    Diferença
                  </th>
                  <th scope="col" className="num">
                    Pago
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const diff = Math.round((r.slip - r.app) * 100) / 100
                  const off = Math.abs(diff) >= 0.1
                  return (
                    <tr key={r.label} className={off ? 'is-off' : undefined}>
                      <th scope="row">{r.label}</th>
                      <td className="num">{dec(r.app)} h</td>
                      <td className="num">{dec(r.slip)} h</td>
                      <td className="num">{off ? `${diff > 0 ? '+' : '−'}${dec(Math.abs(diff))} h` : 'certo'}</td>
                      <td className="num">{r.amount ? euro(r.amount) : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {differs.length > 0 ? (
            <p className="small pay-warn">
              {differs.length === 1 ? 'Há 1 rubrica' : `Há ${differs.length} rubricas`} com diferença de pelo menos 0,1 h. Diferença positiva: o talão pagou mais horas do que as do horário; negativa: pagou menos.
            </p>
          ) : (
            rows.length > 0 && <p className="small">As horas do talão batem com o horário.</p>
          )}

          <table className="report-table pay-table salary-table">
            <thead>
              <tr>
                <th scope="col">Totais</th>
                <th scope="col" className="num">
                  Talão
                </th>
                <th scope="col" className="num">
                  Projeção
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Bruto</th>
                <td className="num">{euro(slip.gross)}</td>
                <td className="num">{projection ? euro(projection.gross) : '–'}</td>
              </tr>
              <tr className="is-deduction">
                <th scope="row">Descontos</th>
                <td className="num">−{euro(slip.totalDeductions)}</td>
                <td className="num">{projection ? `−${euro(projection.gross - projection.net)}` : '–'}</td>
              </tr>
              <tr className="net">
                <th scope="row">Líquido</th>
                <td className="num">
                  <strong>{euro(slip.net)}</strong>
                </td>
                <td className="num">{projection ? euro(projection.net) : '–'}</td>
              </tr>
            </tbody>
          </table>

          <div className="row-actions no-print">
            {fromSlip && fromSlip.changes.length > 0 && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  update((d) => ({ ...d, pay: fromSlip.settings }))
                  setNote(`Definições atualizadas: ${fromSlip.changes.join(', ')}.`)
                }}
              >
                Usar no vencimento: {fromSlip.changes.join(', ')}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => remove(slip)}>
              Apagar este talão
            </button>
          </div>
        </>
      )}
    </section>
  )
}
