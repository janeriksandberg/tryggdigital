// Synk-tester: to–tre «enheter» (nettleserkontekster) mot Firebase-emulatorene. Kjør: npm run test:sync
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 180000,
  workers: 1,
  use: { baseURL: 'http://localhost:8123', bypassCSP: true, locale: 'nb-NO', timezoneId: 'Europe/Oslo', trace: 'off', ...devices['Desktop Chrome'], viewport: { width: 1180, height: 820 } },
  webServer: { command: 'PORT=8123 node tools/serve.mjs', url: 'http://localhost:8123/v2/', reuseExistingServer: true, cwd: '../..' },
});
