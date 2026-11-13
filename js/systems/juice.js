/* js/systems/juice.js — D-70 爽感表现层：把"我变强了"画出来
 * 只画，不算：本模块不写任何数值、不掷随机数、不改战斗顺序。
 * 四件事（全部受 Game.Fx 的 off/low/high 档位控制，off 时一个像素都不画）：
 *   1) 精英之证卡片：打赢精英当场看到"攻击 34 → 36（+2）/ 累计 +2"；
 *   2) 升级卡片：一次升级/连升，列出攻击/防御/生命上限的前后值；
 *   3) 伤害分级：tierOf() 给出 normal / heavy / crush 三档（绘制在 feedback.js）；
 *   4) 碾压击杀：1–2 回合解决普通怪时给一张区别于苦战的卡片 + 一圈固定角度的冲击线。
 * 确定性：不调用 Math.random（同种子跑局与 D-69 逐局一致），不新增外部素材，
 * 只用 canvas 的 fillRect / strokeRect / arc / fillText。
 * 预算：卡片最多 3 张、冲击圈最多 4 个；每帧新增 canvas 调用 < 60 次，且与地图尺寸无关。
 * 接口：tierOf / isCrushKill / levelUp / eliteReward / crushKill / update / draw / _peek / _reset */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var MAX_CARDS = 3;      /* 同屏最多 3 张（超出的丢最旧） */
  var MAX_BURSTS = 4;     /* 同屏最多 4 圈冲击线 */
  var CARD_W = 252;       /* 卡片宽（px） */
  var CARD_GAP = 8;
  var CARD_TOP = 34;      /* 顶部 HUD 条带（0–22）之下 */
  var FADE = 320;         /* 末尾淡出 ms */
  var SLIDE = 160;        /* 入场滑入 ms */

  var COLORS = {
    level: '#7dffb0',     /* 升级：绿色 */
    elite: '#ffd166',     /* 精英之证：金色 */
    crush: '#ff6b3d'      /* 碾压：橙红 */
  };

  var cards = [];         /* {kind,title,rows[],accent,bornAt,life} */
  var bursts = [];        /* {x,y,color,bornAt,life,rays} */
  var clock = null;       /* 验证页注入时钟；null 用真实 performance.now */

  function nowMs() {
    if (typeof clock === 'number') return clock;
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /* 当前有效档位：prefers-reduced-motion 时 Fx 会自己降成 off */
  function fxLevel() {
    var Fx = Game.Fx;
    if (Fx && typeof Fx.effectiveLevel === 'function') return Fx.effectiveLevel();
    return 'off';
  }
  function enabled() { return fxLevel() !== 'off'; }

  /* ── 伤害分级（纯函数，不改任何伤害值）─────────────────────────
   * normal：普通命中
   * heavy ：沿用 D-16 既有阈值（单次 ≥20，或 ≥目标生命上限 20%）
   * crush ：单次打掉目标一半及以上生命（碾压级一击）
   * 生命上限缺失时只按绝对量判断，crush 门槛取 40（避免把 Boss 的 30 点记成碾压） */
  function tierOf(dmg, maxHp) {
    var d = Number(dmg) || 0;
    var m = Number(maxHp) || 0;
    if (d <= 0) return 'normal';
    if (m > 0 && d * 2 >= m) return 'crush';
    if (m <= 0 && d >= 40) return 'crush';
    if (d >= 20) return 'heavy';
    if (m > 0 && d / m >= 0.2) return 'heavy';
    return 'normal';
  }

  /* 碾压击杀：普通怪、1–2 回合解决（Boss 与层内精英不算，它们有自己的收尾） */
  function isCrushKill(rounds, monsterId) {
    var r = Number(rounds) || 0;
    if (r < 1 || r > 2) return false;
    var md = Game.Data && Game.Data.MONSTERS && Game.Data.MONSTERS[monsterId];
    if (md && (md.boss || md.elite)) return false;
    return true;
  }

  function pushCard(kind, title, rows, accent, life) {
    if (!enabled()) return null;
    var t = nowMs();
    var card = {
      kind: kind, title: title, rows: rows || [], accent: accent || COLORS.level,
      bornAt: t, life: (typeof life === 'number') ? life : 2400
    };
    cards.push(card);
    while (cards.length > MAX_CARDS) cards.shift();
    return card;
  }

  function pushBurst(x, y, color, life, rays) {
    if (!enabled()) return null;
    bursts.push({
      x: x, y: y, color: color, rays: (typeof rays === 'number') ? rays : 8,
      bornAt: nowMs(), life: life || 420
    });
    while (bursts.length > MAX_BURSTS) bursts.shift();
    return bursts[bursts.length - 1];
  }

  /* 战场坐标：与 battle.js 的 monsterPos / playerPos 同一口径（中心点） */
  function battlePoint(who) {
    var cv = (Game.Core && Game.Core.Render && Game.Core.Render._canvas) || null;
    var w = (Game.Core && Game.Core.Render && Game.Core.Render.cssW) || (cv && cv.clientWidth) || 0;
    var h = (Game.Core && Game.Core.Render && Game.Core.Render.cssH) || (cv && cv.clientHeight) || 0;
    if (!w || !h) return null;
    return who === 'player' ? { x: w / 2, y: h - 145 } : { x: w / 2, y: 135 };
  }

  function inBattle() {
    return !!(Game.Core && Game.Core.Main && Game.Core.Main._scene === 'battle');
  }

  /* 行："攻击   18 → 20  (+2)" */
  function deltaRow(label, from, to) {
    if (typeof from !== 'number' || typeof to !== 'number') return null;
    var d = to - from;
    return label + '   ' + from + ' → ' + to + '  (' + (d >= 0 ? '+' : '') + d + ')';
  }

  Game.Systems.Juice = {
    tierOf: tierOf,
    isCrushKill: isCrushKill,

    /* 升级：info 由 battle.js#checkLevelUp 传入升级前/后的真实面板值 */
    levelUp: function (info) {
      if (!enabled()) return null;
      var o = info || {};
      var rows = [];
      var r1 = deltaRow('攻击', o.atkFrom, o.atkTo);
      var r2 = deltaRow('防御', o.defFrom, o.defTo);
      var r3 = deltaRow('生命上限', o.hpFrom, o.hpTo);
      if (r1) rows.push(r1);
      if (r2) rows.push(r2);
      if (r3) rows.push(r3);
      rows.push('HP / MP 已回满');
      var title = '升级！Lv.' + (o.from == null ? '?' : o.from) + ' → Lv.' + (o.to == null ? '?' : o.to);
      if (typeof o.levels === 'number' && o.levels > 1) title += '（连升 ' + o.levels + ' 级）';
      var card = pushCard('level', title, rows, COLORS.level, 2400);
      if (inBattle()) {
        var pt = battlePoint('player');
        if (pt) pushBurst(pt.x, pt.y, COLORS.level, 520, 10);
      }
      return card;
    },

    /* 精英之证：info = { from, to, gain, total }，数值全部来自 main.js#grantEliteReward */
    eliteReward: function (info) {
      if (!enabled()) return null;
      var o = info || {};
      var rows = [];
      if (typeof o.from === 'number' && typeof o.to === 'number') {
        rows.push('攻击   ' + o.from + ' → ' + o.to + '  (+' + (o.to - o.from) + ')');
      }
      if (typeof o.total === 'number') rows.push('累计攻击加成 +' + o.total);
      rows.push('下一场战斗立刻生效');
      return pushCard('elite', '精英之证', rows, COLORS.elite, 2800);
    },

    /* 碾压击杀：info = { rounds, name } */
    crushKill: function (info) {
      if (!enabled()) return null;
      var o = info || {};
      var rows = [];
      if (o.name) rows.push('目标：' + o.name);
      if (typeof o.rounds === 'number') rows.push('用时：' + o.rounds + ' 回合');
      var card = pushCard('crush', '碾压击杀', rows, COLORS.crush, 1900);
      if (inBattle()) {
        var pt = battlePoint('monster');
        if (pt) pushBurst(pt.x, pt.y, COLORS.crush, 460, 14);
      }
      return card;
    },

    /* 每帧推进生命周期（卡片/冲击圈过期即移除） */
    update: function () {
      var t = nowMs();
      var i;
      for (i = cards.length - 1; i >= 0; i--) {
        if (t - cards[i].bornAt >= cards[i].life) cards.splice(i, 1);
      }
      for (i = bursts.length - 1; i >= 0; i--) {
        if (t - bursts[i].bornAt >= bursts[i].life) bursts.splice(i, 1);
      }
    },

    /* 绘制（在主场景之后、底部提示条之前）。返回本帧新增的 canvas 调用数，供验证页断言 */
    draw: function () {
      if (!enabled()) return 0;
      var R = Game.Core && Game.Core.Render;
      var ctx = R && R._ctx;
      if (!ctx) return 0;
      if (typeof R._applyDpr === 'function') R._applyDpr();
      var W = (R && typeof R.cssW === 'number') ? R.cssW : 0;
      var H = (R && typeof R.cssH === 'number') ? R.cssH : 0;
      if (!W || !H) return 0;
      var t = nowMs();
      var ops = 0;
      var hi = fxLevel() === 'high';   /* high 档多一圈外描边，low 保持轻量 */
      var i, k;

      /* 冲击圈：固定角度，无随机 */
      for (i = 0; i < bursts.length; i++) {
        var b = bursts[i];
        k = (t - b.bornAt) / b.life;
        if (k < 0 || k >= 1) continue;
        var rr = 16 + 42 * k;
        ctx.save();
        ctx.globalAlpha = 0.85 * (1 - k);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ops += 2;
        ctx.beginPath();
        for (var a = 0; a < b.rays; a++) {
          var ang = (Math.PI * 2 * a) / b.rays + 0.2;
          var r0 = rr + 3, r1 = rr + 9 + 6 * (1 - k);
          ctx.moveTo(b.x + Math.cos(ang) * r0, b.y + Math.sin(ang) * r0);
          ctx.lineTo(b.x + Math.cos(ang) * r1, b.y + Math.sin(ang) * r1);
        }
        ctx.stroke();
        ops += 2;
        ctx.restore();
      }

      /* 卡片：右上角向下排列 */
      var y = CARD_TOP;
      for (i = 0; i < cards.length; i++) {
        var c = cards[i];
        var age = t - c.bornAt;
        if (age < 0) continue;
        if (age >= c.life) continue;
        var alpha = (age > c.life - FADE) ? Math.max(0, (c.life - age) / FADE) : 1;
        var slide = (age < SLIDE) ? (1 - age / SLIDE) * 24 : 0;
        var ch = 34 + c.rows.length * 16 + 6;
        var x = Math.round(W - CARD_W - 12 + slide);
        var yy = Math.round(y);
        ctx.save();
        ctx.globalAlpha = 0.88 * alpha;
        ctx.fillStyle = '#06060c';
        ctx.fillRect(x, yy, CARD_W, ch);
        ops++;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, yy + 0.5, CARD_W - 1, ch - 1);
        ops++;
        if (hi) {
          ctx.globalAlpha = 0.35 * alpha;
          ctx.strokeRect(x - 3.5, yy - 3.5, CARD_W + 6, ch + 6);
          ctx.globalAlpha = alpha;
          ops++;
        }
        ctx.fillStyle = c.accent;
        ctx.fillRect(x, yy, 3, ch);
        ops++;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 14px monospace';
        ctx.fillText(c.title, x + 12, yy + 18);
        ops++;
        ctx.font = '12px monospace';
        ctx.fillStyle = '#e8e8e8';
        for (var j = 0; j < c.rows.length; j++) {
          ctx.fillText(c.rows[j], x + 12, yy + 38 + j * 16);
          ops++;
        }
        ctx.restore();
        y += ch + CARD_GAP;
      }
      return ops;
    },

    /* 验证/调试：当前存活项快照 */
    _peek: function () {
      return {
        level: fxLevel(),
        cards: cards.length,
        bursts: bursts.length,
        titles: cards.map(function (c) { return c.title; }),
        rows: cards.map(function (c) { return c.rows.slice(); })
      };
    },
    _setClock: function (ms) { clock = (typeof ms === 'number') ? ms : null; },
    _reset: function () { cards = []; bursts = []; }
  };
})();
