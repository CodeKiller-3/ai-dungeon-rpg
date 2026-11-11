/* js/systems/fx.js — D-16 战斗最小特效（程序化，零新素材）
 * 目标：用极低成本补"打击感"，不引入任何图片/音频资源，不改渲染管线。
 * 三档强度：off / low / high，默认 low（连打不累；high 留给"手更重"的偏好）。
 * 手段：顿帧 50~90ms、震屏 2~4px、受击挤退、命中局部闪白、程序化斩击弧、技能元素色。
 * 光敏安全：不做 strobe / 高频闪烁；闪白只覆盖受击方块局部，单次 ≤120ms，一次命中只闪一次；
 *           系统 prefers-reduced-motion: reduce → 有效档位直接降为 off（不震屏/不闪白/不顿帧）。
 * 明确不做：每回合鼓点重音、长拖尾、为怪物新画帧动画。
 * 接口：hit / shakeOffset / knockOffset / flashOf / drawSlashes / clockNow / update / setLevel */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};

  var LEVELS = ['off', 'low', 'high'];
  var LABEL = { off: '关', low: '低', high: '高' };

  /* 档位参数（全部落在卡面硬指标内：顿帧 50~90ms、震屏 2~4px、闪白单次 ≤120ms） */
  var PRESET = {
    off: { hitStop: 0, shake: 0, knock: 0, flash: 0, flashMs: 0, slash: 0 },
    low: { hitStop: 50, shake: 2, knock: 5, flash: 0.40, flashMs: 90, slash: 0.75 },
    high: { hitStop: 80, shake: 4, knock: 9, flash: 0.60, flashMs: 110, slash: 1 }
  };

  /* 技能元素色：不新增素材，只用颜色区分技能归属 */
  var SKILL_COLOR = {
    fireball: '#ff8a3d',
    dash: '#8ad4ff',
    shield: '#7dffb0'
  };

  var level = 'low';      /* 默认档：有打击感但不吵；说明见 docs/tasks/D-16-battle-ui.md */
  var reduced = null;     /* null=未探测；true=系统要求减少动态 */
  var freezeLeft = 0;     /* 顿帧剩余（ms）：只冻结"特效/动作时钟"，不冻结战斗结算与输入 */
  var clockShift = 0;     /* 顿帧累计偏移；clockNow = 真实时间 - clockShift */
  var lastReal = null;

  var shake = null;                          /* { amp, ms, t0 } */
  var knock = { monster: null, player: null }; /* { px, ms, t0, dir } */
  var flashes = [];                          /* { who, alpha, ms, t0, color } */
  var slashes = [];                          /* { x, y, r, a0, color, ms, t0, alpha } */

  var _clock = null;

  function realNow() {
    if (typeof _clock === 'function') {
      var v = _clock();
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function detectReduced() {
    try {
      if (typeof window !== 'undefined' && window.matchMedia) {
        return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
    } catch (e) { /* 降级：视为不要求减少动态 */ }
    return false;
  }

  function isReduced() {
    if (reduced === null) reduced = detectReduced();
    return !!reduced;
  }

  function effective() { return isReduced() ? 'off' : level; }
  function preset() { return PRESET[effective()] || PRESET.off; }
  /* 特效时钟：顿帧期间不前进，让动作板/斩击弧真正"定住" */
  function fxNow() { return realNow() - clockShift; }

  Game.Fx = {
    LEVELS: LEVELS,

    getLevel: function () { return level; },
    effectiveLevel: function () { return effective(); },
    label: function () { return LABEL[effective()] || LABEL.off; },
    setLevel: function (l) {
      level = (LEVELS.indexOf(l) >= 0) ? l : 'low';
      return effective();
    },
    /* 循环切换：关 → 低 → 高 → 关（战斗内按 F 触发，设置弹窗有文字入口） */
    cycle: function () {
      var i = LEVELS.indexOf(level);
      level = LEVELS[(i + 1) % LEVELS.length];
      return effective();
    },
    _setPrefersReduced: function (v) { reduced = !!v; return effective(); },
    _setClock: function (fn) { _clock = (typeof fn === 'function') ? fn : null; lastReal = null; },
    now: realNow,
    clockNow: fxNow,

    /* 一次命中：顿帧 + 震屏 + 挤退 + 局部闪白 + 斩击弧（off 档整段跳过）
     * opts: { who:'monster'|'player', dir:+1/-1, color, slash:{x,y,r,a0,color} } */
    hit: function (opts) {
      var P = preset();
      if (P.hitStop <= 0 && P.flash <= 0) return false;
      var o = opts || {};
      var t = fxNow();
      if (P.hitStop > 0) freezeLeft = Math.max(freezeLeft, P.hitStop);
      if (P.shake > 0) shake = { amp: P.shake, ms: 180, t0: t };
      if (P.knock > 0 && o.who && knock[o.who]) {
        knock[o.who] = { px: P.knock, ms: 160, t0: t, dir: (o.dir === -1 ? -1 : 1) };
      }
      if (P.flash > 0 && o.who) {
        flashes.push({
          who: o.who, alpha: P.flash,
          ms: Math.min(P.flashMs, 120),   /* 硬上限：单次闪白 ≤120ms */
          t0: t, color: o.color || '#ffffff'
        });
        if (flashes.length > 6) flashes.shift();
      }
      if (P.slash > 0 && o.slash) {
        slashes.push({
          x: o.slash.x, y: o.slash.y, r: o.slash.r || 40, a0: o.slash.a0 || -0.9,
          color: o.slash.color || '#ffffff', ms: 200, t0: t, alpha: P.slash
        });
        if (slashes.length > 4) slashes.shift();
      }
      return true;
    },

    /* 每帧推进（只做两件事：消耗顿帧、清理过期效果；O(效果数)，可忽略） */
    update: function (dt) {
      var real = realNow();
      if (lastReal === null) lastReal = real;
      var d = real - lastReal;
      lastReal = real;
      if (!(d > 0)) d = (typeof dt === 'number' && dt > 0) ? Math.min(dt, 100) : 0;
      if (freezeLeft > 0) {
        var f = Math.min(freezeLeft, d);
        freezeLeft -= f;
        clockShift += f;
      }
      if (shake && real - (shake.t0 + clockShift) >= shake.ms) shake = null;
      var i;
      for (i = 0; i < flashes.length; i++) {
        if (real - clockShift - flashes[i].t0 >= flashes[i].ms) { flashes.splice(i, 1); i--; }
      }
      for (i = 0; i < slashes.length; i++) {
        if (real - clockShift - slashes[i].t0 >= slashes[i].ms) { slashes.splice(i, 1); i--; }
      }
      for (i = 0; i < LEVELS.length; i++) {
        var k = knock[LEVELS[i]];
        if (k && real - clockShift - k.t0 >= k.ms) knock[LEVELS[i]] = null;
      }
    },

    /* 震屏偏移（px，取整保证像素风不糊）；无震屏时返回 0 偏移 */
    shakeOffset: function () {
      if (!shake) return { x: 0, y: 0 };
      var t = fxNow() - shake.t0;
      if (t >= shake.ms) { shake = null; return { x: 0, y: 0 }; }
      var decay = 1 - t / shake.ms;
      var a = shake.amp * decay;
      return { x: Math.round(Math.sin(t * 0.09) * a), y: Math.round(Math.cos(t * 0.13) * a * 0.6) };
    },

    /* 受击挤退偏移（px，沿 dir 方向随命中衰减） */
    knockOffset: function (who) {
      var e = knock[who];
      if (!e) return 0;
      var t = fxNow() - e.t0;
      if (t >= e.ms) { knock[who] = null; return 0; }
      return e.dir * e.px * (1 - t / e.ms);
    },

    /* 当前局部闪白（返回最强的一条；单次命中只闪一次） */
    flashOf: function (who) {
      var best = null;
      var t = fxNow();
      for (var i = 0; i < flashes.length; i++) {
        var e = flashes[i];
        if (e.who !== who) continue;
        var k = (t - e.t0) / e.ms;
        if (k < 0 || k >= 1) continue;
        var a = e.alpha * (1 - k);
        if (!best || a > best.alpha) best = { alpha: a, color: e.color };
      }
      return best;
    },

    /* 程序化斩击弧（1~2 段 arc，零素材） */
    drawSlashes: function (ctx) {
      if (!ctx) return;
      var t = fxNow();
      for (var i = 0; i < slashes.length; i++) {
        var s = slashes[i];
        var k = (t - s.t0) / s.ms;
        if (k < 0 || k >= 1) continue;
        ctx.save();
        ctx.globalAlpha = s.alpha * (1 - k);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 3 + 2 * (1 - k);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, s.a0 + k * 0.6, s.a0 + 1.7 + k * 0.6);
        ctx.stroke();
        ctx.restore();
      }
    },

    skillColor: function (id) { return SKILL_COLOR[id] || '#ffffff'; },

    /* 验证页/换层清理 */
    _reset: function () {
      freezeLeft = 0; clockShift = 0; lastReal = null;
      shake = null; knock = { monster: null, player: null };
      flashes = []; slashes = [];
    },
    _state: function () {
      return {
        level: level, effective: effective(), reduced: isReduced(),
        preset: preset(),
        frozen: freezeLeft > 0, freezeLeft: freezeLeft,
        shake: !!shake, flashes: flashes.length, slashes: slashes.length
      };
    }
  };
})();
