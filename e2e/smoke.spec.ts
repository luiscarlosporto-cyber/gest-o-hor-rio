import { expect, test } from '@playwright/test'

// Percorre os ecrãs principais sem conta (dados guardados neste navegador).
test('abre, navega, cria uma tarefa e guarda-a depois de recarregar', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('./')
  const nav = page.getByRole('navigation', { name: 'Navegação' })
  await expect(nav).toBeVisible()

  for (const name of [/Calendário|Agenda/, /Turnos/, /Relatórios/, /Definições/]) {
    const direct = nav.getByRole('button', { name })
    if (await direct.isVisible()) await direct.click()
    else {
      // No telemóvel, Relatórios e Definições ficam dentro de "Mais".
      await nav.getByRole('button', { name: 'Mais' }).click()
      await page.getByRole('menuitem', { name }).click()
      await expect(page.getByRole('menu')).toHaveCount(0)
    }
    await expect(page.locator('.page-loading')).toHaveCount(0)
    await expect(page.locator('h1').first()).toBeVisible()
  }

  await nav.getByRole('button', { name: /Tarefas/ }).click()
  await page.getByLabel('Nova tarefa').fill('Teste de ponta a ponta amanhã 10h')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect(page.getByText('Teste de ponta a ponta')).toBeVisible()

  await page.reload()
  await page.getByRole('navigation', { name: 'Navegação' }).getByRole('button', { name: /Tarefas/ }).click()
  await expect(page.getByText('Teste de ponta a ponta')).toBeVisible()

  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(errors).toEqual([])
})

test('sem horizontal scroll no telemóvel', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'só no telemóvel')
  await page.goto('./')
  await expect(page.getByRole('navigation', { name: 'Navegação' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
