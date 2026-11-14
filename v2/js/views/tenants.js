// Valg av kunde for en administrator som har tilgang til flere (eller ingen) kunder.
import { t } from '../i18n.js';
import { h, icon, empty } from '../ui.js';
import { S, chooseTenant, signOutAdmin } from '../session.js';
import { topbar, go } from '../app.js';

export function view() {
  return {
    topbar: () => topbar({ kind: 'kiosk', subtitle: S.admin?.email || '' }),
    render() {
      const a = S.admin;
      if (!a?.mfa) { setTimeout(() => go('login'), 0); return h('div'); }
      return h('main', { class: 'center-page' }, h('div', { class: 'card auth-card stack' },
        h('h1', {}, t('tenants.title')),
        a.tenants.length ? h('div', { class: 'stack tight' }, a.tenants.map((tn) => h('button', { class: 'choice', type: 'button', 'data-tenant': tn.id, onclick: async () => { await chooseTenant(tn.id); go('admin/overview'); } },
          h('span', { class: 'tile-ico' }, icon('building', 26)), h('span', {}, h('strong', {}, tn.name), h('span', {}, tn.id)))))
          : empty('building', t('tenants.none', { email: a.email })),
        a.isSuper ? h('a', { class: 'btn dark block', href: '#/super/tenants' }, icon('crown', 18), t('super.title')) : null,
        h('button', { class: 'btn ghost', onclick: () => signOutAdmin() }, icon('logout', 18), t('login.signOut'))));
    },
  };
}
