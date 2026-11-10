/* preflight/lib/meta.js — 元页面身份与排除集合（Node 与浏览器共用一份实现）
 *
 * 标记语义：页面 <head> 内的 <meta name="preflight-meta" content="1"> 表示
 *   「该页的自证断言读取上一轮回归结果（regression-result.json），
 *     因此不参与其它元页面的自证集合」。
 *
 * 为什么需要它：run-all 在本页结束后才写 JSON，元页面读到的永远是上一轮；
 * 若用写死的文件名列表互相排除，新增一张元页面就必须回头改所有旧页面，
 * 漏改一次就会把「元页面 FAIL」伪装成下一轮的三页连带 FAIL（自检替失败打掩护）。
 *
 * 排除集合的来源：run-all.ps1 逐页扫描 preflight/verify_*.html 的 <head>，
 * 命中标记的行写 meta=true；本文件只消费该标记，不维护任何文件名清单。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PreflightMeta = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MARKER_NAME = 'preflight-meta';
  var MARKER_HTML = 'name="preflight-meta"';

  // 页面源码是否声明了元页面身份
  function hasMarker(html) {
    return typeof html === 'string' && html.indexOf(MARKER_HTML) >= 0;
  }

  // 回归结果行 → 实质页面（meta 为真的是元页面，一律排除）
  function substantive(rows) {
    return (rows || []).filter(function (r) { return !r.meta; });
  }

  // 回归结果行 → 元页面名单（排序后返回，便于比对与展示）
  function metaNames(rows) {
    return (rows || [])
      .filter(function (r) { return !!r.meta; })
      .map(function (r) { return r.page; })
      .sort();
  }

  // 合成输入用：给定页面名与「哪些名字带标记」，返回应被排除的集合
  function excludeByName(names, markers) {
    var m = markers || {};
    return (names || []).filter(function (n) { return !!m[n]; }).sort();
  }

  return {
    MARKER_NAME: MARKER_NAME,
    MARKER_HTML: MARKER_HTML,
    hasMarker: hasMarker,
    substantive: substantive,
    metaNames: metaNames,
    excludeByName: excludeByName
  };
}));
