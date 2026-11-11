/* preflight/selfcheck/d21_audit.js — D-21 素材完整性审计（Node 端，只读）
 * 用途：对 assets/sprites/ 全部 PNG 逐张解码，输出尺寸/不透明像素数/颜色集合等事实，
 *       并做帧组一致性、NAMES 一致性检查，落盘 d21-audit.json 供验证页与文档消费。
 * 用法：node preflight/selfcheck/d21_audit.js [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'assets', 'sprites');

/* ── 最小 PNG 解码（8bit / 非隔行 / colorType 0,2,3,4,6）── */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, inter = 0;
  let plte = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bd = data[8]; ct = data[9]; inter = data[12];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (inter !== 0) throw new Error('interlaced png unsupported');
  if (bd !== 8) throw new Error('bitDepth ' + bd + ' unsupported');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const chan = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!chan) throw new Error('colorType ' + ct + ' unsupported');
  const stride = w * chan;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= chan ? cur[x - chan] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= chan) ? prev[x - chan] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  /* 统一展开成 RGBA8 */
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (ct === 6) { r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; }
    else if (ct === 2) { r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; }
    else if (ct === 0) { r = g = b = out[i]; }
    else if (ct === 4) { r = g = b = out[i * 2]; a = out[i * 2 + 1]; }
    else { const idx = out[i]; r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2]; a = trns && idx < trns.length ? trns[idx] : 255; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w, h, ct, bd, rgba };
}

function stat(name, buf) {
  const img = decodePNG(buf);
  const { w, h, rgba } = img;
  let opaque = 0, full = 0, semi = 0;
  const colors = new Set();
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = rgba[i + 3];
      if (a === 0) continue;
      opaque++;
      if (a === 255) full++; else semi++;
      colors.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  return {
    name, w, h, opaque, full, semi, colorCount: colors.size,
    colors: [...colors].sort((a, b) => a - b).map((v) => '#' + v.toString(16).padStart(6, '0')),
    bbox: maxX < 0 ? null : [minX, minY, maxX, maxY]
  };
}

const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.png')).sort();
const stats = files.map((f) => stat(f, fs.readFileSync(path.join(DIR, f))));

/* ── 帧组：name 去掉末尾 _fN ── */
const groups = {};
for (const s of stats) {
  const base = s.name.replace(/\.png$/, '');
  const m = /^(.*)_f(\d+)$/.exec(base);
  const key = m ? m[1] : base;
  const idx = m ? parseInt(m[2], 10) : null;
  (groups[key] = groups[key] || []).push({ name: base, idx, w: s.w, h: s.h, opaque: s.opaque });
}
const groupRows = Object.keys(groups).sort().map((k) => {
  const g = groups[k].slice().sort((a, b) => (a.idx ?? -1) - (b.idx ?? -1));
  const dims = [...new Set(g.map((x) => x.w + 'x' + x.h))];
  const idxs = g.map((x) => x.idx).filter((x) => x !== null);
  const expect = idxs.length ? Array.from({ length: Math.max(...idxs) + 1 }, (_, i) => i) : [];
  const missing = expect.filter((i) => !idxs.includes(i));
  const dup = idxs.filter((v, i) => idxs.indexOf(v) !== i);
  return { group: k, frames: g.length, dims, dimsOk: dims.length === 1, missing, dup, files: g.map((x) => x.name) };
});

/* ── NAMES 一致性（从 sprites.js 源抽取）── */
const src = fs.readFileSync(path.join(ROOT, 'js', 'core', 'sprites.js'), 'utf8');
const namesBlock = src.slice(src.indexOf('var NAMES ='), src.indexOf('];', src.indexOf('var NAMES =')));
const names = [...namesBlock.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
const diskSet = new Set(files.map((f) => f.replace(/\.png$/, '')));
const nameSet = new Set(names);
const missingFiles = names.filter((n) => !diskSet.has(n));
const extraFiles = [...diskSet].filter((n) => !nameSet.has(n));
const dupNames = names.filter((v, i) => names.indexOf(v) !== i);

/* ── 全量调色板（不透明像素 RGB 并集）── */
const palette = new Set();
for (const s of stats) for (const c of s.colors) palette.add(c);

/* 四类判定统一走 preflight/lib/assetcheck.js（与浏览器验证页同一套实现） */
const AC = require(path.join(__dirname, '..', 'lib', 'assetcheck.js'));
const acStats = stats.map((s) => ({ name: s.name, w: s.w, h: s.h, opaque: s.opaque, colors: s.colors }));

const empty = AC.emptyFrames(acStats);
const nearEmpty = AC.nearEmptyFrames(acStats, 5);

const report = {
  at: new Date().toISOString(),
  total: stats.length,
  paletteSize: palette.size,
  palette: [...palette].sort(),
  empty, nearEmpty,
  dimsBad: AC.dimsMismatch(acStats),
  indexBad: AC.indexIssues(acStats),
  names: Object.assign({ count: names.length }, AC.namesDiff(names, files)),
  paletteBad: AC.paletteViolations(acStats, [...palette]),
  files: stats,
  groups: groupRows
};

const argDump = process.argv.find((a) => a.startsWith('--dump='));
if (argDump) {
  const pre = argDump.split('=')[1];
  for (const s of stats.filter((x) => x.name.startsWith(pre))) {
    const img = decodePNG(fs.readFileSync(path.join(DIR, s.name)));
    console.log('\n== ' + s.name + ' ' + img.w + 'x' + img.h + ' opaque=' + s.opaque);
    for (let y = 0; y < img.h; y++) {
      let row = '';
      for (let x = 0; x < img.w; x++) {
        const i = (y * img.w + x) * 4, a = img.rgba[i + 3];
        if (a === 0) { row += '.'; continue; }
        const hex = ((img.rgba[i] << 16) | (img.rgba[i + 1] << 8) | img.rgba[i + 2]).toString(16).padStart(6, '0');
        row += /^(0{6}|f{6})$/.test(hex) ? (hex === '000000' ? 'k' : 'W') : String.fromCharCode(97 + (s.colors.indexOf('#' + hex) % 26));
      }
      console.log(String(y).padStart(2, ' ') + ' ' + row);
    }
  }
  process.exit(0);
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2));
} else if (process.argv.includes('--md')) {
  /* 逐文件全表 + 分组表，供人工逐行核对 */
  const L = [];
  L.push('# D-21 素材完整性审计全表', '');
  L.push('- 生成时间：' + report.at);
  L.push('- 文件总数：' + report.total + '，帧组：' + groupRows.length + '，调色板：' + report.paletteSize + ' 色');
  L.push('- 空帧：' + (empty.length ? empty.join(', ') : '无') + '；近乎空帧（≤5 px）：' + (nearEmpty.length ? JSON.stringify(nearEmpty) : '无'));
  L.push('- 尺寸不符：' + (report.dimsBad.length ? JSON.stringify(report.dimsBad) : '无') + '；编号断号/重号：' + (report.indexBad.length ? JSON.stringify(report.indexBad) : '无'));
  L.push('- NAMES：注册 ' + names.length + ' / 磁盘 ' + stats.length + ' / 缺文件 ' + missingFiles.length + ' / 多文件 ' + extraFiles.length + ' / 重名 ' + dupNames.length);
  L.push('', '## 逐文件（' + stats.length + ' 行）', '');
  L.push('| # | 文件 | 尺寸 | 不透明 | 全不透明 | 半透明 | 颜色数 | 帧组 |');
  L.push('|---:|---|---|---:|---:|---:|---:|---|');
  stats.forEach((s, i) => {
    const base = s.name.replace(/\.png$/, '');
    const m = /^(.*)_f(\d+)$/.exec(base);
    L.push('| ' + (i + 1) + ' | ' + s.name + ' | ' + s.w + '×' + s.h + ' | ' + s.opaque + ' | ' + s.full + ' | ' + s.semi + ' | ' + s.colorCount + ' | ' + (m ? m[1] + ' (f' + m[2] + ')' : '—') + ' |');
  });
  L.push('', '## 帧组（' + groupRows.length + ' 组）', '');
  L.push('| 帧组 | 帧数 | 尺寸 | 尺寸一致 | 缺号 | 重号 |');
  L.push('|---|---:|---|---|---|---|');
  groupRows.forEach((g) => {
    L.push('| ' + g.group + ' | ' + g.frames + ' | ' + g.dims.join(' / ') + ' | ' + (g.dimsOk ? '✓' : '✗') + ' | ' + (g.missing.length ? g.missing.join(',') : '—') + ' | ' + (g.dup.length ? g.dup.join(',') : '—') + ' |');
  });
  L.push('', '## 调色板（' + report.paletteSize + ' 色）', '', '```');
  L.push(report.palette.join(' '));
  L.push('```');
  process.stdout.write(L.join('\n') + '\n');
} else {
  console.log('TOTAL=' + report.total + ' PALETTE=' + report.paletteSize);
  console.log('EMPTY=' + JSON.stringify(empty));
  console.log('NEAR_EMPTY=' + JSON.stringify(nearEmpty));
  console.log('DIMS_BAD=' + JSON.stringify(report.dimsBad));
  console.log('INDEX_BAD=' + JSON.stringify(report.indexBad));
  console.log('NAMES=' + JSON.stringify(report.names));
  console.log('GROUPS=' + groupRows.length);
}
