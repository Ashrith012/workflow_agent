import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  // Same-origin /api/* in dev; the Fastify server (npm run dev:server) listens on 3001.
  server: { proxy: { '/api': 'http://localhost:3001' } },
})
