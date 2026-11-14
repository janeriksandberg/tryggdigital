import { expect } from '@playwright/test';
export const MET_BODY = { properties: { meta: { updated_at: '2026-11-14T10:00:00Z' }, timeseries: [{ time: new Date().toISOString(), data: { instant: { details: { air_temperature: 13.2, wind_speed: 2.4, wind_speed_of_gust: 4.1, wind_from_direction: 225, relative_humidity: 71 } }, next_1_hours: { details: { precipitation_amount: 0 } } } }] } };

/** Starter demo med ferske data, stopper eksterne kall (kart, MET) og samler feil fra konsollen. */
export async function startDemo(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); if (/Mangler tekst/.test(m.text())) errors.push(m.text()); });
  await page.route(/tile\.openstreetmap|cache\.kartverket/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route(/api\.met\.no/, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(MET_BODY) }));
  await page.goto('/v2/');
  await page.click('[data-act=demo]');
  await expect(page.locator('[data-act=scan]')).toBeVisible();
  // Demodata lages i bakgrunnen; vent til alle personer og QR-nøkler finnes
  await expect.poll(() => page.evaluate(async () => (await import('/v2/js/core/store.js')).all('people').length + Object.keys(JSON.parse(localStorage.getItem('td2.demoTokens') || '{}')).length), { timeout: 15000 }).toBe(12);
  return errors;
}
/** QR-nøkkelen for en demoperson (bare demo lagrer nøklene, slik at kortene kan prøves). */
export async function tokenFor(page, name) {
  return page.evaluate(async (n) => {
    const store = await import('/v2/js/core/store.js');
    const p = store.all('people').find((x) => x.name === n);
    return JSON.parse(localStorage.getItem('td2.demoTokens'))[p.id];
  }, name);
}
/** Skanner et kort ved å skrive koden (kamera finnes ikke i testnettleseren). */
export async function scanCode(page, code) {
  const manual = page.locator('[data-act=manual]');
  const input = page.locator('input[name=manualcode]');
  await expect(manual.or(input).first()).toBeVisible();
  if (!(await input.isVisible())) await manual.click();
  await input.fill(code);
  await input.press('Enter');
}
export async function acceptPrivacyIfAsked(page) {
  const btn = page.locator('[data-act=accept-privacy]');
  try { await btn.waitFor({ timeout: 2500 }); await btn.click({ timeout: 5000 }); } catch { /* ikke spurt */ }
}
export const dbCount = (page, c, filter = '() => true') => page.evaluate(async ([c, f]) => (await import('/v2/js/core/store.js')).all(c).filter(eval(f)).length, [c, filter]);
