import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at /garden-planner/, so the production
  // build needs that base path; the dev server keeps serving from /.
  // PR preview builds override it (VITE_BASE) with their own subfolder.
  base: command === 'build' ? (process.env.VITE_BASE ?? '/garden-planner/') : '/',
  plugins: [react()],
}))
