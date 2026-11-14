// Ende-til-ende-tester for v2 (demomodus, ingen Firebase nødvendig). Kjør: npm run test:e2e
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  workers: 2,
  use: { baseURL: 'http://localhost:8123', bypassCSP: true, locale: 'nb-NO', timezoneId: 'Europe/Oslo', trace: 'off' },
  webServer: { command: 'PORT=8123 node tools/serve.mjs', url: 'http://localhost:8123/v2/', reuseExistingServer: true },
  projects: [
    { name: 'nettbrett', use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 820 } } },
    { name: 'mobil', use: { ...devices['Pixel 7'] }, grep: /@mobil/ },
  ],
});
