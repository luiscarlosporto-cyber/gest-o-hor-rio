import { useMemo, useState } from 'react'
import { formatLongDate, parseLocal } from '../domain/dates'
import { chipStyle } from '../domain/shiftFamily'
import { findType } from '../domain/shifts'
import { applySwap, parseSwapText, planSwap } from '../domain/shiftSwap'
import type { AppData } from '../domain/types'

interface Props {
  data: AppData
  /** Mês aberto em Turnos: os dias escritos sem mês são deste mês. */
  year: number
  month: number
  update: (fn: (d: AppData) => AppData) => void
  onClose: () => void
}

/** Trocas de turno: escreve-se "4 T, 5 M, 6 N", vê-se o antes e o depois e grava-se de uma vez. */
export function ShiftSwap({ data, year, month, update, onClose }: Props) {
  const [text, setText] = useState('')
  const parsed = useMemo(() => parseSwapText(text, year, month, data.shiftTypes), [text, year, month, data.shiftTypes])
  const plan = useMemo(() => planSwap(data.shiftDays, data.shiftTypes, parsed.changes), [data.shiftDays, data.shiftTypes, parsed.changes])
  const monthLabel = new Date(year, month, 1).toLocaleDateString('pt-PT', { month: 'long' })

  const chip = (code: string) => {
    if (!code) return <span className="muted">sem turno</span>
    const t = findType(data.shiftTypes, code)
    return (
      <span className="chip chip-shift" style={chipStyle(t?.color)} title={t?.label}>
        {code}
      </span>
    )
  }

  const save = () => {
    update((d) => ({ ...d, shiftDays: applySwap(d.shiftDays, plan) }))
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shift-swap" role="dialog" aria-modal="true" aria-label="Trocar turnos">
        <div className="modal-head">
          <h2>Trocar turnos</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <p className="muted small">
          Escreve o dia e o turno que vais fazer, por exemplo “4 T, 5 M, 6 N”. Os dias sem mês são de {monthLabel}; para outro mês escreve
          “4/1 M”. “Folga” ou “-” também servem. Dois códigos no mesmo dia, como “24 D N”, ficam como no SISQUAL: fica o turno feito (N) e a
          saída da noite anterior continua a contar.
        </p>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="4 T, 5 M, 6 N"
          aria-label="Trocas a fazer"
          autoComplete="off"
          autoFocus
        />

        {parsed.unknown.length > 0 && (
          <p className="warn" role="alert">
            Não conheço: <strong>{parsed.unknown.join(', ')}</strong>. Usa os códigos do teu horário (M, T, N, MT2, D…).
          </p>
        )}

        {plan.rows.length > 0 && (
          <ul className="swap-rows" aria-label="Antes e depois">
            {plan.rows.map((r) => (
              <li key={r.date} className={r.auto ? 'is-auto' : undefined}>
                <span className="swap-date">{formatLongDate(parseLocal(r.date))}</span>
                <span className="swap-codes">
                  {chip(r.before)}
                  <span aria-label="passa a">→</span>
                  {chip(r.after)}
                </span>
                {r.auto && <span className="muted small swap-auto">{r.auto}</span>}
              </li>
            ))}
          </ul>
        )}

        {plan.warnings.length > 0 && (
          <ul className="swap-warnings" role="status">
            {plan.warnings.map((w) => (
              <li key={w.date + w.message}>
                <strong>{formatLongDate(parseLocal(w.date))}:</strong> {w.message}
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={plan.rows.length === 0} onClick={save}>
            {plan.rows.length === 1 ? 'Gravar 1 dia' : `Gravar ${plan.rows.length} dias`}
          </button>
        </div>
      </div>
    </div>
  )
}
