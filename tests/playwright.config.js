import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:  './e2e',
  timeout:  120000,
  use: {
    baseURL:       'http://localhost:3333',
    headless:      true,
    executablePath: '/opt/pw-browsers/chromium',
    viewport:      { width: 1280, height: 800 },
  },
  webServer: {
    command:             'npx serve /home/user/never-forget-what-you-read -p 3333 --no-clipboard',
    url:                 'http://localhost:3333',
    reuseExistingServer: true,
    timeout:             15000,
  },
  reporter: [
    ['json', { outputFile: 'reports/playwright-results.json' }],
    ['list'],
  ],
  // Run tests serially to avoid IndexedDB conflicts
  workers: 1,
  fullyParallel: false,
});
