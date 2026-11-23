import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// Acessibilidade (WCAG 2.1 AA) dos ecrãs principais, com dados fictícios neste navegador.
const SAMPLE = {
  shiftDays: [
    { date: '2026-11-23', code: 'N' },
    { date: '2026-11-24', code: 'D' },
    { date: '2026-11-25', code: 'DS' },
    { date: '2026-11-26', code: 'T' },
    { date: '2026-11-27', code: 'MT2', extra: true },
    { date: '2026-11-28', code: 'M' },
    { date: '2026-11-29', code: 'L' },
  ],
  events: [{ id: 'e1', title: 'Dentista', start: '2026-11-23T10:00', end: '2026-11-23T11:00', allDay: false, category: 'pessoal', updatedAt: '2026-11-20T00:00:00Z' }],
  tasks: [{ id: 't1', title: 'Entregar declaração', due: '2026-11-23', priority: 'alta', done: false, createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z' }],
}

const SCREENS: { name: string; nav?: RegExp }[] = [
  { name: 'início' },
  { name: 'calendário', nav: /Calendário/ },
  { name: 'turnos', nav: /^Turnos$/ },
  { name: 'tarefas', nav: /Tarefas/ },
]

for (const scheme of ['light', 'dark'] as const) {
  test(`sem falhas graves de acessibilidade (${scheme === 'light' ? 'claro' : 'escuro'})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.clock.setFixedTime(new Date(2026, 10, 23, 18, 40))
    await page.addInitScript((v) => localStorage.getItem('gestao-horario:v1') || localStorage.setItem('gestao-horario:v1', v), JSON.stringify(SAMPLE))
    await page.goto('./')
    const nav = page.getByRole('navigation', { name: 'Navegação' })
    for (const s of SCREENS) {
      if (s.nav) await nav.getByRole('button', { name: s.nav }).click()
      await expect(page.locator('.page-loading')).toHaveCount(0)
      await page.waitForTimeout(250) // fim da animação de entrada
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      const bad = r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${s.name}: ${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
      expect(bad, bad.join('\n')).toEqual([])
    }
  })
}
