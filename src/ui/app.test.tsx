import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { emptyData, type DataStore } from '../data/store'
import type { AppData } from '../domain/types'

class MemoryStore implements DataStore {
  readonly kind = 'local' as const
  data: AppData
  constructor(data: AppData = emptyData()) {
    this.data = data
  }
  async load() {
    return this.data
  }
  async save(d: AppData) {
    this.data = d
  }
}

describe('app', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 23, 9, 0)) // segunda, 23/11/2026
  })

  it('cria um evento a partir do botão Novo e grava-o', async () => {
    const store = new MemoryStore()
    const user = userEvent.setup()
    render(<App store={store} />)
    await user.click(within(await screen.findByRole('navigation')).getByRole('button', { name: 'Calendário' }))
    await user.click(await screen.findByRole('button', { name: '+ Novo' }))
    const dialog = screen.getByRole('dialog', { name: 'Novo evento' })
    await user.type(within(dialog).getByLabelText('Título'), 'Reunião de equipa')
    await user.click(within(dialog).getByRole('button', { name: 'Gravar' }))
    await waitFor(() => expect(store.data.events).toHaveLength(1))
    expect(store.data.events[0]).toMatchObject({ title: 'Reunião de equipa', category: 'reuniao', start: '2026-11-23T09:30' })
    expect(screen.getAllByText('Reunião de equipa').length).toBeGreaterThan(0)
  })

  it('avisa da sobreposição com um turno antes de gravar', async () => {
    const store = new MemoryStore({ ...emptyData(), shiftDays: [{ date: '2026-11-23', code: 'M' }] })
    const user = userEvent.setup()
    render(<App store={store} />)
    await user.click(within(await screen.findByRole('navigation')).getByRole('button', { name: 'Calendário' }))
    await user.click(await screen.findByRole('button', { name: '+ Novo' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Título'), 'Dentista')
    expect(within(dialog).getByRole('status')).toHaveTextContent('Sobreposição')
    expect(within(dialog).getByRole('status')).toHaveTextContent('M (08:30–15:30)')
  })

  it('carrega o mês de turnos colando a linha do horário, com pré-visualização', async () => {
    const store = new MemoryStore()
    const user = userEvent.setup()
    render(<App store={store} />)
    await user.click(within(await screen.findByRole('navigation')).getByRole('button', { name: 'Turnos' }))
    const line = ['D', 'MT2', 'N', ...Array(28).fill('D')].join(' ') // 1 + 30 dias de novembro
    await user.type(await screen.findByLabelText('Linha do horário'), line)
    await user.click(screen.getByRole('button', { name: 'Pré-visualizar' }))
    expect(store.data.shiftDays).toHaveLength(0) // ainda não gravou
    await user.click(screen.getByRole('button', { name: 'Gravar 30 dias' }))
    await waitFor(() => expect(store.data.shiftDays).toHaveLength(30))
    expect(store.data.shiftDays[0]).toEqual({ date: '2026-11-01', code: 'MT2' })
    expect(store.data.shiftDays[1]).toEqual({ date: '2026-11-02', code: 'N' })
    expect(screen.getByText('dias de trabalho').previousSibling).toHaveTextContent('2')
  })

  it('edita só uma ocorrência de uma série', async () => {
    const store = new MemoryStore({
      ...emptyData(),
      events: [
        {
          id: 's',
          title: 'Passagem de turno',
          start: '2026-11-23T08:00',
          end: '2026-11-23T08:30',
          allDay: false,
          category: 'trabalho',
          rrule: 'FREQ=DAILY',
          createdAt: '',
          updatedAt: '',
        },
      ],
    })
    const user = userEvent.setup()
    render(<App store={store} />)
    await user.click(within(await screen.findByRole('navigation')).getByRole('button', { name: 'Calendário' }))
    const events = await screen.findAllByRole('button', { name: /Passagem de turno/ })
    await user.click(events[1]) // terça
    const dialog = screen.getByRole('dialog')
    const title = within(dialog).getByLabelText('Título')
    await user.clear(title)
    await user.type(title, 'Passagem (formação)')
    await user.click(within(dialog).getByRole('button', { name: 'Gravar' }))
    await user.click(within(dialog).getByRole('button', { name: 'Só esta ocorrência' }))
    await waitFor(() => expect(store.data.events).toHaveLength(2))
    expect(store.data.events[0].exdates).toEqual(['2026-11-24'])
    expect(store.data.events[1]).toMatchObject({ title: 'Passagem (formação)', recurringEventId: 's', originalDate: '2026-11-24' })
  })

  it('muda de vista e pesquisa', async () => {
    const store = new MemoryStore({
      ...emptyData(),
      events: [
        { id: 'a', title: 'Consulta médica', start: '2026-12-10T10:00', end: '2026-12-10T11:00', allDay: false, category: 'pessoal', createdAt: '', updatedAt: '' },
      ],
    })
    const user = userEvent.setup()
    render(<App store={store} />)
    await user.click(within(await screen.findByRole('navigation')).getByRole('button', { name: 'Calendário' }))
    await user.click(await screen.findByRole('tab', { name: 'Mês' }))
    expect(screen.getByRole('heading', { name: 'Novembro 2026' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Pesquisar'), 'medica')
    expect(screen.getByText('1 resultado para “medica”')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Consulta médica/ }))
    expect(screen.getByRole('heading', { name: 'Quinta-feira, 10 de dezembro' })).toBeInTheDocument()
  })

  it('pesquisa em toda a app e abre o dia do compromisso', async () => {
    const store = new MemoryStore({
      ...emptyData(),
      events: [
        { id: 'a', title: 'Consulta médica', start: '2026-12-10T10:00', end: '2026-12-10T11:00', allDay: false, category: 'pessoal', createdAt: '', updatedAt: '' },
      ],
    })
    const user = userEvent.setup()
    render(<App store={store} />)
    await user.click(await screen.findByRole('button', { name: 'Pesquisar em toda a app' }))
    const dialog = screen.getByRole('dialog', { name: 'Pesquisar em toda a app' })
    await user.type(within(dialog).getByLabelText('Pesquisar'), 'medica')
    expect(within(dialog).getByRole('status')).toHaveTextContent('1 resultado')
    await user.click(within(dialog).getByRole('button', { name: /Consulta médica/ }))
    expect(await screen.findByRole('heading', { name: 'Quinta-feira, 10 de dezembro' })).toBeInTheDocument()
  })

  it('cria uma tarefa por frase rápida, conclui-a e mostra o número no menu', async () => {
    const store = new MemoryStore()
    const user = userEvent.setup()
    render(<App store={store} />)
    await user.click(within(await screen.findByRole('navigation')).getByRole('button', { name: /^Tarefas/ }))
    await user.type(await screen.findByLabelText('Nova tarefa'), 'Entregar escala hoje 18h !')
    expect(screen.getByText(/prioridade alta/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() => expect(store.data.tasks).toHaveLength(1))
    expect(store.data.tasks[0]).toMatchObject({ title: 'Entregar escala', due: '2026-11-23', dueTime: '18:00', priority: 'alta', done: false })
    expect(within(screen.getByRole('navigation')).getByLabelText('1 para hoje ou atrasadas')).toHaveTextContent('1')
    await user.click(screen.getByRole('checkbox', { name: 'Concluir Entregar escala' }))
    await waitFor(() => expect(store.data.tasks[0].done).toBe(true))
    expect(screen.getByText('Tudo feito')).toBeInTheDocument()
  })

  it('abre no Início com o turno de hoje e mostra o relatório do mês', async () => {
    const store = new MemoryStore({ ...emptyData(), shiftDays: [{ date: '2026-11-23', code: 'MT2' }, { date: '2026-11-24', code: 'D' }] })
    const user = userEvent.setup()
    render(<App store={store} />)
    expect(await screen.findByRole('heading', { name: 'Bom dia' })).toBeInTheDocument()
    expect(screen.getByText('A decorrer, termina às 22:30')).toBeInTheDocument()
    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Relatórios' }))
    expect(await screen.findByRole('heading', { name: /Relatório · Novembro 2026/ })).toBeInTheDocument()
    expect(screen.getAllByText('14h').length).toBeGreaterThan(0)
  })
})
