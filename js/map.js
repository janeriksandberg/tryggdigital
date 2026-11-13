// Kart (Leaflet + Geoman) for å tegne, endre og slette jorder.
import { t } from './i18n.js';
import { h, modal, confirmDialog, toast, fmtNum } from './ui.js';
import * as S from './store.js';
import { polygonAreaM2, m2ToDaa } from './geo.js';

// Kulturer med EPPO-koder (kontrollert mot gd.eppo.int)
export const CROPS = [
  { eppo: 'FRAAN', key: 'crop.strawberry', latin: 'Fragaria x ananassa' },
  { eppo: 'RUBID', key: 'crop.raspberry', latin: 'Rubus idaeus' },
  { eppo: 'VACCO', key: 'crop.blueberry', latin: 'Vaccinium corymbosum' },
  { eppo: 'RIBNI', key: 'crop.blackcurrant', latin: 'Ribes nigrum' },
  { eppo: 'RIBRU', key: 'crop.redcurrant', latin: 'Ribes rubrum' },
  { eppo: 'RIBUC', key: 'crop.gooseberry', latin: 'Ribes uva-crispa' },
  { eppo: 'RUBFR', key: 'crop.blackberry', latin: 'Rubus fruticosus' },
  { eppo: 'PRNAV', key: 'crop.cherry', latin: 'Prunus avium' },
  { eppo: 'MABSD', key: 'crop.apple', latin: 'Malus domestica' },
];
export const cropName = (eppo) => { const c = CROPS.find((x) => x.eppo === eppo); return c ? t(c.key) : eppo || '–'; };
const COLORS = ['#e11d48', '#16a34a', '#2563eb', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

export function baseMap(el, opts = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true, tap: true, ...opts });
  const kv = L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png', {
    maxZoom: 19, maxNativeZoom: 18, attribution: '© <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>',
  });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  });
  // Bruk Kartverket som standard; fall tilbake til OpenStreetMap om Kartverket ikke svarer
  let ok = 0, fail = 0, switched = false;
  kv.on('tileload', () => ok++);
  kv.on('tileerror', () => {
    fail++;
    if (!switched && ok === 0 && fail >= 4) { switched = true; map.removeLayer(kv); osm.addTo(map); }
  });
  kv.addTo(map);
  L.control.layers({ 'Kartverket topo': kv, OpenStreetMap: osm }, null, { position: 'topright' }).addTo(map);
  return map;
}

export function fitToFields(map, fields) {
  const g = L.geoJSON(fields.map((f) => ({ type: 'Feature', geometry: f.geometry })));
  if (fields.length && g.getBounds().isValid()) map.fitBounds(g.getBounds(), { padding: [30, 30], maxZoom: 17 });
  else map.setView([60.5, 9.5], 5); // Sør-Norge
}

export function fieldStyle(f, selected = false) {
  return { color: f.color || '#16a34a', weight: selected ? 5 : 3, fillOpacity: selected ? 0.4 : 0.22, fillColor: f.color || '#16a34a' };
}

function cropSelect(value) {
  return h('select', { class: 'input', name: 'crop' },
    CROPS.map((c) => h('option', { value: c.eppo, selected: c.eppo === value }, `${t(c.key)} (${c.eppo})`)));
}

async function fieldDialog(f, isNew) {
  const name = h('input', { class: 'input', value: f.name || '', required: true, placeholder: t('fields.namePh') });
  const crop = cropSelect(f.crop || 'FRAAN');
  let color = f.color || COLORS[S.db().fields.length % COLORS.length];
  const swatches = h('div', { class: 'swatches' }, COLORS.map((c) => {
    const b = h('button', { type: 'button', class: `swatch ${c === color ? 'on' : ''}`, style: { background: c }, onclick: () => {
      color = c; swatches.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on')); b.classList.add('on');
    } });
    return b;
  }));
  const res = await modal(isNew ? t('fields.newTitle') : t('fields.editTitle'),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, t('fields.name')), name),
      h('label', { class: 'field' }, h('span', {}, t('fields.crop')), crop),
      h('div', { class: 'field' }, h('span', {}, t('fields.color')), swatches),
      h('p', { class: 'muted' }, t('fields.area'), ': ', h('strong', {}, `${fmtNum(f.areaDaa, 1)} ${t('unit.daa')}`))),
    [
      { label: t('common.cancel'), class: 'ghost', value: null },
      { label: t('common.save'), class: 'primary', submit: true, onClick: () => {
        if (!name.value.trim()) { name.focus(); return false; }
        return { name: name.value.trim(), crop: crop.value, color };
      } },
    ]);
  return res;
}

export function renderFieldsAdmin() {
  const wrap = h('div', { class: 'fields-layout' });
  const mapEl = h('div', { class: 'map big-map' });
  const list = h('div', { class: 'field-list' });
  const editBar = h('div', { class: 'edit-bar', hidden: '' });
  wrap.append(h('div', { class: 'map-wrap' }, mapEl, editBar,
    h('div', { class: 'map-tools' },
      h('button', { class: 'btn primary', onclick: () => startDraw() }, '✏️ ', t('fields.draw')),
      h('button', { class: 'btn light', onclick: () => locate() }, '📍 ', t('fields.myPos')))),
    h('div', { class: 'field-side' }, h('h3', {}, t('fields.list')), h('p', { class: 'muted small' }, t('fields.help')), list));

  let map, group, selectedId = null, editingLayer = null;
  const layers = new Map();

  const drawAll = () => {
    group.clearLayers();
    layers.clear();
    for (const f of S.db().fields) {
      const layer = L.geoJSON({ type: 'Feature', geometry: f.geometry }, { style: fieldStyle(f, f.id === selectedId), pmIgnore: false }).getLayers()[0];
      layer.bindTooltip(`${f.name} · ${fmtNum(f.areaDaa, 1)} ${t('unit.daa')}`, { permanent: true, direction: 'center', className: 'field-label' });
      layer.on('click', () => select(f.id, true));
      group.addLayer(layer);
      layers.set(f.id, layer);
    }
    drawList();
  };
  const drawList = () => {
    const fields = S.db().fields;
    list.replaceChildren(...(fields.length ? [] : [h('div', { class: 'empty' }, h('span', {}, '🗺️'), h('p', {}, t('fields.empty')))]),
      ...fields.map((f) => h('div', { class: `field-item ${f.id === selectedId ? 'on' : ''}` },
        h('button', { class: 'field-main', onclick: () => select(f.id, true) },
          h('span', { class: 'dot', style: { background: f.color } }),
          h('span', {}, h('strong', {}, f.name), h('small', {}, `${cropName(f.crop)} · ${fmtNum(f.areaDaa, 1)} ${t('unit.daa')}`))),
        h('div', { class: 'field-actions' },
          h('button', { class: 'icon-btn', title: t('fields.editInfo'), onclick: () => editInfo(f.id) }, '✎'),
          h('button', { class: 'icon-btn', title: t('fields.editShape'), onclick: () => editShape(f.id) }, '⬠'),
          h('button', { class: 'icon-btn danger', title: t('common.delete'), onclick: () => remove(f.id) }, '🗑')))));
  };

  const select = (id, zoom) => {
    selectedId = id;
    drawAll();
    const l = layers.get(id);
    if (zoom && l) map.fitBounds(l.getBounds(), { padding: [40, 40], maxZoom: 18 });
  };

  const startDraw = () => {
    stopEdit(false);
    map.pm.enableDraw('Polygon', { snappable: true, allowSelfIntersection: false, templineStyle: { color: '#e11d48' }, hintlineStyle: { color: '#e11d48', dashArray: [5, 5] }, pathOptions: { color: '#e11d48' } });
    showBar(t('fields.drawHint'), [
      { label: t('fields.finish'), cls: 'primary', fn: () => { map.pm.Draw.Polygon._finishShape?.(); } },
      { label: t('common.cancel'), cls: 'light', fn: () => { map.pm.disableDraw(); hideBar(); } },
    ]);
  };

  const showBar = (text, buttons) => {
    editBar.hidden = false;
    editBar.replaceChildren(h('span', {}, text), ...buttons.map((b) => h('button', { class: `btn ${b.cls}`, onclick: b.fn }, b.label)));
  };
  const hideBar = () => { editBar.hidden = true; };

  const editInfo = async (id) => {
    const f = S.db().fields.find((x) => x.id === id);
    const r = await fieldDialog(f, false);
    if (!r) return;
    S.saveField({ ...f, ...r });
    toast(t('fields.saved'));
    drawAll();
  };

  const editShape = (id) => {
    stopEdit(false);
    select(id, true);
    const l = layers.get(id);
    l.unbindTooltip();
    l.pm.enable({ allowSelfIntersection: false, snappable: true });
    editingLayer = { id, layer: l };
    showBar(t('fields.editHint'), [
      { label: t('common.save'), cls: 'primary', fn: () => stopEdit(true) },
      { label: t('common.cancel'), cls: 'light', fn: () => stopEdit(false) },
    ]);
  };
  const stopEdit = (keep) => {
    if (!editingLayer) return;
    const { id, layer } = editingLayer;
    layer.pm.disable();
    if (keep) {
      const f = S.db().fields.find((x) => x.id === id);
      const geometry = layer.toGeoJSON().geometry;
      S.saveField({ ...f, geometry, areaDaa: m2ToDaa(polygonAreaM2(geometry)) });
      toast(t('fields.saved'));
    }
    editingLayer = null;
    hideBar();
    drawAll();
  };

  const remove = async (id) => {
    const f = S.db().fields.find((x) => x.id === id);
    if (!(await confirmDialog(t('fields.deleteTitle'), t('fields.deleteText', { name: f.name }), t('common.delete')))) return;
    S.deleteField(id);
    if (selectedId === id) selectedId = null;
    toast(t('fields.deleted'));
    drawAll();
  };

  const locate = () => {
    if (!navigator.geolocation) return toast(t('gps.unavailable'), 'error');
    navigator.geolocation.getCurrentPosition(
      (p) => { map.setView([p.coords.latitude, p.coords.longitude], 17); L.circleMarker([p.coords.latitude, p.coords.longitude], { radius: 8, color: '#2563eb', fillOpacity: 0.9 }).addTo(map); },
      () => toast(t('gps.denied'), 'error'), { enableHighAccuracy: true, timeout: 15000 });
  };

  // Kart må initialiseres etter at elementet er i DOM
  requestAnimationFrame(() => {
    map = baseMap(mapEl);
    group = L.featureGroup().addTo(map);
    map.pm.setLang?.('no');
    map.on('pm:create', async (e) => {
      hideBar();
      const geometry = e.layer.toGeoJSON().geometry;
      map.removeLayer(e.layer);
      const draft = { id: S.uid(), geometry, areaDaa: m2ToDaa(polygonAreaM2(geometry)) };
      const r = await fieldDialog(draft, true);
      if (!r) { drawAll(); return; }
      S.saveField({ ...draft, ...r, createdAt: new Date().toISOString() });
      toast(t('fields.saved'));
      selectedId = draft.id;
      drawAll();
    });
    fitToFields(map, S.db().fields);
    drawAll();
    // Uten jorder: start kartet der administrator står
    if (!S.db().fields.length && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => map.setView([p.coords.latitude, p.coords.longitude], 16), () => {}, { enableHighAccuracy: true, timeout: 10000 });
    }
    setTimeout(() => map.invalidateSize(), 200);
  });
  return wrap;
}

// Liten kartvisning for sprøyter
export function fieldPreview(el, fields, selectedId, pos) {
  const map = baseMap(el, { zoomControl: false, dragging: true });
  const sel = fields.find((f) => f.id === selectedId);
  if (sel) fitToFields(map, [sel]); else fitToFields(map, fields);
  for (const f of fields) L.geoJSON({ type: 'Feature', geometry: f.geometry }, { style: fieldStyle(f, f.id === selectedId) }).addTo(map);
  if (pos) L.circleMarker([pos.lat, pos.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map);
  setTimeout(() => map.invalidateSize(), 150);
  return map;
}
