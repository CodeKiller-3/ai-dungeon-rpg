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
        /* 修复：焦点在文本框（NPC 聊天输入）时不把按键写进游戏状态，
         * 否则输入字母 t 会在下一帧触发 T 键关闭对话。Esc 仍放行用于退出。 */
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && e.code !== 'Escape') return;
        keys[e.code] = true;
      });
      window.addEventListener('keyup', function (e) {
        keys[e.code] = false;
      });
      /* 修复：窗口失焦（Alt+Tab/切标签页）清空按键，避免 keyup 丢失后角色持续移动 */
      window.addEventListener('blur', function () { keys = {}; });
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
