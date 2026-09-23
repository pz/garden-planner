import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at /garden-planner/, so the production
  // build needs that base path; the dev server keeps serving from /.
  base: command === 'build' ? '/garden-planner/' : '/',
  plugins: [react()],
}))
