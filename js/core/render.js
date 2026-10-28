/* js/core/render.js — Canvas 渲染
 * 接口：init / drawMap / drawPlayer / drawHUD（见 PLAN.md §4.4）
 * M1：瓦片绘制 + 跟随镜头 + 角色方块 + FPS HUD
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Core = Game.Core || {};

  var TILE = 24; /* 瓦片像素尺寸 */
  var cam = { x: 0, y: 0 };

  Game.Core.Render = {
    _canvas: null,
    _ctx: null,

    init: function (canvas) {
      this._canvas = canvas;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this._ctx = canvas.getContext('2d');
    },

    /* 计算镜头：地图比屏幕小则居中，否则跟随玩家 */
    _updateCam: function (grid, player) {
      var cv = this._canvas;
      var w = grid[0].length * TILE;
      var h = grid.length * TILE;
      cam.x = Math.min(Math.max(player.x * TILE - cv.width / 2 + TILE / 2, 0), Math.max(w - cv.width, 0));
      cam.y = Math.min(Math.max(player.y * TILE - cv.height / 2 + TILE / 2, 0), Math.max(h - cv.height, 0));
    },

    drawMap: function (grid, player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx || !grid) return;
      this._updateCam(grid, player);
      ctx.fillStyle = '#14142a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      for (var y = 0; y < grid.length; y++) {
        for (var x = 0; x < grid[0].length; x++) {
          var t = grid[y][x];
          var px = x * TILE - cam.x;
          var py = y * TILE - cam.y;
          if (px + TILE < 0 || py + TILE < 0 || px > cv.width || py > cv.height) continue;
          if (t === 0) ctx.fillStyle = '#3a2e5c';
          else if (t === 1) ctx.fillStyle = '#2b2b4a';
          else if (t === 2) ctx.fillStyle = '#b06ce0';
          else ctx.fillStyle = '#52c41a';
          ctx.fillRect(px, py, TILE - 1, TILE - 1);
        }
      }
    },

    drawPlayer: function (player) {
      var ctx = this._ctx;
      if (!ctx) return;
      var px = player.x * TILE - cam.x;
      var py = player.y * TILE - cam.y;
      ctx.fillStyle = '#ffcf6e';
      ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
      ctx.fillStyle = '#fff';
      ctx.fillRect(px + 6, py + 6, 4, 4); /* 眼睛，增加辨识度 */
    },

    drawHUD: function (stats) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx) return;
      ctx.fillStyle = 'rgba(20,20,42,0.72)';
      ctx.fillRect(0, 0, cv.width, 30);
      ctx.fillStyle = '#8f8';
      ctx.font = '13px monospace';
      ctx.fillText('FPS=' + (stats ? stats.fps : 0) +
        ' | 楼层:' + stats.floor + '/' + Game.Data.MAPS.floors +
        ' | HP:' + stats.hp + '/' + stats.maxHp +
        ' | 金币:' + stats.gold +
        ' | 攻击:' + stats.atk + ' 防御:' + stats.def,
        10, 20);
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '12px monospace';
      ctx.fillText('方向键/WASD 移动 | 走到紫色楼梯下走下一层，绿色楼梯回上一层', 10, cv.height - 10);
    }
  };
})();
