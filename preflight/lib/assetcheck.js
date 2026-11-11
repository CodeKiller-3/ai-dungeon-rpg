/* preflight/lib/assetcheck.js — 素材完整性检查（D-21，可复用）
 * 纯函数，无 DOM 依赖：浏览器与 Node 共用同一套判定。
 *   浏览器：先 statsFromImageData(name, imageData) 得到帧统计，再跑各检查
 *   Node  ：preflight/selfcheck/d21_audit.js 解码 PNG 后按同样结构传入
 * 输入帧统计帧结构：{ name: 'knight_m_hit_anim_f0', w, h, opaque, colors: ['#rrggbb', ...] }
 * 四类判定：空帧 / 尺寸不符 / 帧组缺号（含重号） / NAMES ↔ 文件不一致
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AssetCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 帧组名：去掉末尾 _fN；单帧图（无 _fN）自成一组 */
  function groupOf(name) {
    var base = String(name).replace(/\.png$/i, '');
    var m = /^(.*)_f(\d+)$/.exec(base);
    return { group: m ? m[1] : base, index: m ? parseInt(m[2], 10) : null };
  }

  /* 浏览器侧：把 canvas ImageData 变成帧统计（alpha>0 记为不透明） */
  function statsFromImageData(name, img) {
    var d = img.data, opaque = 0;
    var seen = {}, colors = [];
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      opaque++;
      var v = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (!seen[v]) {
        seen[v] = 1;
        colors.push('#' + ('000000' + v.toString(16)).slice(-6));
      }
    }
    return { name: name, w: img.width, h: img.height, opaque: opaque, colors: colors };
  }

  /* 1) 空帧：不透明像素为 0 */
  function emptyFrames(frames) {
    return frames.filter(function (f) { return !(f.opaque > 0); }).map(function (f) { return f.name; });
  }

  /* 1b) 近乎空帧：0 < 不透明像素 ≤ limit（默认 5） */
  function nearEmptyFrames(frames, limit) {
    var lim = typeof limit === 'number' ? limit : 5;
    return frames.filter(function (f) { return f.opaque > 0 && f.opaque <= lim; })
      .map(function (f) { return { name: f.name, opaque: f.opaque }; });
  }

  /* 2) 尺寸不符：同一帧组内尺寸必须唯一 */
  function dimsMismatch(frames) {
    var byGroup = {};
    frames.forEach(function (f) {
      var g = groupOf(f.name).group;
      (byGroup[g] = byGroup[g] || {});
      byGroup[g][f.w + 'x' + f.h] = 1;
    });
    var out = [];
    Object.keys(byGroup).sort().forEach(function (g) {
      var dims = Object.keys(byGroup[g]);
      if (dims.length > 1) out.push({ group: g, dims: dims });
    });
    return out;
  }

  /* 3) 帧组编号：从 0 起连续、不重号（单帧图不参与） */
  function indexIssues(frames) {
    var byGroup = {};
    frames.forEach(function (f) {
      var gi = groupOf(f.name);
      if (gi.index === null) return;
      (byGroup[gi.group] = byGroup[gi.group] || []).push(gi.index);
    });
    var out = [];
    Object.keys(byGroup).sort().forEach(function (g) {
      var idx = byGroup[g].slice().sort(function (a, b) { return a - b; });
      var max = idx[idx.length - 1];
      var missing = [];
      for (var i = 0; i <= max; i++) if (idx.indexOf(i) < 0) missing.push(i);
      var dup = idx.filter(function (v, i) { return idx.indexOf(v) !== i; });
      if (!idx.length || idx[0] !== 0) missing.unshift(0);
      if (missing.length || dup.length) out.push({ group: g, missing: missing, dup: dup });
    });
    return out;
  }

  /* 4) NAMES ↔ 文件：缺文件 / 多文件 / 重名 */
  function namesDiff(names, diskFiles) {
    var nameSet = {}, diskSet = {}, dupNames = [];
    names.forEach(function (n) { if (nameSet[n]) dupNames.push(n); nameSet[n] = 1; });
    diskFiles.forEach(function (f) { diskSet[String(f).replace(/\.png$/i, '')] = 1; });
    return {
      missingFiles: names.filter(function (n) { return !diskSet[n]; }),
      extraFiles: Object.keys(diskSet).filter(function (n) { return !nameSet[n]; }).sort(),
      dupNames: dupNames
    };
  }

  /* 5) 调色板：不透明像素颜色必须全部落在给定集合内 */
  function paletteViolations(frames, palette) {
    var pal = {};
    palette.forEach(function (c) { pal[String(c).toLowerCase()] = 1; });
    var out = [];
    frames.forEach(function (f) {
      var bad = (f.colors || []).filter(function (c) { return !pal[String(c).toLowerCase()]; });
      if (bad.length) out.push({ name: f.name, colors: bad });
    });
    return out;
  }

  return {
    groupOf: groupOf,
    statsFromImageData: statsFromImageData,
    emptyFrames: emptyFrames,
    nearEmptyFrames: nearEmptyFrames,
    dimsMismatch: dimsMismatch,
    indexIssues: indexIssues,
    namesDiff: namesDiff,
    paletteViolations: paletteViolations
  };
});
