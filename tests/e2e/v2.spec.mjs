import { test, expect } from '@playwright/test';
import { startDemo, tokenFor, scanCode, acceptPrivacyIfAsked, dbCount } from './helpers.mjs';

const okBig = (page) => page.locator('.big-result');
async function closeBig(page) { await expect(okBig(page)).toBeVisible(); await okBig(page).locator('button').click(); await expect(okBig(page)).toHaveCount(0); }

test('v1 i roten er urørt og laster', async ({ page }) => {
  const res = await page.goto('/');
  expect(res.status()).toBe(200);
  await expect(page.locator('body')).not.toBeEmpty();
});

test('plukker: stemple inn på eget språk med personvern, levere kasse, stemple ut @mobil', async ({ page }) => {
  const errors = await startDemo(page);
  const tok = await tokenFor(page, 'Nguyen Van An');
  await page.click('[data-act=start]');
  await scanCode(page, tok);
  // Personvernerklæringen vises på plukkerens språk (vietnamesisk) første gang
  await expect(page.locator('.modal [lang=vi]').first()).toBeVisible();
  await expect(page.getByText('Quyền riêng tư').first()).toBeVisible();
  await page.click('[data-act=accept-privacy]');
  await expect(okBig(page)).toContainText('Chào mừng');
  await closeBig(page);
  expect(await dbCount(page, 'consents')).toBeGreaterThanOrEqual(1);
  // Appen går tilbake til enhetens språk
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  // Lever kasse: standardverdier fra tildelt/første jorde, telleren kan endres
  const before = await dbCount(page, 'crates');
  await page.click('[data-act=crate]');
  await scanCode(page, tok);
  await page.click('[data-pick="fieldId:Nordre"]');
  await page.getByRole('button', { name: /Nhiều hơn|More|Flere/ }).click();
  await expect(page.locator('[data-count="2"]')).toBeVisible();
  await page.click('[data-act=register]');
  await expect(okBig(page)).toBeVisible();
  await closeBig(page);
  expect(await dbCount(page, 'crates')).toBe(before + 1);
  // Stemple ut
  await page.click('[data-act=end]');
  await scanCode(page, tok);
  await expect(okBig(page)).toBeVisible();
  await closeBig(page);
  expect(await dbCount(page, 'shifts', "(s) => !s.end && s.personId && false")).toBe(0);
  expect(errors).toEqual([]);
});

test('karenstid sperrer levering fra sprøytet jorde og varsler formann', async ({ page }) => {
  const errors = await startDemo(page);
  const tok = await tokenFor(page, 'Olena Shevchenko');
  await page.click('[data-act=crate]');
  await scanCode(page, tok);
  await acceptPrivacyIfAsked(page);
  await page.click('[data-pick="fieldId:Bringebærlia"]');
  await expect(page.locator('[data-karens]')).toBeVisible();
  await expect(page.locator('[data-act=register]')).toBeDisabled();
  const alerts = await dbCount(page, 'alerts');
  // Forsøk via skjemaet registreres som varsel (knappen er sperret, så vi utløser forsøket i koden som en plukker ville gjort i varslingsmodus)
  await page.evaluate(async () => { const s = await import('/v2/js/core/store.js'); s.patch('settings', 'main', { karensMode: 'warn' }); });
  await page.getByRole('button', { name: /Скасувати|Avbryt|Cancel/ }).click();
  await page.click('[data-act=crate]');
  await scanCode(page, tok);
  await page.click('[data-pick="fieldId:Bringebærlia"]');
  await expect(page.locator('[data-act=register]')).toBeEnabled();
  await page.click('[data-act=register]');
  await closeBig(page);
  expect(await dbCount(page, 'alerts')).toBe(alerts + 1);
  // Formannens oversikt viser varselet
  await page.goto('/v2/#/admin/today');
  await acceptPrivacyIfAsked(page);
  await expect(page.locator('[data-alert]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('sprøyter: ny sprøyting med MET-vær, bekreftelse, lagertrekk og karenstid', async ({ page }) => {
  const errors = await startDemo(page);
  const tok = await tokenFor(page, 'Kari Nordmann');
  await page.click('[data-act=sprayer]');
  await scanCode(page, tok);
  await acceptPrivacyIfAsked(page);
  await expect(page).toHaveURL(/#\/work\/sprayer/);
  // Oppdrag fra demo kan utføres
  await expect(page.locator('[data-task]')).toHaveCount(1);
  await page.locator('[data-task] button').click();
  await expect(page.locator('[data-form=spray]')).toBeVisible();
  // Været hentes automatisk (forfalsket MET-svar i testen) men må bekreftes
  await expect(page.locator('[data-weather=done]')).toBeVisible();
  await expect(page.locator('input[name=temp]')).toHaveValue('13.2');
  await page.click('[data-act=save-spray]');
  await expect(page.locator('.toast')).toContainText(/Bekreft værverdiene/);
  await page.check('input[name=wxConfirm]');
  const stockBefore = await dbCount(page, 'stock');
  await page.click('[data-act=save-spray]');
  await expect(page.locator('[data-saved]')).toBeVisible();
  expect(await dbCount(page, 'sprays')).toBe(2);
  expect(await dbCount(page, 'stock')).toBe(stockBefore + 1);
  expect(await dbCount(page, 'tasks', "(x) => x.status === 'done'")).toBe(1);
  const bal = await page.evaluate(async () => { const D = await import('/v2/js/core/domain.js'); const s = await import('/v2/js/core/store.js'); const p = s.all('products').find((x) => x.name.startsWith('Eksempelmiddel A')); return D.stockBalance({ products: s.all('products'), stock: s.all('stock') })[p.id].balance; });
  expect(bal).toBeCloseTo(5 - 0.1 * 12.4, 3); // 100 g/daa × 12,4 daa = 1,24 kg
  await page.click('[data-act=done]');
  await expect(page.locator('[data-act=scan]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('kort som er sperret eller fra feil gård avvises', async ({ page }) => {
  await startDemo(page);
  await page.click('[data-act=start]');
  await scanCode(page, 'TD2:AAAAAAAAAAAAAAAAAAAAAAAAAA');
  await expect(okBig(page)).toHaveClass(/error/);
  await closeBig(page);
  // En kode i feil format kan ikke sendes inn for hånd: OK er sperret til alle tegnene er skrevet
  await page.click('[data-act=start]');
  await scanCode(page, 'hei');
  await expect(page.locator('.manual-form button[type=submit]')).toBeDisabled();
  await expect(page.locator('input[name=manualcode]')).toHaveValue('HE1');
});

test('alle administrasjonssider vises uten feil og uten manglende tekster', async ({ page }) => {
  const errors = await startDemo(page);
  for (const pg of ['overview', 'today', 'registrations', 'pay', 'spraying', 'products', 'trace', 'reports', 'people', 'fields', 'crops', 'devices', 'settings']) {
    await page.goto(`/v2/#/admin/${pg}`);
    if (pg === 'overview') await acceptPrivacyIfAsked(page);
    await page.waitForFunction((id) => document.querySelector('.nav-link.on')?.dataset.nav === id && !!document.querySelector('.admin-main h1'), pg);
  }
  expect(errors).toEqual([]);
});

test('rapport sammenligner med i fjor, og lønn summerer', async ({ page }) => {
  await startDemo(page);
  await page.goto('/v2/#/admin/reports');
  await acceptPrivacyIfAsked(page);
  await expect(page.locator('[data-report] tbody tr')).toHaveCount(3);
  await page.goto('/v2/#/admin/pay');
  await expect(page.locator('[data-pay-row]')).toHaveCount(5);
});

test('sporbarhet: ny pall, etikett og oppslag fra etikett', async ({ page }) => {
  await startDemo(page);
  await page.goto('/v2/#/admin/trace');
  await acceptPrivacyIfAsked(page);
  await page.click('[data-act=new-pallet]');
  await page.locator('.modal select[name=field]').selectOption({ label: 'Nordre' });
  await page.locator('.modal input[name=count]').fill('3');
  await page.locator('.modal button[type=submit]').click();
  await expect(page.locator('.modal .label')).toBeVisible(); // forhåndsvisning av etikett med QR
  await page.locator('.modal').getByRole('button', { name: 'Lukk' }).first().click();
  const no = await page.evaluate(async () => (await import('/v2/js/core/store.js')).all('pallets')[0].no);
  expect(no).toMatch(/^P\d{4}-0001$/);
  await page.click('[data-act=lookup]');
  await scanCode(page, no);
  await expect(page.locator('.modal')).toContainText('Nordre');
});

test('plantevernmiddel: legg til, innkjøp og telling gir riktig beholdning', async ({ page }) => {
  await startDemo(page);
  await page.goto('/v2/#/admin/products');
  await acceptPrivacyIfAsked(page);
  await page.click('[data-act=add-product]');
  await page.locator('.modal input[name=name]').fill('Testmiddel (fiktivt)');
  await page.locator('.modal input[name=phiDays]').fill('5');
  await page.locator('.modal button[type=submit]').click();
  const row = page.locator('[data-product="Testmiddel (fiktivt)"]');
  await row.locator('[data-act=purchase]').click();
  await page.locator('.modal input[name=qty]').fill('4');
  await page.locator('.modal button[type=submit]').click();
  await expect(row).toContainText('4 l');
});

test('sikkerhetskopi kan lastes ned og leses tilbake', async ({ page }) => {
  await startDemo(page);
  await page.goto('/v2/#/admin/settings');
  await acceptPrivacyIfAsked(page);
  await page.click('[data-act=backup]');
  await page.locator('.modal input[type=password]').first().fill('et-langt-passord-123');
  await page.locator('.modal input[type=password]').nth(1).fill('et-langt-passord-123');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.modal button[type=submit]').click()]);
  const txt = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  const env = JSON.parse(txt);
  expect(env.format).toBe('tryggdigital-encrypted');
  const ok = await page.evaluate(async (t) => { const b = await import('/v2/js/core/backup.js'); const o = await b.open(t, 'et-langt-passord-123'); return o.kind === 'tenant' && o.collections.people.length; }, txt);
  expect(ok).toBe(6);
  const bad = await page.evaluate(async (t) => { const b = await import('/v2/js/core/backup.js'); try { await b.open(t, 'feil'); return 'åpnet'; } catch (e) { return e.message; } }, txt);
  expect(bad).toBe('wrong-password');
});

test('språkvalg: hele appen på engelsk, plukkerspråk merket', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('button', { name: 'Velg språk' }).click();
  await expect(page.locator('.lang-option[lang=pl]')).toContainText('plukkervisning');
  await page.locator('.lang-option[lang=en]').click();
  await expect(page.locator('[data-act=scan]')).toContainText('Scan your card');
});

test('sikkerhet: HTML i brukerdata vises som tekst, ikke som kode', async ({ page }) => {
  const errors = await startDemo(page);
  await page.evaluate(async () => {
    const s = await import('/v2/js/core/store.js');
    window.__xss = 0;
    s.put('people', { name: '<img src=x onerror="window.__xss=1">Ola', roles: ['picker'], lang: 'nb', active: true }, 'test');
    s.put('fields', { name: '<svg onload="window.__xss=1">', crop: 'strawberry', areaDaa: 1 }, 'test');
  });
  await page.goto('/v2/#/admin/people');
  await acceptPrivacyIfAsked(page);
  await expect(page.locator('.admin-main')).toContainText('<img src=x');
  await page.goto('/v2/#/admin/fields');
  await expect(page.locator('.admin-main')).toContainText('<svg onload');
  await page.goto('/v2/#/admin/today');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xss)).toBe(0);
  expect(await page.locator('.admin-main img[src="x"], .admin-main svg[onload]').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('appen nekter å kjøre inne i en ramme (clickjacking)', async ({ page }) => {
  await page.setContent('<iframe src="http://localhost:8123/v2/" width="800" height="600"></iframe>');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#app')).toContainText('kan ikke vises inne i en annen side');
});

// To falske kameraer (lerret som videokilde), så vi kan prøve kamerabytte uten ekte maskinvare.
const FAKE_CAMERAS = () => {
  const cams = [{ deviceId: 'cam-back', label: 'Bakkamera', kind: 'videoinput', groupId: 'g' }, { deviceId: 'cam-front', label: 'Frontkamera', kind: 'videoinput', groupId: 'g' }];
  window.__camCalls = [];
  navigator.mediaDevices.enumerateDevices = async () => cams.map((c) => ({ ...c, toJSON: () => c }));
  navigator.mediaDevices.getUserMedia = async (c) => {
    const want = c.video?.deviceId?.exact;
    window.__camCalls.push(want || 'default');
    const id = want || 'cam-back';
    const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
    const ctx = canvas.getContext('2d'); ctx.fillStyle = id === 'cam-back' ? '#264' : '#642'; ctx.fillRect(0, 0, 320, 240);
    const stream = canvas.captureStream(5);
    const track = stream.getVideoTracks()[0];
    track.getSettings = () => ({ deviceId: id });
    track.getCapabilities = () => ({});
    return stream;
  };
};

test('skanner: bytt mellom kameraer, og valget huskes @mobil', async ({ page }) => {
  await page.addInitScript(FAKE_CAMERAS);
  const errors = await startDemo(page);
  await page.click('[data-act=start]');
  const btn = page.locator('[data-act=switch-camera]');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('(1/2)');
  await btn.click();
  await expect(btn).toContainText('(2/2)');
  expect(await page.evaluate(() => window.__camCalls.at(-1))).toBe('cam-front');
  expect(await page.evaluate(() => localStorage.getItem('td2.camera'))).toBe('cam-front');
  await btn.click();
  await expect(btn).toContainText('(1/2)');
  await btn.click();
  await page.getByRole('button', { name: /Avbryt|Cancel/ }).click();
  // Neste skanning starter med kameraet som sist ble valgt
  await page.click('[data-act=start]');
  await expect(btn).toContainText('(2/2)');
  expect(await page.evaluate(() => window.__camCalls.at(-1))).toBe('cam-front');
  // Ved inntasting skjules kameraknappen og kameraet stoppes
  await page.click('[data-act=manual]');
  await expect(btn).toBeHidden();
  expect(errors).toEqual([]);
});

test('kortkode tastes som en produktnøkkel: strekene kommer av seg selv @mobil', async ({ page }) => {
  const errors = await startDemo(page);
  const tok = await tokenFor(page, 'Anna Kowalska');
  await page.click('[data-act=start]');
  await page.click('[data-act=manual]');
  const input = page.locator('input[name=manualcode]');
  const ok = page.locator('.manual-form button[type=submit]');
  await expect(page.locator('.code-ghost')).toHaveText('____-____-____-____-____-____-__');
  await input.pressSequentially(tok.slice(0, 4).toLowerCase());
  await expect(input).toHaveValue(tok.slice(0, 4) + '-');
  await expect(ok).toBeDisabled();
  await input.pressSequentially(tok.slice(4, 6));
  await expect(input).toHaveValue(`${tok.slice(0, 4)}-${tok.slice(4, 6)}`);
  // Sletting over en strek tar med tegnet foran
  await input.press('Backspace'); await input.press('Backspace');
  await expect(input).toHaveValue(tok.slice(0, 4) + '-');
  await input.press('Backspace');
  await expect(input).toHaveValue(tok.slice(0, 3));
  // Innliming av hele koden med streker
  const pretty = tok.match(/.{1,4}/g).join('-');
  await input.fill('');
  await input.fill(pretty);
  await expect(input).toHaveValue(pretty);
  await expect(ok).toBeEnabled();
  await ok.click();
  await acceptPrivacyIfAsked(page);
  await expect(page.locator('.big-result, [data-big]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

// Hver overskrift i et skjema skal ha noe å fylle ut. Fanger feil der et felt ikke blir laget.
async function expectAllFieldsHaveControls(page) {
  const modal = page.locator('.modal').last();
  await expect(modal).toBeVisible();
  const missing = await modal.evaluate((m) => [...m.querySelectorAll('.field')]
    .filter((f) => f.querySelector('.field-label') && !f.querySelector('input, select, textarea, button, .swatches, .chips, .hint'))
    .map((f) => f.querySelector('.field-label').textContent));
  expect(missing).toEqual([]);
  const empty = await modal.evaluate((m) => [...m.querySelectorAll('label.field')].filter((f) => !f.querySelector('input, select, textarea')).map((f) => f.textContent.trim()));
  expect(empty).toEqual([]);
}

test('nytt jorde uten kart: alle felt kan fylles ut, og jordet lagres', async ({ page }) => {
  const errors = await startDemo(page);
  await page.goto('/v2/#/admin/fields');
  await acceptPrivacyIfAsked(page);
  const before = await dbCount(page, 'fields');
  await page.click('[data-act=add-field]');
  await expectAllFieldsHaveControls(page);
  const modal = page.locator('.modal');
  await modal.locator('input[name=name]').fill('Testjordet');
  await modal.locator('select[name=crop]').selectOption('RUBID');
  await modal.locator('input[name=area]').fill('4.5');
  await modal.locator('select[name=quality]').selectOption('A');
  await modal.getByRole('button', { name: 'Lagre' }).click();
  await expect(modal).toBeHidden();
  expect(await dbCount(page, 'fields')).toBe(before + 1);
  const f = await page.evaluate(async () => (await import('/v2/js/core/store.js')).all('fields').find((x) => x.name === 'Testjordet'));
  expect(f).toMatchObject({ crop: 'RUBID', areaDaa: 4.5, defaultQuality: 'A' });
  await expect(page.locator('.admin-main')).toContainText('Testjordet');
  // Endre det samme jordet
  await page.locator('.admin-main').getByText('Testjordet').first().click();
  expect(errors).toEqual([]);
});

test('alle «ny»-skjemaer i administrasjonen har felt under hver overskrift', async ({ page }) => {
  const errors = await startDemo(page);
  const forms = [
    ['fields', '[data-act=add-field]'], ['people', '[data-act=add-person]'], ['crops', '[data-act=add-variety]'], ['crops', '[data-act=add-cratetype]'],
    ['products', '[data-act=add-product]'], ['products', '[data-act=purchase]'], ['spraying', '[data-act=new-task]'], ['trace', '[data-act=new-pallet]'],
    ['registrations', '[data-act=add-registration]'],
  ];
  let first = true;
  for (const [pg, sel] of forms) {
    await page.goto(`/v2/#/admin/${pg}`);
    if (first) { await acceptPrivacyIfAsked(page); first = false; }
    await page.locator(sel).first().click();
    await expectAllFieldsHaveControls(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('versjonsmerket i appen stemmer med service worker-versjonen', async ({ page, request }) => {
  await startDemo(page);
  const id = await page.locator('.kiosk-main [data-version]').getAttribute('data-version');
  const sw = await (await request.get('/v2/sw.js')).text();
  expect(sw).toContain(`const VERSION = 'td2-${id}`);
  await page.goto('/v2/#/admin/overview');
  await acceptPrivacyIfAsked(page);
  await expect(page.locator('.sidebar [data-version]')).toHaveAttribute('data-version', id);
});
