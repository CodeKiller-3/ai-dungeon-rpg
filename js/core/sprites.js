/* js/core/sprites.js — 像素素材加载器（M7.5）
 * 素材来源：GitHub 开源仓库 fernandovmp/kni-dungeon（MIT），
 *           其美术素材源自 0x72 的 CC0 像素包（DungeonTileset II / character-pack）
 * 素材列表见 assets/sprites/（逐文件来源声明见 README 组件来源表）
 * 接口：load / isReady / get
 * 降级：素材未加载完成或缺失时，渲染层自动回退到色块绘制 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Core = Game.Core || {};

  var IMG = {};
  var READY = false;
  var COUNT = 0;
  var NAMES = ['player', 'monster_chort', 'monster_chort_run', 'boss_demon', 'boss_demon_run',
    /* M9-1：装饰物与 tile 细节素材（CC0，kenney/0x72；缺失则渲染层程序化兜底） */
    'chest', 'barrel', 'torch', 'vine', 'grass', 'puddle', 'bones', 'moss'];

  Game.Core.Sprites = {
    load: function () {
      var self = this;
      NAMES.forEach(function (n) {
        var img = new Image();
        COUNT++;
        img.onload = function () { IMG[n] = img; self._check(); };
        img.onerror = function () { self._check(); };   /* 加载失败不入库，渲染层自动程序化兜底 */
        img.src = 'assets/sprites/' + n + '.png';
      });
    },
    _check: function () {
      COUNT--;
      if (COUNT <= 0) READY = true;
    },
    isReady: function () { return READY; },
    get: function (name) { return IMG[name] || null; }
  };
})();
