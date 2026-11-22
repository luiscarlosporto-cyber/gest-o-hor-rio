import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Em produção a app vive em https://luiscarlosporto-cyber.github.io/gest-o-hor-rio/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/gest-o-hor-rio/' : '/',
  plugins: [react()],
}))
