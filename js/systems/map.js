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
  /* 修复 P1：楼层快照缓存——回访时恢复同一份地图/敌人/装饰/巡逻，
   * 避免上下楼反复重新生成而刷怪、刷宝箱。只在重新开始（setFloor）时清空。 */
  var floorCache = {};

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
    /* 装饰物：按层数调整数量（越深火把越多、宝箱越少） */
    var f = floorIndex + 1;
    placeDecor('chest', Math.max(1, 3 - f), w, h);
    placeDecor('barrel', 3 + f, w, h);
    placeDecor('torch', 2 + f * 2, w, h);
    placeDecor('vine', 2 + f, w, h);
    furnishRooms(); /* S-05：密室内固定 1 个密室宝箱 + 2 个火把 */
    placeTraps(w, h); /* S-04：陷阱层（与细节/装饰同批生成，避免二次遍历） */
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
    var count = cfgT.min + Math.floor(Math.random() * (Math.max(cfgT.min, cfgT.max) - cfgT.min + 1));
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
    return {
      grid: cloneGrid(e && e.grid),
      enemies: ens,
      details: cloneRows(e && e.details),
      decor: cloneRows(e && e.decor),
      traps: cloneTraps(e && e.traps),
      rooms: rms,
      spawn: (e && e.spawn) ? { x: e.spawn.x, y: e.spawn.y } : { x: 1, y: 1 },
      patrols: ps
    };
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
      if (Game.Systems.AI) Game.Systems.AI.initPatrols(2);
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
          ? Game.Systems.AI.getPatrols() : []
      };
      Game.Core.EventBus.emit('map:floorChanged', { floor: floorIndex + 1 });
      if (!quietQuest) notifyFloorQuest();
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
        p.hp = Math.max(p.hp - d, 0);
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
          ? tb.loseTelemetry({ source: 'trap', monsterId: null, monsterName: null, roundNo: null })
          : { result: 'lose' };
        Game.Core.EventBus.emit('battle:end', tp);
      }
      return res;
    },

    /* S-05：取本层密室（可能为 0 间） */
    getRooms: function () { return rooms; },

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
      if (id !== 'chest' && id !== 'room_chest') return false;
      decor[y][x] = null;
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
        var richPool = ['potion_small', 'sword_bone', 'armor_leather', 'scroll_upgrade'];
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
        var items = ['potion_small', 'sword_bone', 'armor_leather'];
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
