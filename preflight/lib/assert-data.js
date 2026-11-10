/* preflight/lib/assert-data.js — D-05：自检工具的文档解析共享实现
 * 目的：让「README 条目数」与「C5-5 文档百分数」两处校验只依赖数据、不依赖固定句式。
 * 使用方：preflight/selfcheck/selfcheck.js（Node require）
 *         preflight/verify_c05.html、preflight/verify_d05.html（浏览器 <script>）
 * 说明：本文件不进入游戏运行时，index.html 不加载。 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AssertData = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ── 1. README 物品条目数 ─────────────────────────────
   * 支持：「物品全表 48 件」「物品 48 条」「物品共 48 件」「48 件物品」
   * 返回：文档中解析到的所有声明值（去重前，便于定位冲突） */
  function parseItemCounts(text) {
    var s = String(text || '');
    var out = [], m;
    var reAfter = /物品(?:全表|共|总计|条目)?[^\d\n]{0,10}?(\d+)\s*[条件]/g;
    while ((m = reAfter.exec(s)) !== null) out.push(Number(m[1]));
    var reBefore = /(\d+)\s*[条件]\s*物品/g;
    while ((m = reBefore.exec(s)) !== null) out.push(Number(m[1]));
    return out;
  }

  /* 与实际条数比对：未解析到声明也算不通过（避免"检查被悄悄跳过"） */
  function checkItemCount(text, actual) {
    var vals = parseItemCounts(text);
    var bad = vals.filter(function (v) { return v !== actual; });
    return {
      ok: vals.length > 0 && bad.length === 0,
      parsed: vals,
      actual: actual,
      reason: vals.length === 0
        ? '未解析到物品条目数声明'
        : (bad.length ? '声明值 ' + bad.join('/') + ' ≠ 实际 ' + actual : '')
    };
  }

  /* ── 2. C5-5 文档百分数（数据驱动） ───────────────────
   * 只扫描 Q-learning 相关段落：README 含 "Q-learning" 的行、讲稿 §三.4 整节。
   * 规则：① 六个实测值（Q 中位数/区间端点、随机中位数/区间端点）必须都出现；
   *       ② 段落内不得出现白名单外的百分数（允许 demoAllow，演示页快照值）；
   *       ③ 中位数必须落在各自区间内。 */
  var DEFAULTS = {
    qMedian: 22, qMin: 9, qMax: 31,
    rMedian: 5, rMin: 2, rMax: 12,
    demoAllow: [17] /* 演示页单图快照值（D-02 入库），与离线口径分开登记 */
  };

  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) {
      var k = String(v);
      if (!seen[k]) { seen[k] = true; out.push(v); }
    });
    return out;
  }

  function qSections(readme, speech) {
    var readmeSec = String(readme || '').split('\n').filter(function (l) {
      return l.indexOf('Q-learning') >= 0;
    }).join('\n');
    var s = String(speech || '');
    var i = s.indexOf('**4. Q-learning 寻宝鼠**');
    var j = i >= 0 ? s.indexOf('\n## ', i + 1) : -1;
    var speechSec = i >= 0 ? s.slice(i, j > 0 ? j : i + 1500) : '';
    return { readme: readmeSec, speech: speechSec };
  }

  function extractPercents(txt) {
    var out = [], m;
    var re = /(\d+(?:\.\d+)?)\s*%/g;
    var s = String(txt || '');
    while ((m = re.exec(s)) !== null) out.push(Number(m[1]));
    return out;
  }

  function checkC55(readme, speech, opt) {
    var E = {};
    ['qMedian', 'qMin', 'qMax', 'rMedian', 'rMin', 'rMax'].forEach(function (k) {
      E[k] = opt && typeof opt[k] === 'number' ? opt[k] : DEFAULTS[k];
    });
    E.demoAllow = (opt && opt.demoAllow) || DEFAULTS.demoAllow;
    var required = [E.qMedian, E.qMin, E.qMax, E.rMedian, E.rMin, E.rMax];
    var allow = uniq(required.concat(E.demoAllow));

    var sec = qSections(readme, speech);
    var res = { ok: true, reasons: [], allow: allow, required: required, readme: null, speech: null };

    ['readme', 'speech'].forEach(function (k) {
      var list = uniq(extractPercents(sec[k]));
      var missing = required.filter(function (v) { return list.indexOf(v) < 0; });
      var extra = list.filter(function (v) { return allow.indexOf(v) < 0; });
      res[k] = { percents: list, missing: missing, extra: extra };
      if (!sec[k]) res.reasons.push(k + ' 未找到 Q-learning 段落');
      if (missing.length) res.reasons.push(k + ' 缺少实测值 ' + missing.join('/'));
      if (extra.length) res.reasons.push(k + ' 出现白名单外百分数 ' + extra.join('/'));
    });
    if (!(E.qMin <= E.qMedian && E.qMedian <= E.qMax)) res.reasons.push('Q 中位数不在区间内');
    if (!(E.rMin <= E.rMedian && E.rMedian <= E.rMax)) res.reasons.push('随机中位数不在区间内');

    res.ok = res.reasons.length === 0;
    return res;
  }

  return {
    parseItemCounts: parseItemCounts,
    checkItemCount: checkItemCount,
    extractPercents: extractPercents,
    qSections: qSections,
    checkC55: checkC55
  };
});
