// UI-hjelpere: elementbygger, ikoner, toast, modaler, lyd/vibrasjon, QR, formatering og nedlasting.
import { t, locale } from './i18n.js';
import { ICONS } from './icons.js';
import { BUILD } from './version.js';
import { maskTemplate, cleanChars, formatMasked, caretFor, isComplete } from './core/codemask.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** SVG-ikon fra Lucide-settet (statisk innhold fra build-vendor, ikke brukerdata). */
export function icon(name, size = 22, cls = '') {
  const wrap = document.createElement('span');
  wrap.className = `ico ${cls}`;
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return wrap;
}

/** Tømmer et element og legger eventuelt inn nye barn (null/false hoppes over, som i h()). */
export const clear = (el, ...kids) => {
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};

// ---------- Lyd og vibrasjon ----------
let audioCtx;
function beep(freqs, dur = 0.09) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    let at = audioCtx.currentTime;
    for (const f of freqs) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(at); o.stop(at + dur + 0.02);
      at += dur * 0.9;
    }
  } catch { /* ingen lyd */ }
}
export function feedback(kind) {
  const vib = { scan: 40, success: [60, 40, 120], error: [200, 80, 200], warn: [120, 60, 120, 60, 120], tap: 15 }[kind];
  try { if (vib && navigator.vibrate) navigator.vibrate(vib); } catch { /* */ }
  if (kind === 'scan') beep([1320], 0.07);
  if (kind === 'success') beep([660, 880, 1320], 0.1);
  if (kind === 'error') beep([300, 220], 0.18);
  if (kind === 'warn') beep([520, 380, 520, 380], 0.14);
}

// ---------- Toast ----------
export function toast(msg, type = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(host); }
  const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check', 18), h('span', {}, msg));
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 5000 : 3200);
}

// ---------- Modal ----------
export function modal(title, content, actions = [], opts = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (v) => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && !opts.locked) close(null); };
    document.addEventListener('keydown', onKey);
    const footer = h('div', { class: 'modal-actions' },
      actions.map((a) => h('button', { class: `btn ${a.class || ''}`, type: a.submit ? 'submit' : 'button', 'data-act': a.id || null, onclick: async () => {
        if (a.submit) return;
        if (a.onClick) { const r = await a.onClick(); if (r === false) return; close(r ?? a.value); } else close(a.value);
      } }, a.icon ? icon(a.icon, 18) : null, a.label)));
    const form = h('form', { class: `modal ${opts.wide ? 'wide' : ''} ${opts.cls || ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onsubmit: async (e) => {
      e.preventDefault();
      const sub = actions.find((a) => a.submit);
      if (!sub) return;
      const r = sub.onClick ? await sub.onClick() : sub.value;
      if (r === false) return;
      close(r ?? sub.value);
    } },
      h('div', { class: 'modal-head' }, h('h2', {}, title), opts.locked ? null : h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('common.close'), onclick: () => close(null) }, icon('x'))),
      h('div', { class: 'modal-body' }, content),
      actions.length ? footer : null);
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap && !opts.locked) close(null); } }, form);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    setTimeout(() => (form.querySelector('[autofocus]') || form.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea'))?.focus?.(), 80);
    opts.onOpen?.({ close, form });
  });
}
export const confirmDialog = (title, text, okLabel, danger = true) =>
  modal(title, h('p', {}, text), [
    { label: t('common.cancel'), class: 'ghost', value: false },
    { label: okLabel || t('common.ok'), class: danger ? 'danger' : 'primary', value: true, id: 'confirm' },
  ]);
export const infoDialog = (title, text, iconName = 'info') =>
  modal(title, h('div', { class: 'info-dialog' }, h('div', { class: 'info-badge' }, icon(iconName, 30)), h('p', { class: 'info-text' }, text)), [
    { label: t('common.ok'), class: 'primary', value: true },
  ]);

// ---------- Fullskjerm resultat (for hanske- og avstandsbruk) ----------
export function bigResult({ type = 'success', title, lines = [], extra = null, duration = 0 }) {
  return new Promise((resolve) => {
    feedback(type === 'success' ? 'success' : type === 'warn' ? 'warn' : 'error');
    const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); clearTimeout(timer); resolve(); };
    const el = h('div', { class: `big-result ${type}`, onclick: close, role: 'alertdialog', 'aria-label': title },
      h('div', { class: 'big-inner' },
        h('div', { class: 'big-icon' }, icon(type === 'success' ? 'check' : 'alert', 64)),
        h('h1', {}, title),
        lines.map((l) => (l instanceof Node ? l : h('p', {}, l))),
        extra,
        h('button', { class: 'btn light xl', type: 'button', onclick: (e) => { e.stopPropagation(); close(); } }, t('common.ok'))));
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const timer = duration ? setTimeout(close, duration) : null;
  });
}

// ---------- QR ----------
export function qrSvg(text, size = 160, ecc = 'M') {
  const qr = window.qrcode(0, ecc);
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const q = 4; // stille sone etter standarden
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  const total = n + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
export function qrEl(text, size = 160, ecc = 'M') {
  const el = h('div', { class: 'qr' });
  el.innerHTML = qrSvg(text, size, ecc);
  return el;
}

// ---------- Formatering ----------
export const fmtKr = (v) => new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(v || 0);
export const fmtKr2 = (v) => new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
export const fmtNum = (v, d = 1) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v || 0);
export const fmtTime = (d) => new Date(d).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (d) => new Date(String(d).length === 10 ? d + 'T12:00' : d).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (d) => new Date(d).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtDay = (k) => new Date(k + 'T12:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
export function fmtDuration(hours) {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)} ${t('unit.h')} ${String(total % 60).padStart(2, '0')} ${t('unit.min')}`;
}
export function fmtAgo(ms) {
  if (!ms) return t('common.never');
  const s = Math.round((Date.now() - ms) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}
export const toLocalInput = (iso) => {
  const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export function toCsv(rows) {
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (typeof v !== 'number' && !/^-?\d+([.,]\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // hindrer formelinjeksjon i regneark (tall er trygge)
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Tar imot enten rader som lister, eller objekter (kolonnenavn fra første objekt)
  if (rows.length && !Array.isArray(rows[0])) { const cols = Object.keys(rows[0]); rows = [cols, ...rows.map((r) => cols.map((c) => r[c]))]; }
  return '\uFEFF' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}
/** Felt med etikett. */
export const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
export const input = (attrs = {}) => h('input', { class: 'input', ...attrs });
export function select(options, value, attrs = {}) {
  return h('select', { class: 'input', ...attrs }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, l)));
}
export const empty = (iconName, text, action) => h('div', { class: 'empty' }, icon(iconName, 40), h('p', {}, text), action || null);

/**
 * Felt for kode med fast format (som en produktnøkkel). Skilletegnene vises på forhånd i grått og
 * settes inn automatisk; brukeren skriver bare tegnene. Innliming av hel kode virker.
 * mask: se core/codemask.js. Returnerer { el, input, complete() }.
 */
export function codeInput(mask, attrs = {}, onChange = () => {}) {
  const tpl = maskTemplate(mask);
  const ghostTyped = h('span', { class: 'typed' });
  const ghostRest = h('span', { class: 'rest' }, tpl);
  const ghost = h('div', { class: 'code-ghost', 'aria-hidden': 'true' }, ghostTyped, ghostRest);
  const input = h('input', { class: 'input big code-input', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', maxlength: tpl.length, 'aria-label': attrs['aria-label'] || null, ...attrs });
  const sync = () => {
    ghostTyped.textContent = input.value;
    ghostRest.textContent = tpl.slice(input.value.length);
    const done = isComplete(input.value, mask);
    wrap.classList.toggle('complete', done);
    onChange(done);
  };
  const reformat = () => {
    const pos = input.selectionStart ?? input.value.length;
    const before = cleanChars(input.value.slice(0, pos), mask).length;
    const chars = cleanChars(input.value, mask);
    input.value = formatMasked(chars, mask);
    const caret = Math.min(caretFor(before, mask), input.value.length);
    try { input.setSelectionRange(caret, caret); } catch { /* ikke fokusert */ }
    sync();
  };
  input.addEventListener('input', reformat);
  input.addEventListener('keydown', (e) => {
    // Sletting rett etter et skilletegn sletter tegnet foran skilletegnet.
    if (e.key === 'Backspace' && input.selectionStart === input.selectionEnd && input.selectionStart > 0
      && input.value.slice(input.selectionStart - mask.sep.length, input.selectionStart) === mask.sep) {
      const p = input.selectionStart - mask.sep.length;
      input.setSelectionRange(p, p);
    }
  });
  const wrap = h('div', { class: 'code-mask' }, ghost, input);
  if (attrs.value) reformat(); else sync();
  return { el: wrap, input, complete: () => isComplete(input.value, mask) };
}

/** Versjonsmerke, f.eks. «Versjon b905be6 · 14.11.2026 15:39». Samme kode står i service worker (td2-b905be6…). */
export const versionText = () => `${t('app.version')} ${BUILD.id} · ${fmtDateTime(BUILD.built)}`;
export const versionTag = () => h('span', { class: 'version-tag', 'data-version': BUILD.id }, versionText());
