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

  /* D-58：感知半径不再是一个全局常量，而是按怪物种类从数据表读取。
   * SIGHT 仅作为"数据缺失/未知 id"的兜底，与改造前的 6 格一致。 */
  var SIGHT = 6;
  var REPLAN = 4;      /* 每 N 帧重规划路径 */
  var patrols = [];    /* [{x,y,monsterId,state,path,frame}] */

  function dist(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

  /* D-58：习性读取——只读 Game.Data.MONSTERS[id].habit，绝不写回、绝不入档。
   * 未知 id / 旧数据没有 habit 字段时按 patrol + 6 格兜底（等价于改造前行为）。 */
  function habitOf(id) {
    var m = (Game.Data && Game.Data.MONSTERS) ? Game.Data.MONSTERS[id] : null;
    var h = m && m.habit;
    if (!h) return { kind: 'patrol', sight: SIGHT };
    var kind = (h.kind === 'guard' || h.kind === 'patrol' || h.kind === 'chase') ? h.kind : 'patrol';
    var sight = (typeof h.sight === 'number' && h.sight > 0) ? Math.round(h.sight) : SIGHT;
    return { kind: kind, sight: sight };
  }

  /* D-58：视线检查——4 连通 Bresenham，逐格检查 tile 是否为墙（0）。
   * 选它而不是 BFS 的理由：
   *   ① 语义就是"看不看得见"，半径是视线长度，不需要把整片区域都 flood 一遍；
   *   ② 每帧每只怪只要 O(半径) 次读取（≤8 格），批跑 200 局时不会成为新热点；
   *   ③ 4 连通步进不产生斜向跨格，天然不可能从墙角缝隙"看见"，与"隔墙不可见"一致。 */
  function canSee(ax, ay, bx, by, grid) {
    if (!grid || !grid[ay] || !grid[by]) return false;
    var dx = bx - ax, dy = by - ay;
    var nx = Math.abs(dx), ny = Math.abs(dy);
    var sx = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    var sy = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
    var x = ax, y = ay, ix = 0, iy = 0;
    var guard = 0;
    while ((ix < nx || iy < ny) && guard++ < 64) {
      if (ix === nx) { y += sy; iy++; }
      else if (iy === ny) { x += sx; ix++; }
      else if ((ix + 1) * ny <= (iy + 1) * nx) { x += sx; ix++; }
      else { y += sy; iy++; }
      if (!grid[y] || grid[y][x] === undefined) return false;
      if (grid[y][x] === 0) return false;   /* 墙：视线到此为止 */
    }
    return true;
  }

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
        /* D-18：Graph 把第一维当 x 用（g.grid[真实y][真实x]），所以节点上的
         * node.x = 真实 y、node.y = 真实 x。这里必须换回来再返回，否则拿到的是
         * 转置坐标：多数情况下 grid[next.y][next.x] 会越界抛错（D-17 的 230 帧），
         * 少数情况会"走一步斜跳"到不相邻的格子。 */
        return { x: path[0].y, y: path[0].x };
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

    /* D-15：胜利结算时移除被击败的巡逻怪（唯一删除入口；逃跑绝不经过这里） */
    removePatrolAt: function (x, y) {
      for (var i = 0; i < patrols.length; i++) {
        if (patrols[i].x === x && patrols[i].y === y) {
          patrols.splice(i, 1);
          return true;
        }
      }
      return false;
    },

    /* D-15：逃跑成功后的短暂喘息（只延迟再追击，不删怪）。
     * 没有它的话，巡逻怪在下一 tick 就会重新贴脸，"后退一格"等于白退。 */
    fleeStunAt: function (x, y, ticks) {
      for (var i = 0; i < patrols.length; i++) {
        if (patrols[i].x === x && patrols[i].y === y) {
          patrols[i].rest = Math.max(patrols[i].rest || 0, ticks || 6);
          patrols[i].state = 'idle';
          patrols[i].path = [];
          return true;
        }
      }
      return false;
    },

    /* 修复 P1：楼层快照恢复时回填巡逻怪（保持回访层的怪物状态） */
    setPatrols: function (arr) { patrols = arr || []; },

    /* 主循环每帧调用：更新所有巡逻怪。
     * D-58：每只怪按自己的习性走——
     *   guard  守卫：发现玩家只进 alert（原地不动），贴脸才触发战斗；
     *   patrol 巡逻：视距 5–6，发现后 A* 追击；
     *   chase  追击：视距 7–8，发现后 A* 追击。
     * 失去视线立即回 idle，不保留"上次见过你"的锁定状态。 */
    tick: function (player) {
      var grid = Game.Systems.Map.getGrid();
      for (var i = 0; i < patrols.length; i++) {
        var e = patrols[i];
        e.frame++;
        /* D-15：逃跑后的喘息期——只暂停追击，怪物仍在场景里 */
        if (e.rest > 0) {
          e.rest--;
          e.state = 'idle';
          e.path = [];
          continue;
        }
        var hb = habitOf(e.monsterId);
        var d = dist(e.x, e.y, player.x, player.y);
        /* D-58：半径内 + 视线不被墙挡住才算"发现"；两个条件任一不满足都回 idle。
         * 视线函数经导出表取用，便于历史验证页临时替换为"全可见"复现改前行为。 */
        var seeFn = (Game.Systems.AI && typeof Game.Systems.AI.canSee === 'function')
          ? Game.Systems.AI.canSee : canSee;
        var seen = (d <= hb.sight) && seeFn(e.x, e.y, player.x, player.y, grid);
        if (!seen) {
          e.state = 'idle';
          e.path = [];
          continue;
        }
        /* 贴脸：触发战斗（D-15：不删怪；胜利才由 removePatrolAt 移除） */
        if (d <= 1) {
          e.state = (hb.kind === 'guard') ? 'alert' : 'chase';
          Game.Core.EventBus.emit('ai:encounter', { monsterId: e.monsterId, x: e.x, y: e.y });
          return; /* 一帧只触发一次遭遇，避免相邻多怪同时开局 */
        }
        /* 不追型：发现即警戒，但一步都不走（守卫原地） */
        if (hb.kind === 'guard') {
          e.state = 'alert';
          e.path = [];
          continue;
        }
        e.state = 'chase';
        /* 周期重规划路径 */
        if (e.frame % REPLAN === 0) {
          var next = nextStep(grid, e, player);
          /* 不额外做越界兜底：旧实现就是"下一步必须是可走格"，D-18 的负例靠这条
           * （A* 坐标转置后必须抛错）证明测量台抓得住回归。 */
          if (next && grid[next.y][next.x] !== 0) {
            var pfx = e.x, pfy = e.y;
            e.x = next.x;
            e.y = next.y;
            /* M9-3：登记巡逻怪移动插值（渲染层用 patrol_<index> 取视觉位置） */
            if (Game.Motion && typeof Game.Motion.setStep === 'function') {
              Game.Motion.setStep('patrol_' + i, pfx, pfy, next.x, next.y, 160);
            }
          }
        }
      }
    },

    /* D-58：只读习性表（验证页 A 组与文档逐条对照的入口）。
     * 返回 { id: {kind, sight} }，直接由 Game.Data.MONSTERS[id].habit 推导，
     * 不缓存、不复制第二份真相。 */
    habits: function () {
      var out = {};
      var all = (Game.Data && Game.Data.MONSTERS) || {};
      for (var id in all) {
        if (!Object.prototype.hasOwnProperty.call(all, id)) continue;
        out[id] = habitOf(id);
      }
      return out;
    },

    habitOf: habitOf,
    canSee: canSee
  };
})();
