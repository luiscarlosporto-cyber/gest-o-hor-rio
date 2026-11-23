import { defineConfig, devices } from '@playwright/test'

// Teste de ponta a ponta: a app publicada (build) num telemóvel e num computador, sem conta.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173/gest-o-hor-rio/', locale: 'pt-PT', timezoneId: 'Europe/Lisbon', trace: 'off' },
  projects: [
    { name: 'telemovel', use: { ...devices['Pixel 7'] } },
    { name: 'computador', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/gest-o-hor-rio/', reuseExistingServer: !process.env.CI },
})
