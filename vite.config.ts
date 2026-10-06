import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

function gitCommit(): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''
    return dirty ? `${hash}-dirty` : hash
  } catch {
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo at /garden-planner/, so the production
  // build needs that base path; the dev server keeps serving from /.
  // PR preview builds override it (VITE_BASE) with their own subfolder.
  base: command === 'build' ? (process.env.VITE_BASE ?? '/garden-planner/') : '/',
  plugins: [react()],
  define: { __APP_COMMIT__: JSON.stringify(gitCommit()) },
}))
