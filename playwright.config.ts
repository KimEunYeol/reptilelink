import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 90000,
  use: { baseURL: 'http://localhost:5173', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: [['list']],
  webServer: { command: 'npm run dev:all', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60000 },
});
