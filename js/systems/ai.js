/* js/systems/ai.js — 怪物 AI：行为状态机 + A* 追击（M5）
 * 状态机：IDLE(等待) → CHASE(感知到玩家, A*寻路追击) → ATTACK(贴脸触发战斗)
 * 寻路：GitHub 开源库 bgrins/javascript-astar（MIT，js/vendor/astar.js）
 * 重规划策略：每 4 帧重新计算一次路径（性能与讲解点）
 * 接口：tick（见 PLAN.md §4.4）
 * 事件：ai:encounter */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var SIGHT = 6;       /* 感知半径（格） */
  var REPLAN = 4;      /* 每 N 帧重规划路径 */
  var patrols = [];    /* [{x,y,monsterId,state,path,frame}] */

  function dist(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

  /* 用 A* 计算下一步（从 from 到 to） */
  function nextStep(grid, from, to) {
    try {
      var h = grid.length;
      var w = grid[0].length;
      /* Graph 输入：0=不可走 1=可走 */
      var data = [];
      for (var y = 0; y < h; y++) {
        data[y] = [];
        for (var x = 0; x < w; x++) {
          data[y][x] = grid[y][x] === 0 ? 0 : 1;
        }
      }
      var g = new window.Graph(data);
      var start = g.grid[from.y][from.x];
      var end = g.grid[to.y][to.x];
      var path = window.astar.search(g, start, end, { closest: true });
      if (path && path.length > 0) {
        return { x: path[0].x, y: path[0].y };
      }
    } catch (e) { /* 寻路失败则原地等待 */ }
    return null;
  }

  Game.Systems.AI = {
    /* 每层生成巡逻怪（由 map.js generate 调用） */
    initPatrols: function (count) {
      patrols = [];
      var grid = Game.Systems.Map.getGrid();
      var table = Game.Data.MAPS.enemyTable[Game.Systems.Map.getFloor() - 1];
      var placed = 0;
      var tries = 0;
      var spawn = Game.Systems.Map.getSpawn();
      while (placed < count && tries < 300) {
        tries++;
        var w = grid[0].length;
        var h = grid.length;
        var x = 1 + Math.floor(Math.random() * (w - 2));
        var y = 1 + Math.floor(Math.random() * (h - 2));
        if (grid[y][x] === 1 && dist(x, y, spawn.x, spawn.y) > 8) {
          var roll = Math.random();
          var acc = 0;
          var pick = table[0].id;
          for (var i = 0; i < table.length; i++) {
            acc += table[i].rate;
            if (roll <= acc) { pick = table[i].id; break; }
          }
          patrols.push({ x: x, y: y, monsterId: pick, state: 'idle', path: [], frame: 0 });
          placed++;
        }
      }
    },

    getPatrols: function () { return patrols; },

    /* 主循环每帧调用：更新所有巡逻怪 */
    tick: function (player) {
      for (var i = 0; i < patrols.length; i++) {
        var e = patrols[i];
        e.frame++;
        var d = dist(e.x, e.y, player.x, player.y);
        if (d <= SIGHT) {
          e.state = 'chase';
          /* 贴脸：触发战斗 */
          if (d <= 1) {
            var mid = e.monsterId;
            patrols.splice(i, 1);
            i--;
            Game.Core.EventBus.emit('ai:encounter', { monsterId: mid });
            continue;
          }
          /* 周期重规划路径 */
          if (e.frame % REPLAN === 0) {
            var next = nextStep(Game.Systems.Map.getGrid(), e, player);
            if (next) {
              var grid = Game.Systems.Map.getGrid();
              if (grid[next.y][next.x] !== 0) {
                e.x = next.x;
                e.y = next.y;
              }
            }
          }
        } else {
          e.state = 'idle';
          e.path = [];
        }
      }
    }
  };
})();
