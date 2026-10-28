/* js/systems/map.js — 地图系统：随机迷宫生成 / 碰撞 / 楼层切换
 * 接口：generate / isWalkable / tileAt / changeFloor（PLAN.md §4.4）
 * 算法：DFS 回溯迷宫 + 随机开洞（答辩可讲解：深度优先搜索生成完美迷宫）
 * tile：0=墙 1=地板 2=楼梯下(去下一层) 3=楼梯上(回上一层)
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var cfg = null;
  var grid = null;
  var floorIndex = 0;
  var spawn = { x: 1, y: 1 };

  function initGrid(w, h) {
    var g = [];
    for (var y = 0; y < h; y++) {
      g[y] = [];
      for (var x = 0; x < w; x++) g[y][x] = 0;
    }
    return g;
  }

  /* DFS 回溯：从 (sx, sy) 出发，隔一格挖通，形成完美迷宫 */
  function carve(sx, sy) {
    var dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    for (var i = dirs.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t;
    }
    for (var k = 0; k < dirs.length; k++) {
      var nx = sx + dirs[k][0];
      var ny = sy + dirs[k][1];
      if (nx > 0 && nx < grid[0].length - 1 && ny > 0 && ny < grid.length - 1 && grid[ny][nx] === 0) {
        grid[sy + dirs[k][1] / 2][sx + dirs[k][0] / 2] = 1;
        grid[ny][nx] = 1;
        carve(nx, ny);
      }
    }
  }

  /* 随机开洞：把迷宫局部连通成大空间，降低寻路难度 */
  function openRooms() {
    for (var y = 1; y < grid.length - 1; y++) {
      for (var x = 1; x < grid[0].length - 1; x++) {
        if (grid[y][x] === 0 && Math.random() < 0.12) grid[y][x] = 1;
      }
    }
  }

  function dist(x1, y1, x2, y2) { return Math.abs(x1 - x2) + Math.abs(y1 - y2); }

  function findOpen(w, h) {
    for (var i = 0; i < 200; i++) {
      var x = 1 + Math.floor(Math.random() * (w - 2));
      var y = 1 + Math.floor(Math.random() * (h - 2));
      if (grid[y][x] === 1 && dist(x, y, spawn.x, spawn.y) > Math.min(w, h) * 0.35) {
        return { x: x, y: y };
      }
    }
    return { x: 1, y: 1 };
  }

  function placeStairs() {
    var w = grid[0].length;
    var h = grid.length;
    var up = findOpen(w, h);
    var down = findOpen(w, h);
    grid[up.y][up.x] = 3;   /* 楼梯上（回上一层） */
    grid[down.y][down.x] = 2; /* 楼梯下（去下一层） */
  }

  Game.Systems.Map = {
    generate: function () {
      cfg = Game.Data.MAPS;
      var size = cfg.sizes[floorIndex % cfg.sizes.length];
      grid = initGrid(size[0], size[1]);
      carve(1, 1);
      openRooms();
      placeStairs();
      spawn = { x: 1, y: 1 };
      Game.Core.EventBus.emit('map:floorChanged', { floor: floorIndex + 1 });
      return grid;
    },

    isWalkable: function (x, y) {
      if (!grid) return false;
      if (x < 0 || y < 0 || x >= grid[0].length || y >= grid.length) return false;
      return grid[y][x] !== 0;
    },

    tileAt: function (x, y) {
      if (!grid) return 0;
      if (x < 0 || y < 0 || x >= grid[0].length || y >= grid.length) return 0;
      return grid[y][x];
    },

    changeFloor: function (dir) {
      floorIndex += dir;
      if (floorIndex < 0) floorIndex = 0;
      if (floorIndex >= cfg.floors) floorIndex = cfg.floors - 1;
      var g = this.generate();
      return { grid: g, floor: floorIndex + 1 };
    },

    getFloor: function () { return floorIndex + 1; },
    getGrid: function () { return grid; },
    getSpawn: function () { return { x: spawn.x, y: spawn.y }; }
  };
})();
