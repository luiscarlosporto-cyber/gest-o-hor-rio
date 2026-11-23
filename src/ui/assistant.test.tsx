import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emptyData } from '../data/store'
import type { AppData } from '../domain/types'

vi.mock('../data/assistant', () => ({
  assistantReady: () => Promise.resolve(true),
  logDecision: vi.fn(() => Promise.resolve()),
  askAssistant: vi.fn(() =>
    Promise.resolve({
      reply: 'Tens folga na quinta. Proponho o dentista às 10h.',
      proposals: [
        { kind: 'event', title: 'Dentista', start: '2026-11-26T10:00', end: '2026-11-26T11:00', allDay: false, category: 'pessoal', location: null, due: null, dueTime: null, priority: null, notes: null, why: 'Quinta é folga.' },
        { kind: 'task', title: 'Levar exames', start: null, end: null, allDay: null, category: null, location: null, due: '2026-11-25', dueTime: null, priority: 'alta', notes: null, why: '' },
      ],
    }),
  ),
}))

import { AssistantPage } from './AssistantPage'

describe('ecrã do assistente', () => {
  it('pede consentimento, mostra propostas e só grava o que for aceite', async () => {
    localStorage.clear()
    let data: AppData = emptyData()
    const update = (fn: (d: AppData) => AppData) => (data = fn(data))
    render(<AssistantPage data={data} update={update} signedIn />)
    fireEvent.click(await screen.findByRole('button', { name: 'Percebi, continuar' }))
    fireEvent.change(screen.getByLabelText('Pergunta ao assistente'), { target: { value: 'Marca dentista' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByText(/Proponho o dentista/)).toBeTruthy()
    expect(data.events).toHaveLength(0)
    const add = screen.getAllByRole('button', { name: 'Adicionar' })
    fireEvent.click(add[0])
    expect(data.events.map((e) => e.title)).toEqual(['Dentista'])
    fireEvent.click(screen.getByRole('button', { name: 'Ignorar' }))
    expect(data.tasks).toHaveLength(0)
    expect(screen.getByText('Adicionado.')).toBeTruthy()
    expect(screen.getByText('Ignorado.')).toBeTruthy()
  })
})
