// Kameraskanner for QR-koder og strekkoder.
// Bruker nettleserens innebygde BarcodeDetector der den finnes (Chrome/Android),
// ellers ZXing (WebAssembly) via barcode-detector-biblioteket, lastet lokalt.
import { t } from './i18n.js';
import { h, feedback, icon, codeInput } from './ui.js';

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

const CAM_KEY = 'td2.camera';
const savedCamera = () => { try { return localStorage.getItem(CAM_KEY); } catch { return null; } };
const saveCamera = (id) => { try { if (id) localStorage.setItem(CAM_KEY, id); } catch { /* privat modus */ } };

/**
 * Åpner fullskjerm-skanner. Returnerer Promise<string|null> med koden.
 * opts: { title, hint, color, placeholder, mask, manualFirst }
 * mask: fast format for inntasting (core/codemask.js), f.eks. CARD_MASK. Da settes skilletegnene inn automatisk.
 * Har enheten flere kameraer, vises «Bytt kamera». Valget huskes på enheten.
 */
export function scan(opts = {}) {
  return new Promise((resolve) => {
    let stream = null;
    let running = true;
    let torchOn = false;
    const video = h('video', { playsinline: '', muted: '', autoplay: '' });
    video.muted = true;
    const status = h('div', { class: 'scan-status' }, t('scan.starting'));
    const torchBtn = h('button', { class: 'scan-tool', hidden: '', 'aria-label': t('scan.torch'), onclick: toggleTorch }, icon('sun', 26));

    let cameras = [], manualMode = false;
    const camLabel = h('span', {}, t('scan.switchCamera'));
    const camBtn = h('button', { class: 'btn ghost-light xl cam-switch', type: 'button', hidden: '', 'data-act': 'switch-camera', onclick: () => switchCamera() }, icon('switchCamera'), camLabel);
    const stopStream = () => { if (stream) stream.getTracks().forEach((tr) => tr.stop()); stream = null; };

    const close = (value) => {
      running = false;
      stopStream();
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);

    const manual = () => {
      manualMode = true;
      stopStream();
      camBtn.hidden = true;
      let input, form;
      const ok = h('button', { class: 'btn primary xl', type: 'submit' }, t('common.ok'));
      if (opts.mask) {
        const ci = codeInput(opts.mask, { name: 'manualcode', 'aria-label': t('scan.manualLabel') }, (done) => { ok.disabled = !done; });
        input = ci.input;
        ok.disabled = true;
        form = h('form', { class: 'manual-form', onsubmit: (e) => { e.preventDefault(); if (ci.complete()) close(input.value); } },
          h('label', { class: 'field-label manual-label' }, t('scan.manualLabel')), ci.el, h('p', { class: 'small', style: { margin: 0, opacity: 0.8 } }, t('scan.maskHint')), ok);
      } else {
        input = h('input', { class: 'input big', placeholder: opts.placeholder || '', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', name: 'manualcode' });
        form = h('form', { class: 'manual-form', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) close(input.value.trim()); } },
          h('label', { class: 'field-label manual-label' }, t('scan.manualLabel')), input, ok);
      }
      body.replaceChildren(form);
      setTimeout(() => input.focus(), 50);
    };

    const body = h('div', { class: 'scan-body' },
      h('div', { class: 'scan-view' }, video, h('div', { class: 'scan-frame' }, h('span'), h('span'), h('span'), h('span'), h('div', { class: 'scan-laser' }))),
      status);

    const overlay = h('div', { class: `scanner ${opts.color || ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || t('scan.title') },
      h('div', { class: 'scan-top' },
        h('div', { class: 'scan-title' }, h('strong', {}, opts.title || t('scan.title')), h('span', {}, opts.hint || t('scan.hint'))),
        torchBtn),
      body,
      camBtn,
      h('div', { class: 'scan-actions' },
        h('button', { class: 'btn ghost-light xl', onclick: manual, 'data-act': 'manual' }, icon('keyboard'), t('scan.manual')),
        h('button', { class: 'btn light xl', onclick: () => close(null) }, icon('x'), t('common.cancel'))));
    document.body.appendChild(overlay);

    async function toggleTorch() {
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      torchOn = !torchOn;
      try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch { /* ikke støttet */ }
    }

    async function openStream(deviceId) {
      const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
      return navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: 'environment' }, ...size },
        audio: false,
      });
    }
    async function startCamera(deviceId) {
      stopStream();
      try { stream = await openStream(deviceId); } catch (e) {
        if (!deviceId) throw e;
        stream = await openStream(null); // lagret kamera finnes ikke lenger
      }
      if (!running || manualMode) { stopStream(); return; }
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay */ }
      const track = stream.getVideoTracks()[0];
      torchOn = false;
      const caps = track?.getCapabilities?.();
      torchBtn.hidden = !(caps && caps.torch);
      return track?.getSettings?.().deviceId || deviceId;
    }
    async function listCameras() {
      try {
        cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      } catch { cameras = []; }
      updateCamBtn();
    }
    function currentCameraIndex() {
      const id = stream?.getVideoTracks()[0]?.getSettings?.().deviceId;
      return Math.max(0, cameras.findIndex((c) => c.deviceId === id));
    }
    function updateCamBtn() {
      camBtn.hidden = cameras.length < 2;
      if (cameras.length >= 2) {
        const i = currentCameraIndex();
        camLabel.textContent = `${t('scan.switchCamera')} (${i + 1}/${cameras.length})`;
        camBtn.title = cameras[i]?.label || '';
      }
    }
    async function switchCamera() {
      if (cameras.length < 2) return;
      const next = cameras[(currentCameraIndex() + 1) % cameras.length];
      camBtn.disabled = true;
      try {
        const id = await startCamera(next.deviceId);
        saveCamera(id || next.deviceId);
        feedback('tap');
      } catch {
        status.textContent = t('scan.noCamera');
      } finally {
        camBtn.disabled = false;
        updateCamBtn();
      }
    }

    if (opts.manualFirst) { manual(); return; }
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        status.textContent = t('scan.noCamera');
        return manual();
      }
      try {
        await startCamera(savedCamera());
      } catch (e) {
        status.textContent = t('scan.noPermission');
        status.classList.add('error');
        return;
      }
      if (!running || manualMode) { stopStream(); return; }
      await listCameras();
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
