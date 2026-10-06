import { defineConfig } from '@playwright/test';

const PORT = 5199;

// Browser smoke tests against the real app. They pin the user-visible behavior that unit tests
// can't (gestures, rendering, persistence), so refactors of the state layer can be made safely.
// Run with `npm run test:e2e`; set PW_CHROMIUM_PATH to use an already-installed Chromium.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1300, height: 850 },
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
