/* js/core/input.js — 键盘输入
 * 接口：bind / getState / clear / direction（见 PLAN.md §4.4）
 * 来源：自写 */
(function () {
  'use strict';
  var keys = {};
  var Game = window.Game = window.Game || {};
  Game.Core = Game.Core || {};

  /* D-12：方向键"新按下"边沿。轮询 keys 只能看到某帧的按下状态，
   * 若一次抬起+再按下落在同一帧间隔内（或界面层中途 clear 过状态），轮询会把它
   * 误判成"一直按住"，于是这次按下被节流吃掉。边沿必须在 keydown 事件里捕获。 */
  var dirEdge = false;
  /* D-51：按键"按下边沿"表。ESC 暂停必须只认首次按下——否则按住 ESC 会在下一帧
   * 立刻把刚打开的暂停面板又关掉（轮询 keys 无法区分"新按下"与"一直按住"）。
   * 只记录 keydown 首次按下，takeEdge 取走即清；不改变任何既有轮询语义。 */
  var edges = {};
  var DIR_CODES = {
    ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1,
    KeyA: 1, KeyD: 1, KeyW: 1, KeyS: 1
  };

  Game.Core.Input = {
    bind: function () {
      window.addEventListener('keydown', function (e) {
        /* 修复：焦点在文本框（NPC 聊天输入）时不把按键写进游戏状态，
         * 否则输入字母 t 会在下一帧触发 T 键关闭对话。Esc 仍放行用于退出。 */
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && e.code !== 'Escape') return;
        /* D-15：忽略操作系统自动重复，只认"按下边沿"。
         * 旧实现把 repeat 也写进 keys，主循环删键后又会被重复事件重新置位，
         * 于是按住 1/2/3 等于按键盘重复率连发，手快与手慢玩家拿到的回合数不同。
         * 方向键连走不受影响：keys 在按住期间一直为 true，连发仍由 main 的 120ms 节流控制。 */
        if (e.repeat) return;
        if (!keys[e.code] && DIR_CODES[e.code]) dirEdge = true; /* 只认首次按下，忽略系统自动重复 */
        if (!keys[e.code]) edges[e.code] = true; /* D-51：按下边沿（ESC 暂停用） */
        keys[e.code] = true;
      });
      window.addEventListener('keyup', function (e) {
        keys[e.code] = false;
      });
      /* 修复：窗口失焦（Alt+Tab/切标签页）清空按键，避免 keyup 丢失后角色持续移动 */
      window.addEventListener('blur', function () { keys = {}; dirEdge = false; edges = {}; });
    },
    getState: function () {
      return keys;
    },
    /* D-12：取走并清除"方向键新按下"边沿（每帧最多消费一次） */
    takeDirEdge: function () {
      var v = dirEdge;
      dirEdge = false;
      return v;
    },
    clear: function () {
      keys = {};
      dirEdge = false;
      edges = {};
    },
    /* D-51：取走某个键的"按下边沿"（每帧最多消费一次；用于 ESC 开关暂停面板） */
    takeEdge: function (code) {
      var v = !!edges[code];
      edges[code] = false;
      return v;
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
