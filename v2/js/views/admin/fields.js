// Jorder: tegn på kart, importer fra KML/shapefil/GeoJSON, og sett standardverdier for kasser.
import { t } from '../../i18n.js';
import { h, icon, modal, toast, confirmDialog, fmtNum, field, input, select, pickFile, empty } from '../../ui.js';
import * as store from '../../core/store.js';
import { polygonAreaM2 } from '../../core/geo.js';
import { parseFile, looksLikeWgs84 } from '../../core/importgeo.js';
import { CROPS, cropName } from '../../core/crops.js';
import { baseMap, fitToFields, fieldStyle, mapAvailable } from '../../map.js';
import { pageHead } from './index.js';
import { actor } from '../shared.js';

const COLORS = ['#d6264f', '#157a52', '#1d4ed8', '#b45309', '#7c3aed', '#0e7490', '#be185d', '#4d7c0f'];
let map = null;

export function destroy() { try { map?.remove(); } catch { /* */ } map = null; }

export function render(ctx) {
  destroy();
  const fields = store.all('fields').sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  const mapEl = h('div', { class: 'map big-map' });
  const editBar = h('div', { class: 'edit-bar', hidden: true });
  let group, selectedId = null, editing = null;
  const layers = new Map();

  const list = h('div', { class: 'list' }, fields.length ? fields.map((f) => h('div', { class: 'list-item', 'data-field': f.name },
    h('span', { class: 'dot', style: { background: f.color } }),
    h('button', { class: 'grow', style: { all: 'unset', cursor: 'pointer', flex: 1 }, onclick: () => focusField(f.id, true) },
      h('strong', {}, f.name, f.active === false ? ' ' : null, f.active === false ? h('span', { class: 'tag' }, t('fields.inactive')) : null),
      h('div', { class: 'small muted' }, `${cropName(f.crop)} · ${fmtNum(f.areaDaa, 1)} ${t('unit.daa')}`, f.defaultVarietyId ? ` · ${store.get('varieties', f.defaultVarietyId)?.name || ''}` : '')),
    h('button', { class: 'icon-btn', title: t('fields.editInfo'), 'aria-label': t('fields.editInfo'), onclick: () => editInfo(f) }, icon('edit', 18)),
    f.geometry && mapAvailable() ? h('button', { class: 'icon-btn', title: t('fields.editShape'), 'aria-label': t('fields.editShape'), onclick: () => editShape(f.id) }, icon('mapPin', 18)) : null))
    : [empty('map', t('fields.empty'))]);

  const page = h('div', { class: 'stack' },
    pageHead(t('nav.fields'), t('fields.text'),
      h('button', { class: 'btn light', 'data-act': 'import', onclick: importFields }, icon('upload', 18), t('fields.import')),
      h('button', { class: 'btn light', 'data-act': 'add-field', onclick: () => editInfo(null) }, icon('plus', 18), t('fields.addNoMap')),
      mapAvailable() ? h('button', { class: 'btn primary', onclick: () => startDraw() }, icon('edit', 18), t('fields.draw')) : null),
    h('div', { class: 'fields-layout' },
      h('div', { class: 'map-wrap' }, mapEl, editBar),
      h('div', { class: 'card' }, h('h3', {}, t('fields.list')), h('p', { class: 'muted small' }, t('fields.help')), list)));

  const drawAll = () => {
    if (!group) return;
    group.clearLayers(); layers.clear();
    for (const f of store.all('fields')) {
      if (!f.geometry) continue;
      const layer = L.geoJSON({ type: 'Feature', geometry: f.geometry }, { style: fieldStyle(f, f.id === selectedId) }).getLayers()[0];
      layer.bindTooltip(`${f.name} · ${fmtNum(f.areaDaa, 1)} ${t('unit.daa')}`, { permanent: true, direction: 'center', className: 'field-tip' });
      layer.on('click', () => focusField(f.id, false));
      group.addLayer(layer); layers.set(f.id, layer);
    }
  };
  const focusField = (id, zoom) => { selectedId = id; drawAll(); const l = layers.get(id); if (zoom && l) map.fitBounds(l.getBounds(), { padding: [40, 40], maxZoom: 18 }); };
  const showBar = (text, buttons) => { editBar.hidden = false; editBar.replaceChildren(h('span', { class: 'grow' }, text), ...buttons.map((b) => h('button', { class: `btn small ${b.cls}`, onclick: b.fn }, b.label))); };
  const hideBar = () => { editBar.hidden = true; };
  const startDraw = () => {
    stopEdit(false);
    map.pm.enableDraw('Polygon', { snappable: true, allowSelfIntersection: false, pathOptions: { color: '#d6264f' } });
    showBar(t('fields.drawHint'), [{ label: t('common.cancel'), cls: 'light', fn: () => { map.pm.disableDraw(); hideBar(); } }]);
  };
  const editShape = (id) => {
    stopEdit(false); focusField(id, true);
    const l = layers.get(id);
    if (!l) return;
    l.unbindTooltip();
    l.pm.enable({ allowSelfIntersection: false, snappable: true });
    editing = { id, layer: l };
    showBar(t('fields.editHint'), [{ label: t('common.save'), cls: 'primary', fn: () => stopEdit(true) }, { label: t('common.cancel'), cls: 'light', fn: () => stopEdit(false) }]);
  };
  function stopEdit(keep) {
    if (!editing) return;
    const { id, layer } = editing;
    layer.pm.disable();
    if (keep) {
      const geometry = layer.toGeoJSON().geometry;
      store.patch('fields', id, { geometry, areaDaa: polygonAreaM2(geometry) / 1000 }, actor());
      toast(t('common.saved'));
    }
    editing = null; hideBar(); ctx.redraw();
  }

  async function editInfo(f, draft) {
    const isNew = !f;
    const cur = f || draft || { name: '', crop: 'FRAAN', color: COLORS[store.all('fields').length % COLORS.length], areaDaa: 0 };
    const name = input({ value: cur.name, required: true, name: 'name' });
    const crop = select(CROPS.map((c) => [c.eppo, `${t(c.key)} (${c.eppo})`]), cur.crop, { name: 'crop' });
    const area = input({ type: 'number', step: '0.1', min: 0, value: cur.areaDaa ? Math.round(cur.areaDaa * 10) / 10 : '', name: 'area', disabled: cur.geometry ? true : null });
    const vs = store.all('varieties'), cts = store.all('crateTypes');
    const variety = select([['', '–'], ...vs.map((v) => [v.id, v.name])], cur.defaultVarietyId, { name: 'variety' });
    const crateType = select([['', '–'], ...cts.map((c) => [c.id, c.name])], cur.defaultCrateTypeId, { name: 'crateType' });
    const quality = select([['', '–'], ['A', 'A'], ['B', 'B'], ['C', 'C']], cur.defaultQuality, { name: 'quality' });
    const active = h('input', { type: 'checkbox', checked: cur.active !== false });
    let color = cur.color;
    const sw = h('div', { class: 'swatches' }, COLORS.map((c) => { const b = h('button', { type: 'button', class: `swatch ${c === color ? 'on' : ''}`, style: { background: c }, 'aria-label': c, onclick: () => { color = c; sw.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on')); b.classList.add('on'); } }); return b; }));
    const r = await modal(isNew ? t('fields.newTitle') : t('fields.editTitle'), h('div', { class: 'form-grid' },
      field(t('fields.name'), name), field(t('fields.crop'), crop), field(t('fields.areaDaa'), area, cur.geometry ? t('fields.areaFromMap') : null),
      h('div', { class: 'field full' }, h('span', { class: 'field-label' }, t('fields.defaults')), h('small', { class: 'hint' }, t('fields.defaultsHint'))),
      field(t('crate.variety'), variety), field(t('crate.type'), crateType), field(t('crate.quality'), quality),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('fields.color')), sw),
      h('label', { class: 'check' }, active, t('fields.activeLabel'))),
    [
      isNew ? null : { label: t('common.delete'), class: 'danger-light', value: 'delete' },
      { label: t('common.cancel'), class: 'ghost', value: null },
      { label: t('common.save'), class: 'primary', submit: true, onClick: () => {
        if (!name.value.trim()) { name.focus(); return false; }
        return { name: name.value.trim(), crop: crop.value, areaDaa: cur.geometry ? cur.areaDaa : Number(area.value) || 0, defaultVarietyId: variety.value || null, defaultCrateTypeId: crateType.value || null, defaultQuality: quality.value || null, color, active: active.checked };
      } },
    ].filter(Boolean), { wide: true });
    if (!r) { if (draft) ctx.redraw(); return; }
    if (r === 'delete') {
      if (!(await confirmDialog(t('fields.deleteTitle'), t('fields.deleteText', { name: cur.name }), t('common.delete')))) return;
      store.remove('fields', cur.id, actor()); toast(t('common.deleted')); return ctx.redraw();
    }
    store.put('fields', { ...cur, ...r }, actor());
    toast(t('common.saved'));
    ctx.redraw();
  }

  async function importFields() {
    const file = await pickFile('.kml,.zip,.geojson,.json');
    if (!file) return;
    let polys;
    try { polys = await parseFile(file); } catch (e) {
      return toast(e.message === 'shp-alone' ? t('fields.importShpZip') : e.message === 'format' ? t('fields.importFormat') : t('fields.importFailed') + ' ' + e.message, 'error');
    }
    if (!polys.length) return toast(t('fields.importNone'), 'error');
    if (!looksLikeWgs84(polys)) return toast(t('fields.importProjection'), 'error');
    const crop = select(CROPS.map((c) => [c.eppo, `${t(c.key)} (${c.eppo})`]), 'FRAAN');
    const rows = polys.map((p) => ({ p, cb: h('input', { type: 'checkbox', checked: true }), name: input({ value: p.name }) }));
    const ok = await modal(t('fields.importTitle', { n: polys.length }), h('div', { class: 'stack' },
      h('p', { class: 'muted' }, t('fields.importText', { file: file.name })), field(t('fields.crop'), crop),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, t('fields.name')), h('th', { class: 'num' }, t('unit.daa')))),
        h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.cb), h('td', {}, r.name), h('td', { class: 'num' }, fmtNum(r.p.areaDaa, 1)))))))),
    [{ label: t('common.cancel'), class: 'ghost', value: false }, { label: t('fields.importBtn'), class: 'primary', value: true, id: 'do-import' }], { wide: true });
    if (!ok) return;
    let n = 0;
    rows.forEach((r, i) => { if (!r.cb.checked) return; store.put('fields', { name: r.name.value.trim() || r.p.name, crop: crop.value, geometry: r.p.geometry, areaDaa: r.p.areaDaa, color: COLORS[(store.all('fields').length + i) % COLORS.length], source: file.name }, actor()); n++; });
    toast(t('fields.imported', { n }));
    ctx.redraw();
  }

  if (mapAvailable()) requestAnimationFrame(() => {
    if (!mapEl.isConnected) return;
    map = baseMap(mapEl);
    group = L.featureGroup().addTo(map);
    map.pm.setLang?.('no');
    map.on('pm:create', async (e) => {
      hideBar();
      const geometry = e.layer.toGeoJSON().geometry;
      map.removeLayer(e.layer);
      await editInfo(null, { name: '', crop: 'FRAAN', geometry, areaDaa: polygonAreaM2(geometry) / 1000, color: COLORS[store.all('fields').length % COLORS.length] });
    });
    fitToFields(map, store.all('fields'));
    drawAll();
    setTimeout(() => map?.invalidateSize(), 200);
  });
  else mapEl.replaceWith(h('div', { class: 'notice warn' }, icon('map'), h('p', {}, t('fields.noMap'))));
  return page;
}
