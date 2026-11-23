import { useMemo, useState } from 'react'
import { addMonths, formatMonthYear, parseLocal, weekdayShort } from '../domain/dates'
import { premiumHours } from '../domain/payroll'
import { fmtHours, monthReport, reportCsv } from '../domain/reports'
import { CATEGORIES, type AppData } from '../domain/types'

interface Props {
  data: AppData
  cursor: Date
  setCursor: (d: Date) => void
}

export function ReportsPage({ data, cursor, setCursor }: Props) {
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const r = useMemo(() => monthReport(data, year, month), [data, year, month])
  const pay = useMemo(() => premiumHours(data, year, month), [data, year, month])
  const payslip = formatMonthYear(addMonths(cursor, 1))
  const dec = (h: number) => h.toFixed(2).replace('.', ',')
  const [showDays, setShowDays] = useState(false)
  const maxWeek = Math.max(60, ...r.weeks.map((w) => w.minutes))
  const catTotal = Object.values(r.eventMinutes).reduce((a, b) => a + (b ?? 0), 0)

  const download = () => {
    const blob = new Blob([reportCsv(r)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `relatorio-${year}-${String(month + 1).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="page page-reports">
      <header className="toolbar">
        <div className="toolbar-group">
          <button className="icon-btn no-print" onClick={() => setCursor(addMonths(cursor, -1))} aria-label="Mês anterior">
            ‹
          </button>
          <button className="icon-btn no-print" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Mês seguinte">
            ›
          </button>
          <h1 className="toolbar-title">Relatório · {formatMonthYear(cursor)}</h1>
        </div>
        <div className="row-actions no-print">
          <button className="btn" onClick={download}>
            Exportar Excel (CSV)
          </button>
          <button className="btn" onClick={() => window.print()}>
            Imprimir / PDF
          </button>
        </div>
      </header>

      <div className="stats">
        <Stat label="Horas de turno" value={fmtHours(r.summary.workedMinutes)} note={r.deltaMinutes ? `${r.deltaMinutes > 0 ? '+' : ''}${fmtHours(r.deltaMinutes)} que no mês anterior` : 'igual ao mês anterior'} />
        <Stat label="Dias de trabalho" value={String(r.summary.workDays)} note={`${r.daysOff} de folga ou descanso`} />
        <Stat label="Noites" value={String(r.nights)} note={`${r.weekendsWorked} dias de fim de semana`} />
        <Stat label="Seguidos, no máximo" value={`${r.longestStreak} ${r.longestStreak === 1 ? 'dia' : 'dias'}`} note="de trabalho sem folga" />
      </div>

      <div className="report-grid">
        <section className="card" aria-labelledby="r-weeks">
          <h2 id="r-weeks">Horas de turno por semana</h2>
          <div className="bars" role="img" aria-label={r.weeks.map((w) => `semana de ${parseLocal(w.start).getDate()}: ${fmtHours(w.minutes)}`).join('; ')}>
            {r.weeks.map((w) => {
              const d = parseLocal(w.start)
              const peak = w.minutes === maxWeek && w.minutes > 0
              return (
                <div key={w.start} className="bar-col" title={`Semana de ${d.getDate()}/${d.getMonth() + 1}: ${fmtHours(w.minutes)}`}>
                  <span className="bar-value">{peak || w.minutes === 0 ? fmtHours(w.minutes) : ''}</span>
                  <div className="bar-track">
                    <div className="bar" style={{ height: `${(w.minutes / maxWeek) * 100}%` }} />
                  </div>
                  <span className="bar-label">
                    {d.getDate()}/{d.getMonth() + 1}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="small muted">Semanas de segunda a domingo. Passa o rato (ou toca) numa barra para ver as horas.</p>
        </section>

        <section className="card" aria-labelledby="r-codes">
          <h2 id="r-codes">Turnos do mês</h2>
          {r.summary.counts.length === 0 ? (
            <p className="muted">Ainda sem turnos neste mês.</p>
          ) : (
            <ul className="code-list">
              {r.summary.counts.map((c) => (
                <li key={c.code}>
                  <span className="chip chip-shift" style={c.color ? { ['--chip' as string]: c.color } : undefined}>
                    {c.code}
                  </span>
                  <span>{c.label}</span>
                  <strong>{c.days}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="r-events">
          <h2 id="r-events">Agenda fora dos turnos</h2>
          <p>
            {r.eventCount} {r.eventCount === 1 ? 'evento' : 'eventos'}
            {r.conflicts > 0 && <span className="conflict-pill inline">{r.conflicts} sobreposições</span>}
          </p>
          {catTotal > 0 && (
            <ul className="code-list">
              {CATEGORIES.filter((c) => r.eventMinutes[c.id]).map((c) => (
                <li key={c.id}>
                  <span className={`seg-dot cat-${c.id}`} aria-hidden />
                  <span>{c.label}</span>
                  <strong>{fmtHours(r.eventMinutes[c.id] ?? 0)}</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">
            Tarefas: {r.tasksDone} concluídas e {r.tasksCreated} criadas neste mês.
          </p>
        </section>
      </div>

      <section className="card" aria-labelledby="r-pay">
        <h2 id="r-pay">Para conferir o vencimento</h2>
        <p className="small muted">
          Horas deste mês com acréscimo, com os nomes do talão. São pagas no talão de <strong>{payslip.toLowerCase()}</strong>. Noturno das 20h às 8h; sábado depois das 13h, domingos e
          feriados (nacionais e São Martinho). Não inclui trabalho suplementar.
        </p>
        <table className="report-table pay-table">
          <tbody>
            <tr>
              <th scope="row">TN noturno em dias úteis</th>
              <td className="num">{dec(pay.weekdayNight)} h</td>
            </tr>
            <tr>
              <th scope="row">TN sábado &gt;13h, domingo e feriado, diurno</th>
              <td className="num">{dec(pay.weekendDay)} h</td>
            </tr>
            <tr>
              <th scope="row">TN sábado, domingo e feriado, noturno</th>
              <td className="num">{dec(pay.weekendNight)} h</td>
            </tr>
            <tr>
              <th scope="row">Total de horas de turno</th>
              <td className="num">{dec(pay.total)} h</td>
            </tr>
          </tbody>
        </table>
        {pay.missingDays.length > 0 && (
          <p className="small pay-warn">
            Faltam turnos em {pay.missingDays.length} {pay.missingDays.length === 1 ? 'dia' : 'dias'} ({pay.missingDays.map((d) => parseLocal(d).getDate()).join(', ')}). Preenche-os em Turnos para o cálculo
            bater certo com o talão.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="r-days">
        <div className="card-head">
          <h2 id="r-days">Dia a dia</h2>
          <button className="btn btn-sm no-print" onClick={() => setShowDays(!showDays)} aria-expanded={showDays}>
            {showDays ? 'Esconder' : 'Mostrar'}
          </button>
        </div>
        <div className={showDays ? undefined : 'print-only'}>
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Dia</th>
                <th scope="col">Turno</th>
                <th scope="col" className="num">
                  Horas
                </th>
                <th scope="col" className="num">
                  Eventos
                </th>
              </tr>
            </thead>
            <tbody>
              {r.days.map((d) => {
                const date = parseLocal(d.date)
                return (
                  <tr key={d.date} className={d.weekend ? 'is-weekend' : undefined}>
                    <td>
                      {weekdayShort(date)} {date.getDate()}
                    </td>
                    <td>
                      {d.code ?? '–'}
                      {d.label && <span className="muted"> · {d.label}</span>}
                    </td>
                    <td className="num">{d.workMinutes ? fmtHours(d.workMinutes) : ''}</td>
                    <td className="num">{d.events || ''}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td>{r.summary.workDays} dias</td>
                <td className="num">{fmtHours(r.summary.workedMinutes)}</td>
                <td className="num">{r.eventCount}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="stat card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="small muted">{note}</span>
    </div>
  )
}
