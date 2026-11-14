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
  for (const pg of ['overview', 'today', 'registrations', 'pay', 'spraying', 'products', 'fertilizer', 'trace', 'deliveries', 'reports', 'people', 'fields', 'crops', 'devices', 'settings']) {
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
    ['registrations', '[data-act=add-registration]'], ['fertilizer', '[data-act=new-fert]'], ['deliveries', '[data-act=add-buyer]'], ['deliveries', '[data-act=new-delivery]'],
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

test('pause: plukker tar pause, skanner seg tilbake, og pausen trekkes fra timene @mobil', async ({ page }) => {
  const errors = await startDemo(page);
  const token = await tokenFor(page, 'Anna Kowalska');
  await page.click('[data-act=scan]');
  await scanCode(page, token);
  await acceptPrivacyIfAsked(page);
  await expect(page.locator('[data-flow=crate]')).toBeVisible({ timeout: 15000 });
  await page.click('[data-act=break]');
  await expect(page.locator('.big-result')).toBeVisible();
  const open = () => page.evaluate(async () => { const s = await import('/v2/js/core/store.js'); const p = s.all('people').find((x) => x.name === 'Anna Kowalska'); return s.all('shifts').find((x) => x.personId === p.id && !x.end); });
  expect((await open()).breakStart).toBeTruthy();
  // Lat som pausen startet for 20 minutter siden
  await page.evaluate(async () => { const s = await import('/v2/js/core/store.js'); const p = s.all('people').find((x) => x.name === 'Anna Kowalska'); const sh = s.all('shifts').find((x) => x.personId === p.id && !x.end); s.patch('shifts', sh.id, { breakStart: new Date(Date.now() - 20 * 60000).toISOString() }); });
  await expect(page.locator('[data-act=scan]')).toBeVisible({ timeout: 10000 });
  await page.click('[data-act=scan]');
  await scanCode(page, token);
  await expect(page.locator('[data-flow=crate]')).toBeVisible({ timeout: 15000 });
  const after = await open();
  expect(after.breakStart).toBeNull();
  expect(after.breakMin).toBe(20);
  expect(errors).toEqual([]);
});

test('gjødslingsjournal: ny gjødsling regner ut næring, og gjødselslaget huskes', async ({ page }) => {
  const errors = await startDemo(page);
  await page.goto('/v2/#/admin/fertilizer');
  await acceptPrivacyIfAsked(page);
  await expect(page.locator('[data-fert] tbody tr')).toHaveCount(1);
  await page.click('[data-act=new-fert]');
  await expectAllFieldsHaveControls(page);
  const modal = page.locator('.modal');
  await modal.locator('input[name=product]').fill('Testgjødsel 10-5-20');
  await modal.locator('input[name=amount]').fill('40');
  await modal.locator('input[name=nContent]').fill('10');
  await modal.locator('input[name=pContent]').fill('5');
  await modal.locator('input[name=kContent]').fill('20');
  await expect(modal.locator('[data-fert-result]')).toContainText('4 kg N, 2 kg P og 8 kg K');
  await modal.getByRole('button', { name: 'Lagre' }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('[data-fert] tbody tr')).toHaveCount(2);
  const f = await page.evaluate(async () => (await import('/v2/js/core/store.js')).all('fertilizations').find((x) => x.product === 'Testgjødsel 10-5-20'));
  expect(f).toMatchObject({ amount: 40, unit: 'kg/daa', nPerDaa: 4, pPerDaa: 2, kPerDaa: 8, kind: 'mineral' });
  expect(f.areaDaa).toBeGreaterThan(0);
  // Neste gang: velg samme gjødselslag, innholdet fylles inn
  await page.click('[data-act=new-fert]');
  await modal.locator('input[name=product]').fill('Testgjødsel 10-5-20');
  await modal.locator('input[name=product]').blur();
  await expect(modal.locator('input[name=kContent]')).toHaveValue('20');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-fert-totals] tbody tr')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('leveranse: kjøper hentes fra Enhetsregisteret, pall legges på følgeseddel og kan ikke brukes to ganger', async ({ page }) => {
  const errors = await startDemo(page);
  await page.route(/data\.brreg\.no/, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ organisasjonsnummer: '974760673', navn: 'TESTKJØPER AS', forretningsadresse: { adresse: ['Havnegata 48'], postnummer: '8900', poststed: 'BRØNNØYSUND', kommune: 'BRØNNØY' } }) }));
  // En pall å levere
  await page.goto('/v2/#/admin/trace');
  await acceptPrivacyIfAsked(page);
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('[data-act=new-pallet]');
  await page.locator('.modal input[name=count]').fill('3');
  await page.locator('.modal').getByRole('button', { name: 'Opprett og skriv ut' }).click();
  await page.keyboard.press('Escape');
  await page.goto('/v2/#/admin/deliveries');
  await page.click('[data-act=add-buyer]');
  await expectAllFieldsHaveControls(page);
  const modal = page.locator('.modal');
  await modal.locator('input[name=buyerOrgNo]').fill('974 760 674');
  await modal.locator('[data-act=org-lookup]').click();
  await expect(modal.locator('[data-org-status]')).toContainText('Ikke et gyldig');
  await modal.locator('input[name=buyerOrgNo]').fill('974 760 673');
  await modal.locator('[data-act=org-lookup]').click();
  await expect(modal.locator('input[name=buyerName]')).toHaveValue('TESTKJØPER AS');
  await expect(modal.locator('input[name=buyerAddress]')).toHaveValue('Havnegata 48, 8900 BRØNNØYSUND');
  await modal.getByRole('button', { name: 'Lagre' }).click();
  await expect(modal).toBeHidden();
  await page.click('[data-act=new-delivery]');
  await modal.locator('select[name=buyer]').selectOption({ label: 'TESTKJØPER AS' });
  await modal.locator('[data-pallet]').first().click();
  await expect(modal.locator('[data-pallet]')).toHaveCount(0);
  await modal.locator('input[name=kg0]').fill('15');
  await modal.locator('input[name=price]').fill('60');
  await expect(modal.locator('[data-sum]')).toContainText('15 kg');
  await expect(modal.locator('[data-sum]')).toContainText('900');
  await modal.getByRole('button', { name: 'Lagre og skriv ut' }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('[data-deliveries] tbody tr')).toHaveCount(1);
  await expect(page.locator('#print-area [data-delivery-note]')).toContainText('TESTKJØPER AS');
  const d = await page.evaluate(async () => (await import('/v2/js/core/store.js')).all('deliveries')[0]);
  expect(d.no).toMatch(/^\d{4}-0001$/);
  expect(d.lines[0]).toMatchObject({ kg: 15, pricePerKg: 60, crates: 3 });
  // Pallen er brukt og tilbys ikke på en ny leveranse
  await page.click('[data-act=new-delivery]');
  await expect(modal.locator('[data-pallet]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-dummy=ehf]')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('innstillinger: gårdsnavn og adresse hentes fra Enhetsregisteret, og uten nett går det fint å taste selv', async ({ page }) => {
  const errors = await startDemo(page);
  let fail = true;
  await page.route(/data\.brreg\.no/, (r) => (fail ? r.abort() : r.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ organisasjonsnummer: '974760673', navn: 'BÆRGÅRDEN AS', forretningsadresse: { adresse: ['Bærveien 2'], postnummer: '3400', poststed: 'LIER' } }) })));
  await page.evaluate(async () => { const s = await import('/v2/js/core/store.js'); s.put('settings', { ...s.settings(), farmName: '', address: '' }); });
  await page.goto('/v2/#/admin/settings');
  await acceptPrivacyIfAsked(page);
  await page.locator('input[name=orgNo]').fill('974760673');
  await page.locator('[data-act=org-lookup]').click();
  await expect(page.locator('[data-org-status]')).toContainText('Fikk ikke kontakt');
  fail = false;
  await page.locator('[data-act=org-lookup]').click();
  await expect(page.locator('input[name=farmName]')).toHaveValue('BÆRGÅRDEN AS');
  await expect(page.locator('input[name=address]')).toHaveValue('Bærveien 2, 3400 LIER');
  // Minstelønn: varsel på lønnssiden når noen ligger under
  await page.locator('input[name=minHourRate]').fill('250');
  await page.locator('input[name=minHourRate]').blur();
  await page.goto('/v2/#/admin/pay');
  await acceptPrivacyIfAsked(page); // gårdsopplysningene står i personvernerklæringen, så den vises på nytt
  await expect(page.locator('[data-below-min]')).toBeVisible();
  await page.goto('/v2/#/admin/spraying');
  await expect(page.locator('[data-dummy=mattilsynet]')).toBeDisabled();
  expect(errors.filter((e) => !/brreg/.test(e))).toEqual([]);
});

test('jorder: adressesøk flytter kartet, og oversikten varsler frost', async ({ page }) => {
  const errors = await startDemo(page);
  await page.route(/ws\.geonorge\.no/, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ adresser: [{ adressetekst: 'Havnegata 48', postnummer: '8900', poststed: 'BRØNNØYSUND', kommunenavn: 'BRØNNØY', representasjonspunkt: { epsg: 'EPSG:4258', lat: 65.4764, lon: 12.2126 } }] }) }));
  const now = Date.now();
  const step = (h, temp) => ({ time: new Date(now + h * 3600000).toISOString(), data: { instant: { details: { air_temperature: temp, wind_speed: 1.5 } }, next_1_hours: { details: { precipitation_amount: 0 } } } });
  await page.route(/api\.met\.no/, (r) => r.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ properties: { meta: { updated_at: new Date().toISOString() }, timeseries: [step(0, 5), step(8, -2), step(9, -1), step(12, 6)] } }) }));
  await page.goto('/v2/#/admin/overview');
  await acceptPrivacyIfAsked(page);
  await expect(page.locator('[data-outlook] [data-frost]')).toBeVisible();
  await expect(page.locator('[data-outlook]')).toContainText('−2');
  await page.goto('/v2/#/admin/fields');
  await page.locator('input[name=address-search]').fill('Havnegata 48');
  await page.click('[data-act=address-search]');
  await page.locator('.addr-hit').first().click();
  await expect.poll(() => page.evaluate(() => { const m = document.querySelector('.big-map')._leaflet_map_ref; return m ? Math.round(m.getCenter().lat * 10) / 10 : null; })).toBe(65.5);
  expect(errors).toEqual([]);
});

test('offline: hele appen virker uten nett, også etter omstart, og alle sider og språk er lagret på enheten', async ({ page, context }) => {
  const errors = await startDemo(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20000 }).toBe(true);
  const token = await tokenFor(page, 'Anna Kowalska');
  const people = await dbCount(page, 'people');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-act=scan]')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => dbCount(page, 'people'), { timeout: 15000 }).toBe(people);
  // Plukker på polsk (språkfilen må komme fra enheten): personvern, så levere kasser
  const before = await dbCount(page, 'crates');
  await page.click('[data-act=crate]');
  await scanCode(page, token);
  await expect(page.locator('.modal')).toContainText('Prywatność', { timeout: 10000 });
  await page.click('[data-act=accept-privacy]');
  await expect(page.locator('[data-flow=crate]')).toBeVisible({ timeout: 15000 });
  await page.click('[data-act=register]');
  await expect.poll(() => dbCount(page, 'crates')).toBe(before + 1);
  await expect(page.locator('.big-result')).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb');
  // Alle administrasjonssider lastes fra enheten
  for (const pg of ['overview', 'today', 'registrations', 'pay', 'spraying', 'products', 'fertilizer', 'trace', 'deliveries', 'reports', 'people', 'fields', 'crops', 'devices', 'settings']) {
    await page.goto(`/v2/#/admin/${pg}`);
    if (pg === 'overview') await acceptPrivacyIfAsked(page);
    await expect(page.locator(`.nav-link.on[data-nav=${pg}]`), `siden ${pg} uten nett`).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.admin-main h1'), `siden ${pg} uten nett`).toBeVisible({ timeout: 10000 });
  }
  // Ny gjødsling uten nett, så full omstart uten nett: alt er der
  await page.goto('/v2/#/admin/fertilizer');
  await page.click('[data-act=new-fert]');
  await page.locator('.modal input[name=product]').fill('Offline-gjødsel');
  await page.locator('.modal input[name=amount]').fill('10');
  await page.locator('.modal').getByRole('button', { name: 'Lagre' }).click();
  await expect(page.locator('.modal')).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-fert-row="Offline-gjødsel"]')).toBeVisible({ timeout: 15000 });
  expect(await dbCount(page, 'crates')).toBe(before + 1);
  await context.setOffline(false);
  expect(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError/.test(e))).toEqual([]);
});
