import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

export default defineConfig({
  testDir: resolve(__dirname, 'e2e'),
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3003',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm exec vite --config examples/kitchen-sink/vite.config.ts',
    port: 3003,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    cwd: repoRoot,
  },
});
