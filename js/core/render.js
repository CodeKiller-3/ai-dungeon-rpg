/* js/core/render.js — Canvas 渲染
 * 接口：init / drawMap / drawPlayer / drawHUD（见 PLAN.md §4.4）
 * M0：空场景 + 帧率 HUD；M1 起补瓦片/角色绘制
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Core = Game.Core || {};

  Game.Core.Render = {
    _canvas: null,
    _ctx: null,

    init: function (canvas) {
      this._canvas = canvas;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this._ctx = canvas.getContext('2d');
    },

    drawMap: function (map, cam) {
      /* M1 实现：瓦片绘制 */
    },

    drawPlayer: function () {
      /* M1 实现：角色绘制 */
    },

    drawHUD: function (stats) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx) return;
      ctx.fillStyle = '#2b2b4a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#8f8';
      ctx.font = '14px monospace';
      ctx.fillText('FPS=' + (stats ? stats.fps : 0) +
        ' | 场景:' + (stats ? stats.scene : '?') +
        ' | AI勇者闯地牢 M0 骨架', 10, 24);
    }
  };
})();
