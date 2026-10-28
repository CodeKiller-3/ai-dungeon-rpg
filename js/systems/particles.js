/* js/systems/particles.js — 粒子特效系统（任务卡 M9-3，PLAN.md §16.6 A-4）
 * 契约（docs/tasks/M9-3-animation.md，纯新增渲染层）：
 *   Game.Particles.spawn(kind, x, y, opts)  kind: 'spark'|'puff'|'shard'|'soul'
 *   Game.Particles.update(dtMs)             推进位置/alpha/缩放/生命
 *   Game.Particles.draw()                   render.js 每帧调用
 *   Game.Particles.count()                  当前粒子数（调试/验证）
 *   Game.Particles.enabled                  低端开关（false 时全部静默）
 * 粒子类型：
 *   spark  命中火花：暖色小方块，向外扩散，短生命（~300ms），攻击命中触发
 *   puff   尘土烟雾：灰色半透明圆，缓慢上浮扩大，~500ms，宝箱/落地触发
 *   shard  死亡碎片：怪物色小三角，四散飞溅，~600ms，怪物死亡触发
 *   soul   死亡灵魂：白色/浅蓝光点，缓慢上浮渐隐，~800ms，怪物死亡触发
 * 硬性约束：
 *   - 上限 60 粒/屏，spawn 时若超限则丢弃最旧粒子
 *   - enabled=false 时 spawn/update/draw 全部静默（M9-5 设置面板可调）
 *   - 纯渲染层，不改任何游戏逻辑
 * 依赖：render.js _ctx（无 ctx 时 draw 静默）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};

  var MAX_PARTICLES = 60;
  var particles = []; /* { kind, x, y, vx, vy, life, maxLife, size, color, alpha, rot, vrot, scale } */

  function ctx() {
    return Game.Core && Game.Core.Render && Game.Core.Render._ctx;
  }

  /* 各类型默认配置 */
  var CONFIGS = {
    spark: { life: 280, size: 3, color: '#ffcf6e', speed: 80, count: 6, gravity: 0 },
    puff:  { life: 500, size: 6, color: 'rgba(160,160,180,0.5)', speed: 20, count: 4, gravity: -10 },
    shard: { life: 600, size: 4, color: '#ea6668', speed: 110, count: 8, gravity: 200 },
    soul:  { life: 800, size: 5, color: '#9bbbf4', speed: 35, count: 3, gravity: -40 }
  };

  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* 创建单颗粒子 */
  function makeOne(kind, x, y, cfg) {
    var angle = rnd(0, Math.PI * 2);
    var spd = rnd(cfg.speed * 0.4, cfg.speed);
    return {
      kind: kind,
      x: x, y: y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      life: 0,
      maxLife: rnd(cfg.life * 0.7, cfg.life * 1.2),
      size: rnd(cfg.size * 0.6, cfg.size * 1.2),
      color: cfg.color,
      alpha: 1,
      rot: rnd(0, Math.PI * 2),
      vrot: rnd(-6, 6),
      scale: 1
    };
  }

  Game.Particles = {
    enabled: true, /* 低端开关：false 时全部静默 */

    /* 生成一组粒子。opts 可覆盖 count/color 等 */
    spawn: function (kind, x, y, opts) {
      if (!this.enabled) return;
      var cfg = CONFIGS[kind];
      if (!cfg) return;
      opts = opts || {};
      var count = opts.count || cfg.count;
      for (var i = 0; i < count; i++) {
        var p = makeOne(kind, x, y, cfg);
        if (opts.color) p.color = opts.color;
        if (opts.vx != null) p.vx = opts.vx;
        if (opts.vy != null) p.vy = opts.vy;
        particles.push(p);
      }
      /* 超限：丢弃最旧粒子 */
      while (particles.length > MAX_PARTICLES) {
        particles.shift();
      }
    },

    /* 推进所有粒子生命/位置；到期自动回收 */
    update: function (dtMs) {
      if (!this.enabled) return;
      var dt = (typeof dtMs === 'number' && dtMs > 0) ? dtMs / 1000 : 0;
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.life += dtMs;
        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        var cfg = CONFIGS[p.kind];
        if (cfg && cfg.gravity) p.vy += cfg.gravity * dt;
        p.rot += p.vrot * dt;
        /* alpha 随生命衰减（前 20% 渐入，后 50% 渐出） */
        var lt = p.life / p.maxLife;
        if (lt < 0.2) p.alpha = lt / 0.2;
        else if (lt > 0.5) p.alpha = (1 - lt) / 0.5;
        else p.alpha = 1;
        /* soul 上浮时缩小；shard 落地时缩小 */
        if (p.kind === 'soul' || p.kind === 'shard') {
          p.scale = 1 - lt * 0.5;
        }
      }
    },

    /* 绘制所有粒子（由 render.js 调用） */
    draw: function () {
      if (!this.enabled) return;
      var c = ctx();
      if (!c) return;
      c.save();
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        c.globalAlpha = Math.max(0, Math.min(1, p.alpha));
        c.fillStyle = p.color;
        var s = p.size * (p.scale || 1);
        if (p.kind === 'spark') {
          /* 火花：小方块 */
          c.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        } else if (p.kind === 'puff') {
          /* 烟雾：圆 */
          c.beginPath();
          c.arc(p.x, p.y, s, 0, Math.PI * 2);
          c.fill();
        } else if (p.kind === 'shard') {
          /* 碎片：旋转三角 */
          c.save();
          c.translate(p.x, p.y);
          c.rotate(p.rot);
          c.beginPath();
          c.moveTo(0, -s);
          c.lineTo(s * 0.8, s * 0.6);
          c.lineTo(-s * 0.8, s * 0.6);
          c.closePath();
          c.fill();
          c.restore();
        } else if (p.kind === 'soul') {
          /* 灵魂：发光圆点 */
          c.beginPath();
          c.arc(p.x, p.y, s, 0, Math.PI * 2);
          c.fill();
          /* 外层光晕 */
          c.globalAlpha = Math.max(0, Math.min(1, p.alpha * 0.3));
          c.beginPath();
          c.arc(p.x, p.y, s * 2, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
    },

    /* 当前粒子数 */
    count: function () {
      return particles.length;
    },

    /* 清空所有粒子（换场景/重置时调用） */
    clear: function () {
      particles = [];
    }
  };
})();
