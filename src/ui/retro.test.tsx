import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { emptyData } from '../data/store'
import type { AppData } from '../domain/types'
import { RetroPage } from './RetroPage'

function Harness({ initial }: { initial: AppData }) {
  const [data, setData] = useState(initial)
  return <RetroPage data={data} update={(fn) => setData((d) => fn(d))} />
}

describe('ecrã Retroativos', () => {
  it('cria o retroativo e mostra devido, recebido e falta por ano (valores inventados)', async () => {
    const user = userEvent.setup()
    const data: AppData = {
      ...emptyData(),
      payslips: [
        {
          year: 2026,
          month: 0,
          earnings: [{ code: '710 310', label: 'Prémio (em valor) - retro', ref: '2020-01', amount: 100 }],
          deductions: [],
          gross: 0,
          totalDeductions: 0,
          net: 0,
        },
      ],
    }
    render(<Harness initial={data} />)
    expect(screen.getByRole('heading', { name: 'Novo retroativo' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Primeiro mês devido'), { target: { value: '2020-01' } })
    fireEvent.change(screen.getByLabelText('Último mês devido'), { target: { value: '2020-03' } })
    await user.type(screen.getByLabelText('2020'), '300,00')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('progressbar', { name: 'Recebido do total devido' })).toHaveAttribute('aria-valuenow', '33')
    expect(screen.getByText(/1 mês pago, 2 em falta \(a partir de fev\/2020\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /2020/ }))
    expect(screen.getByText('mar/2020')).toBeInTheDocument()
  })
})
