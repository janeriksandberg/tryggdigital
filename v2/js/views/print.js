// Utskrift av QR-kort og etiketter. Viser en forhåndsvisning og bruker nettleserens utskrift (også «Lagre som PDF»).
import { t } from '../i18n.js';
import { h, icon, modal, qrSvg } from '../ui.js';
import { formatToken, qrPayload } from '../core/qrauth.js';

export function printNodes(nodes, title) {
  const area = document.getElementById('print-area');
  area.replaceChildren(...nodes);
  const prevTitle = document.title;
  if (title) document.title = title;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); document.title = prevTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 50);
}

const qrBox = (text) => { const d = h('div', { class: 'qr' }); d.innerHTML = qrSvg(text, 150, 'M'); return d; };

export function idCard({ person, token, farm }) {
  const roles = (person.roles || ['picker']).map((r) => t('role.' + r)).join(' · ');
  return h('div', { class: 'id-card' },
    qrBox(qrPayload(token)),
    h('div', {},
      h('div', { class: 'role' }, roles),
      h('h2', {}, person.name),
      person.number ? h('div', { class: 'farm' }, `#${person.number}`) : null,
      h('div', { class: 'farm' }, farm || ''),
      h('div', { class: 'code' }, formatToken(token)),
      h('div', { class: 'brandline' }, h('img', { src: 'icons/icon.svg', width: 14, height: 14, alt: '' }), 'Tryggdigital · ', t('cards.personal'))));
}
export function cardsSheet(items, farm) {
  return h('div', { class: 'cards-sheet' }, items.map((x) => idCard({ ...x, farm })));
}

export async function previewAndPrint(sheet, title) {
  const preview = h('div', { class: 'preview-sheet' }, sheet.cloneNode(true));
  const r = await modal(title, h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('print.hint')), h('div', { style: { overflow: 'auto', maxHeight: '60vh', background: 'var(--surface-3)', padding: '10px', borderRadius: '12px' } }, preview)),
    [{ label: t('common.close'), class: 'ghost', value: false }, { label: t('common.print'), class: 'primary', value: true, icon: 'printer', id: 'print' }], { wide: true });
  if (r) printNodes([sheet], title);
}
