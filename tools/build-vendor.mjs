// Bygger og kopierer tredjepartsbiblioteker til v2/vendor og ikonsettet til v2/js/icons.js.
// Kjør: npm run vendor
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'v2', 'vendor');
mkdirSync(join(out, 'images'), { recursive: true });

const common = { bundle: true, format: 'esm', minify: true, target: ['es2020'], legalComments: 'eof', logLevel: 'warning' };
await build({ ...common, entryPoints: [join(root, 'tools/firebase-entry.js')], outfile: join(out, 'firebase.js') });
await build({ ...common, stdin: { contents: "export { default as shp, parseShp, parseDbf, combine } from 'shpjs';", resolveDir: root }, outfile: join(out, 'shp.js'), platform: 'browser' });
await build({ ...common, stdin: { contents: "export { kml } from '@tmcw/togeojson';", resolveDir: root }, outfile: join(out, 'togeojson.js') });

// Biblioteker som allerede er kontrollert og brukes i v1 (kopieres slik at v2 er uavhengig av v1-filene)
for (const f of ['leaflet.js', 'leaflet.css', 'leaflet-geoman.min.js', 'leaflet-geoman.css', 'qrcode.js', 'barcode-ponyfill.js', 'zxing_reader.wasm']) {
  copyFileSync(join(root, 'vendor', f), join(out, f));
}
for (const f of readdirSync(join(root, 'vendor', 'images'))) copyFileSync(join(root, 'vendor', 'images', f), join(out, 'images', f));

// Ikoner fra Lucide (ISC-lisens). Bare de som brukes tas med.
const ICONS = JSON.parse(readFileSync(join(root, 'tools/icons.json'), 'utf8'));
const dir = join(root, 'node_modules/lucide-static/icons');
const body = {};
for (const [alias, name] of Object.entries(ICONS)) {
  const svg = readFileSync(join(dir, name + '.svg'), 'utf8');
  body[alias] = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
}
writeFileSync(join(root, 'v2/js/icons.js'),
  '// Generert av tools/build-vendor.mjs fra lucide-static (ISC-lisens). Ikke rediger for hånd.\n' +
  'export const ICONS = ' + JSON.stringify(body, null, 0).replace(/","/g, '",\n"') + ';\n');
console.log('vendor ok', Object.keys(body).length, 'ikoner');
