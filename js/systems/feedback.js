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

  /* 推进单条生命期，返回 true 表示仍存活 */
  function tick(item, dt) {
    item.life -= dt;
    if (item.type === 'text') {
      item.y += (item.vy || TEXT_VY) * dt / 1000;
    }
    return item.life > 0;
  }

  /* 受击闪白/红闪叠加层（在 sprite 矩形上叠一层颜色） */
  function drawFlash(ctx, item) {
    var ratio = Math.max(0, item.life / item.maxLife);
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

    /* 玩家受击额外：屏幕边缘低强度红晕（仅 hurt 类型） */
    if (item.type === 'hurt') {
      var cv = canvas();
      if (cv) {
        var a = (0.18 * ratio).toFixed(3);
        var grd = ctx.createRadialGradient(
          cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.3,
          cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) * 0.75
        );
        grd.addColorStop(0, 'rgba(255,0,0,0)');
        grd.addColorStop(1, 'rgba(255,0,0,' + a + ')');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, cv.width, cv.height);
      }
    }
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
          maxLife: (typeof opts.life === 'number') ? opts.life : (opts.kind === 'hit' ? HIT_LIFE : HURT_LIFE)
        };
      } else {
        item = {
          type: 'text',
          x: opts.x || 0,
          y: opts.y || 0,
          text: (opts.text == null) ? '' : String(opts.text),
          color: opts.color || '#ffffff',
          vy: (typeof opts.vy === 'number') ? opts.vy : TEXT_VY,
          maxLife: (typeof opts.life === 'number') ? opts.life : TEXT_LIFE
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
          ctx.globalAlpha = ratio;
          ctx.fillStyle = it.color;
          ctx.font = 'bold 18px monospace';
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
    /* 测试用：当前存活数 */
    _count: function () { return items.length; }
  };
})();
