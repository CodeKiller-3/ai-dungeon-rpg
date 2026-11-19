/* preflight/lib/geom.js — 战斗分区几何断言（Node 与浏览器共用一份实现）
 *
 * 用途：把「六类元素两两不交」写成一个可复用函数，后续布局卡片直接调用。
 * 输入矩形一律是逻辑坐标 {x, y, w, h}；空矩形（w<=0 或 h<=0）视为不存在，不参与判定。
 * 判定口径：边界相接不算相交（a.x+a.w === b.x 时 disjoint 为 true），与画布 fillRect 的覆盖语义一致。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PreflightGeom = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isRect(r) {
    return !!r && typeof r.x === 'number' && typeof r.y === 'number' &&
      typeof r.w === 'number' && typeof r.h === 'number' && r.w > 0 && r.h > 0;
  }

  function intersect(a, b) {
    if (!isRect(a) || !isRect(b)) return null;
    var x = Math.max(a.x, b.x);
    var y = Math.max(a.y, b.y);
    var r = Math.min(a.x + a.w, b.x + b.w);
    var d = Math.min(a.y + a.h, b.y + b.h);
    if (r <= x || d <= y) return null;
    return { x: x, y: y, w: r - x, h: d - y, area: (r - x) * (d - y) };
  }

  function disjoint(a, b) { return !intersect(a, b); }

  function inViewport(r, W, H) {
    return isRect(r) && r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
  }

  /* groups: [{ name: 'cards', rects: [{...}] }, ...]
   * skip: [['cards','hpBars'], ...]  —— 有意嵌套的例外必须显式列出（如规格 §5.1 的卡内血条） */
  function pairwise(groups, skip) {
    var skipSet = {};
    (skip || []).forEach(function (p) {
      var a = p[0], b = p[1];
      skipSet[a + '|' + b] = 1;
      skipSet[b + '|' + a] = 1;
    });
    var violations = [];
    for (var i = 0; i < groups.length; i++) {
      for (var j = i + 1; j < groups.length; j++) {
        var A = groups[i], B = groups[j];
        if (skipSet[A.name + '|' + B.name]) continue;
        for (var a = 0; a < (A.rects || []).length; a++) {
          for (var b = 0; b < (B.rects || []).length; b++) {
            var hit = intersect(A.rects[a], B.rects[b]);
            if (hit) {
              violations.push({ a: A.name, b: B.name, ai: a, bi: B && b,
                ra: A.rects[a], rb: B.rects[b], hit: hit });
            }
          }
        }
      }
    }
    return { ok: violations.length === 0, violations: violations };
  }

  function allInViewport(rects, W, H) {
    var bad = [];
    (rects || []).forEach(function (r, i) {
      if (!inViewport(r, W, H)) bad.push({ i: i, r: r });
    });
    return { ok: bad.length === 0, bad: bad };
  }

  /* ── D-103：颜色合成与 WCAG 对比度 ─────────────────────────────
   * 渲染层用半透明色叠加（条底 0.92、格底 0.05、文字 0.75），
   * 对比度必须先按 alpha 合成成不透明色再算，不能拿声明色直接比。
   * 支持 '#rgb' / '#rrggbb' / 'rgb(...)' / 'rgba(...)'，解析失败返回 null。 */
  function parseColor(s) {
    if (s && typeof s === 'object' && typeof s.r === 'number') {
      return { r: s.r, g: s.g, b: s.b, a: (typeof s.a === 'number') ? s.a : 1 };
    }
    var t = String(s == null ? '' : s).trim();
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: 1
      };
    }
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
    if (!m) return null;
    return {
      r: Number(m[1]), g: Number(m[2]), b: Number(m[3]),
      a: (m[4] === undefined) ? 1 : Number(m[4])
    };
  }

  /* fg over bg（标准 source-over；bg 也可以带 alpha） */
  function composite(fg, bg) {
    var f = parseColor(fg), b = parseColor(bg);
    if (!f || !b) return null;
    var a = f.a + b.a * (1 - f.a);
    if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (f.r * f.a + b.r * b.a * (1 - f.a)) / a,
      g: (f.g * f.a + b.g * b.a * (1 - f.a)) / a,
      b: (f.b * f.a + b.b * b.a * (1 - f.a)) / a,
      a: a
    };
  }

  /* 相对亮度（WCAG 2.x，sRGB 线性化） */
  function luminance(c) {
    var v = parseColor(c);
    if (!v) return null;
    function lin(x) {
      x = x / 255;
      return (x <= 0.04045) ? (x / 12.92) : Math.pow((x + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * lin(v.r) + 0.7152 * lin(v.g) + 0.0722 * lin(v.b);
  }

  /* 对比度（1–21）。两端都应是不透明色；带 alpha 时先自行 composite 到实底再传进来。 */
  function contrastRatio(a, b) {
    var la = luminance(a), lb = luminance(b);
    if (la === null || lb === null) return null;
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  return {
    isRect: isRect,
    intersect: intersect,
    disjoint: disjoint,
    inViewport: inViewport,
    pairwise: pairwise,
    allInViewport: allInViewport,
    parseColor: parseColor,
    composite: composite,
    luminance: luminance,
    contrastRatio: contrastRatio
  };
}));
