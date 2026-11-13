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
  var traps = null;     /* S-04：2D 数组，每格 {id, seen}|null；seen=true 表示已触发并永久显现 */
  var rooms = [];       /* S-05：特殊房间 [{x,y,w,h,cx,cy,doorX,doorY}]，坐标均为室内/门所在格 */
  var floorIndex = 0;
  var spawn = { x: 1, y: 1 };
  var enemies = []; /* [{x, y, monsterId}] */
  var npcs = [];    /* D-47：本层实体 NPC [{id, x, y}]，位置确定性生成且可通行 */
  /* 修复 P1：楼层快照缓存——回访时恢复同一份地图/敌人/装饰/巡逻，
   * 避免上下楼反复重新生成而刷怪、刷宝箱。只在重新开始（setFloor）时清空。 */
  var floorCache = {};
  var lastMoves = [];   /* D-38：最近一次生成里被搬进出生点连通块的必经目标（只读遥测） */

  /* D-64：扩图前的每层尺寸。密度参数（怪/宝箱/陷阱/装饰/巡逻）按
   * 当前面积 / 基准面积 等比放大，避免"格子多了但内容没变多"的空旷大地图。
   * 只放大数量，不改任何怪物/物品/伤害/掉落数值。 */
  var BASE_SIZES = [[21, 15], [25, 17], [29, 19], [33, 21], [37, 23]];
  function areaRatio(w, h) {
    var b = BASE_SIZES[floorIndex % BASE_SIZES.length];
    return (w * h) / (b[0] * b[1]);
  }
  function areaScale(n, w, h) {
    return Math.max(n, Math.round(n * areaRatio(w, h)));
  }
  /* D-67：遭遇成本——只把"扩图带来的增量"乘以系数，基准数量恒不变。
   * 系数从 MAPS.density 读取，缺省 1（等价于 D-64/D-66 行为）。 */
  function densityOf(key) {
    var d = (Game.Data.MAPS && Game.Data.MAPS.density) || {};
    var v = d[key];
    /* D-67：允许按层给系数（数组）或全局一个数；缺省 1。 */
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var x = v[floorIndex % v.length];
      return (typeof x === 'number' && isFinite(x) && x >= 0) ? x : 1;
    }
    return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 1;
  }
  function areaExtra(n, w, h, k) {
    var scaled = areaScale(n, w, h);
    return Math.max(n, Math.round(n + (scaled - n) * k));
  }
  function enemyCount(w, h) { return areaExtra(5 + floorIndex * 2, w, h, densityOf('enemyArea')); }
  function patrolCount(w, h) { return areaExtra(2, w, h, densityOf('patrolArea')); }

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
        /* S-05：楼梯不放密室里，也不放门口（否则密室失去"绕进去"的意义） */
        if (inRoom(x, y) || inRoomDoor(x, y)) continue;
        return { x: x, y: y };
      }
    }
    return { x: 1, y: 1 };
  }

  /* S-05：格子是否落在某间密室的内部 */
  function inRoom(x, y) {
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
    }
    return false;
  }

  function inRoomDoor(x, y) {
    for (var i = 0; i < rooms.length; i++) {
      if (rooms[i].doorX === x && rooms[i].doorY === y) return true;
    }
    return false;
  }

  /* BFS：从 (sx,sy) 出发能否走到 (tx,ty)，只走非墙格（含楼梯 2/3 与地板 1）
   * blockTile：把某个 tile 值视为不可通行（D-18：用于"楼梯不是走廊"的真实移动语义） */
  function reachable(sx, sy, tx, ty, blockTile) {
    var w = grid[0].length, h = grid.length;
    var seen = [], q = [[sx, sy]], qi = 0;
    for (var yy = 0; yy < h; yy++) { seen[yy] = []; for (var xx = 0; xx < w; xx++) seen[yy][xx] = false; }
    seen[sy][sx] = true;
    var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    while (qi < q.length) {
      var cx = q[qi][0], cy = q[qi][1];
      qi++;
      if (cx === tx && cy === ty) return true;
      for (var d = 0; d < dirs.length; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (seen[ny][nx] || grid[ny][nx] === 0) continue;
        if (blockTile && grid[ny][nx] === blockTile) continue;
        seen[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
    return false;
  }

  /* S-05：从现有迷宫里"圈"出一间封闭小房 + 一扇门。
   * 做法：房间内部全部铺地板，房间四周一圈改成墙（把已有走廊封死），只留 1 扇门通向外部地板；
   * 生成后必须通过两条校验——① 门口与房间中心从出生点可达；② 全图地板格仍然全连通
   * （等价于"楼梯 100% 可达"的更强断言）。任一校验失败就把受影响的格子整体还原并重试。
   * 返回房间记录或 null（该层没有密室也是合法结果） */
  function placeSpecialRoom(w, h) {
    rooms = [];
    var cfgR = Game.Data.ROOMS;
    if (!cfgR || (floorIndex + 1) < (cfgR.startFloor || 2)) return null;
    var tries = cfgR.tries || 40;
    /* 全图连通性：从出生点旁的第一块地板出发能走到的地板格数 vs 总地板格数。
     * 注意 (1,1) 本身是墙（DFS 迷宫从墙角起挖，真正的第一块地板在 (2,1)），不能拿它当起点计数 */
    function fullyConnected() {
      var total = 0, seen = [], qi = 0, cnt = 0, sx0 = -1, sy0 = -1;
      for (var yy = 0; yy < h; yy++) {
        seen[yy] = [];
        for (var xx = 0; xx < w; xx++) {
          seen[yy][xx] = false;
          if (grid[yy][xx] !== 0) {
            total++;
            if (sx0 < 0) { sx0 = xx; sy0 = yy; }
          }
        }
      }
      if (total === 0 || sx0 < 0) return false;
      var q = [[sx0, sy0]];
      seen[sy0][sx0] = true;
      var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      while (qi < q.length) {
        var cx = q[qi][0], cy = q[qi][1];
        qi++; cnt++;
        for (var d = 0; d < dirs.length; d++) {
          var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (seen[ny][nx] || grid[ny][nx] === 0) continue;
          seen[ny][nx] = true;
          q.push([nx, ny]);
        }
      }
      return cnt === total;
    }
    for (var t = 0; t < tries; t++) {
      var rw = cfgR.minW + Math.floor(Math.random() * (Math.max(cfgR.minW, cfgR.maxW) - cfgR.minW + 1));
      var rh = cfgR.minH + Math.floor(Math.random() * (Math.max(cfgR.minH, cfgR.maxH) - cfgR.minH + 1));
      if (rw < 2 || rh < 2) continue;
      var x0 = 2 + Math.floor(Math.random() * Math.max(1, w - rw - 5));
      var y0 = 2 + Math.floor(Math.random() * Math.max(1, h - rh - 5));
      if (x0 + rw >= w - 1 || y0 + rh >= h - 1) continue;
      /* 密室中心离出生点太近就不挖（出生点旁边直接给厚赏会破坏经济与风险回报感） */
      var ccx = x0 + Math.floor(rw / 2), ccy = y0 + Math.floor(rh / 2);
      if (dist(ccx, ccy, spawn.x, spawn.y) < (cfgR.safeRadius || 7)) continue;
      /* 先备份"房间内部 + 四周一圈墙"的原状，失败时整体还原 */
      var back = [];
      for (var by = y0 - 1; by <= y0 + rh; by++) {
        back[by] = [];
        for (var bx = x0 - 1; bx <= x0 + rw; bx++) back[by][bx] = grid[by][bx];
      }
      /* 房间内部铺平 + 四周封成墙 */
      for (var iy = y0; iy < y0 + rh; iy++) {
        for (var ix = x0; ix < x0 + rw; ix++) grid[iy][ix] = 1;
      }
      for (var sy3 = y0 - 1; sy3 <= y0 + rh; sy3++) {
        for (var sx3 = x0 - 1; sx3 <= x0 + rw; sx3++) {
          /* 只封边，不清内部（内部已铺平） */
          if (sx3 === x0 - 1 || sx3 === x0 + rw || sy3 === y0 - 1 || sy3 === y0 + rh) grid[sy3][sx3] = 0;
        }
      }
      /* 开门候选：边界圈上、紧邻"圈外地板"的墙格（不取四个角，避免门开在角上） */
      var cands = [];
      var ring = [];
      for (var rx = x0; rx < x0 + rw; rx++) { ring.push([rx, y0 - 1]); ring.push([rx, y0 + rh]); }
      for (var ry = y0; ry < y0 + rh; ry++) { ring.push([x0 - 1, ry]); ring.push([x0 + rw, ry]); }
      for (var ri = 0; ri < ring.length; ri++) {
        var qx = ring[ri][0], qy = ring[ri][1];
        var near = false;
        var around = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (var ai = 0; ai < around.length; ai++) {
          var ax = qx + around[ai][0], ay = qy + around[ai][1];
          if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
          if (ax >= x0 - 1 && ax <= x0 + rw && ay >= y0 - 1 && ay <= y0 + rh) continue; /* 圈内不算 */
          if (grid[ay][ax] !== 0) { near = true; break; }
        }
        if (near) cands.push([qx, qy]);
      }
      if (!cands.length) {
        for (var by2 = y0 - 1; by2 <= y0 + rh; by2++) for (var bx2 = x0 - 1; bx2 <= x0 + rw; bx2++) grid[by2][bx2] = back[by2][bx2];
        continue;
      }
      var door = cands[Math.floor(Math.random() * cands.length)];
      grid[door[1]][door[0]] = 1;
      var cx = x0 + Math.floor(rw / 2), cy = y0 + Math.floor(rh / 2);
      if (!reachable(spawn.x, spawn.y, cx, cy) || !reachable(spawn.x, spawn.y, door[0], door[1]) || !fullyConnected()) {
        for (var by3 = y0 - 1; by3 <= y0 + rh; by3++) for (var bx3 = x0 - 1; bx3 <= x0 + rw; bx3++) grid[by3][bx3] = back[by3][bx3];
        continue;
      }
      var rec = { x: x0, y: y0, w: rw, h: rh, cx: cx, cy: cy, doorX: door[0], doorY: door[1] };
      rooms.push(rec);
      return rec;
    }
    return null;
  }

  /* D-18：楼梯落点必须保证"出生点 → 上行梯"和"出生点 → 下行梯"都走得通。
   * 关键：楼梯是传送门——踩到 tile 2/3 会立刻 changeFloor 并被传送到目标层出生点，
   * 因此楼梯格不能当走廊穿行。只做"网格连通"检查是不够的（D-17 里 4/50 的卡关正是
   * 上行梯卡在唯一走廊上：格子连通，但走过去的路上会先踩到上行梯被传走，下行梯永远到不了）。
   * 这里按真实移动语义校验：去上行梯的路上不许踩下行梯，去下行梯的路上不许踩上行梯。
   * 第 1 层的上行梯 / 最深层的下行梯，changeFloor 越界返回 null，踩上去等同普通地板，不构成阻断。 */
  function placeStairs() {
    var w = grid[0].length;
    var h = grid.length;
    var sx = spawn.x, sy = spawn.y;
    var upBlocks = floorIndex > 0;                 /* 第 1 层的上行梯是空转 */
    var downBlocks = floorIndex < cfg.floors - 1;  /* 最深层的下行梯是空转 */

    /* 先按原顺序抽两个落点，占位后一起校验；不合格就整体撤销重抽。
     * 首轮抽样与旧实现完全一致，因此原本就合法的地图指纹不变，只有真正会卡关的层会重新抽。 */
    function fits(upCell, downCell) {
      if (!upCell || !downCell) return false;
      if (upCell.x === downCell.x && upCell.y === downCell.y) return false;
      grid[upCell.y][upCell.x] = 3;
      grid[downCell.y][downCell.x] = 2;
      var okUp = reachable(sx, sy, upCell.x, upCell.y, downBlocks ? 2 : 0);
      var okDown = reachable(sx, sy, downCell.x, downCell.y, upBlocks ? 3 : 0);
      if (okUp && okDown) return true;
      grid[upCell.y][upCell.x] = 1;
      grid[downCell.y][downCell.x] = 1;
      return false;
    }

    var up = null, down = null;
    for (var t = 0; t < 60 && !down; t++) {
      var a = findOpen(w, h);
      if (!a || grid[a.y][a.x] !== 1) continue;
      grid[a.y][a.x] = 3;            /* 先占位，避免第二次抽样选到同一格 */
      var b = findOpen(w, h);
      grid[a.y][a.x] = 1;
      if (!b || grid[b.y][b.x] !== 1) continue;
      if (fits(a, b)) { up = a; down = b; }
    }

    /* 兜底：死角（可走邻居 ≤1）不可能成为别人路径的中间点，把楼梯放死角必然不切断任何通路。
     * 扫描顺序固定、不消耗随机数，任何地图都能落地（完美迷宫必有叶子）。
     * 不缩图、不减楼梯、不减房间，只是换两个更安全的落点。 */
    if (!up || !down) {
      var leaves = [], others = [];
      for (var y = 1; y < h - 1; y++) {
        for (var x = 1; x < w - 1; x++) {
          if (grid[y][x] !== 1) continue;
          if (inRoom(x, y) || inRoomDoor(x, y)) continue;
          if (dist(x, y, spawn.x, spawn.y) <= Math.min(w, h) * 0.35) continue;
          var deg = 0;
          if (x > 0 && grid[y][x - 1] !== 0) deg++;
          if (x < w - 1 && grid[y][x + 1] !== 0) deg++;
          if (y > 0 && grid[y - 1][x] !== 0) deg++;
          if (y < h - 1 && grid[y + 1][x] !== 0) deg++;
          (deg <= 1 ? leaves : others).push({ x: x, y: y });
        }
      }
      var order = leaves.concat(others);
      for (var i = 0; i < order.length && !down; i++) {
        for (var j = 0; j < order.length; j++) {
          if (i === j) continue;
          if (fits(order[i], order[j])) { up = order[i]; down = order[j]; break; }
        }
      }
    }

    /* 理论不可达（迷宫结构退化到无任何可用落点）：仍按旧口径落地，避免生成直接失败。
     * verify_d18 的 200 种子 × 5 层断言会把这种情况暴露出来。 */
    if (!up || !down) {
      up = up || findOpen(w, h);
      down = down || findOpen(w, h);
      grid[up.y][up.x] = 3;
      grid[down.y][down.x] = 2;
    }
  }

  /* D-38：出生点连通块。楼梯是传送门——踩到会真正换层的楼梯格不能当走廊穿行，
   * 所以这里只走非墙格，并把"会换层的楼梯值"排除（空转楼梯仍是普通地板）。 */
  function stairBlockMap() {
    return {
      2: floorIndex < cfg.floors - 1, /* 最深层的下行梯空转 */
      3: floorIndex > 0               /* 第 1 层的上行梯空转 */
    };
  }
  function spawnComponent() {
    var w = grid[0].length, h = grid.length;
    var block = stairBlockMap();
    var seen = [], q = [[spawn.x, spawn.y]], qi = 0;
    for (var y = 0; y < h; y++) { seen[y] = []; for (var x = 0; x < w; x++) seen[y][x] = false; }
    seen[spawn.y][spawn.x] = true;
    var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    while (qi < q.length) {
      var cx = q[qi][0], cy = q[qi][1];
      qi++;
      /* 传送楼梯可以"走上去"（它是目标/终点），但踩上去就换层，不能从它继续往外走 */
      if (block[grid[cy][cx]]) continue;
      for (var d = 0; d < dirs.length; d++) {
        var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (seen[ny][nx] || grid[ny][nx] === 0) continue;
        seen[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
    return seen;
  }

  /* D-38：某一层的"必经目标"集合（不通关不能算合格地图）：
   *   · 非最终层：下行梯——不下楼永远到不了 Boss；
   *   · 最终层：MAPS.bosses 注入的 Boss——主线胜利条件是击杀 Boss；
   *     该层的下行梯 changeFloor 空转，是普通地板，不构成目标。
   * 由 floorIndex / cfg.floors / cfg.bosses 推导，不写死层号。 */
  function mandatoryTargets() {
    var list = [];
    if (floorIndex >= cfg.floors - 1) {
      var bossId = null;
      if (cfg.bosses) {
        for (var b = 0; b < cfg.bosses.length; b++) {
          if (cfg.bosses[b].floor === floorIndex + 1) { bossId = cfg.bosses[b].id; break; }
        }
      }
      if (bossId) {
        for (var i = 0; i < enemies.length; i++) {
          if (enemies[i].monsterId === bossId) {
            list.push({ kind: 'boss', id: bossId, enemyIndex: i, x: enemies[i].x, y: enemies[i].y });
          }
        }
      }
      return list;
    }
    for (var y = 0; y < grid.length; y++) {
      for (var x = 0; x < grid[0].length; x++) {
        if (grid[y][x] === 2) list.push({ kind: 'stairs-down', x: x, y: y });
      }
    }
    return list;
  }

  /* 只修"目标落点"，不动迷宫拓扑 / 楼梯位置 / 怪物数量：
   * 目标不在出生点连通块里时，把它搬到块内空地（沿用 spawnEnemies 的"离出生点 >6 格"约束）。
   * 只有旧检查漏掉的非法层会走到这里——合法地图不消耗随机数，指纹与历史基线不变。 */
  function ensureMandatoryTargets() {
    var seen = spawnComponent();
    var targets = mandatoryTargets();
    var moved = [];
    for (var t = 0; t < targets.length; t++) {
      var tg = targets[t];
      if (seen[tg.y][tg.x]) continue;
      if (tg.kind !== 'boss') continue; /* 下行梯由 placeStairs 的 fits 保证，这里只兜底 Boss */
      var cands = [];
      for (var y = 1; y < grid.length - 1; y++) {
        for (var x = 1; x < grid[0].length - 1; x++) {
          if (grid[y][x] !== 1 || !seen[y][x]) continue;
          if (dist(x, y, spawn.x, spawn.y) <= 6) continue;
          var occupied = false;
          for (var e = 0; e < enemies.length; e++) {
            if (e !== tg.enemyIndex && enemies[e].x === x && enemies[e].y === y) { occupied = true; break; }
          }
          if (!occupied) cands.push({ x: x, y: y });
        }
      }
      if (!cands.length) continue;
      var pick = cands[Math.floor(Math.random() * cands.length)];
      moved.push({ kind: tg.kind, id: tg.id, from: tg.x + ',' + tg.y, to: pick.x + ',' + pick.y });
      enemies[tg.enemyIndex].x = pick.x;
      enemies[tg.enemyIndex].y = pick.y;
    }
    return moved;
  }

  /* 按楼层怪物概率表生成敌人（M2 战斗触发点） */
  function spawnEnemies() {
    enemies = [];
    var table = cfg.enemyTable[floorIndex % cfg.enemyTable.length];
    var w = grid[0].length;
    var h = grid.length;
    /* D-64：按面积等比放大，基准 5+2×(层-1)。D-67：系数只管增量，见 areaExtra。 */
    var count = enemyCount(w, h);
    var placed = 0;
    var tries = 0;
    while (placed < count && tries < 500) {
      tries++;
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
        /* D-59：静态怪也接入 AI——记住出生格（丢失目标后走回去）与 tick 帧计数。
         * 这两个字段是运行期状态，不入存档；读档/换层后由本函数重新生成。 */
        enemies.push({ x: x, y: y, monsterId: pick, homeX: x, homeY: y, frame: 0, rest: 0 });
        placed++;
      }
    }
    /* P2-4：通用层 Boss 保底（合并 P2-3b 的末层 dragon 逻辑，不再保留两套）。
     * cfg.bosses 中 floor 匹配本层 → 保证恰好 1 只该 Boss：
     *   0 只 → 末位替换为 Boss（保底，保证主线可达）；1 只 → 不动；
     *   >1 只 → 保留第一只，其余替换为本层敌表中非 Boss 的随机项（普通表不含 Boss id，通常不触发）。
     * 无配置的层不处理；敌表全为 Boss 项时兜底保留原样，不抛错。 */
    var bossId = null;
    if (cfg.bosses) {
      for (var bi = 0; bi < cfg.bosses.length; bi++) {
        if (cfg.bosses[bi].floor === floorIndex + 1) { bossId = cfg.bosses[bi].id; break; }
      }
    }
    if (bossId && enemies.length > 0) {
      var bossFirst = -1, bossCount = 0;
      for (var d = 0; d < enemies.length; d++) {
        if (enemies[d].monsterId === bossId) {
          bossCount++;
          if (bossFirst < 0) bossFirst = d;
        }
      }
      if (bossCount === 0) {
        enemies[enemies.length - 1].monsterId = bossId;
      } else if (bossCount > 1) {
        var nonBoss = [];
        var nonBossTotal = 0;
        for (var nt = 0; nt < table.length; nt++) {
          if (table[nt].id !== bossId) {
            nonBoss.push(table[nt]);
            nonBossTotal += table[nt].rate;
          }
        }
        if (nonBoss.length > 0 && nonBossTotal > 0) {
          for (var k = 0; k < enemies.length; k++) {
            if (k === bossFirst || enemies[k].monsterId !== bossId) continue;
            var roll2 = Math.random() * nonBossTotal;
            var acc2 = 0, pick2 = nonBoss[0].id;
            for (var p2 = 0; p2 < nonBoss.length; p2++) {
              acc2 += nonBoss[p2].rate;
              if (roll2 <= acc2) { pick2 = nonBoss[p2].id; break; }
            }
            enemies[k].monsterId = pick2;
          }
        }
      }
    }
  }

  /* M9-1：生成细节层与装饰层（纯视觉 + 宝箱，不影响通行/碰撞/寻路/FOV） */
  function genDetailsAndDecor(w, h) {
    details = [];
    decor = [];
    traps = [];
    for (var y = 0; y < h; y++) {
      details[y] = [];
      decor[y] = [];
      traps[y] = [];
      for (var x = 0; x < w; x++) {
        details[y][x] = null;
        decor[y][x] = null;
        traps[y][x] = null;
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
    /* 装饰物：按层数调整数量（越深火把越多、宝箱越少）。
     * D-58：宝箱仍按原顺序/原次数生成（随机流一格不差），生成后再把其中约 65%
     * 就近搬到怪物 2 格内——搬移是纯确定性操作，不消耗 Math.random，
     * 所以木桶/火把/藤蔓/陷阱/奖励点/NPC 的位置与 D-57 逐格一致。 */
    var f = floorIndex + 1;
    /* D-64：数量按面积等比放大；宝箱下限 2（扩图后不让密度被摊薄）。
     * 宝箱的金币/道具池、绑怪比例、密室宝箱都不变，只改"放几个"。 */
    var ratio = areaRatio(w, h);
    var chestN = Math.max(ratio > 1.05 ? 2 : 1, Math.round(Math.max(1, 3 - f) * ratio));
    placeDecor('chest', chestN, w, h);
    bindChestsToMonsters(w, h);
    placeDecor('barrel', areaScale(3 + f, w, h), w, h);
    placeDecor('torch', areaScale(2 + f * 2, w, h), w, h);
    placeDecor('vine', areaScale(2 + f, w, h), w, h);
    furnishRooms(); /* S-05：密室内固定 1 个密室宝箱 + 2 个火把 */
    placeTraps(w, h); /* S-04：陷阱层（与细节/装饰同批生成，避免二次遍历） */
    placeRewards(w, h); /* D-46：每层固定奖励点（金币/药），放在陷阱之后，互不侵占 */
    placeNpc(w, h);     /* D-47：实体 NPC（不消耗随机数，放在最后，不挤占任何既有落点） */
  }

  /* ── D-47：实体 NPC ────────────────────────────────────────────
   * 位置规则：优先"出生点→下行梯"主路的 72% 附近（离楼梯 3~6 步，接取后走到楼梯旁
   * 再回头两步即可交付），沿路径向两侧逐格扫描；主路找不到再按行序扫描整个出生点
   * 连通块。全程不调用 Math.random，因此地图指纹 / 怪物 / 宝箱 / 奖励点与 D-46 逐格一致。
   * 约束：地板格、出生点连通块内、不压出生点/楼梯、离出生点 ≥4、离下行梯 ≥2、
   *       不在密室内、不占敌人/巡逻/装饰（含宝箱与奖励点）/陷阱格。 */
  function placeNpc(w, h) {
    npcs = [];
    var list = (Game.Data.NPCS && Game.Data.NPCS.list) || [];
    var def = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].floor === floorIndex + 1) { def = list[i]; break; }
    }
    if (!def) return;
    var seen = spawnComponent();
    var down = findTile(2, w, h);
    var cands = [], used = Object.create(null);
    if (down) {
      var path = rewardPath(down, w, h, false) || rewardPath(down, w, h, true) || [];
      var fracs = [0.72, 0.65, 0.6, 0.78, 0.55, 0.8, 0.5, 0.85, 0.45, 0.9];
      for (var f = 0; f < fracs.length; f++) {
        var idx = Math.max(1, Math.min(path.length - 1, Math.round((path.length - 1) * fracs[f])));
        for (var d2 = 0; d2 < path.length; d2++) {
          var j = (d2 % 2 === 0) ? idx + d2 / 2 : idx - (d2 + 1) / 2;
          if (j < 0 || j >= path.length) continue;
          var key = path[j].x + ',' + path[j].y;
          if (used[key]) continue;
          used[key] = 1;
          cands.push(path[j]);
        }
      }
    }
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var k = x + ',' + y;
        if (used[k]) continue;
        if (grid[y][x] === 1 && seen[y][x]) { used[k] = 1; cands.push({ x: x, y: y }); }
      }
    }
    for (var c = 0; c < cands.length; c++) {
      if (!npcCellOk(cands[c], seen)) continue;
      npcs.push({ id: def.id, x: cands[c].x, y: cands[c].y });
      return;
    }
  }

  function npcCellOk(c, seen) {
    if (!grid[c.y] || grid[c.y][c.x] !== 1) return false;
    if (!seen[c.y][c.x]) return false;                                  /* 出生点连通块内（真实移动语义） */
    if (c.x === spawn.x && c.y === spawn.y) return false;               /* 不压出生点 */
    if (dist(c.x, c.y, spawn.x, spawn.y) < 4) return false;
    var down = findTile(2, grid[0].length, grid.length);
    if (down && dist(c.x, c.y, down.x, down.y) < 2) return false;       /* 不压下行梯 */
    if (inRoom(c.x, c.y) || inRoomDoor(c.x, c.y)) return false;
    if (enemyAtCell(c.x, c.y)) return false;                            /* 不占怪物格 */
    var ps = (Game.Systems.AI && typeof Game.Systems.AI.getPatrols === 'function')
      ? Game.Systems.AI.getPatrols() : [];
    for (var i = 0; i < ps.length; i++) {                               /* 不占巡逻怪格 */
      if (ps[i].x === c.x && ps[i].y === c.y) return false;
    }
    if (decor[c.y] && decor[c.y][c.x]) return false;                    /* 不压宝箱 / 奖励点 */
    if (traps[c.y] && traps[c.y][c.x]) return false;                    /* 不压陷阱 */
    return true;
  }

  /* ── D-46：每层固定奖励点 ──────────────────────────────────────
   * 只解决一件事：玩家在 F1/F2 首次进店时买得起第一件装备。
   * 位置取"出生点→下行梯"的主路（优先不穿怪的路径），确定性取点、不消耗
   * Math.random，因此既有地图指纹/敌人/宝箱布局与 D-45 逐格一致。
   * 约束：每层 ≤2 处；距出生点 ≥minSpawnDist；距下行梯 ≥minStairDist；
   *       不落在墙 / 敌人 / 陷阱 / 已有装饰 / 密室内。 */
  function placeRewards(w, h) {
    var rc = Game.Data.REWARD;
    if (!rc || !rc.floors) return;
    var spec = rc.floors[floorIndex];
    if (!spec || !spec.count) return;
    var n = Math.min(spec.count, (typeof rc.maxPerFloor === 'number') ? rc.maxPerFloor : 2, 2);
    var down = findTile(2, w, h);
    if (!down || n <= 0) return;
    var path = rewardPath(down, w, h, false);
    if (!path || path.length < 4) path = rewardPath(down, w, h, true);
    if (!path || path.length < 3) return;
    for (var i = 0; i < n; i++) {
      var frac = (n === 1) ? 0.5 : (i === 0 ? 0.35 : 0.7);
      var idx = Math.max(1, Math.round((path.length - 1) * frac));
      var cell = rewardCell(path, idx, down, rc);
      if (!cell) continue;
      decor[cell.y][cell.x] = (spec.kind === 'potion') ? 'potion_stash' : 'gold_pile';
    }
  }
  function findTile(t, w, h) {
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) if (grid[y][x] === t) return { x: x, y: y };
    }
    return null;
  }
  function enemyAtCell(x, y) {
    for (var i = 0; i < enemies.length; i++) if (enemies[i].x === x && enemies[i].y === y) return enemies[i];
    return null;
  }
  /* 出生点→目标格的 BFS 路径（含两端）。allowEnemy=false 时把敌人当墙。
   * 与真实移动语义一致：会换层的楼梯是传送门，不能当走廊穿行。 */
  function rewardPath(goal, w, h, allowEnemy) {
    var sk = spawn.x + ',' + spawn.y;
    var prev = Object.create(null), q = [sk], head = 0;
    var dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    prev[sk] = null;
    while (head < q.length) {
      var k = q[head++], c = k.split(','), x = +c[0], y = +c[1];
      if (x === goal.x && y === goal.y) break;
      for (var i = 0; i < 4; i++) {
        var nx = x + dirs[i][0], ny = y + dirs[i][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var nk = nx + ',' + ny;
        if (prev[nk] !== undefined) continue;
        var t = grid[ny][nx];
        if (t === 0) continue;
        if (t === 3 && floorIndex > 0) continue;
        if (t === 2 && !(nx === goal.x && ny === goal.y)) continue;
        if (!allowEnemy && enemyAtCell(nx, ny)) continue;
        prev[nk] = k; q.push(nk);
      }
    }
    var gk = goal.x + ',' + goal.y;
    if (prev[gk] === undefined) return null;
    var out = [], cur = gk;
    while (cur !== null) {
      var cc = cur.split(',');
      out.push({ x: +cc[0], y: +cc[1] });
      cur = prev[cur];
    }
    out.reverse();
    return out;
  }
  /* 在路径 idx 附近找一格合法落点（前后各退 1 格依次尝试） */
  function rewardCell(path, idx, down, rc) {
    var minSpawn = (typeof rc.minSpawnDist === 'number') ? rc.minSpawnDist : 5;
    var minStair = (typeof rc.minStairDist === 'number') ? rc.minStairDist : 3;
    for (var d = 0; d < path.length; d++) {
      var j = (d % 2 === 0) ? (idx + d / 2) : (idx - (d + 1) / 2);
      if (j < 1 || j >= path.length) continue;
      var c = path[j];
      if (grid[c.y][c.x] !== 1) continue;
      if (decor[c.y][c.x]) continue;
      if (traps[c.y] && traps[c.y][c.x]) continue;
      if (enemyAtCell(c.x, c.y)) continue;
      if (inRoom(c.x, c.y) || inRoomDoor(c.x, c.y)) continue;
      if (Math.abs(c.x - spawn.x) + Math.abs(c.y - spawn.y) < minSpawn) continue;
      if (Math.abs(c.x - down.x) + Math.abs(c.y - down.y) < minStair) continue;
      return c;
    }
    return null;
  }

  /* S-05：密室内固定陈设——中心密室宝箱，左右上角各一支火把（若有空间） */
  function furnishRooms() {
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      decor[r.cy][r.cx] = 'room_chest';
      var t1 = { x: r.x, y: r.y }, t2 = { x: r.x + r.w - 1, y: r.y };
      if (!(t1.x === r.cx && t1.y === r.cy)) decor[t1.y][t1.x] = 'torch';
      if (!(t2.x === r.cx && t2.y === r.cy) && !(t2.x === t1.x && t2.y === t1.y)) decor[t2.y][t2.x] = 'torch';
    }
  }

  /* S-04：陷阱放置——每层 3~6 个，只放地板格；
   * 排除出生点 safeRadius 格内、敌人格、已放宝箱格；F1 只放地刺，F2 起按 gasRate 抽毒气 */
  function placeTraps(w, h) {
    var cfgT = Game.Data.TRAP_PLACEMENT || { min: 3, max: 6, safeRadius: 3, gasRate: 0.45 };
    /* D-64：先按原规则取 3~6，再按面积等比放大；陷阱伤害/触发逻辑不变。 */
    var baseCount = cfgT.min + Math.floor(Math.random() * (Math.max(cfgT.min, cfgT.max) - cfgT.min + 1));
    var count = areaScale(baseCount, w, h);
    var gasRate = (typeof cfgT.gasRate === 'number') ? cfgT.gasRate : 0.45;
    var only = (floorIndex === 0) ? (cfgT.firstFloorOnly || 'spike') : null;
    var placed = 0, tries = 0;
    while (placed < count && tries < 600) {
      tries++;
      var x = 1 + Math.floor(Math.random() * (w - 2));
      var y = 1 + Math.floor(Math.random() * (h - 2));
      if (grid[y][x] !== 1) continue;
      /* 出生点周围不放（含出生点本身），玩家一落地就踩陷阱属于设计缺陷 */
      var dx = x - spawn.x, dy = y - spawn.y;
      if (dx * dx + dy * dy <= cfgT.safeRadius * cfgT.safeRadius) continue;
      if (traps[y][x]) continue;
      if (decor[y][x] === 'chest' || decor[y][x] === 'room_chest') continue;
      if (inRoom(x, y)) continue; /* S-05：密室内不放陷阱（房内必须靠走位，不靠踩坑） */
      var occupied = false;
      for (var i = 0; i < enemies.length; i++) {
        if (enemies[i].x === x && enemies[i].y === y) { occupied = true; break; }
      }
      if (occupied) continue;
      var id = only || (Math.random() < gasRate ? 'gas' : 'spike');
      if (!Game.Data.TRAPS || !Game.Data.TRAPS[id]) continue;
      traps[y][x] = { id: id, seen: false };
      placed++;
    }
  }

  /* ── D-58：宝箱布置 ────────────────────────────────────────────
   * 目标：让"开箱"和"处理那只怪"发生关系，而不是把箱子撒在没人去的角落。
   * 硬约束（都在 chestCellOk 里逐条检查）：
   *   · 只放地板、且在出生点连通块内 —— 永远可达，不会把箱子放进死块；
   *   · 不压出生点 / 楼梯 / 密室与门 / 已有装饰 / 陷阱 / 怪物格；
   *   · 奖励点（D-46）、NPC（D-47）都在本函数之后生成，且它们都显式跳过 decor，
   *     所以不会出现"宝箱和金币堆/NPC/陷阱叠在一格"。
   * 数量与掉率完全不变：仍是 chest 的既有金币/道具池，绑怪只改位置。 */
  var chestPlan = {};
  function binderMonsters() {
    var out = [], i;
    /* 优先绑"会追人的怪"（巡逻/追击），这样玩家靠近箱子时真的会被发现；
     * 守卫类排在后面，作为没有追人怪时的候选。 */
    function kindOf(id) {
      var m = (Game.Data.MONSTERS || {})[id];
      var h = m && m.habit;
      return h && h.kind ? h.kind : 'patrol';
    }
    var ps = (Game.Systems.AI && typeof Game.Systems.AI.getPatrols === 'function')
      ? Game.Systems.AI.getPatrols() : [];
    for (i = 0; i < ps.length; i++) {
      if (kindOf(ps[i].monsterId) !== 'guard') out.push({ x: ps[i].x, y: ps[i].y });
    }
    for (i = 0; i < enemies.length; i++) {
      if (kindOf(enemies[i].monsterId) !== 'guard') out.push({ x: enemies[i].x, y: enemies[i].y });
    }
    for (i = 0; i < ps.length; i++) {
      if (kindOf(ps[i].monsterId) === 'guard') out.push({ x: ps[i].x, y: ps[i].y });
    }
    for (i = 0; i < enemies.length; i++) {
      if (kindOf(enemies[i].monsterId) === 'guard') out.push({ x: enemies[i].x, y: enemies[i].y });
    }
    return out;
  }

  function chestCellOk(x, y, seen) {
    if (!grid[y] || grid[y][x] === undefined) return false;
    if (grid[y][x] !== 1) return false;                       /* 地板（不含楼梯） */
    if (!seen[y][x]) return false;                            /* 出生点连通块内 */
    if (x === spawn.x && y === spawn.y) return false;
    if (inRoom(x, y) || inRoomDoor(x, y)) return false;       /* 密室陈设由 furnishRooms 独占 */
    if (decor[y][x]) return false;
    if (traps[y] && traps[y][x]) return false;
    if (enemyAtCell(x, y)) return false;
    return true;
  }

  /* 把怪物格当墙的连通块：用于判断"这个空地在怪的另一侧、不处理怪就过不去"。 */
  function componentAvoidMonsters(w, h) {
    var seen = [], x, y;
    for (y = 0; y < h; y++) { seen[y] = []; for (x = 0; x < w; x++) seen[y][x] = false; }
    var block = Object.create(null), i;
    for (i = 0; i < enemies.length; i++) block[enemies[i].x + ',' + enemies[i].y] = 1;
    var ps = (Game.Systems.AI && typeof Game.Systems.AI.getPatrols === 'function')
      ? Game.Systems.AI.getPatrols() : [];
    for (i = 0; i < ps.length; i++) block[ps[i].x + ',' + ps[i].y] = 1;
    var q = [[spawn.x, spawn.y]], qi = 0;
    seen[spawn.y][spawn.x] = true;
    var dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    while (qi < q.length) {
      var c = q[qi++];
      for (var d = 0; d < 4; d++) {
        var nx = c[0] + dirs[d][0], ny = c[1] + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (grid[ny][nx] === 0 || seen[ny][nx]) continue;
        if (block[nx + ',' + ny]) continue;
        seen[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
    return seen;
  }

  function chestNearMonster(mons, rad, seen, seenAvoid) {
    var cands = [], hard = [], used = Object.create(null), i;
    for (i = 0; i < mons.length; i++) {
      var m = mons[i];
      for (var d = 1; d <= rad; d++) {
        for (var dx = -d; dx <= d; dx++) {
          var ay = d - Math.abs(dx);
          var dys = ay === 0 ? [0] : [-ay, ay];
          for (var k = 0; k < dys.length; k++) {
            var x = m.x + dx, y = m.y + dys[k];
            var key = x + ',' + y;
            if (used[key]) continue;
            if (!chestCellOk(x, y, seen)) continue;
            used[key] = 1;
            var cell = { x: x, y: y };
            cands.push(cell);
            /* "怪的另一侧"优先：不处理那只怪就走不到，开箱成本真的落在怪身上 */
            if (seenAvoid && seenAvoid[y] && !seenAvoid[y][x]) hard.push(cell);
          }
        }
      }
    }
    var pool = hard.length ? hard : cands;
    if (!pool.length) return null;
    /* 确定性挑选（不用 Math.random）：同一张图同一层，选到的目标格恒定 */
    var pick = (mons.length * 31 + pool.length * 7 + floorIndex * 13) % pool.length;
    return pool[pick];
  }

  function firstFreeSeenCell(w, h, seen) {
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        if (chestCellOk(x, y, seen)) return { x: x, y: y };
      }
    }
    return null;
  }

  /* 把已生成的普通宝箱搬到怪物附近。判定"绑怪"用坐标哈希（不消耗随机数）：
   * hash < boundRate×100 才搬，因此比例稳定在 65% 左右，且同图可复现。
   * 搬移目标必须在地板、出生点连通块内、不压楼梯/密室/已有装饰/陷阱/怪物。 */
  function bindChestsToMonsters(w, h) {
    var cp = Game.Data.CHEST_PLACEMENT || { boundRate: 0.65, bindRadius: 2 };
    var rate = (typeof cp.boundRate === 'number') ? cp.boundRate : 0.65;
    var rad = (typeof cp.bindRadius === 'number') ? cp.bindRadius : 2;
    var list = [], x, y;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        if (decor[y][x] === 'chest') list.push({ x: x, y: y });
      }
    }
    var total = list.length, bound = 0, free = 0;
    if (rate <= 0 || !total) {
      chestPlan[floorIndex] = { floor: floorIndex + 1, total: total, bound: 0, free: total, radius: rad };
      return;
    }
    var mons = binderMonsters();
    var seen = spawnComponent();
    var seenAvoid = componentAvoidMonsters(w, h);
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var hash = Math.abs(c.x * 31 + c.y * 17 + floorIndex * 7) % 100;
      var cell = null, boundMove = false;
      if (mons.length && hash < Math.round(rate * 100)) {
        cell = chestNearMonster(mons, rad, seen, seenAvoid);
        boundMove = !!cell;
      }
      if (!cell && !seen[c.y][c.x]) {
        /* 极少数宝箱会被 openRooms 的孤立单格吞掉：不搬去怪旁边，但必须搬回连通块，
         * 否则"开不到的箱子"会变成新缺口。 */
        cell = firstFreeSeenCell(w, h, seen);
        boundMove = false;
      }
      if (cell) {
        decor[c.y][c.x] = null;
        decor[cell.y][cell.x] = 'chest';
        if (boundMove) bound++;
        else free++;
      } else {
        free++;
      }
    }
    chestPlan[floorIndex] = {
      floor: floorIndex + 1, total: total, bound: bound, free: free, radius: rad
    };
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
      if (inRoom(x, y)) continue; /* S-05：密室陈设由 furnishRooms 独占，不参与普通装饰抽位 */
      if (decor[y][x]) continue;
      var occupied = false;
      for (var i = 0; i < enemies.length; i++) {
        if (enemies[i].x === x && enemies[i].y === y) { occupied = true; break; }
      }
      if (occupied) continue;
      decor[y][x] = id;
      placed++;
    }
    return placed; /* 返回实际放了几格（调用方可据此计数） */
  }

  /* P2-5：floor 任务推进——每次 map:floorChanged 后调用（含缓存恢复分支）；
   * 守卫式调用避免硬依赖，Quest 未加载时跳过 */
  function notifyFloorQuest() {
    if (Game.Systems.Quest && typeof Game.Systems.Quest.progress === 'function') {
      Game.Systems.Quest.progress('floor', floorIndex + 1);
    }
  }

  /* D-15：存档快照的深拷贝工具——存档与运行期互不引用，
   * 避免"存档里保存了同一批数组，之后挖宝/杀怪把已写出的档改脏"。
   * 只复制快照实际需要的字段，全部是纯 JSON 数据。 */
  function isGrid(a) { return Array.isArray(a) && a.length > 0 && Array.isArray(a[0]); }
  function cloneGrid(a) {
    var out = [];
    if (!isGrid(a)) return out;
    for (var y = 0; y < a.length; y++) out.push(a[y].slice());
    return out;
  }
  function cloneRows(a) {
    var out = [];
    if (!Array.isArray(a)) return out;
    for (var y = 0; y < a.length; y++) out.push(Array.isArray(a[y]) ? a[y].slice() : []);
    return out;
  }
  function cloneTraps(a) {
    var out = [];
    if (!Array.isArray(a)) return out;
    for (var y = 0; y < a.length; y++) {
      var row = [];
      if (Array.isArray(a[y])) {
        for (var x = 0; x < a[y].length; x++) {
          var t = a[y][x];
          row.push(t ? { id: t.id, seen: !!t.seen } : null);
        }
      }
      out.push(row);
    }
    return out;
  }
  function clonePatrol(p) {
    return {
      x: p.x, y: p.y, monsterId: p.monsterId,
      state: p.state || 'idle',
      path: Array.isArray(p.path) ? p.path.slice() : [],
      frame: p.frame || 0,
      rest: p.rest || 0
    };
  }
  function cloneEntry(e) {
    var ens = [], ps = [], rms = [];
    var i;
    if (e && Array.isArray(e.enemies)) {
      for (i = 0; i < e.enemies.length; i++) {
        var m = e.enemies[i];
        if (m) ens.push({ x: m.x, y: m.y, monsterId: m.monsterId });
      }
    }
    if (e && Array.isArray(e.patrols)) {
      for (i = 0; i < e.patrols.length; i++) if (e.patrols[i]) ps.push(clonePatrol(e.patrols[i]));
    }
    if (e && Array.isArray(e.rooms)) {
      for (i = 0; i < e.rooms.length; i++) {
        var r = e.rooms[i] || {};
        rms.push({ x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy, doorX: r.doorX, doorY: r.doorY });
      }
    }
    var out = {
      grid: cloneGrid(e && e.grid),
      enemies: ens,
      details: cloneRows(e && e.details),
      decor: cloneRows(e && e.decor),
      traps: cloneTraps(e && e.traps),
      rooms: rms,
      spawn: (e && e.spawn) ? { x: e.spawn.x, y: e.spawn.y } : { x: 1, y: 1 },
      patrols: ps
    };
    /* D-47：旧档（D-46 及之前）没有 npcs 字段——保持"属性不存在"，
     * 让 importState 之后的 generate 走"补生成"而不是误当成"本层没有 NPC" */
    if (e && Array.isArray(e.npcs)) {
      var ns = [];
      for (i = 0; i < e.npcs.length; i++) {
        var n = e.npcs[i];
        if (n && typeof n.id === 'string' && typeof n.x === 'number' && typeof n.y === 'number') {
          ns.push({ id: n.id, x: n.x, y: n.y });
        }
      }
      out.npcs = ns;
    }
    return out;
  }

  /* ---------- D-53：读档落点解析 ----------
   * 目标：续玩回到存档时的格子，而不是本层出生点；落点非法/被占时，
   * 在**同一连通块**内用 BFS 找最近的可站立格，找不到才回出生点。
   * 纯查询，不移动任何实体、不发任何奖励、不生成资源。 */
  var LAND_DIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]]; /* 上/左/下/右：并列时固定取先者 */
  function inGrid(x, y) {
    return !!(grid && y >= 0 && x >= 0 && y < grid.length && x < grid[0].length);
  }
  /* 可站立 = 地板/楼梯（grid≠0）且不压任何实体或可拾取物。
   * 楼梯也排除：读档直接站在梯子上会让"再走一步"立刻换层，落点语义不干净。 */
  function landableAt(x, y) {
    if (!inGrid(x, y)) return false;
    var t = grid[y][x];
    if (t === 0 || t === 2 || t === 3) return false;
    var i;
    for (i = 0; i < enemies.length; i++) {
      if (enemies[i] && enemies[i].x === x && enemies[i].y === y) return false;
    }
    for (i = 0; i < npcs.length; i++) {
      if (npcs[i] && npcs[i].x === x && npcs[i].y === y) return false;
    }
    if (decor && decor[y] && decor[y][x]) return false; /* 宝箱/奖励点/火把等 */
    if (traps && traps[y] && traps[y][x]) return false; /* 未触发/已显现陷阱 */
    return true;
  }
  /* 从 (sx,sy) 出发，在单一连通块内 BFS。起点若可走则从起点开始；
   * 起点是墙时只取"上/左/下/右"里第一个可走邻格所在的连通块（确定、可复现）。 */
  function nearestLanding(sx, sy) {
    if (!inGrid(sx, sy)) return null;
    var seen = {}, q = [], qi = 0, i;
    function push(x, y, d) {
      if (!inGrid(x, y)) return;
      if (grid[y][x] === 0) return;
      var key = x + ',' + y;
      if (seen[key]) return;
      seen[key] = 1;
      q.push({ x: x, y: y, d: d });
    }
    if (grid[sy][sx] !== 0) {
      push(sx, sy, 0);
    } else {
      var seed = null;
      for (i = 0; i < LAND_DIRS.length; i++) {
        var nx0 = sx + LAND_DIRS[i][0], ny0 = sy + LAND_DIRS[i][1];
        if (inGrid(nx0, ny0) && grid[ny0][nx0] !== 0) { seed = { x: nx0, y: ny0 }; break; }
      }
      if (!seed) return null;
      push(seed.x, seed.y, 1);
    }
    while (qi < q.length) {
      var c = q[qi++];
      if (landableAt(c.x, c.y)) return { x: c.x, y: c.y, distance: c.d };
      for (i = 0; i < LAND_DIRS.length; i++) {
        push(c.x + LAND_DIRS[i][0], c.y + LAND_DIRS[i][1], c.d + 1);
      }
    }
    return null;
  }

  Game.Systems.Map = {
    /* opts.quietQuest：读档恢复时跳过 floor 任务推进。
     * 否则"恢复存档"会被当成一次"到达该层"，把楼层任务奖励再发一次（读档刷奖励）。 */
    generate: function (opts) {
      cfg = Game.Data.MAPS;
      var quietQuest = !!(opts && opts.quietQuest);
      /* 修复 P1：已有该层快照则原样恢复，不重新生成 */
      var cached = floorCache[floorIndex];
      if (cached) {
        lastMoves = [];
        grid = cached.grid;
        enemies = cached.enemies;
        details = cached.details;
        decor = cached.decor;
        traps = cached.traps || traps;
        rooms = cached.rooms || [];
        spawn = { x: cached.spawn.x, y: cached.spawn.y };
        if (Game.Systems.AI && typeof Game.Systems.AI.setPatrols === 'function') {
          Game.Systems.AI.setPatrols(cached.patrols);
        }
        /* D-47：旧档快照没有 npcs 字段 → 用同一套确定性规则补生成并写回缓存；
         * 新档直接恢复（位置随存档固化，刷新不会换人站位） */
        if (Array.isArray(cached.npcs)) {
          npcs = cached.npcs.slice();
        } else {
          placeNpc(grid[0].length, grid.length);
          cached.npcs = npcs.slice();
        }
        Game.Core.EventBus.emit('map:floorChanged', { floor: floorIndex + 1 });
        if (!quietQuest) notifyFloorQuest();
        return grid;
      }
      var size = cfg.sizes[floorIndex % cfg.sizes.length];
      grid = initGrid(size[0], size[1]);
      carve(1, 1);
      openRooms();
      placeSpecialRoom(size[0], size[1]); /* S-05：先挖密室（需要整片实心墙），再放楼梯 */
      placeStairs();
      spawnEnemies();
      lastMoves = ensureMandatoryTargets(); /* D-38：必经目标必须落在出生点连通块里 */
      /* D-64：巡逻怪同样按面积等比放大（基准 2 只）；AI 习性与视距不变。
       * D-67：巡逻数量走 patrolArea 系数（只管增量，基准 2 只恒定）。 */
      if (Game.Systems.AI) Game.Systems.AI.initPatrols(patrolCount(size[0], size[1]));
      spawn = { x: 1, y: 1 };
      genDetailsAndDecor(size[0], size[1]); /* M9-1：细节层 + 装饰层 */
      floorCache[floorIndex] = {
        grid: grid,
        enemies: enemies,
        details: details,
        decor: decor,
        traps: traps,
        rooms: rooms,
        spawn: { x: spawn.x, y: spawn.y },
        patrols: (Game.Systems.AI && typeof Game.Systems.AI.getPatrols === 'function')
          ? Game.Systems.AI.getPatrols() : [],
        npcs: npcs.slice() /* D-47：NPC 站位随楼层快照保存 */
      };
      Game.Core.EventBus.emit('map:floorChanged', { floor: floorIndex + 1 });
      if (!quietQuest) notifyFloorQuest();
      return grid;
    },

    /* D-38：最近一次生成里被搬动的必经目标（只读；用于统计"修复了多少张图"） */
    getLastMoves: function () { return lastMoves.slice(); },

    /* D-38：当前层的必经目标（只读，供 verify_d38 与生成期共用同一份定义） */
    getMandatoryTargets: function () {
      cfg = Game.Data.MAPS;
      var list = mandatoryTargets(), out = [];
      for (var i = 0; i < list.length; i++) {
        out.push({ kind: list[i].kind, id: list[i].id || null, x: list[i].x, y: list[i].y });
      }
      return out;
    },

    /* D-38：纯函数——给定网格/出生点/会换层的 tile 列表/目标，返回目标可达性与不可达清单。
     * 语义与生成期一致：只走非墙格；传送楼梯可作终点进入，但不能穿过。 */
    checkTargetsReachable: function (gx, sp, blockTiles, targets) {
      var w = gx[0].length, h = gx.length;
      var blocked = {};
      for (var b = 0; b < (blockTiles || []).length; b++) blocked[blockTiles[b]] = true;
      var seen = [], q = [[sp.x, sp.y]], qi = 0;
      for (var y = 0; y < h; y++) { seen[y] = []; for (var x = 0; x < w; x++) seen[y][x] = false; }
      if (sp.x < 0 || sp.y < 0 || sp.x >= w || sp.y >= h) {
        return { ok: false, unreachable: (targets || []).slice(), seen: seen };
      }
      seen[sp.y][sp.x] = true;
      var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      while (qi < q.length) {
        var cx = q[qi][0], cy = q[qi][1];
        qi++;
        if (blocked[gx[cy][cx]]) continue;
        for (var d = 0; d < dirs.length; d++) {
          var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (seen[ny][nx] || gx[ny][nx] === 0) continue;
          seen[ny][nx] = true;
          q.push([nx, ny]);
        }
      }
      var unreachable = [];
      for (var t = 0; t < (targets || []).length; t++) {
        var tg = targets[t];
        var ok = tg.x >= 0 && tg.y >= 0 && tg.x < w && tg.y < h && seen[tg.y][tg.x];
        if (!ok) unreachable.push({ kind: tg.kind, x: tg.x, y: tg.y });
      }
      return { ok: unreachable.length === 0, unreachable: unreachable, seen: seen };
    },

    isWalkable: function (x, y) {
      if (!grid) return false;
      if (x < 0 || y < 0 || x >= grid[0].length || y >= grid.length) return false;
      return grid[y][x] !== 0;
    },

    /* D-53：该格能否作为读档落点（地板、无实体、无装饰/陷阱、非楼梯） */
    canLand: function (x, y) { return landableAt(x, y); },

    /* D-53：解析读档落点。
     *   reason='saved' 原格可用；'bfs' 同连通块最近可站立格；'spawn' 找不到才回出生点。
     * 坐标非法/墙/水/楼梯/被实体或可拾取物占用时都会走 BFS；越界或整块无空地才回出生点。
     * 纯查询：不移动实体、不拾取、不发奖励，因此反复存读档不会产生任何资源。 */
    resolveLanding: function (x, y) {
      var ix = Math.floor(Number(x)), iy = Math.floor(Number(y));
      var sp = { x: spawn.x, y: spawn.y, reason: 'spawn', distance: -1 };
      if (!isFinite(ix) || !isFinite(iy)) return sp;
      if (!inGrid(ix, iy)) return sp;
      if (landableAt(ix, iy)) return { x: ix, y: iy, reason: 'saved', distance: 0 };
      var hit = nearestLanding(ix, iy);
      if (!hit) return sp;
      return { x: hit.x, y: hit.y, reason: 'bfs', distance: hit.distance };
    },

    tileAt: function (x, y) {
      if (!grid) return 0;
      if (x < 0 || y < 0 || x >= grid[0].length || y >= grid.length) return 0;
      return grid[y][x];
    },

    changeFloor: function (dir) {
      var next = floorIndex + dir;
      /* 修复：超出楼层范围直接忽略（原实现钳制后仍 generate，会静默重生成当前层） */
      if (next < 0 || next >= cfg.floors) return null;
      floorIndex = next;
      var g = this.generate();
      Game.Core.EventBus.emit('audio:play', { sfx: 'stair' });
      return { grid: g, floor: floorIndex + 1 };
    },

    getFloor: function () { return floorIndex + 1; },
    getGrid: function () { return grid; },
    /* D-64：当前层按面积等比放大后的期望怪物数（只读；与 spawnEnemies 同一口径，
     * 供 verify_d18 断言"扩图后只增不减、且等于密度公式"。
     * D-67：同一口径包含 MAPS.density.enemyArea（只放大增量）。 */
    expectedEnemyCount: function () {
      cfg = Game.Data.MAPS;
      var size = cfg.sizes[floorIndex % cfg.sizes.length];
      return enemyCount(size[0], size[1]);
    },
    /* D-64：当前层陷阱数量的期望区间（只读；与 placeTraps 同一口径）。 */
    expectedTrapRange: function () {
      cfg = Game.Data.MAPS;
      var size = cfg.sizes[floorIndex % cfg.sizes.length];
      var c = Game.Data.TRAP_PLACEMENT || { min: 3, max: 6 };
      return { min: areaScale(c.min, size[0], size[1]), max: areaScale(c.max, size[0], size[1]) };
    },
    getSpawn: function () { return { x: spawn.x, y: spawn.y }; },

    /* 存档恢复/重新开始：直接切到指定楼层并生成。
     * 修复 P1：清空楼层快照——新局必须是新地图，不能复用上一局已清空的地图。 */
    setFloor: function (f) {
      floorCache = {};
      floorIndex = Math.min(Math.max(f - 1, 0), cfg.floors - 1);
      return this.generate();
    },

    /* D-15：只读查询该格敌人——遭遇时**不再移除**。
     * 旧实现命中即 splice，导致"逃跑成功 = 怪物消失"（Boss 逃一次就再也通不了关）。
     * 现在移除只发生在胜利结算（main.js onBattleEnd → removeEnemyAt）。 */
    enemyAt: function (x, y) {
      for (var i = 0; i < enemies.length; i++) {
        if (enemies[i].x === x && enemies[i].y === y) return enemies[i];
      }
      return null;
    },
    /* D-15：胜利结算时移除该格敌人（唯一的删除入口，且只在 win 通道调用） */
    removeEnemyAt: function (x, y) {
      for (var i = 0; i < enemies.length; i++) {
        if (enemies[i].x === x && enemies[i].y === y) {
          enemies.splice(i, 1);
          return true;
        }
      }
      return false;
    },
    getEnemies: function () { return enemies; },

    /* D-59：逃跑成功后的喘息期——只冻结这只静态怪的 AI，不移除、不改数值 */
    stunEnemyAt: function (x, y, turns) {
      for (var i = 0; i < enemies.length; i++) {
        if (enemies[i].x === x && enemies[i].y === y) {
          enemies[i].rest = Math.max(enemies[i].rest || 0, turns || 0);
          return true;
        }
      }
      return false;
    },

    /* D-47：本层实体 NPC（只读）。位置在 placeNpc 里确定性生成，
     * 渲染、交互判定与验证页共用这一份数据。 */
    getNpcs: function () { return npcs; },
    npcAt: function (x, y) {
      for (var i = 0; i < npcs.length; i++) {
        if (npcs[i].x === x && npcs[i].y === y) return npcs[i];
      }
      return null;
    },

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

    /* S-04：取该格陷阱（{id, seen}），无陷阱返回 null；seen=true 的陷阱仍然返回，供渲染画"已显现"格 */
    getTrap: function (x, y) {
      if (!traps || !traps[y]) return null;
      if (x < 0 || y < 0 || x >= traps[0].length || y >= traps.length) return null;
      return traps[y][x] || null;
    },

    /* S-04：踩中陷阱——未触发过的陷阱结算一次后置 seen=true（永久显现且不再伤人）。
     * 伤害 = 当前 HP 8%（F1 单次 ≤15，其余层 ≤30）；毒气不扣血，改为施加中毒。
     * 返回 { id, name, dmg, status } 供上层提示；无陷阱/已触发返回 null */
    triggerTrap: function (x, y) {
      var tr = this.getTrap(x, y);
      if (!tr || tr.seen) return null;
      var def = Game.Data.TRAPS && Game.Data.TRAPS[tr.id];
      if (!def) { traps[y][x] = null; return null; }
      tr.seen = true;
      var p = Game.Data.Player;
      var res = { id: tr.id, name: def.name, dmg: 0, status: null };
      if (def.dmgPct > 0) {
        var cap = (floorIndex === 0 && def.dmgCap1) ? def.dmgCap1 : def.dmgCap30;
        var d = Math.min(Math.max(1, Math.floor(p.hp * def.dmgPct)), cap);
        var hpBeforeTrap = p.hp;
        p.hp = Math.max(p.hp - d, 0);
        /* D-43：血量账——陷阱直接伤害（地刺）单独记一笔，按实际掉血计 */
        var TB = Game.Systems.Battle;
        if (TB && typeof TB._logHp === 'function') TB._logHp('damage', 'trap:' + tr.id, hpBeforeTrap - p.hp);
        res.dmg = d;
      }
      if (def.status && Game.Systems.Status && typeof Game.Systems.Status.apply === 'function') {
        Game.Systems.Status.apply(def.status, def.turns);
        res.status = def.status;
      }
      var msg = '踩到' + def.name + '。';
      if (res.dmg > 0) msg += ' 受到 ' + res.dmg + ' 伤害';
      if (res.status) {
        var sdef = Game.Data.STATUS && Game.Data.STATUS[res.status];
        msg += '，' + (sdef ? sdef.name : res.status) + ' ' + def.turns + ' 回合';
      }
      Game.Core.EventBus.emit('ui:notice', { msg: msg });
      Game.Core.EventBus.emit('audio:play', { sfx: 'hit' });
      Game.Core.EventBus.emit('trap:triggered', { x: x, y: y, id: tr.id, dmg: res.dmg });
      if (p.hp <= 0) {
        Game.Core.EventBus.emit('audio:play', { sfx: 'lose' });
        /* D-23：陷阱致死不是战斗致死——怪/回合显式置 null，只保留楼层与死时状态 */
        var tb = Game.Systems.Battle;
        var tp = (tb && typeof tb.loseTelemetry === 'function')
          ? tb.loseTelemetry({
            source: 'trap', monsterId: null, monsterName: null, roundNo: null,
            trapId: tr.id, trapName: def.name
          })
          : { result: 'lose' };
        Game.Core.EventBus.emit('battle:end', tp);
      }
      return res;
    },

    /* S-05：取本层密室（可能为 0 间） */
    getRooms: function () { return rooms; },

    /* D-58：最近一次宝箱布置的统计（只读遥测，不参与玩法） */
    getChestPlan: function () { return chestPlan; },

    /* D-15：导出本局地图状态（写进存档）。结构直接复用 floorCache 的快照：
     * { floorIndex, floors: { "<层索引>": {grid,enemies,details,decor,traps,rooms,spawn,patrols} } }
     * 只导出玩家实际到过的层；返回深拷贝，调用方随即可安全 JSON 序列化。 */
    exportState: function () {
      var out = {};
      for (var k in floorCache) {
        if (!Object.prototype.hasOwnProperty.call(floorCache, k)) continue;
        out[k] = cloneEntry(floorCache[k]);
      }
      return { floorIndex: floorIndex, floors: out };
    },

    /* D-15：从存档恢复地图状态。任何校验不过一律返回 false（调用方按旧档降级重新生成）。
     * 只替换 floorCache 与 floorIndex，不做生成；调用方随后 generate() 会命中缓存分支
     * （含 AI.setPatrols 回填），从而恢复"已开箱 / 已杀怪 / 已触发陷阱"的现场。 */
    importState: function (st) {
      if (!cfg || !st || typeof st !== 'object') return false;
      var src = st.floors;
      if (!src || typeof src !== 'object') return false;
      var fi = (typeof st.floorIndex === 'number') ? Math.floor(st.floorIndex) : -1;
      if (fi < 0 || fi >= cfg.floors) return false;
      var out = {};
      for (var k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        var idx = parseInt(k, 10);
        if (!(idx >= 0 && idx < cfg.floors)) return false;
        var e = src[k];
        if (!e || !isGrid(e.grid) || !Array.isArray(e.enemies)) return false;
        if (!isGrid(e.details) || !isGrid(e.decor)) return false;
        out[idx] = cloneEntry(e);
      }
      if (!out[fi]) return false; /* 存档层没有快照 → 落点/地图无法复现，按降级处理 */
      floorCache = out;
      floorIndex = fi;
      return true;
    },

    /* M9-1：拾取宝箱——chest / room_chest 可拾取，成功后置空并 emit 'decor:taken'
     * 金币走 Player.gold，道具走 Inventory.add，不新增数值系统 */
    takeDecor: function (x, y) {
      if (!decor || !decor[y]) return false;
      if (x < 0 || y < 0 || x >= decor[0].length || y >= decor.length) return false;
      var id = decor[y][x];
      if (id !== 'chest' && id !== 'room_chest' && id !== 'gold_pile' && id !== 'potion_stash') return false;
      decor[y][x] = null;
      /* D-46：固定奖励点——额度只读 Game.Data.REWARD（按当前层），不走进宝箱随机池 */
      var rw = (Game.Data.REWARD && Game.Data.REWARD.floors) ? Game.Data.REWARD.floors[floorIndex] : null;
      if (id === 'gold_pile') {
        var amt = (rw && rw.kind === 'gold' && rw.amount) ? rw.amount : 0;
        Game.Data.Player.gold += amt;
        Game.Core.EventBus.emit('ui:notice', { msg: '路边金币：+' + amt + ' 金币' });
        Game.Core.EventBus.emit('decor:taken', { x: x, y: y, kind: id });
        Game.Core.EventBus.emit('audio:play', { sfx: 'gold' });
        return true;
      }
      if (id === 'potion_stash') {
        var pid = (rw && rw.kind === 'potion' && rw.id) ? rw.id : 'potion_xl';
        if (Game.Systems.Inventory && Game.Systems.Inventory.add) {
          Game.Systems.Inventory.add(pid, 1);
          var pit = Game.Data.ITEMS && Game.Data.ITEMS[pid];
          Game.Core.EventBus.emit('ui:notice', { msg: '补给包：获得 ' + (pit ? pit.name : pid) });
        }
        Game.Core.EventBus.emit('decor:taken', { x: x, y: y, kind: id });
        Game.Core.EventBus.emit('audio:play', { sfx: 'gold' });
        return true;
      }
      var loot = 'gold';
      var def = Game.Data.DECOR && Game.Data.DECOR[id];
      if (def && def.loot === 'random') loot = Math.random() < 0.5 ? 'gold' : 'item';
      else if (def && def.loot) loot = def.loot;
      if (loot === 'rich') {
        /* S-05：密室宝箱 = 厚金币 + 保底 1 件道具（可出强化卷轴），金币倍率取自 ROOMS */
        var mul = (Game.Data.ROOMS && Game.Data.ROOMS.roomChestGoldMul) || 2.5;
        var rich = Math.floor((8 + Math.floor(Math.random() * 20)) * (floorIndex + 1) * mul);
        Game.Data.Player.gold += rich;
        Game.Core.EventBus.emit('ui:notice', { msg: '密室宝箱：获得 ' + rich + ' 金币' });
        var richPool = (Game.Data.CHEST_LOOT && Game.Data.CHEST_LOOT.room_chest) ||
          ['potion_xl', 'potion_large', 'sword_bone', 'armor_leather', 'scroll_upgrade'];
        var richId = richPool[Math.floor(Math.random() * richPool.length)];
        if (Game.Systems.Inventory && Game.Systems.Inventory.add) {
          Game.Systems.Inventory.add(richId, 1);
          var rit = Game.Data.ITEMS && Game.Data.ITEMS[richId];
          Game.Core.EventBus.emit('ui:notice', { msg: '密室宝箱：获得 ' + (rit ? rit.name : richId) });
        }
      } else if (loot === 'gold') {
        var gold = (5 + Math.floor(Math.random() * 15)) * (floorIndex + 1);
        Game.Data.Player.gold += gold;
        Game.Core.EventBus.emit('ui:notice', { msg: '宝箱：获得 ' + gold + ' 金币' });
      } else {
        var items = (Game.Data.CHEST_LOOT && Game.Data.CHEST_LOOT.chest) ||
          ['potion_large', 'potion_large', 'potion_small', 'sword_bone', 'armor_leather'];
        var itemId = items[Math.floor(Math.random() * items.length)];
        if (Game.Systems.Inventory && Game.Systems.Inventory.add) {
          Game.Systems.Inventory.add(itemId, 1);
          var it = Game.Data.ITEMS && Game.Data.ITEMS[itemId];
          Game.Core.EventBus.emit('ui:notice', { msg: '宝箱：获得 ' + (it ? it.name : itemId) });
        }
      }
      Game.Core.EventBus.emit('decor:taken', { x: x, y: y, kind: id });
      Game.Core.EventBus.emit('audio:play', { sfx: 'gold' });
      return true;
    }
  };
})();
