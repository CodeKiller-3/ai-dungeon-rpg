/* js/systems/fx.js — D-16 战斗最小特效（程序化，零新素材）
 * 目标：用极低成本补"打击感"，不引入任何图片/音频资源，不改渲染管线。
 * D-78：特效改为游戏硬性要求——固定最高档（high），不提供 off / low 退路；
 *       设置页不再有开关，F 键不再切换，旧设置里的 fx=off/low 由 main.js 忽略并强制 high。
 *       setLevel / cycle 仅保留为兼容空操作（恒返回 high），任何调用都降不了档。
 * 手段：顿帧 80ms、震屏 4px、受击挤退、命中局部闪白、程序化斩击弧、技能元素色。
 * 光敏安全：不做 strobe / 高频闪烁；闪白只覆盖受击方块局部，单次 ≤120ms，一次命中只闪一次。
 * 明确不做：每回合鼓点重音、长拖尾、为怪物新画帧动画。
 * 接口：hit / shakeOffset / knockOffset / flashOf / drawSlashes / clockNow / update / setLevel */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};

  var LEVELS = ['off', 'low', 'high'];   /* 历史档位名，仅用于兼容旧调用方 */
  var LABEL = { off: '关', low: '低', high: '高' };

  /* 唯一档位：high（全部落在卡面硬指标内：顿帧 50~90ms、震屏 2~4px、闪白单次 ≤120ms） */
  var PRESET = {
    high: { hitStop: 80, shake: 4, knock: 9, flash: 0.60, flashMs: 110, slash: 1 }
  };

  /* 技能元素色：不新增素材，只用颜色区分技能归属 */
  var SKILL_COLOR = {
    fireball: '#ff8a3d',
    dash: '#8ad4ff',
    shield: '#7dffb0'
  };

  var level = 'high';     /* D-78：硬性常开，唯一档位 */
  var freezeLeft = 0;     /* 顿帧剩余（ms）：只冻结"特效/动作时钟"，不冻结战斗结算与输入 */
  var clockShift = 0;     /* 顿帧累计偏移；clockNow = 真实时间 - clockShift */
  var lastReal = null;

  /* D-89：受击位移按"接触点保持 50ms → 回收"两段，且必须落在既有战斗时钟内。
   * 玩家段 0~100ms（顶出 7px，100ms 回收完，正好等于 seg1）；
   * 怪物段 100~180ms（退 4px，80ms 回收完，正好等于 lock→total）。
   * 旧口径 9px×1.4=12.6px 的阻尼余弦在 160ms 后才归零，既超出窗口又读不出"被顶住"的接触感。 */
  var KNOCK = {
    player: { px: 7, ms: 100, hold: 50 },
    monster: { px: 4, ms: 80, hold: 50 }
  };

  var shake = null;                          /* { amp, ms, t0 } */
  var knock = { monster: null, player: null }; /* { px, ms, t0, dir, who } */
  var flashes = [];                          /* { who, alpha, ms, t0, color } */
  var slashes = [];                          /* { x, y, r, a0, dir, color, ms, t0, alpha } */
  var rings = [];                            /* 第三拨 D-88：落点冲击环 { x, y, ms, t0, r0, r1, color } */

  var _clock = null;

  function realNow() {
    if (typeof _clock === 'function') {
      var v = _clock();
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* D-78：不再读取 prefers-reduced-motion 降档，特效是硬性常开。
   * 保留 isReduced 查询接口只为兼容旧验证页，恒返回 false。 */
  function isReduced() { return false; }
  function effective() { return 'high'; }
  function preset() { return PRESET.high; }
  /* 特效时钟：顿帧期间不前进，让动作板/斩击弧真正"定住" */
  function fxNow() { return realNow() - clockShift; }

  Game.Fx = {
    LEVELS: LEVELS,

    getLevel: function () { return 'high'; },
    effectiveLevel: function () { return 'high'; },
    label: function () { return LABEL.high; },
    /* D-78：兼容空操作——无论传什么（含旧设置里的 off/low）都固定 high */
    setLevel: function () { level = 'high'; return 'high'; },
    /* 循环切换已废弃（F 键不再绑定）；保留函数只为旧调用方不报错 */
    cycle: function () { level = 'high'; return 'high'; },
    _setPrefersReduced: function () { return 'high'; },
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
      if (P.knock > 0 && (o.who === 'player' || o.who === 'monster')) {
        var kd = KNOCK[o.who];
        knock[o.who] = {
          px: (typeof o.knockPx === 'number') ? o.knockPx : kd.px,
          ms: (typeof o.knockMs === 'number') ? o.knockMs : kd.ms,
          hold: kd.hold, t0: t, dir: (o.dir === -1 ? -1 : 1), who: o.who
        };
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
          dir: (o.slash.dir === 1 ? 1 : -1), color: o.slash.color || '#ffffff',
          ms: 200, t0: t, alpha: P.slash,
          /* D-89：血条保护线——斩击弧一律裁在 keepBelow 以下 / keepAbove 以上。
           * 几何上已经把玩家弧压在 456 以下、怪物弧压在 202 以上，这里是硬兜底。 */
          keepBelow: (typeof o.slash.keepBelow === 'number') ? o.slash.keepBelow : null,
          keepAbove: (typeof o.slash.keepAbove === 'number') ? o.slash.keepAbove : null
        });
        if (slashes.length > 4) slashes.shift();
        /* 落点冲击环：和斩击同时起，180ms 扩到 44px 后消失（纯视觉，不参与计时）
         * D-89：环心改用 impact（剑锋与身体的交界点），不再跟斩击中心混用。 */
        var ip = o.slash.impact || { x: o.slash.x, y: o.slash.y };
        rings.push({
          x: ip.x, y: ip.y, ms: 180, t0: t, r0: 6, r1: 44,
          color: o.slash.color || '#ffffff'
        });
        if (rings.length > 4) rings.shift();
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
      for (i = 0; i < rings.length; i++) {
        if (real - clockShift - rings[i].t0 >= rings[i].ms) { rings.splice(i, 1); i--; }
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

    /* 受击位移偏移（px）。D-89：接触点先保持 50ms（撞击的"顶住"），再平滑回收；
     * 玩家 100ms、怪物 80ms 内归零，全部落在 100/150/180 战斗时钟内，不产生慢动作。 */
    knockOffset: function (who) {
      var e = knock[who];
      if (!e) return 0;
      var t = fxNow() - e.t0;
      if (t >= e.ms) { knock[who] = null; return 0; }
      if (t <= e.hold) return e.dir * e.px;
      var r = (t - e.hold) / Math.max(1, e.ms - e.hold);
      if (r > 1) r = 1;
      var ease = 1 - r * r * (3 - 2 * r);
      return e.dir * e.px * ease;
    },

    /* D-89：验证页读取当前位移账（不做任何状态变更） */
    knockState: function (who) {
      var e = knock[who];
      return e ? { px: e.px, ms: e.ms, hold: e.hold, dir: e.dir, t0: e.t0, who: e.who } : null;
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

    /* 程序化斩击弧 + 落点冲击环（零素材）
     * 第三拨 D-88：由"一段细弧"升级成"方向斩击"——
     *   外晕 / 主斩 / 白芯三层同轴弧，开口方向由 a0 与 dir 决定（玩家上挑、怪物下劈）；
     *   另画一条沿开口方向的直切痕，静止帧也读得出"从哪边砍过来"；
     *   落点先出一圈冲击环 + 十字星，180ms 内扩到 44px。
     * 全部由 fx 时钟驱动，几何固定、无随机，不改变战斗时钟。 */
    drawSlashes: function (ctx) {
      if (!ctx) return;
      var t = fxNow();
      var i, s, k, fade, rot;
      for (i = 0; i < slashes.length; i++) {
        s = slashes[i];
        k = (t - s.t0) / s.ms;
        if (k < 0 || k >= 1) continue;
        fade = 1 - k;
        rot = s.a0 + s.dir * (0.20 + k * 0.42);
        var L = s.r * 1.45;
        var Wd = s.r * 0.40;
        var grow = 0.86 + k * 0.30;
        ctx.save();
        /* D-89：血条保护裁切（玩家弧只允许在 keepBelow 以下，怪物弧只允许在 keepAbove 以上） */
        if (s.keepBelow !== null || s.keepAbove !== null) {
          ctx.beginPath();
          if (s.keepBelow !== null) {
            ctx.rect(-9999, s.keepBelow, 99999, 99999);
            ctx.clip();
          }
          if (s.keepAbove !== null) {
            ctx.rect(-9999, -9999, 99999, s.keepAbove + 9999);
            ctx.clip();
          }
        }
        ctx.translate(s.x, s.y);
        ctx.rotate(rot);
        ctx.lineCap = 'round';
        /* 外晕：同形状放大放宽，只给方向感 */
        ctx.globalAlpha = 0.28 * fade;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.moveTo(-L * grow, 6);
        ctx.quadraticCurveTo(-L * 0.15 * grow, -Wd * 1.55 * grow, L * grow, -4);
        ctx.quadraticCurveTo(L * 0.15 * grow, Wd * 0.55 * grow, -L * grow, 6);
        ctx.closePath();
        ctx.fill();
        /* 主斩：两头尖、中间宽的白色月牙，一刀切过目标 */
        ctx.globalAlpha = 0.92 * fade;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(-L * grow, 3);
        ctx.quadraticCurveTo(-L * 0.15 * grow, -Wd * grow, L * grow, -2);
        ctx.quadraticCurveTo(L * 0.15 * grow, Wd * 0.30 * grow, -L * grow, 3);
        ctx.closePath();
        ctx.fill();
        /* 刀路上的一线暖色，避免纯白读成"白条" */
        ctx.globalAlpha = 0.55 * fade;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-L * grow, 4);
        ctx.quadraticCurveTo(-L * 0.15 * grow, -Wd * 0.95 * grow, L * grow, -1);
        ctx.stroke();
        ctx.restore();
      }
      /* 落点冲击环画在斩击之后：环 + 白色十字星必须在最上层，静止帧就能看到"打点" */
      for (i = 0; i < rings.length; i++) {
        s = rings[i];
        k = (t - s.t0) / s.ms;
        if (k < 0 || k >= 1) continue;
        var rr = s.r0 + (s.r1 - s.r0) * k;
        var fadeR = 1 - k;
        ctx.save();
        ctx.globalAlpha = 0.70 * fadeR;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5 + 2.5 * fadeR;
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        if (k < 0.55) {
          var arm = 20 * (1 - k / 0.55);
          ctx.globalAlpha = 0.95 * (1 - k / 0.55);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(s.x - arm, s.y);
          ctx.lineTo(s.x + arm, s.y);
          ctx.moveTo(s.x, s.y - arm);
          ctx.lineTo(s.x, s.y + arm);
          ctx.stroke();
        }
        ctx.restore();
      }
    },

    skillColor: function (id) { return SKILL_COLOR[id] || '#ffffff'; },

    /* 验证页/换层清理 */
    _reset: function () {
      freezeLeft = 0; clockShift = 0; lastReal = null;
      shake = null; knock = { monster: null, player: null };
      flashes = []; slashes = []; rings = [];
    },
    _state: function () {
      return {
        level: level, effective: effective(), reduced: isReduced(),
        preset: preset(),
        frozen: freezeLeft > 0, freezeLeft: freezeLeft,
        shake: !!shake, flashes: flashes.length, slashes: slashes.length,
        rings: rings.length,
        slashDirs: slashes.map(function (s) { return s.dir; }),
        slashAlpha: slashes.length ? slashes[0].alpha : 0,
        ringPos: rings.length ? { x: rings[0].x, y: rings[0].y } : null,
        slashPos: slashes.length ? { x: slashes[0].x, y: slashes[0].y, keepBelow: slashes[0].keepBelow, keepAbove: slashes[0].keepAbove } : null,
        knock: { player: knock.player ? { px: knock.player.px, ms: knock.player.ms, hold: knock.player.hold } : null,
                 monster: knock.monster ? { px: knock.monster.px, ms: knock.monster.ms, hold: knock.monster.hold } : null }
      };
    }
  };
})();
