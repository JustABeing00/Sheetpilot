import { defineConfig, devices } from '@playwright/test';

const API_URL = 'http://127.0.0.1:4000';
// Vite binds to `localhost`, which Node resolves to IPv6 first; polling 127.0.0.1 would never connect.
const WEB_URL = 'http://localhost:5173';

/**
 * Browser end-to-end coverage for the shipped SPA + API pair. The API runs with the in-memory
 * repository driver and local file storage, which is the same auth-disabled configuration a fresh
 * local install uses; workspace/auth flows are covered by the API test suites.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: './apps/api',
      url: `${API_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        REPOSITORY_DRIVER: 'memory',
        STORAGE_DRIVER: 'local',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'npm run dev -w @sheetpilot/web',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
