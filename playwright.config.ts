import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /hmr\.test\.ts/,
    },
    {
      // HMR tests mutate fixture files on disk — run them serially after
      // all other tests to avoid corrupting the shared dev server state.
      name: 'hmr',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /hmr\.test\.ts/,
      dependencies: ['chromium'],
    },
  ],
  webServer: {
    command: 'pnpm exec vite --config tests/fixtures/phase2-app/vite.config.ts',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { TIMBER_DEV_QUIET: '1' },
  },
});
