import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // e2e/ is Playwright's (npm run test:e2e), not vitest's.
    include: ['src/**/*.test.ts'],
  },
});
