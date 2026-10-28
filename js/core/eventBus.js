/* js/core/eventBus.js — 事件总线（模块间唯一通信方式）
 * 接口：on / off / emit，频道清单见 PLAN.md §4.5
 * 来源：自写 */
(function () {
  'use strict';
  var channels = {};
  var Game = window.Game = window.Game || {};
  Game.Core = Game.Core || {};

  Game.Core.EventBus = {
    on: function (channel, fn) {
      if (!channels[channel]) channels[channel] = [];
      channels[channel].push(fn);
    },
    off: function (channel, fn) {
      if (!channels[channel]) return;
      var i = channels[channel].indexOf(fn);
      if (i >= 0) channels[channel].splice(i, 1);
    },
    emit: function (channel, payload) {
      if (!channels[channel]) return;
      var list = channels[channel].slice();
      for (var i = 0; i < list.length; i++) {
        list[i](payload || {});
      }
    }
  };
})();
