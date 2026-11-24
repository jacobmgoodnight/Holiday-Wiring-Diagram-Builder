import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  // Tests start with the backup reminder snoozed and the iPhone tip seen (tests/notices.spec.ts
  // turns them back on), so notices never shift the layout in the middle of a test.
  use: { baseURL: 'http://localhost:4173/', trace: 'off', storageState: 'tests/storage-state.json' },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
