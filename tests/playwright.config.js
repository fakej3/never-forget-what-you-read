import { defineConfig } from '@playwright/test';

// Use the pre-installed headless shell if available, otherwise fall back to full chrome
const CHROMIUM_EXEC =
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

export default defineConfig({
  testDir:   './e2e',
  testMatch: '**/*.{spec,test,e2e}.js',
  timeout:  120000,
  use: {
    baseURL:  'http://localhost:3333',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        launchOptions: {
          executablePath: CHROMIUM_EXEC,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      },
    },
  ],
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
