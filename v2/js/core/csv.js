// CSV-import: kolonnenavn som i eksporten (name;regNo;substance;unit;phiDays;defaultDose;defaultUnit;maxDose;maxTimes;validUntil;notes)
export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = (line) => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()); };
  const head = split(lines[0]).map((x) => x.replace(/^'/, ''));
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v.replace(/^'(?=[=+\-@])/, '')])));
}
