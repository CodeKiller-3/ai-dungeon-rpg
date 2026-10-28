/* js/systems/map.js — 地图系统：随机迷宫生成 / 碰撞 / 楼层切换
 * 接口：generate / isWalkable / tileAt / changeFloor（PLAN.md §4.4）
 * M9-1 扩展：getDetail / getDecor / takeDecor（地图细节层与装饰物层，纯视觉+宝箱拾取）
 * 算法：DFS 回溯迷宫 + 随机开洞（答辩可讲解：深度优先搜索生成完美迷宫）
 * tile：0=墙 1=地板 2=楼梯下(去下一层) 3=楼梯上(回上一层)
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var cfg = null;
  var grid = null;
  var details = null;   /* M9-1：2D 数组，每格细节类型 string|null（纯视觉） */
  var decor = null;     /* M9-1：2D 数组，每格装饰物 id string|null（chest 可拾取） */
  var floorIndex = 0;
  var spawn = { x: 1, y: 1 };
  var enemies = []; /* [{x, y, monsterId}] */

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

  /* 按楼层怪物概率表生成敌人（M2 战斗触发点） */
  function spawnEnemies() {
    enemies = [];
    var table = cfg.enemyTable[floorIndex % cfg.enemyTable.length];
    var count = 5 + floorIndex * 2;
    var placed = 0;
    var tries = 0;
    while (placed < count && tries < 500) {
      tries++;
      var w = grid[0].length;
      var h = grid.length;
      var x = 1 + Math.floor(Math.random() * (w - 2));
      var y = 1 + Math.floor(Math.random() * (h - 2));
      if (grid[y][x] === 1 && dist(x, y, spawn.x, spawn.y) > 6) {
        var roll = Math.random();
        var acc = 0;
        var pick = table[0].id;
        for (var i = 0; i < table.length; i++) {
          acc += table[i].rate;
          if (roll <= acc) { pick = table[i].id; break; }
        }
        enemies.push({ x: x, y: y, monsterId: pick });
        placed++;
      }
    }
  }

  /* M9-1：生成细节层与装饰层（纯视觉 + 宝箱，不影响通行/碰撞/寻路/FOV） */
  function genDetailsAndDecor(w, h) {
    details = [];
    decor = [];
    for (var y = 0; y < h; y++) {
      details[y] = [];
      decor[y] = [];
      for (var x = 0; x < w; x++) {
        details[y][x] = null;
        decor[y][x] = null;
      }
    }
    /* 地板细节：约 25% 概率按权重抽取 */
    var pool = (Game.Data.TILE_DETAILS && Game.Data.TILE_DETAILS.floor) || [];
    var totalW = 0;
    for (var i = 0; i < pool.length; i++) totalW += pool[i].weight;
    if (totalW > 0) {
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          if (grid[y][x] !== 1) continue;
          if (Math.random() >= 0.25) continue;
          var r = Math.random() * totalW;
          var acc = 0;
          for (var j = 0; j < pool.length; j++) {
            acc += pool[j].weight;
            if (r <= acc) { details[y][x] = pool[j].type; break; }
          }
        }
      }
    }
    /* 墙细节：苔藓（少量） */
    var wallPool = (Game.Data.TILE_DETAILS && Game.Data.TILE_DETAILS.wall) || [];
    var wallTotal = 0;
    for (var wi = 0; wi < wallPool.length; wi++) wallTotal += wallPool[wi].weight;
    if (wallTotal > 0) {
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          if (grid[y][x] !== 0) continue;
          if (Math.random() >= 0.08) continue;
          var wr = Math.random() * wallTotal;
          var wacc = 0;
          for (var wj = 0; wj < wallPool.length; wj++) {
            wacc += wallPool[wj].weight;
            if (wr <= wacc) { details[y][x] = wallPool[wj].type; break; }
          }
        }
      }
    }
    /* 装饰物：按层数调整数量（越深火把越多、宝箱越少） */
    var f = floorIndex + 1;
    placeDecor('chest', Math.max(1, 3 - f), w, h);
    placeDecor('barrel', 3 + f, w, h);
    placeDecor('torch', 2 + f * 2, w, h);
    placeDecor('vine', 2 + f, w, h);
  }

  function placeDecor(id, count, w, h) {
    var placed = 0, tries = 0;
    while (placed < count && tries < 400) {
      tries++;
      var x = 1 + Math.floor(Math.random() * (w - 2));
      var y = 1 + Math.floor(Math.random() * (h - 2));
      /* 只放地板格、不放楼梯/出生点/已有装饰/敌人格 */
      if (grid[y][x] !== 1) continue;
      if (x === spawn.x && y === spawn.y) continue;
      if (decor[y][x]) continue;
      var occupied = false;
      for (var i = 0; i < enemies.length; i++) {
        if (enemies[i].x === x && enemies[i].y === y) { occupied = true; break; }
      }
      if (occupied) continue;
      decor[y][x] = id;
      placed++;
    }
  }

  Game.Systems.Map = {
    generate: function () {
      cfg = Game.Data.MAPS;
      var size = cfg.sizes[floorIndex % cfg.sizes.length];
      grid = initGrid(size[0], size[1]);
      carve(1, 1);
      openRooms();
      placeStairs();
      spawnEnemies();
      if (Game.Systems.AI) Game.Systems.AI.initPatrols(2);
      spawn = { x: 1, y: 1 };
      genDetailsAndDecor(size[0], size[1]); /* M9-1：细节层 + 装饰层 */
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
      Game.Core.EventBus.emit('audio:play', { sfx: 'stair' });
      return { grid: g, floor: floorIndex + 1 };
    },

    getFloor: function () { return floorIndex + 1; },
    getGrid: function () { return grid; },
    getSpawn: function () { return { x: spawn.x, y: spawn.y }; },

    /* 存档恢复：直接切到指定楼层并重新生成 */
    setFloor: function (f) {
      floorIndex = Math.min(Math.max(f - 1, 0), cfg.floors - 1);
      return this.generate();
    },

    /* 取该格敌人：命中则移除（一次遭遇） */
    enemyAt: function (x, y) {
      for (var i = 0; i < enemies.length; i++) {
        if (enemies[i].x === x && enemies[i].y === y) {
          var e = enemies[i];
          enemies.splice(i, 1);
          return e;
        }
      }
      return null;
    },
    getEnemies: function () { return enemies; },

    /* M9-1：取该格 tile 细节类型（纯视觉），越界返回 null */
    getDetail: function (x, y) {
      if (!details || !details[y]) return null;
      if (x < 0 || y < 0 || x >= details[0].length || y >= details.length) return null;
      return details[y][x] || null;
    },

    /* M9-1：取该格装饰物 id（chest/barrel/torch/vine），越界/无装饰返回 null */
    getDecor: function (x, y) {
      if (!decor || !decor[y]) return null;
      if (x < 0 || y < 0 || x >= decor[0].length || y >= decor.length) return null;
      return decor[y][x] || null;
    },

    /* M9-1：拾取宝箱——仅 chest 可拾取，成功后置空并 emit 'decor:taken'
     * 金币走 Player.gold，道具走 Inventory.add，不新增数值系统 */
    takeDecor: function (x, y) {
      if (!decor || !decor[y]) return false;
      if (x < 0 || y < 0 || x >= decor[0].length || y >= decor.length) return false;
      var id = decor[y][x];
      if (id !== 'chest') return false;
      decor[y][x] = null;
      var loot = 'gold';
      var def = Game.Data.DECOR && Game.Data.DECOR.chest;
      if (def && def.loot === 'random') loot = Math.random() < 0.5 ? 'gold' : 'item';
      else if (def && def.loot) loot = def.loot;
      if (loot === 'gold') {
        var gold = (5 + Math.floor(Math.random() * 15)) * (floorIndex + 1);
        Game.Data.Player.gold += gold;
        Game.Core.EventBus.emit('ui:notice', { msg: '宝箱：获得 ' + gold + ' 金币' });
      } else {
        var items = ['potion_small', 'sword_bone', 'armor_leather'];
        var itemId = items[Math.floor(Math.random() * items.length)];
        if (Game.Systems.Inventory && Game.Systems.Inventory.add) {
          Game.Systems.Inventory.add(itemId, 1);
          var it = Game.Data.ITEMS && Game.Data.ITEMS[itemId];
          Game.Core.EventBus.emit('ui:notice', { msg: '宝箱：获得 ' + (it ? it.name : itemId) });
        }
      }
      Game.Core.EventBus.emit('decor:taken', { x: x, y: y, kind: 'chest' });
      Game.Core.EventBus.emit('audio:play', { sfx: 'gold' });
      return true;
    }
  };
})();
