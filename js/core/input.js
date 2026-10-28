/* js/core/input.js — 键盘/触屏输入
 * 接口：bind / getState / clear（见 PLAN.md §4.4）
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
    }
  };
})();
