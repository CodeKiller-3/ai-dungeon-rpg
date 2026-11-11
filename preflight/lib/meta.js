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

  /* ── D-15b：产物溯源与防篡改 ─────────────────────────────────
   * run-all 每次运行生成一个 runId，逐页结束即把行写入 current-run.json（本轮台账），
   * 全部结束后再写 regression-result.json（含同一 runId 与 rowsHash）。
   * 页面读到的 JSON 若 runId 与自己的 `?run=` 不同，则这些行是上一轮的——
   * 机器可读地区分 current-run / previous-run，而不是靠人工判断。 */

  // 从 location.search 取本轮 runId（run-all 以 ?run=<id> 打开每个页面）
  function runIdFromSearch(search) {
    var m = /[?&]run=([^&]+)/.exec(search || '');
    return m ? decodeURIComponent(m[1]) : '';
  }

  // FNV-1a 32 位；canonical() 只含 ASCII（页面名/裁决/布尔/run 标记/整数毫秒）
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  // 行的规范化文本：page|verdict|meta|source|ms，行间以 \n 连接（无尾随换行）
  function canonical(rows) {
    return (rows || []).map(function (r) {
      return r.page + '|' + r.verdict + '|' + (r.meta ? 'true' : 'false') + '|' +
        (r.source || '') + '|' + r.ms;
    }).join('\n');
  }

  // 产物指纹：run-all.ps1 的 Get-RowsHash 用同一规范化文本与同一 FNV 参数
  function rowsHash(rows) {
    return fnv1a(canonical(rows));
  }

  // 给行标注来源：JSON 的 runId 与本轮一致 → current-run，否则 previous-run
  function annotate(rows, jsonRunId, myRunId) {
    var same = !!jsonRunId && !!myRunId && jsonRunId === myRunId;
    return (rows || []).map(function (r) {
      var c = {};
      for (var k in r) {
        if (Object.prototype.hasOwnProperty.call(r, k)) c[k] = r[k];
      }
      c.source = same ? 'current-run' : 'previous-run';
      return c;
    });
  }

  return {
    MARKER_NAME: MARKER_NAME,
    MARKER_HTML: MARKER_HTML,
    hasMarker: hasMarker,
    substantive: substantive,
    metaNames: metaNames,
    excludeByName: excludeByName,
    runIdFromSearch: runIdFromSearch,
    fnv1a: fnv1a,
    canonical: canonical,
    rowsHash: rowsHash,
    annotate: annotate
  };
}));
