// Kameraskanner for QR-koder og strekkoder.
// Bruker nettleserens innebygde BarcodeDetector der den finnes (Chrome/Android),
// ellers ZXing (WebAssembly) via barcode-detector-biblioteket, lastet lokalt.
import { t } from './i18n.js';
import { h, feedback } from './ui.js';

const FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'itf', 'data_matrix'];
let detectorPromise = null;

async function getDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (supported.includes('qr_code')) {
          return new window.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) });
        }
      } catch (e) { /* faller tilbake til ZXing */ }
    }
    await loadScript('vendor/barcode-ponyfill.js');
    const api = window.BarcodeDetectionAPI;
    const wasmUrl = new URL('vendor/zxing_reader.wasm', document.baseURI).href;
    api.prepareZXingModule({
      overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    });
    return new api.BarcodeDetector({ formats: FORMATS });
  })();
  return detectorPromise;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/**
 * Åpner fullskjerm-skanner. Returnerer Promise<string|null> med koden.
 * opts: { title, hint, color }
 */
export function scan(opts = {}) {
  return new Promise((resolve) => {
    let stream = null;
    let running = true;
    let torchOn = false;
    const video = h('video', { playsinline: '', muted: '', autoplay: '' });
    video.muted = true;
    const status = h('div', { class: 'scan-status' }, t('scan.starting'));
    const torchBtn = h('button', { class: 'scan-tool', hidden: '', onclick: toggleTorch }, '🔦');

    const close = (value) => {
      running = false;
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);

    const manual = () => {
      const input = h('input', { class: 'input big', placeholder: 'TD-XXXXXX', autocomplete: 'off', autocapitalize: 'characters' });
      const form = h('form', { class: 'manual-form', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) close(input.value.trim()); } },
        h('label', { class: 'label' }, t('scan.manualLabel')), input,
        h('button', { class: 'btn primary xl', type: 'submit' }, t('common.ok')));
      body.replaceChildren(form);
      setTimeout(() => input.focus(), 50);
    };

    const body = h('div', { class: 'scan-body' },
      h('div', { class: 'scan-view' }, video, h('div', { class: 'scan-frame' }, h('span'), h('span'), h('span'), h('span'), h('div', { class: 'scan-laser' }))),
      status);

    const overlay = h('div', { class: `scanner ${opts.color || ''}`, role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'scan-top' },
        h('div', { class: 'scan-title' }, h('strong', {}, opts.title || t('scan.title')), h('span', {}, opts.hint || t('scan.hint'))),
        torchBtn),
      body,
      h('div', { class: 'scan-actions' },
        h('button', { class: 'btn ghost-light xl', onclick: manual }, '⌨️ ', t('scan.manual')),
        h('button', { class: 'btn light xl', onclick: () => close(null) }, '✕ ', t('common.cancel'))));
    document.body.appendChild(overlay);

    async function toggleTorch() {
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      torchOn = !torchOn;
      try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch { /* ikke støttet */ }
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        status.textContent = t('scan.noCamera');
        return manual();
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        status.textContent = t('scan.noPermission');
        status.classList.add('error');
        return;
      }
      if (!running) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay */ }
      const caps = stream.getVideoTracks()[0]?.getCapabilities?.();
      if (caps && caps.torch) torchBtn.hidden = false;
      status.textContent = t('scan.looking');
      let detector;
      try { detector = await getDetector(); } catch (e) {
        status.textContent = t('scan.noDetector');
        status.classList.add('error');
        return;
      }
      const tick = async () => {
        if (!running) return;
        if (video.readyState >= 2) {
          try {
            const codes = await detector.detect(video);
            if (codes.length && running) {
              feedback('scan');
              overlay.classList.add('hit');
              const value = codes[0].rawValue;
              setTimeout(() => close(value), 220);
              return;
            }
          } catch { /* prøver igjen */ }
        }
        setTimeout(tick, 120);
      };
      tick();
    })();
  });
}
