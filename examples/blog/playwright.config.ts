import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3001',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm exec vite --config examples/blog/vite.config.ts',
    port: 3001,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    cwd: '../..',
  },
});
