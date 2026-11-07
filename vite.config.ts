import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

// Göreli base: aynı build Pages alt klasöründe ve yerelde çalışır.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {environment: 'node', include: ['tests/**/*.test.{ts,mjs}']},
} as never)
