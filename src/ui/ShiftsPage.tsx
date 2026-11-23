import { useMemo, useState } from 'react'
import { addMonths, daysInMonth, formatMonthYear, monthGrid, toDateKey, weekdayShort } from '../domain/dates'
import { mergeShiftDays, parseRosterLine, shiftErrors, summarizeMonth, findType, type RosterParseResult } from '../domain/shifts'
import type { AppData, ShiftDay, ShiftType } from '../domain/types'
import { SisqualImport } from './SisqualImport'

interface Props {
  data: AppData
  cursor: Date
  setCursor: (d: Date) => void
  update: (fn: (d: AppData) => AppData) => void
}

const fmtHours = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`

export function ShiftsPage({ data, cursor, setCursor, update }: Props) {
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const [paste, setPaste] = useState('')
  const [skipFirst, setSkipFirst] = useState(true)
  const [preview, setPreview] = useState<RosterParseResult | null>(null)

  const byDate = useMemo(() => new Map(data.shiftDays.map((d) => [d.date, d.code])), [data.shiftDays])
  const extras = useMemo(() => new Set(data.shiftDays.filter((d) => d.extra).map((d) => d.date)), [data.shiftDays])
  const summary = useMemo(() => summarizeMonth(data.shiftDays, data.shiftTypes, year, month), [data, year, month])
  const grid = monthGrid(cursor)
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`
  const errors = useMemo(() => shiftErrors(data.shiftDays, data.shiftTypes).filter((e) => e.date.startsWith(monthPrefix)), [data.shiftDays, data.shiftTypes, monthPrefix])
  const errorDates = new Set(errors.map((e) => e.date))

  const setDay = (date: string, code: string) =>
    update((d) => ({ ...d, shiftDays: mergeShiftDays(d.shiftDays, [extras.has(date) ? { date, code, extra: true } : { date, code }]) }))
  const toggleExtra = (date: string) =>
    update((d) => ({ ...d, shiftDays: d.shiftDays.map((s) => (s.date !== date ? s : s.extra ? { date: s.date, code: s.code } : { ...s, extra: true })) }))

  const doPreview = () => setPreview(parseRosterLine(paste, year, month, data.shiftTypes, { skipFirst: skipFirst ? 1 : 0 }))

  const apply = () => {
    if (!preview) return
    update((d) => ({ ...d, shiftDays: mergeShiftDays(d.shiftDays, preview.days) }))
    setPreview(null)
    setPaste('')
  }

  const clearMonth = () => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
    update((d) => ({ ...d, shiftDays: d.shiftDays.filter((s) => !s.date.startsWith(prefix)) }))
  }

  const total = daysInMonth(year, month)
  const filled = data.shiftDays.filter((d) => d.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`)).length

  return (
    <div className="page">
      <header className="toolbar">
        <div className="toolbar-group">
          <button className="icon-btn" onClick={() => setCursor(addMonths(cursor, -1))} aria-label="Mês anterior">
            ‹
          </button>
          <button className="icon-btn" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Mês seguinte">
            ›
          </button>
          <h1 className="toolbar-title">Turnos · {formatMonthYear(cursor)}</h1>
        </div>
        <span className="muted">
          {filled} de {total} dias preenchidos
        </span>
      </header>

      <div className="shifts-layout">
        <section className="card">
          <h2>Carregar o mês</h2>
          <SisqualImport data={data} update={update} onApplied={setCursor} />
          <h3>Ou colar a linha</h3>
          <p className="muted">
            Cola a tua linha do horário (por exemplo copiada do PDF SISQUAL), com um código por dia. Vês o resultado antes de gravar.
          </p>
          <textarea
            className="mono"
            rows={3}
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value)
              setPreview(null)
            }}
            placeholder="D  MT2  N  D  DS  M  …"
            aria-label="Linha do horário"
          />
          <label className="check">
            <input type="checkbox" checked={skipFirst} onChange={(e) => (setSkipFirst(e.target.checked), setPreview(null))} />
            A primeira coluna é o último dia do mês anterior (ignorar)
          </label>
          <div className="row-actions">
            <button className="btn" onClick={doPreview} disabled={!paste.trim()}>
              Pré-visualizar
            </button>
            {preview && (
              <button className="btn btn-primary" onClick={apply} disabled={preview.days.length === 0}>
                Gravar {preview.days.length} dias
              </button>
            )}
          </div>
          {preview && (
            <div className="preview">
              {preview.countDelta !== 0 && (
                <div className="warn">
                  {preview.countDelta < 0
                    ? `Faltam ${-preview.countDelta} dias: só serão gravados os primeiros ${preview.days.length}.`
                    : `Há ${preview.countDelta} códigos a mais; foram ignorados os últimos.`}
                </div>
              )}
              {preview.unknown.length > 0 && (
                <div className="warn">
                  Códigos que não conheço: <strong>{preview.unknown.join(', ')}</strong>. Ficam como dia inteiro; podes criá-los em baixo.
                </div>
              )}
              <div className="preview-strip">
                {preview.days.map((d) => (
                  <ShiftBadge key={d.date} day={d} types={data.shiftTypes} />
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Resumo do mês</h2>
          <div className="summary-big">
            <div>
              <strong>{summary.workDays}</strong>
              <span>dias de trabalho</span>
            </div>
            <div>
              <strong>{fmtHours(summary.workedMinutes)}</strong>
              <span>horas de turno</span>
            </div>
          </div>
          <ul className="legend">
            {summary.counts.map((c) => (
              <li key={c.code}>
                <span className="swatch" style={{ background: c.color ?? 'var(--line)' }} />
                <strong>{c.code}</strong>
                <span className="muted">{c.label}</span>
                <span className="legend-n">{c.days}</span>
              </li>
            ))}
            {summary.counts.length === 0 && <li className="muted">Ainda sem turnos neste mês.</li>}
          </ul>
          {filled > 0 && (
            <button className="btn btn-danger-ghost" onClick={clearMonth}>
              Limpar o mês
            </button>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Editar dia a dia</h2>
        {errors.length > 0 && (
          <p className="warn" role="alert">
            {errors.length === 1 ? 'Há um erro' : `Há ${errors.length} erros`} no horário: o D tem de vir logo a seguir a uma N. Vê{' '}
            {errors.map((e) => Number(e.date.slice(8))).join(', ')}.
          </p>
        )}
        <div className="shift-grid" role="grid">
          {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((h) => (
            <div key={h} className="shift-grid-head">
              {h}
            </div>
          ))}
          {grid.map((d) => {
            const key = toDateKey(d)
            const code = byDate.get(key) ?? ''
            const type = findType(data.shiftTypes, code)
            const outside = d.getMonth() !== month
            return (
              <label
                key={key}
                className={`shift-cell${outside ? ' is-outside' : ''}${errorDates.has(key) ? ' is-error' : ''}`}
                title={errors.find((e) => e.date === key)?.message}
                style={type ? { ['--chip' as string]: type.color } : undefined}
              >
                <span className="shift-cell-day">
                  {d.getDate()} <span className="muted">{weekdayShort(d)}</span>
                </span>
                <select value={code} onChange={(e) => setDay(key, e.target.value)} aria-label={`Turno do dia ${key}`}>
                  <option value="">—</option>
                  {data.shiftTypes.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code}
                    </option>
                  ))}
                  {code && !type && <option value={code}>{code}</option>}
                </select>
                {type?.work && (
                  <button
                    type="button"
                    className={`shift-extra${extras.has(key) ? ' is-on' : ''}`}
                    onClick={(e) => {
                      e.preventDefault()
                      toggleExtra(key)
                    }}
                    aria-pressed={extras.has(key)}
                    title="Turno extra (trabalho suplementar)"
                  >
                    Extra
                  </button>
                )}
              </label>
            )
          })}
        </div>
      </section>

      <ShiftTypesEditor types={data.shiftTypes} onChange={(shiftTypes) => update((d) => ({ ...d, shiftTypes }))} />
    </div>
  )
}

function ShiftBadge({ day, types }: { day: ShiftDay; types: ShiftType[] }) {
  const t = findType(types, day.code)
  return (
    <span className={`badge${t ? '' : ' is-unknown'}`} style={t ? { ['--chip' as string]: t.color } : undefined} title={day.date}>
      <small>{Number(day.date.slice(8))}</small>
      {day.code}
    </span>
  )
}

function ShiftTypesEditor({ types, onChange }: { types: ShiftType[]; onChange: (t: ShiftType[]) => void }) {
  const [draft, setDraft] = useState<ShiftType>({ code: '', label: '', color: '#B4C7E7', work: true, start: '', end: '' })
  const set = (i: number, patch: Partial<ShiftType>) => onChange(types.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const add = () => {
    const code = draft.code.trim()
    if (!code || types.some((t) => t.code === code)) return
    onChange([...types, { ...draft, code, label: draft.label.trim() || code, start: draft.start || undefined, end: draft.end || undefined }])
    setDraft({ code: '', label: '', color: '#B4C7E7', work: true, start: '', end: '' })
  }
  return (
    <section className="card">
      <h2>Tipos de turno</h2>
      <p className="muted">Sem horas = dia inteiro (descanso, folga, férias). Se o fim for antes do início, o turno acaba no dia seguinte.</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th>Início</th>
              <th>Fim</th>
              <th>Horas contadas</th>
              <th>Cor</th>
              <th>Trabalho</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {types.map((t, i) => (
              <tr key={t.code}>
                <td>
                  <strong>{t.code}</strong>
                </td>
                <td>
                  <input value={t.label} onChange={(e) => set(i, { label: e.target.value })} aria-label={`Descrição de ${t.code}`} />
                </td>
                <td>
                  <input type="time" value={t.start ?? ''} onChange={(e) => set(i, { start: e.target.value || undefined })} aria-label={`Início de ${t.code}`} />
                </td>
                <td>
                  <input type="time" value={t.end ?? ''} onChange={(e) => set(i, { end: e.target.value || undefined })} aria-label={`Fim de ${t.code}`} />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    className="hours-input"
                    value={t.paidHours ?? ''}
                    placeholder="todas"
                    disabled={!t.start || !t.end}
                    onChange={(e) => set(i, { paidHours: e.target.value ? Number(e.target.value) : undefined })}
                    aria-label={`Horas contadas de ${t.code}`}
                  />
                </td>
                <td>
                  <input type="color" value={t.color} onChange={(e) => set(i, { color: e.target.value })} aria-label={`Cor de ${t.code}`} />
                </td>
                <td>
                  <input type="checkbox" checked={t.work} onChange={(e) => set(i, { work: e.target.checked })} aria-label={`${t.code} é trabalho`} />
                </td>
                <td>
                  <button className="icon-btn" onClick={() => onChange(types.filter((_, j) => j !== i))} aria-label={`Remover ${t.code}`}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="Cgs" aria-label="Novo código" />
              </td>
              <td>
                <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Descrição" aria-label="Nova descrição" />
              </td>
              <td>
                <input type="time" value={draft.start ?? ''} onChange={(e) => setDraft({ ...draft, start: e.target.value })} aria-label="Novo início" />
              </td>
              <td>
                <input type="time" value={draft.end ?? ''} onChange={(e) => setDraft({ ...draft, end: e.target.value })} aria-label="Novo fim" />
              </td>
              <td />
              <td>
                <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} aria-label="Nova cor" />
              </td>
              <td>
                <input type="checkbox" checked={draft.work} onChange={(e) => setDraft({ ...draft, work: e.target.checked })} aria-label="Novo é trabalho" />
              </td>
              <td>
                <button className="btn btn-primary btn-sm" onClick={add} disabled={!draft.code.trim()}>
                  Adicionar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
