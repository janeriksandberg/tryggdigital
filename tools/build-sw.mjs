// Lager v2/sw.js med liste over alle filer som skal lagres for offline bruk, og en versjon som er en hash
// av innholdet. Da oppdateres appen automatisk når noe endres. Kjør: npm run build:sw
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'v2');
const SKIP = new Set(['sw.js', 'version.js']);
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (!SKIP.has(f) && !f.endsWith('.map') && !f.endsWith('.md') && !f.startsWith('.')) files.push(relative(root, p).split('\\').join('/'));
  }
})(root);
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
const version = hash.digest('hex').slice(0, 12);
// Versjonsmerke som appen viser (Hjelp-vinduet og menyen), så man ser hvilken versjon en enhet kjører.
const built = new Date().toISOString().slice(0, 16) + 'Z';
writeFileSync(join(root, 'js', 'version.js'), `// Generert av tools/build-sw.mjs – ikke rediger.\nexport const BUILD = { id: '${version.slice(0, 7)}', built: '${built}' };\n`);
files.push('js/version.js');
const tpl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sw-template.js'), 'utf8');
writeFileSync(join(root, 'sw.js'), tpl.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(['./', ...files], null, 1)));
console.log('sw.js', version, files.length, 'filer');
