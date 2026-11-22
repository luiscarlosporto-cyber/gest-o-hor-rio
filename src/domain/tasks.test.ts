import { describe, expect, it } from 'vitest'
import { addTask, groupTasks, parseQuickTask, pendingCount, toggleTask, updateTask } from './tasks'

// Domingo, 22 de novembro de 2026, 21:00
const now = new Date(2026, 10, 22, 21, 0)

describe('frase rápida', () => {
  it('lê amanhã, hora e prioridade', () => {
    expect(parseQuickTask('Ligar à Ana amanhã 14h !', now)).toEqual({ title: 'Ligar à Ana', due: '2026-11-23', dueTime: '14:00', priority: 'alta' })
  })
  it('lê dia da semana e hora com minutos', () => {
    expect(parseQuickTask('Entregar relatório sexta 9h30', now)).toMatchObject({ title: 'Entregar relatório', due: '2026-11-27', dueTime: '09:30' })
    expect(parseQuickTask('Reunião na segunda às 10', now)).toMatchObject({ title: 'Reunião', due: '2026-11-23', dueTime: '10:00' })
  })
  it('lê datas dd/mm e passa para o ano seguinte se já passou', () => {
    expect(parseQuickTask('Prenda 25/12', now).due).toBe('2026-12-25')
    expect(parseQuickTask('Seguro 10/01', now).due).toBe('2027-01-10')
    expect(parseQuickTask('Exame 31/02', now).due).toBeUndefined()
  })
  it('hora sem data é para hoje; sem nada fica sem data', () => {
    expect(parseQuickTask('Tomar medicação 22:00', now)).toMatchObject({ due: '2026-11-22', dueTime: '22:00' })
    expect(parseQuickTask('Ter cuidado com o carro', now)).toEqual({ title: 'Ter cuidado com o carro', priority: 'normal', due: undefined, dueTime: undefined })
  })
})

describe('lista de tarefas', () => {
  const base = [
    { title: 'Atrasada', due: '2026-11-20' },
    { title: 'Hoje passou', due: '2026-11-22', dueTime: '08:00' },
    { title: 'Hoje', due: '2026-11-22', dueTime: '23:00' },
    { title: 'Amanhã', due: '2026-11-23' },
    { title: 'Sem data alta', priority: 'alta' as const },
    { title: 'Sem data' },
  ].reduce((acc, t) => addTask(acc, t, now), [] as ReturnType<typeof addTask>)

  it('agrupa por atrasadas, hoje, próximas e sem data', () => {
    const g = groupTasks(base, now)
    expect(g.overdue.map((t) => t.title)).toEqual(['Atrasada', 'Hoje passou'])
    expect(g.today.map((t) => t.title)).toEqual(['Hoje'])
    expect(g.upcoming.map((t) => t.title)).toEqual(['Amanhã'])
    expect(g.someday.map((t) => t.title)).toEqual(['Sem data alta', 'Sem data'])
    expect(pendingCount(base, now)).toBe(3)
  })

  it('concluir e reabrir guarda a data de conclusão', () => {
    const id = base[0].id
    const done = toggleTask(base, id, now)
    expect(done[0]).toMatchObject({ done: true, doneAt: now.toISOString() })
    expect(groupTasks(done, now).done).toHaveLength(1)
    expect(toggleTask(done, id, now)[0]).toMatchObject({ done: false, doneAt: undefined })
  })

  it('tirar a data também tira a hora', () => {
    const id = base[2].id
    expect(updateTask(base, id, { due: undefined }, now).find((t) => t.id === id)).toMatchObject({ due: undefined, dueTime: undefined })
  })
})
