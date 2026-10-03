import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/web'),
  plugins: [react()],
  build: { outDir: path.resolve(import.meta.dirname, 'dist/web'), emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
})
