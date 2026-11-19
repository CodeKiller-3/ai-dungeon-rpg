/* js/systems/feedback.js — 战斗视觉反馈（任务卡 S3-4，参考 Shattered Pixel Dungeon）
 * 契约（docs/tasks/S3-4-combat-feedback.md，纯新增，不改既有接口与事件频道）：
 *   Game.Feedback.spawn(opts)  // 飘字：{x,y,text,color,life,vy}；受击：{x,y,kind:'hit'|'hurt',life,w,h}
 *   Game.Feedback.update(dt)   // 推进生命周期与位移（main.js 每帧调用，dt 单位 ms）
 *   Game.Feedback.draw()       // 绘制全部存活反馈（render.js 每帧调用）
 * 反馈类型：
 *   1. 伤害飘字：text 为伤害值（如 '-12'），从命中点向上飘 20-30px 渐隐，500-700ms 生命周期，白/红区分敌我。
 *   2. 怪物受击(kind:'hit')：sprite 叠加白色半透明层（alpha 随生命衰减）+ 水平抖动 ±2px（前 100ms）。
 *   3. 玩家受击(kind:'hurt')：sprite 叠加红色半透明层 + 屏幕边缘低强度红晕。
 * 硬约束：同屏上限 20 条（超出丢弃最旧）；不修改任何战斗数值、胜负判定与既有事件频道。
 * 数据：spawn 调用方（battle.js 命中处）直接传入坐标与伤害值，反馈层不重算地图。
 * 降级：ctx 缺失时 draw 静默返回；update 对非数字 dt 容错。
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};

  var MAX_ITEMS = 20;          /* 同屏反馈上限（防刷屏性能问题） */
  var TEXT_LIFE = 600;         /* 飘字默认生命周期 ms（任务卡：500-700ms） */
  var TEXT_VY = -42;           /* 飘字上飘速度 px/s（600ms 飘约 25px） */
  var HIT_LIFE = 150;          /* 怪物受击闪白/抖动生命周期 ms */
  var HURT_LIFE = 220;         /* 玩家受击红闪生命周期 ms */
  var SHAKE_MS = 100;          /* 水平抖动持续 ms */
  var SHAKE_AMP = 2;           /* 抖动幅度 px（任务卡：±2px） */

  var items = [];              /* 存活反馈项 */

  function canvas() {
    return (Game.Core && Game.Core.Render && Game.Core.Render._canvas) || document.getElementById('game');
  }
  function cctx() {
    return Game.Core && Game.Core.Render && Game.Core.Render._ctx;
  }
  /* M9-5：取 CSS 像素尺寸（DPR 适配后 cv.width 为物理像素，绘制坐标为 CSS 像素） */
  function cssSize() {
    var R = Game.Core && Game.Core.Render;
    var cv = canvas();
    var w = (R && typeof R.cssW === 'number') ? R.cssW : (cv && cv.clientWidth) || (cv && cv.width) || 0;
    var h = (R && typeof R.cssH === 'number') ? R.cssH : (cv && cv.clientHeight) || (cv && cv.height) || 0;
    return { w: w, h: h };
  }

  /* 推进单条生命期，返回 true 表示仍存活 */
  function tick(item, dt) {
    item.life -= dt;
    if (item.type === 'text') {
      item.y += (item.vy || TEXT_VY) * dt / 1000;
    }
    return item.life > 0;
  }

  /* 受击闪白/红闪叠加层（在 sprite 矩形上叠一层颜色）
   * D-101：带 who 的战斗受击项不再自己画像素——闪白统一由 render 的 tintSprite
   * 按精灵轮廓着色（A1 口径），本模块只提供 alpha 账本；无 who 的旧调用方
   * （如 S3-4 独立验证页）保持原来的矩形叠加 + 边缘红晕行为。 */
  function drawFlash(ctx, item) {
    var ratio = Math.max(0, item.life / item.maxLife);
    if (item.who) return;
    var shake = 0;
    if (item.type === 'hit' && (item.maxLife - item.life) < SHAKE_MS) {
      /* 水平抖动：前 SHAKE_MS 毫秒内 ±SHAKE_AMP px，用 sin 让方向交替 */
      var t = (item.maxLife - item.life);
      shake = Math.round(Math.sin(t * 0.06) * SHAKE_AMP);
    }
    var dx = item.x + shake;
    var color;
    if (item.type === 'hit') {
      /* 怪物受击闪白：alpha 随生命衰减，起始约 0.7 */
      color = 'rgba(255,255,255,' + (0.7 * ratio).toFixed(3) + ')';
    } else {
      /* 玩家受击红闪 */
      color = 'rgba(255,50,50,' + (0.6 * ratio).toFixed(3) + ')';
    }
    ctx.fillStyle = color;
    ctx.fillRect(dx, item.y, item.w, item.h);
    if (item.type === 'hurt') drawVignette(ctx, ratio);
  }

  /* 玩家受击额外：屏幕边缘低强度红晕 */
  function drawVignette(ctx, ratio) {
    var sz = cssSize();
    if (!(sz.w > 0 && sz.h > 0)) return;
    var a = (0.18 * ratio).toFixed(3);
    var grd = ctx.createRadialGradient(
      sz.w / 2, sz.h / 2, Math.min(sz.w, sz.h) * 0.3,
      sz.w / 2, sz.h / 2, Math.max(sz.w, sz.h) * 0.75
    );
    grd.addColorStop(0, 'rgba(255,0,0,0)');
    grd.addColorStop(1, 'rgba(255,0,0,' + a + ')');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, sz.w, sz.h);
  }

  Game.Feedback = {
    /* opts:
     *   飘字：{ x, y, text, color, life(可选), vy(可选) }
     *   受击：{ x, y, kind: 'hit'|'hurt', life(可选), w(可选), h(可选) }
     * x,y：飘字为文字锚点；受击为 sprite 左上角 */
    spawn: function (opts) {
      if (!opts) return;
      var item;
      if (opts.kind === 'hit' || opts.kind === 'hurt') {
        item = {
          type: opts.kind,
          x: opts.x || 0,
          y: opts.y || 0,
          w: (typeof opts.w === 'number') ? opts.w : 90,
          h: (typeof opts.h === 'number') ? opts.h : 90,
          /* D-101：who / color / alpha 让"受击闪白"成为唯一账本，
           * render 按 who 取 alpha 给 tintSprite，颜色沿用纵置既有口径。 */
          who: opts.who || null,
          color: opts.color || (opts.kind === 'hit' ? '#ffffff' : '#ff5a5a'),
          alpha: (typeof opts.alpha === 'number') ? opts.alpha : (opts.kind === 'hit' ? 0.7 : 0.6),
          maxLife: (typeof opts.life === 'number') ? opts.life : (opts.kind === 'hit' ? HIT_LIFE : HURT_LIFE)
        };
      } else {
        /* D-70：碾压档——只在特效非 off 时接管字号/颜色/寿命，并画一圈冲击环；
         * off 档或旧调用方（无 tier）走的仍是 D-16 的普通/高伤两种样式，逐项不变。 */
        var crush = false;
        var lv = 'off';
        if (opts.tier === 'crush') {
          var Fx = Game.Fx;
          lv = (Fx && typeof Fx.effectiveLevel === 'function') ? Fx.effectiveLevel() : 'off';
          crush = lv !== 'off';
        }
        item = {
          type: 'text',
          x: opts.x || 0,
          y: opts.y || 0,
          text: (opts.text == null) ? '' : String(opts.text),
          /* D-107：同侧伤害播报需要按 who 合并——一条存活时后续命中累加到这条，
           * 不再生成第二条；val/hits 是只读账面字段，不参与游戏逻辑。 */
          who: opts.who || null,
          val: (typeof opts.val === 'number') ? opts.val : null,
          hits: (typeof opts.hits === 'number' && opts.hits > 0) ? opts.hits : 1,
          color: crush ? (opts.who === 'player' ? '#ff3b30' : '#ff5a2a')
            : (opts.color || '#ffffff'),
          /* D-16：伤害分级——普通 18px / 高伤 24~26px（默认 18px，旧调用方行为不变） */
          size: crush ? (lv === 'high' ? 36 : 32)
            : ((typeof opts.size === 'number' && opts.size >= 10) ? opts.size : 18),
          vy: (typeof opts.vy === 'number') ? opts.vy : TEXT_VY,
          maxLife: crush ? 820 : ((typeof opts.life === 'number') ? opts.life : TEXT_LIFE),
          crush: crush
        };
      }
      item.life = item.maxLife;
      items.push(item);
      /* 超出上限丢最旧 */
      while (items.length > MAX_ITEMS) items.shift();
      return item;
    },

    update: function (dt) {
      if (typeof dt !== 'number' || dt <= 0) dt = 16;
      if (dt > 500) dt = 500;   /* 切后台回来时单帧 dt 过大，钳制避免飘字瞬移 */
      for (var i = items.length - 1; i >= 0; i--) {
        if (!tick(items[i], dt)) items.splice(i, 1);
      }
    },

    draw: function () {
      var ctx = cctx();
      if (!ctx) return;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.type === 'text') {
          var ratio = Math.max(0, it.life / it.maxLife);
          ctx.save();
          /* D-70：碾压档在数字外画一圈冲击环（固定角度，无随机；off 档不会进这里） */
          if (it.crush) {
            var ck = 1 - ratio;
            ctx.globalAlpha = 0.7 * ratio;
            ctx.strokeStyle = it.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(it.x, it.y, 14 + 26 * ck, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            for (var ci = 0; ci < 8; ci++) {
              var ca = (Math.PI * 2 * ci) / 8 + 0.2;
              var cr0 = 14 + 26 * ck + 2, cr1 = cr0 + 6;
              ctx.moveTo(it.x + Math.cos(ca) * cr0, it.y + Math.sin(ca) * cr0);
              ctx.lineTo(it.x + Math.cos(ca) * cr1, it.y + Math.sin(ca) * cr1);
            }
            ctx.stroke();
          }
          ctx.globalAlpha = ratio;
          ctx.fillStyle = it.color;
          ctx.font = 'bold ' + (it.size || 18) + 'px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          /* 暗色描边提升可读性（数字为主，不依赖额外字体） */
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.lineWidth = 3;
          ctx.strokeText(it.text, it.x, it.y);
          ctx.fillText(it.text, it.x, it.y);
          ctx.restore();
        } else {
          drawFlash(ctx, it);
        }
      }
    },

    /* 测试/调试用：清空所有反馈 */
    _clear: function () { items = []; },
    /* D-107：同侧伤害播报合并——该侧已有一条存活飘字时，把后到的伤害累加进去，
     * 不再生成第二条。返回 true 表示已合并。
     * 寿命不刷新：一条飘字从首次命中起按自己的 620/760ms 走完就消散，累加窗口因此有界
     * （180ms/回合时约 3–4 击），既不会无限长大成"全场总伤害"，也不会越飘越远离锚点；
     * 消散后的下一次命中重新起一条，读起来是"这一小段的合计"，不是一坨。
     * 碾压档仍按 Fx 档位重算样式；普通/高伤只升不降（26px 命中后不会缩回 18px）。 */
    mergeText: function (who, add, opts) {
      for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i];
        if (it.type !== 'text' || it.who !== who || it.life <= 0) continue;
        var crush = false, lv = 'off';
        if (opts && opts.tier === 'crush') {
          var Fx = Game.Fx;
          lv = (Fx && typeof Fx.effectiveLevel === 'function') ? Fx.effectiveLevel() : 'off';
          crush = lv !== 'off';
        }
        it.val = (typeof it.val === 'number' ? it.val : 0) + (add || 0);
        it.hits = (it.hits || 1) + 1;
        it.text = '-' + it.val;
        if (crush) {
          it.crush = true;
          it.size = (lv === 'high') ? 36 : 32;
          it.color = (who === 'player') ? '#ff3b30' : '#ff5a2a';
          it.maxLife = 820;
        } else if (opts && opts.size > it.size) {
          it.size = opts.size;
          it.color = opts.color || it.color;
          it.maxLife = Math.max(it.maxLife, opts.life || 0);
        }
        return true;
      }
      return false;
    },
    /* D-107 只读账本：某侧当前存活的伤害飘字（断言同侧不叠、y 间距用） */
    liveTexts: function (who) {
      var out = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.type !== 'text' || it.who !== who || it.life <= 0) continue;
        out.push({ x: it.x, y: it.y, text: it.text, val: it.val, hits: it.hits, size: it.size });
      }
      return out;
    },
    /* 换场时清掉残留飘字，避免上一场的累计值被带进新战斗 */
    clearTexts: function () {
      for (var i = items.length - 1; i >= 0; i--) {
        if (items[i].type === 'text') items.splice(i, 1);
      }
    },
    /* 测试用：当前存活数 */
    _count: function () { return items.length; },
    /* D-101：受击闪白只读账本——render 用它给 tintSprite 取 alpha。
     * 返回当前最强的一条 { alpha, color }，没有则 null（调用方回退 Fx）。 */
    flashOf: function (who) {
      var best = null;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it.who || it.who !== who) continue;
        if (it.type !== 'hit' && it.type !== 'hurt') continue;
        var k = Math.max(0, it.life / it.maxLife);
        if (!(k > 0)) continue;
        var a = it.alpha * k;
        if (!best || a > best.alpha) best = { alpha: a, color: it.color };
      }
      return best;
    },
    /* D-70 测试用：飘字样式快照（只读；不参与游戏逻辑） */
    _items: function () {
      return items.map(function (it) {
        return { type: it.type, text: it.text, color: it.color,
          size: it.size, life: it.maxLife, crush: !!it.crush, who: it.who || null };
      });
    }
  };
})();
