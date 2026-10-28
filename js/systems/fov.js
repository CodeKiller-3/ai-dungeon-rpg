/* js/systems/fov.js — FOV 视野迷雾（任务卡 S3-1）
 * 契约接口（docs/tasks/S3-1-rotjs-fov.md，必须实现）：
 *   Game.fov.compute(x, y, radius, isBlocked) -> [{x, y}, ...]
 *   isBlocked(x, y) 返回 true 表示该格阻挡视线（墙）
 * 契约外新增（仅追加，不改既有接口，已在任务卡报备）：
 *   update(x, y, radius, isBlocked)  重算当前可见并写入记忆，点亮新格时 emit 'map:fovChanged'
 *   isVisible(x, y) / isExplored(x, y) / reset() / RADIUS
 * 事件频道（新增）：map:fovChanged（payload: { lit: 本次新点亮格数 }）
 * 依赖：js/vendor/rot.min.js（ondras/rot.js，BSD-3，ROT.FOV.PreciseShadowcasting）
 * 降级：ROT 未定义/加载失败时 compute 退化为半径方形全可见（无遮挡计算），
 *       不抛错、不白屏，游戏仍可玩——任务卡要求的"全图可见"语义在 compute 签名下
 *       无法表达全图（无地图尺寸入参），以"半径内无遮挡"实现等价效果。
 * 记忆策略：本地图每次换层均重新随机生成（map.js），旧坐标记忆无意义，
 *       故订阅 map:floorChanged 自动清空记忆。
 * 来源：自写（基于 rot.js） */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};

  var RADIUS = 5;        /* 默认视野半径（任务卡：玩家周围 5 格可见） */
  var visible = {};      /* 当前可见格集合 "x,y" -> true */
  var explored = {};     /* 本层已点亮（记忆）集合 */

  function key(x, y) { return x + ',' + y; }

  /* rot.js 精确阴影投射：回调语义为 lightPasses（true=透光），与 isBlocked 相反 */
  function computeRot(x, y, radius, isBlocked) {
    var out = [];
    var fov = new ROT.FOV.PreciseShadowcasting(function (cx, cy) {
      return !isBlocked(cx, cy);
    });
    fov.compute(x, y, radius, function (cx, cy) {
      out.push({ x: cx, y: cy });
    });
    return out;
  }

  /* 降级路径：半径方形内全部可见（含自身），不做遮挡剔除 */
  function computeFallback(x, y, radius) {
    var out = [];
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        out.push({ x: x + dx, y: y + dy });
      }
    }
    return out;
  }

  Game.fov = {
    /* 任务卡契约接口 */
    compute: function (x, y, radius, isBlocked) {
      if (typeof ROT !== 'undefined' && ROT.FOV && ROT.FOV.PreciseShadowcasting) {
        return computeRot(x, y, radius, isBlocked);
      }
      return computeFallback(x, y, radius);
    },

    /* 重算可见区并累积记忆；探索点亮新格子时广播 map:fovChanged */
    update: function (x, y, radius, isBlocked) {
      radius = radius || RADIUS;
      var list = this.compute(x, y, radius, isBlocked);
      visible = {};
      var newly = 0;
      for (var i = 0; i < list.length; i++) {
        var k = key(list[i].x, list[i].y);
        visible[k] = true;
        if (!explored[k]) { explored[k] = true; newly++; }
      }
      if (newly > 0 && Game.Core && Game.Core.EventBus) {
        Game.Core.EventBus.emit('map:fovChanged', { lit: newly });
      }
      return list.length;
    },

    isVisible: function (x, y) { return !!visible[key(x, y)]; },
    isExplored: function (x, y) { return !!explored[key(x, y)]; },
    reset: function () { visible = {}; explored = {}; },
    RADIUS: RADIUS
  };

  /* 换层/新图生成时清空记忆（eventBus.js 先于本文件加载，订阅安全） */
  if (Game.Core && Game.Core.EventBus) {
    Game.Core.EventBus.on('map:floorChanged', function () { Game.fov.reset(); });
  }
})();
