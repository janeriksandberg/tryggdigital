// Administrasjon: sidemeny og sider. Krever innlogget administrator med tofaktor (eller demomodus).
import { t } from '../../i18n.js';
import { h, icon, clear, versionTag } from '../../ui.js';
import { S, isAdminHere, signOutAdmin, chooseTenant } from '../../session.js';
import * as store from '../../core/store.js';
import { topbar, go, route } from '../../app.js';
import { hasAccepted, askConsent } from '../privacy.js';
import { debounce } from '../shared.js';

export const PAGES = [
  { group: 'nav.daily' },
  { id: 'overview', icon: 'home', key: 'nav.overview' },
  { id: 'today', icon: 'users', key: 'nav.foreman' },
  { id: 'registrations', icon: 'clock', key: 'nav.registrations' },
  { id: 'pay', icon: 'banknote', key: 'nav.pay' },
  { group: 'nav.spraying' },
  { id: 'spraying', icon: 'tractor', key: 'nav.journal' },
  { id: 'products', icon: 'flask', key: 'nav.products' },
  { id: 'fertilizer', icon: 'sprout', key: 'nav.fertilizer' },
  { group: 'nav.quality' },
  { id: 'trace', icon: 'tag', key: 'nav.trace' },
  { id: 'deliveries', icon: 'truck', key: 'nav.deliveries' },
  { id: 'reports', icon: 'chart', key: 'nav.reports' },
  { group: 'nav.setup' },
  { id: 'people', icon: 'qr', key: 'nav.people' },
  { id: 'fields', icon: 'map', key: 'nav.fields' },
  { id: 'crops', icon: 'grape', key: 'nav.crops' },
  { id: 'devices', icon: 'tablet', key: 'nav.devices' },
  { id: 'settings', icon: 'settings', key: 'nav.settings' },
];
const LOADERS = {
  overview: () => import('./overview.js'), today: () => import('./today.js'), registrations: () => import('./registrations.js'), pay: () => import('./pay.js'),
  spraying: () => import('./spraying.js'), products: () => import('./products.js'), fertilizer: () => import('./fertilizer.js'), deliveries: () => import('./deliveries.js'), trace: () => import('./trace.js'), reports: () => import('./reports.js'),
  people: () => import('./people.js'), fields: () => import('./fields.js'), crops: () => import('./crops.js'), devices: () => import('./devices.js'), settings: () => import('./settings.js'),
};

export function view() {
  let page = null, content = null, ctx = null;
  return {
    topbar: () => topbar({ kind: 'admin', subtitle: S.tenantName || store.settings().farmName || '', actions: [h('button', { class: 'top-btn menu-btn', type: 'button', 'aria-label': t('nav.menu'), onclick: () => document.querySelector('.sidebar')?.classList.toggle('open') }, icon('menu', 22))] }),
    async render(r) {
      if (!isAdminHere()) {
        if (S.admin?.mfa && S.mode === 'device') return h('main', { class: 'center-page' }, h('div', { class: 'card auth-card stack' }, h('h2', {}, t('admin.notForTenant')), h('p', { class: 'muted' }, t('admin.notForTenantText')), h('button', { class: 'btn light', onclick: () => signOutAdmin() }, t('login.signOut'))));
        setTimeout(() => go('login'), 0);
        return h('div');
      }
      // Administratoren må også ha sett personvernerklæringen
      const subject = S.mode === 'demo' ? 'demo-admin' : S.admin.email;
      if (!hasAccepted(subject)) {
        const ok = await askConsent({ subjectId: subject, kind: 'admin' });
        if (!ok) { if (S.mode !== 'demo') await signOutAdmin(); go(''); return h('div'); }
      }
      const id = LOADERS[r.page] ? r.page : 'overview';
      const sidebar = h('nav', { class: 'sidebar', 'aria-label': t('nav.menu') },
        S.mode === 'admin' && S.admin?.tenants.length > 1 ? h('select', { class: 'input tenant-switch', 'aria-label': t('tenants.title'), onchange: async (e) => { await chooseTenant(e.target.value); go('admin/overview'); } },
          S.admin.tenants.map((tn) => h('option', { value: tn.id, selected: tn.id === S.tenantId }, tn.name))) : null,
        PAGES.map((p) => (p.group ? h('div', { class: 'nav-group' }, t(p.group)) : h('a', { class: `nav-link ${p.id === id ? 'on' : ''}`, href: `#/admin/${p.id}`, 'data-nav': p.id }, icon(p.icon, 20), h('span', {}, t(p.key)), badgeFor(p.id)))),
        h('div', { class: 'sep' }),
        S.admin?.isSuper ? h('a', { class: 'nav-link', href: '#/super/tenants' }, icon('crown', 20), t('super.title')) : null,
        S.mode === 'device' || S.mode === 'demo' ? h('a', { class: 'nav-link', href: '#/' }, icon('tablet', 20), t('nav.backToKiosk')) : null,
        S.mode !== 'demo' ? h('button', { class: 'nav-link', type: 'button', style: { border: 0, background: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'start' }, onclick: () => signOutAdmin() }, icon('logout', 20), t('login.signOut')) : null,
        S.admin ? h('div', { class: 'small muted', style: { padding: '8px 12px' } }, S.admin.email) : null,
        h('div', { style: { padding: '4px 12px' } }, versionTag()));
      content = h('div', { class: 'admin-main', id: 'admin-main' });
      const mod = await LOADERS[id]();
      page = mod;
      ctx = { sub: r.sub, redraw: () => drawPage() };
      const drawPage = async () => {
        const node = await mod.render(ctx);
        clear(content, node);
      };
      await drawPage();
      return h('div', { class: 'admin-layout' }, sidebar, content);
    },
    onData: debounce((ev) => { if (!document.querySelector('.modal-wrap')) page?.onData?.(ev, ctx); }, 400),
    destroy() { page?.destroy?.(); },
  };
}

function badgeFor(id) {
  if (id === 'today') {
    const today = new Date().toISOString().slice(0, 10);
    const n = store.all('alerts').filter((a) => !a.ack && a.ts?.slice(0, 10) === today).length;
    return n ? h('span', { class: 'badge' }, String(n)) : null;
  }
  return null;
}

/** Felles sidehode. */
export const pageHead = (title, text, ...actions) => h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), text ? h('p', {}, text) : null), actions.length ? h('div', { class: 'row wrap' }, actions) : null);
