import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    // The news & updates signup posts to the local API server
    // (`npm run dev:server`, port 8080). Without it running, the form
    // degrades to its error state — the rest of the app is unaffected.
    proxy: { '/api': 'http://localhost:8080' }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/styles/**', 'src/main.jsx']
    }
  }
})