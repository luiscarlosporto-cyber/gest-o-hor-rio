import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Em produção a app vive em https://luiscarlosporto-cyber.github.io/gest-o-hor-rio/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/gest-o-hor-rio/' : '/',
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Bibliotecas em ficheiros à parte: mudam pouco, ficam em cache entre versões da app.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
            { name: 'datas', test: /node_modules[\\/](date-fns|rrule)[\\/]/ },
          ],
        },
      },
    },
  },
}))
