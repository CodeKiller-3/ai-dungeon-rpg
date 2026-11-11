/* js/systems/notice.js — D-14：底部提示条（ui:notice 的唯一订阅方）
 * 背景：全仓 9 处 emit('ui:notice') 却没有任何订阅者，陷阱扣血 / 开宝箱 / 任务完成 /
 *      技能失败 / 读档提示 / 换层全部无声。本模块把消息渲染成屏幕底部的短提示条。
 * 生命周期（任务卡 D-14 §1）：
 *   - 最多同时显示 3 条，超出踢掉最旧的；
 *   - 每条存活 LIFE=2400ms，最后 FADE=400ms 线性淡出；
 *   - 同一文本在 1500ms 内重复、或同一条还在显示时再次到达 → 忽略（不堆叠刷屏）。
 * 绘制位置：画布底部、既有底部操作提示（render.js drawHUD 的 FPS 行）之上，
 *          不覆盖顶部 HUD 条带（0~22px），也不覆盖画面中心的玩家区域。
 * 接口：Game.Notice.push(text|{msg}) / update(dt) / draw() / _list() / _historyTexts()
 *      / _rect() / _clear() / _setClock(ms|null)
 * 不进任何数值链路，不新增事件频道。
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};

  var MAX = 3;              /* 同时最多显示条数 */
  var LIFE = 2400;          /* 单条存活 ms */
  var FADE = 400;           /* 末尾淡出 ms */
  var DEDUPE_MS = 1500;     /* 同文本去重窗口 ms */
  var LINE_H = 19;          /* 行高 */
  var PAD_X = 9;            /* 文本左右内边距 */
  var GAP = 4;              /* 条与条间距 */
  var BOTTOM_GAP = 24;      /* 距画布底部（让开 FPS 提示行） */

  var items = [];           /* [{ text, kind, bornAt }] 旧→新 */
  var history = [];         /* [{ text, at }] 全部到达过的消息（验证页断言用） */
  var lastText = '';
  var lastAt = -1e9;
  var drawRects = [];       /* 最近一帧实际绘制的矩形（验证页断言不遮挡用） */
  var clockOverride = null;

  function nowMs() {
    if (typeof clockOverride === 'number') return clockOverride;
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function normKind(kind, ok) {
    if (kind === 'warn' || kind === 'ok' || kind === 'info') return kind;
    if (ok === false) return 'warn';
    if (ok === true) return 'ok';
    return 'info';
  }

  function push(arg) {
    var text = '';
    var kind = 'info';
    var ok;
    if (typeof arg === 'string') text = arg;
    else if (arg && typeof arg.msg === 'string') { text = arg.msg; kind = arg.kind; ok = arg.ok; }
    else if (arg && typeof arg.text === 'string') { text = arg.text; kind = arg.kind; ok = arg.ok; }
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    var t = nowMs();
    /* 去重：正在显示的同文本、或 DEDUPE_MS 内刚出现过 → 忽略 */
    for (var i = 0; i < items.length; i++) if (items[i].text === text) return null;
    if (text === lastText && t - lastAt < DEDUPE_MS) return null;
    if (items.length >= MAX) items.shift();
    var entry = { text: text, kind: normKind(kind, ok), bornAt: t };
    items.push(entry);
    lastText = text;
    lastAt = t;
    history.push({ text: text, at: t });
    if (history.length > 80) history.shift();
    return entry;
  }

  /* 生命周期推进：清掉过期条目（绘制时按年龄算透明度，故这里只做淘汰） */
  function update(dt) {
    var t = nowMs();
    for (var i = items.length - 1; i >= 0; i--) {
      if (t - items[i].bornAt >= LIFE) items.splice(i, 1);
    }
    /* dt 仅用于兼容主循环的统一签名；时钟由 nowMs 提供 */
    void dt;
  }

  function alphaOf(entry, t) {
    var age = t - entry.bornAt;
    if (age < 0) return 1;
    if (age <= LIFE - FADE) return 1;
    var a = (LIFE - age) / FADE;
    return Math.max(0, Math.min(1, a));
  }

  var COLORS = {
    warn: { border: '#ff8a5c', text: '#ffd9c7' },
    ok: { border: '#8fe3a0', text: '#d8ffe2' },
    info: { border: '#7fd1ff', text: '#e6f4ff' }
  };

  function draw() {
    drawRects = [];
    var R = Game.Core && Game.Core.Render;
    var ctx = R && R._ctx;
    if (!ctx || !items.length) return;
    if (typeof R._applyDpr === 'function') R._applyDpr();
    var W = (R && typeof R.cssW === 'number') ? R.cssW : 0;
    var H = (R && typeof R.cssH === 'number') ? R.cssH : 0;
    if (!W || !H) return;
    var t = nowMs();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '12px monospace';
    /* D-19：战斗场景的指令图例在 H-30，提示条按探索场景的 BOTTOM_GAP 会压住图例；
     * 只在战斗场景上移 26px（生命周期/去重/配色等语义全部不变）。 */
    var inBattle = Game.Core.Main && Game.Core.Main._scene === 'battle';
    var bottom = H - (inBattle ? BOTTOM_GAP + 26 : BOTTOM_GAP);
    for (var i = items.length - 1; i >= 0; i--) {
      var e = items[i];
      var a = alphaOf(e, t);
      if (a <= 0) continue;
      var tw = ctx.measureText(e.text).width;
      var bw = Math.min(tw + PAD_X * 2, W - 16);
      var bx = Math.round((W - bw) / 2);
      var by = bottom - LINE_H;
      var col = COLORS[e.kind] || COLORS.info;
      ctx.globalAlpha = 0.82 * a;
      ctx.fillStyle = '#06060c';
      ctx.fillRect(bx, by, bw, LINE_H);
      ctx.globalAlpha = a;
      ctx.strokeStyle = col.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, LINE_H - 1);
      ctx.fillStyle = col.text;
      ctx.fillText(e.text, W / 2, by + LINE_H / 2 + 1, bw - PAD_X * 2);
      drawRects.push({ x: bx, y: by, w: bw, h: LINE_H, alpha: a, text: e.text });
      bottom = by - GAP;
    }
    ctx.restore();
  }

  if (Game.Core && Game.Core.EventBus && typeof Game.Core.EventBus.on === 'function') {
    Game.Core.EventBus.on('ui:notice', function (payload) { push(payload); });
  }

  Game.Notice = {
    MAX: MAX,
    LIFE: LIFE,
    FADE: FADE,
    DEDUPE_MS: DEDUPE_MS,
    push: push,
    update: update,
    draw: draw,

    /* 当前显示队列快照（验证页断言用） */
    _list: function () {
      var t = nowMs(), out = [];
      for (var i = 0; i < items.length; i++) {
        out.push({ text: items[i].text, kind: items[i].kind, age: t - items[i].bornAt,
          alpha: alphaOf(items[i], t) });
      }
      return out;
    },
    _historyTexts: function () { return history.map(function (h) { return h.text; }); },
    _rect: function () {
      if (!drawRects.length) return null;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (var i = 0; i < drawRects.length; i++) {
        var r = drawRects[i];
        x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, count: drawRects.length };
    },
    _rects: function () { return drawRects.slice(); },
    _clear: function () { items = []; drawRects = []; lastText = ''; lastAt = -1e9; },
    /* 验证页可控时钟：传 ms 固定，传 null 恢复 performance.now */
    _setClock: function (ms) { clockOverride = (typeof ms === 'number') ? ms : null; }
  };
})();
