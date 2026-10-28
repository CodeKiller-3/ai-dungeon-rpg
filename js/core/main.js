/* js/core/main.js — 游戏主循环与场景调度（启动入口，必须最后加载）
 * 接口：init / start / switchScene / loop（见 PLAN.md §4.4）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Core = Game.Core || {};

  Game.Core.Main = {
    _scene: 'boot',
    _fps: 0,
    _frames: 0,
    _lastT: 0,

    init: function () {
      var canvas = document.getElementById('game');
      Game.Core.Render.init(canvas);
      Game.Core.Input.bind();
      this._lastT = performance.now();
      this._scene = 'explore'; /* M0 占位场景，M1 起切到地图 */
    },

    start: function () {
      var self = this;
      requestAnimationFrame(function loop(ts) {
        self.loop(ts);
        requestAnimationFrame(loop);
      });
    },

    switchScene: function (name) {
      this._scene = name;
      Game.Core.EventBus.emit('game:sceneChanged', { scene: name });
    },

    loop: function (ts) {
      this._frames++;
      if (ts - this._lastT >= 1000) {
        this._fps = Math.round((this._frames * 1000) / (ts - this._lastT));
        this._frames = 0;
        this._lastT = ts;
      }
      Game.Core.Render.drawHUD({ fps: this._fps, scene: this._scene });
    }
  };

  /* script 位于 body 末尾，DOM 已就绪，直接启动 */
  Game.Core.Main.init();
  Game.Core.Main.start();
})();
