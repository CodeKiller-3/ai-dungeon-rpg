/* preflight/selfcheck/d21_fix.js — D-21 坏帧修复 + 8 倍放大对照图生成（唯一会写 assets/sprites 的脚本）
 * 用法：
 *   node preflight/selfcheck/d21_fix.js --preview knight_m_hit   # 只出"修复前"预览，不写素材
 *   node preflight/selfcheck/d21_fix.js --fix                    # 修复空帧（从同组其它帧程序化派生）并出前后对照图
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'assets', 'sprites');
const SHOTS = path.join(__dirname, 'shots');

/* ── 复用 d21_audit 的解码器 ── */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, inter = 0;
  let plte = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; inter = data[12]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (inter !== 0 || bd !== 8) throw new Error('unsupported png');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const chan = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
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
  return { w, h, rgba };
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = -1; for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();

/* 最小 PNG 编码（RGBA8，无滤波） */
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    rows[y * (w * 4 + 1)] = 0;
    rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* 把若干行帧横向拼成对照图：每帧 8 倍放大 + 棋盘底 + 行首标签（色块，无字体依赖） */
function renderRows(rows, scale, outPath) {
  const pad = 6, labelH = 10;
  const cols = Math.max(...rows.map((r) => r.length));
  const fw = rows[0][0].w, fh = rows[0][0].h;
  const cw = fw * scale, ch = fh * scale;
  const W = cols * (cw + pad) + pad;
  const H = rows.length * (ch + pad + labelH) + pad;
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dark = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      const v = dark ? 40 : 56;
      out[i] = v; out[i + 1] = v; out[i + 2] = v + 6; out[i + 3] = 255;
    }
  }
  rows.forEach((frames, rn) => {
    const baseY = pad + rn * (ch + pad + labelH) + labelH;
    frames.forEach((f, n) => {
      const ox = pad + n * (cw + pad), oy = baseY;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const i = ((oy + y) * W + ox + x) * 4;
        out[i] = 24; out[i + 1] = 26; out[i + 2] = 34;
      }
      for (let y = 0; y < f.h * scale; y++) {
        for (let x = 0; x < f.w * scale; x++) {
          const src = ((Math.floor(y / scale)) * f.w + Math.floor(x / scale)) * 4;
          const a = f.rgba[src + 3];
          if (a === 0) continue;
          const i = ((oy + y) * W + ox + x) * 4;
          const k = a / 255;
          out[i] = Math.round(f.rgba[src] * k + out[i] * (1 - k));
          out[i + 1] = Math.round(f.rgba[src + 1] * k + out[i + 1] * (1 - k));
          out[i + 2] = Math.round(f.rgba[src + 2] * k + out[i + 2] * (1 - k));
          out[i + 3] = 255;
        }
      }
      /* 帧号：n+1 个白色小方块 */
      for (let k = 0; k <= n; k++) {
        for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
          const i = ((baseY - labelH + y) * W + ox + k * 8 + x) * 4;
          out[i] = 240; out[i + 1] = 240; out[i + 2] = 240; out[i + 3] = 255;
        }
      }
    });
  });
  fs.writeFileSync(outPath, encodePNG(W, H, out));
  return { file: outPath, w: W, h: H };
}

function strip(frames, scale, outPath) { return renderRows([frames], scale, outPath); }
function compare(a, b, scale, outPath) { return renderRows([a, b], scale, outPath); }

function load(name) {
  const img = decodePNG(fs.readFileSync(path.join(DIR, name + '.png')));
  return { name, w: img.w, h: img.h, rgba: img.rgba };
}
function opaqueCount(f) {
  let n = 0;
  for (let i = 3; i < f.rgba.length; i += 4) if (f.rgba[i] > 0) n++;
  return n;
}

const args = process.argv.slice(2);
const pre = (process.argv.find((a) => a.startsWith('--preview=')) || '').split('=')[1];
const doFix = args.includes('--fix');

if (pre) {
  const names = fs.readdirSync(DIR).filter((f) => f.startsWith(pre) && f.endsWith('.png')).sort();
  const frames = names.map((f) => load(f.replace(/\.png$/, '')));
  const r = strip(frames, 8, path.join(SHOTS, 'D21-' + pre.replace(/_$/, '') + '-before.png'));
  console.log('PREVIEW ' + r.file + ' ' + r.w + 'x' + r.h + ' frames=' + frames.map((f) => opaqueCount(f)).join('/'));
}

if (doFix) {
  /* 空帧判定：不透明像素为 0 */
  const bad = [];
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.png'))) {
    const img = load(f.replace(/\.png$/, ''));
    if (opaqueCount(img) === 0) bad.push(img.name);
  }
  console.log('EMPTY=' + JSON.stringify(bad));

  /* 修复规则表：每个坏帧登记"从同组哪一帧、怎么派生"，不跨组借图、不新增颜色 */
  const RULES = {
    knight_m_hit_anim_f1: { from: 'knight_m_hit_anim_f0', dx: -1, dy: 1, why: '受击顿挫：整帧左下位移 1 像素，颜色与尺寸完全不变' }
  };

  const before = {};
  for (const name of bad) {
    const rule = RULES[name];
    if (!rule) { console.log('NO_RULE ' + name); continue; }
    const src = load(rule.from);
    const old = load(name);
    before[name] = old;
    /* 逐像素搬运（整数位移，透明填充），像素值原样复制 → 不产生新颜色 */
    const dst = Buffer.alloc(src.w * src.h * 4);
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const sx = x - rule.dx, sy = y - rule.dy;
        if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
        const si = (sy * src.w + sx) * 4, di = (y * src.w + x) * 4;
        src.rgba.copy(dst, di, si, si + 4);
      }
    }
    const colsBefore = new Set();
    for (let i = 0; i < dst.length; i += 4) if (dst[i + 3] > 0) colsBefore.add(dst.readUIntBE(i, 3));
    const colsSrc = new Set();
    for (let i = 0; i < src.rgba.length; i += 4) if (src.rgba[i + 3] > 0) colsSrc.add(src.rgba.readUIntBE(i, 3));
    const newColors = [...colsBefore].filter((c) => !colsSrc.has(c));
    fs.writeFileSync(path.join(DIR, name + '.png'), encodePNG(src.w, src.h, dst));
    const after = { name, w: src.w, h: src.h, rgba: dst };
    console.log('FIXED ' + name + ' from=' + rule.from + ' d=' + rule.dx + ',' + rule.dy +
      ' opaque ' + opaqueCount(old) + '→' + opaqueCount(after) + ' newColors=' + JSON.stringify(newColors) +
      ' sameSize=' + (old.w === after.w && old.h === after.h));

    /* 前后对照图：上排修复前 f0..f3，下排修复后 f0..f3，8 倍放大 */
    const pre = name.replace(/_f\d+$/, '');
    const names = fs.readdirSync(DIR).filter((f) => f.startsWith(pre) && f.endsWith('.png')).sort();
    const rowBefore = names.map((f) => {
      const n = f.replace(/\.png$/, '');
      return n === name ? old : load(n);
    });
    const rowAfter = names.map((f) => load(f.replace(/\.png$/, '')));
    const out = path.join(SHOTS, 'D21-' + pre + '-before-after.png');
    const r = compare(rowBefore, rowAfter, 8, out);
    console.log('COMPARE ' + r.file + ' ' + r.w + 'x' + r.h);
  }
}
