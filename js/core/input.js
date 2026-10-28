/* js/core/input.js — 键盘输入
 * 接口：bind / getState / clear / direction（见 PLAN.md §4.4）
 * 来源：自写 */
(function () {
  'use strict';
  var keys = {};
  var Game = window.Game = window.Game || {};
  Game.Core = Game.Core || {};

  Game.Core.Input = {
    bind: function () {
      window.addEventListener('keydown', function (e) {
        keys[e.code] = true;
      });
      window.addEventListener('keyup', function (e) {
        keys[e.code] = false;
      });
    },
    getState: function () {
      return keys;
    },
    clear: function () {
      keys = {};
    },
    /* 方向映射：方向键 / WASD → {dx, dy} */
    direction: function (k) {
      var dx = 0, dy = 0;
      if (k['ArrowLeft'] || k['KeyA']) dx = -1;
      if (k['ArrowRight'] || k['KeyD']) dx = 1;
      if (k['ArrowUp'] || k['KeyW']) dy = -1;
      if (k['ArrowDown'] || k['KeyS']) dy = 1;
      return { dx: dx, dy: dy };
    }
  };
})();
