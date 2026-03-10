import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'tailwind.test.ts',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3002',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm exec vite --config examples/tailwind/vite.config.ts',
    port: 3002,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
