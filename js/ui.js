// Små UI-hjelpere: elementbygger, toast, modal, lyd/vibrasjon, QR-generering, formatering
import { t, lang } from './i18n.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------- Lyd og vibrasjon ----------
let audioCtx;
function beep(freqs, dur = 0.09) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    let at = audioCtx.currentTime;
    for (const f of freqs) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(at);
      o.stop(at + dur + 0.02);
      at += dur * 0.9;
    }
  } catch { /* ingen lyd */ }
}
export function feedback(kind) {
  const vib = { scan: 40, success: [60, 40, 120], error: [200, 80, 200], tap: 15 }[kind];
  try { if (vib && navigator.vibrate) navigator.vibrate(vib); } catch { /* */ }
  if (kind === 'scan') beep([1320], 0.07);
  if (kind === 'success') beep([660, 880, 1320], 0.1);
  if (kind === 'error') beep([300, 220], 0.18);
}

// ---------- Toast ----------
export function toast(msg, type = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(host); }
  const el = h('div', { class: `toast ${type}` }, h('span', { class: 'toast-icon' }, type === 'error' ? '!' : '✓'), h('span', {}, msg));
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

// ---------- Modal ----------
export function modal(title, content, actions = [], opts = {}) {
  return new Promise((resolve) => {
    const close = (v) => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    const footer = h('div', { class: 'modal-actions' },
      actions.map((a) => h('button', { class: `btn ${a.class || ''}`, type: a.submit ? 'submit' : 'button', onclick: async (e) => {
        if (a.submit) return; // håndteres av form
        if (a.onClick) { const r = await a.onClick(); if (r === false) return; close(r ?? a.value); } else close(a.value);
      } }, a.label)));
    const form = h('form', { class: `modal ${opts.wide ? 'wide' : ''}`, onsubmit: async (e) => {
      e.preventDefault();
      const sub = actions.find((a) => a.submit);
      if (!sub) return;
      const r = sub.onClick ? await sub.onClick() : sub.value;
      if (r === false) return;
      close(r ?? sub.value);
    } },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('common.close'), onclick: () => close(null) }, '✕')),
      h('div', { class: 'modal-body' }, content),
      actions.length ? footer : null);
    const wrap = h('div', { class: 'modal-wrap', onclick: (e) => { if (e.target === wrap) close(null); } }, form);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    setTimeout(() => form.querySelector('input:not([type=hidden]),select,textarea')?.focus?.(), 80);
  });
}
export const confirmDialog = (title, text, okLabel, danger = true) =>
  modal(title, h('p', {}, text), [
    { label: t('common.cancel'), class: 'ghost', value: false },
    { label: okLabel || t('common.ok'), class: danger ? 'danger' : 'primary', value: true },
  ]);

// Enkel info-melding (brukes for TrippelTex/myndighets-knappene)
export const infoDialog = (title, text) =>
  modal(title, h('div', { class: 'info-dialog' }, h('div', { class: 'check-badge' }, '✓'), h('p', { class: 'info-text' }, text)), [
    { label: t('common.ok'), class: 'primary', value: true },
  ]);

// ---------- Fullskjerm suksess / feil ----------
export function bigResult({ type = 'success', title, lines = [], extra = null, duration = 0 }) {
  return new Promise((resolve) => {
    feedback(type === 'success' ? 'success' : 'error');
    const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); clearTimeout(timer); resolve(); };
    const el = h('div', { class: `big-result ${type}`, onclick: close, role: 'alertdialog' },
      h('div', { class: 'big-inner' },
        h('div', { class: 'big-icon' }, type === 'success'
          ? h('span', { class: 'check-wrap', html: '<svg viewBox="0 0 52 52" class="checkmark"><circle cx="26" cy="26" r="24" fill="none"/><path fill="none" d="M14 27l8 8 16-17"/></svg>' })
          : h('span', {}, '!')),
        h('h1', {}, title),
        lines.map((l) => (l instanceof Node ? l : h('p', {}, l))),
        extra,
        h('button', { class: 'btn light xl', onclick: (e) => { e.stopPropagation(); close(); } }, t('common.ok'))));
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    if (type === 'success') confetti(el);
    const timer = duration ? setTimeout(close, duration) : null;
  });
}

export function confetti(host, n = 60) {
  const colors = ['#f43f5e', '#facc15', '#22c55e', '#38bdf8', '#a855f7', '#fb923c'];
  const layer = h('div', { class: 'confetti' });
  for (let i = 0; i < n; i++) {
    const p = h('i', { style: {
      left: Math.random() * 100 + '%',
      background: colors[i % colors.length],
      animationDelay: Math.random() * 0.4 + 's',
      animationDuration: 1.6 + Math.random() * 1.4 + 's',
      transform: `rotate(${Math.random() * 360}deg)`,
    } });
    layer.appendChild(p);
  }
  host.appendChild(layer);
  setTimeout(() => layer.remove(), 3600);
}

// ---------- QR ----------
export function qrSvg(text, size = 160) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 2; // stille sone
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  const total = n + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- Formatering ----------
const locale = () => ({ nb: 'nb-NO', en: 'en-GB', pl: 'pl-PL', lt: 'lt-LT', uk: 'uk-UA', vi: 'vi-VN' }[lang()] || 'nb-NO');
export const fmtKr = (v) => new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(v || 0);
export const fmtNum = (v, d = 1) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v || 0);
export const fmtTime = (d) => new Date(d).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (d) => new Date(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDay = (k) => new Date(k + 'T12:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
export function fmtDuration(hours) {
  const total = Math.round(hours * 60);
  const hh = Math.floor(total / 60), mm = total % 60;
  return `${hh} ${t('unit.h')} ${String(mm).padStart(2, '0')} ${t('unit.min')}`;
}
export const toLocalInput = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function toCsv(rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}
