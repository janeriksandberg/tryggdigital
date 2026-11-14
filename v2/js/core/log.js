// Ringbuffer med hendelser for support. Vises i enhetens statuspanel og sendes med diagnosen til superadministrator.
const MAX = 200;
const buf = [];
const listeners = new Set();
export function log(area, msg, data) {
  const e = { ts: new Date().toISOString(), area, msg, data: data ? JSON.stringify(data).slice(0, 400) : undefined };
  buf.push(e);
  if (buf.length > MAX) buf.shift();
  if (area === 'error' || area === 'sync') console.warn('[td2]', area, msg, data || '');
  for (const fn of listeners) try { fn(e); } catch { /* */ }
}
export const recent = (n = 50) => buf.slice(-n);
export const onLog = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => log('error', e.message, { src: e.filename, line: e.lineno }));
  window.addEventListener('unhandledrejection', (e) => log('error', String(e.reason?.message || e.reason)));
}
