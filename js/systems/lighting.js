/* js/systems/lighting.js — 光影与视野（任务卡 M9-2，PLAN.md §16.6 A-3）
 * 契约（docs/tasks/M9-2-lighting.md，纯新增，不改既有接口与事件频道）：
 *   Game.Lighting.init()        预创建径向渐变（性能：避免每帧 new 渐变）
 *   Game.Lighting.draw()        叠加火把光晕 + FOV 软边 + 暗角（render.js 每帧调用，迷雾后、HUD 前）
 *   Game.Lighting.setRadius(r)  软边过渡半径（默认 2 格），M9-5 设置面板可调
 *   Game.Lighting._debug        调试辅助（可选）
 * 三层效果：
 *   1. 火把光晕：遍历可见火把格，在格中心画径向渐变（暖橙中心→透明），lighter 加色，同屏上限 12
 *   2. FOV 软边：可见区边缘 1-2 格 alpha 渐降（统计不可见邻居数，纯视觉，不改 isVisible 语义）
 *   3. 暗角 vignette：画布四角径向压暗（rgba(0,0,0,0.28)→透明），中心不遮
 * 硬性约束：
 *   - 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩
 *   - 渐变对象 init 预建、每帧复用；60fps 验收线
 *   - 软边不改变 FOV 可见性语义；火把只在玩家可见范围内发光
 *   - 迷雾外的火把不画光晕
 * 依赖：render.js（_getCam/TILE）、fov.js（isVisible/isExplored）、map.js（getGrid/getDecor）
 * 降级：ctx/grid/fov 缺失时 draw 静默返回，不影响主画面
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};

  /* ---------- 常量 ---------- */
  var MAX_TORCH = 12;            /* 同屏火把光晕上限（防性能） */
  var TORCH_RADIUS = 2.6;        /* 火把光晕半径（格） */
  var SOFT_EDGE_DEFAULT = 2;     /* 软边默认过渡半径（格） */
  var EDGE_ALPHA = 0.13;         /* 单不可见邻居贡献的暗化 alpha（4 邻居全不可见时 ≈0.52） */
  var VIGNETTE_ALPHA = 0.30;     /* 暗角最大 alpha */
  var GLOW_SPRITE_SIZE = 128;    /* 预渲染光晕离屏画布边长 */

  /* ---------- 模块内状态 ---------- */
  var softRadius = SOFT_EDGE_DEFAULT;
  var glowSprite = null;         /* 预渲染的火把光晕离屏画布（每帧 drawImage 复用） */
  var vignetteGradient = null;   /* 预建的暗角径向渐变（画布尺寸变化时重建） */
  var lastCanvasSize = { w: 0, h: 0 };

  /* ---------- 工具 ---------- */
  function getCtx() {
    return Game.Core && Game.Core.Render && Game.Core.Render._ctx;
  }
  function getCanvas() {
    return Game.Core && Game.Core.Render && Game.Core.Render._canvas;
  }
  function getCam() {
    return (Game.Core && Game.Core.Render && Game.Core.Render._getCam)
      ? Game.Core.Render._getCam() : { x: 0, y: 0 };
  }
  function getTile() {
    return (Game.Core && Game.Core.Render && Game.Core.Render.TILE) ? Game.Core.Render.TILE : 24;
  }
  function getGrid() {
    return (Game.Systems && Game.Systems.Map && Game.Systems.Map.getGrid)
      ? Game.Systems.Map.getGrid() : null;
  }
  function isVis(x, y) {
    return !!(Game.fov && Game.fov.isVisible) ? Game.fov.isVisible(x, y) : true;
  }

  /* ---------- 预渲染：火把光晕离屏画布（init 时建一次，每帧复用） ---------- */
  function buildGlowSprite() {
    var c = document.createElement('canvas');
    c.width = GLOW_SPRITE_SIZE;
    c.height = GLOW_SPRITE_SIZE;
    var g = c.getContext('2d');
    var cx = GLOW_SPRITE_SIZE / 2;
    var cy = GLOW_SPRITE_SIZE / 2;
    var r = GLOW_SPRITE_SIZE / 2;
    var grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    /* 暖橙中心亮 → 边缘透明；用多段 stop 做平滑衰减 */
    grad.addColorStop(0.00, 'rgba(255,180,80,0.62)');
    grad.addColorStop(0.25, 'rgba(255,150,50,0.42)');
    grad.addColorStop(0.55, 'rgba(255,120,30,0.18)');
    grad.addColorStop(1.00, 'rgba(255,100,20,0.00)');
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
    glowSprite = c;
  }

  /* ---------- 预建：暗角径向渐变（画布尺寸变化时重建） ---------- */
  function buildVignette(cv) {
    var g = cv.getContext('2d');
    var w = cv.width, h = cv.height;
    var cx = w / 2, cy = h / 2;
    var outer = Math.sqrt(cx * cx + cy * cy);   /* 对角线一半，确保四角全覆盖 */
    var inner = outer * 0.45;                   /* 中心 45% 不遮 */
    var grad = g.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0.00, 'rgba(0,0,0,0.00)');
    grad.addColorStop(0.70, 'rgba(0,0,0,' + (VIGNETTE_ALPHA * 0.55).toFixed(3) + ')');
    grad.addColorStop(1.00, 'rgba(0,0,0,' + VIGNETTE_ALPHA.toFixed(3) + ')');
    vignetteGradient = grad;
    lastCanvasSize.w = w;
    lastCanvasSize.h = h;
  }

  /* ---------- FOV 软边：可见区边缘 alpha 渐降（纯视觉，不改 isVisible 语义） ----------
   * 对每个可见格，统计 4 邻域中不可见的邻居数 nonVis；
   * nonVis 越大表示越靠近视野边缘，覆盖越暗的黑色半透明层。
   * 这样自然形成 1-2 格的柔和过渡（中心格邻居全可见→不暗化，边缘格邻居多不可见→渐暗）。
   */
  function drawSoftEdge(ctx, grid, cam, TILE) {
    if (!Game.fov || typeof Game.fov.isVisible !== 'function') return;
    var fovOn = true;
    var h = grid.length, w = grid[0].length;
    var cv = ctx.canvas;
    /* 只遍历屏幕可视区域内的格，减少绘制调用 */
    var x0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
    var y0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
    var x1 = Math.min(w, Math.ceil((cam.x + cv.width) / TILE) + 1);
    var y1 = Math.min(h, Math.ceil((cam.y + cv.height) / TILE) + 1);

    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        if (!Game.fov.isVisible(x, y)) continue;
        /* 统计 4 邻域不可见数 */
        var nonVis = 0;
        if (!Game.fov.isVisible(x - 1, y)) nonVis++;
        if (!Game.fov.isVisible(x + 1, y)) nonVis++;
        if (!Game.fov.isVisible(x, y - 1)) nonVis++;
        if (!Game.fov.isVisible(x, y + 1)) nonVis++;
        if (nonVis === 0) continue;
        var a = nonVis * EDGE_ALPHA;
        if (a <= 0) continue;
        var px = x * TILE - cam.x;
        var py = y * TILE - cam.y;
        ctx.fillStyle = 'rgba(4,4,12,' + a.toFixed(3) + ')';
        ctx.fillRect(px, py, TILE, TILE);
      }
    }
  }

  /* ---------- 火把光晕：遍历可见火把格，lighter 加色叠加 ---------- */
  function drawTorchGlow(ctx, grid, cam, TILE) {
    if (!glowSprite) return;
    if (!(Game.Systems && Game.Systems.Map && Game.Systems.Map.getDecor)) return;
    var h = grid.length, w = grid[0].length;
    var cv = ctx.canvas;
    var radius = TORCH_RADIUS * TILE;
    var spriteHalf = GLOW_SPRITE_SIZE / 2;
    var drawn = 0;

    /* 遍历屏幕可视区域内的格找火把（减少遍历量） */
    var x0 = Math.max(0, Math.floor(cam.x / TILE) - TORCH_RADIUS);
    var y0 = Math.max(0, Math.floor(cam.y / TILE) - TORCH_RADIUS);
    var x1 = Math.min(w, Math.ceil((cam.x + cv.width) / TILE) + TORCH_RADIUS);
    var y1 = Math.min(h, Math.ceil((cam.y + cv.height) / TILE) + TORCH_RADIUS);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var y = y0; y < y1 && drawn < MAX_TORCH; y++) {
      for (var x = x0; x < x1 && drawn < MAX_TORCH; x++) {
        if (Game.Systems.Map.getDecor(x, y) !== 'torch') continue;
        if (!isVis(x, y)) continue;  /* 迷雾外的火把不发光 */
        var cx = x * TILE - cam.x + TILE / 2;
        var cy = y * TILE - cam.y + TILE / 2;
        ctx.drawImage(glowSprite, cx - radius, cy - radius, radius * 2, radius * 2);
        drawn++;
      }
    }
    ctx.restore();
  }

  /* ---------- 暗角 vignette ---------- */
  function drawVignette(ctx, cv) {
    if (!vignetteGradient || cv.width !== lastCanvasSize.w || cv.height !== lastCanvasSize.h) {
      buildVignette(cv);
    }
    ctx.save();
    ctx.fillStyle = vignetteGradient;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.restore();
  }

  /* ---------- 对外接口 ---------- */
  Game.Lighting = {
    init: function () {
      try {
        buildGlowSprite();
        var cv = getCanvas();
        if (cv) buildVignette(cv);
      } catch (e) { /* 预建失败不阻断游戏，draw 时会降级 */ }
    },

    draw: function () {
      var ctx = getCtx();
      var cv = getCanvas();
      var grid = getGrid();
      if (!ctx || !cv || !grid || !grid.length) return;
      /* 懒初始化：确保光晕离屏画布已预建（render.init 可能在本模块加载后才执行） */
      if (!glowSprite) {
        try { buildGlowSprite(); } catch (e) { return; }
      }
      var cam = getCam();
      var TILE = getTile();

      /* 1. FOV 软边（先画，作为迷雾到可见的过渡） */
      drawSoftEdge(ctx, grid, cam, TILE);

      /* 2. 火把光晕（lighter 加色，叠在软边之上） */
      drawTorchGlow(ctx, grid, cam, TILE);

      /* 3. 暗角（最后叠，四角压暗） */
      drawVignette(ctx, cv);
    },

    setRadius: function (r) {
      if (typeof r === 'number' && r > 0 && isFinite(r)) {
        softRadius = Math.min(Math.max(r, 1), 4);
      }
      return softRadius;
    },

    _debug: {
      enabled: false,
      mode: 'normal',
      getState: function () {
        return {
          softRadius: softRadius,
          maxTorch: MAX_TORCH,
          torchRadius: TORCH_RADIUS,
          glowSpriteSize: GLOW_SPRITE_SIZE,
          vignetteAlpha: VIGNETTE_ALPHA,
          edgeAlpha: EDGE_ALPHA
        };
      }
    }
  };

  /* 自动初始化：若 render 已就绪则立即预建渐变；否则等首次 draw 兜底 */
  if (getCanvas() && getCtx()) {
    Game.Lighting.init();
  }
})();
