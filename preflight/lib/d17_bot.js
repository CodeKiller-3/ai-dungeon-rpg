/* preflight/lib/d17_bot.js — D-17 规则 bot（只在 preflight 下运行，不改 js/）
 *
 * 定位：只造尺子。策略固定、无随机决策；随机数用固定种子 mulberry32 覆盖 Math.random
 * （仅本页作用域内生效），并虚拟化 performance.now，保证"同种子两次结果完全一致"。
 *
 * 输入路径：所有动作都 dispatch 真实 KeyboardEvent → Game.Core.Input → Main._updateExplore /
 * _updateBattle。bot 从不直接调用 Battle.playerAction / Inventory.use / Map.changeFloor。
 * 唯一非输入动作是开新局 Main.restart()（等同死亡结算页按 R / Enter，游戏内没有别的开局入口）。
 *
 * 渲染：install() 把 Render.draw* 全部替换成空函数（只为提速，不影响玩法判定）。
 *
 * D-37（测量台校准）：只新增 opts.d37 = {fireball, flee, grind} 三条可选分支与遥测，
 * 既有策略分支（嗑药 / 套盾 / 寻路 / 商店 / 换装）一行未改；不传 opts.d37 时行为与 D-34 完全一致
 * （由 verify_d37 A 组逐局对照 d34-bot-report.json 守门）。
 *
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game;
  var Bot = window.Game.Bot = window.Game.Bot || {};

  var STEP = 16.7;       /* 战斗/等待用帧步长（≈60fps） */
  var MOVE_MS = 120;     /* 探索一步（与 main.MOVE_INTERVAL 一致） */
  var ACTION_SEC = 0.12; /* 卡面口径：1 步 = 120ms */

  /* 固定种子 PRNG：mulberry32 */
  function mulberry32(a) {
    a = a | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var DIRS = [[0, -1, 'ArrowUp'], [1, 0, 'ArrowRight'], [0, 1, 'ArrowDown'], [-1, 0, 'ArrowLeft']];

  var spy = { pa: 0, paOutside: 0, moves: 0, movesOutside: 0, updates: 0, keys: 0, loops: 0, crashes: 0, lastCrash: null };
  var installed = false, saved = null;
  var inUpdate = 0, cur = null, vNow = 0;

  /* ── 输入：真实按键事件 ───────────────────────────────────────── */
  /* 一帧 = 主循环一次。捕获异常并计数：D-17 只测量，不修游戏；
     ai.js 的 A* 越界读是既有缺陷（见 docs/tasks/D-17），bot 遇到就记一笔继续跑。 */
  function frame(ms) {
    vNow += ms;
    try {
      Game.Core.Main.loop(vNow);
    } catch (e) {
      spy.crashes++;
      spy.lastCrash = String(e && (e.message || e));
      if (cur) cur.crashes++;
    }
    spy.loops++;
  }
  function kd(code) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: code, bubbles: true, cancelable: true }));
    spy.keys++;
  }
  function ku(code) {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: code, bubbles: true, cancelable: true }));
  }
  function press(code, ms) {
    kd(code);
    frame(ms || STEP);
    ku(code);
  }

  /* ── 只读工具 ────────────────────────────────────────────────── */
  function items() { return (Game.Data && Game.Data.ITEMS) || {}; }
  function healPotions() {
    var list = Game.Systems.Inventory.list(), out = [];
    for (var i = 0; i < list.length; i++) {
      var d = items()[list[i].id];
      if (d && d.type === 'consumable' && d.effect && d.effect.hp > 0) out.push({ idx: i, id: list[i].id, heal: d.effect.hp });
    }
    return out;
  }
  /* 换装：候选的 atk/def 高于当前装备才换；返回背包索引，否则 -1 */
  function betterEquipIndex() {
    var P = Game.Data.Player, list = Game.Systems.Inventory.list(), best = -1, bestGain = 0;
    for (var i = 0; i < list.length; i++) {
      var d = items()[list[i].id];
      if (!d || !d.effect) continue;
      var gain = 0;
      if (d.type === 'weapon') {
        var curAtk = 0;
        if (P.equipment.weapon && items()[P.equipment.weapon]) curAtk = items()[P.equipment.weapon].effect.atk || 0;
        gain = (d.effect.atk || 0) - curAtk;
      } else if (d.type === 'armor') {
        var curDef = 0;
        if (P.equipment.armor && items()[P.equipment.armor]) curDef = items()[P.equipment.armor].effect.def || 0;
        gain = (d.effect.def || 0) - curDef;
      }
      if (gain > bestGain) { bestGain = gain; best = i; }
    }
    return best;
  }
  function equipScore() {
    var P = Game.Data.Player, it = items(), s = 0;
    if (P.equipment.weapon && it[P.equipment.weapon]) s += (it[P.equipment.weapon].effect.atk || 0);
    if (P.equipment.armor && it[P.equipment.armor]) s += (it[P.equipment.armor].effect.def || 0);
    return s;
  }

  /* ── D-37：人会不会这么做 ──────────────────────────────────────
   * 这里只用"玩家肉眼也能算"的量做判断：当前 atk/def、怪的血/攻/防、MP、已损失血量。
   * 伤害推演与 battle.js 的 D-34 公式同式（普攻 max(1,round(a²/(a+d)))，技能 max(round(a×倍率)-d,1)），
   * 但只用于决策；实际伤害一律读战斗状态的前后差值（见 d37AfterBattleAct），不拿推演冒充实测。 */
  function dmgOf(atk, def) {
    var a = Math.max(Number(atk) || 0, 0), d = Math.max(Number(def) || 0, 0);
    if (a + d <= 0) return 1;
    return Math.max(1, Math.round(a * a / (a + d)));
  }
  /* 战斗状态的只读快照（狂暴时取当前生效值，与 battle.js 的 monsterAtk/monsterDef 同口径） */
  function d37Stats(st) {
    var m = st.monster;
    return {
      id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp,
      atk: st.enraged ? st.enrageAtk : m.atk,
      def: st.enraged ? st.enrageDef : m.def
    };
  }
  /* 本回合能打出的最高单发（火球可用且更疼就用火球，否则普攻） */
  function d37BestHit(P, def) {
    var nd = dmgOf(P.atk, def);
    var cd = (Game.Skills && Game.Skills.getCooldown) ? Game.Skills.getCooldown('fireball') : 0;
    if (cd <= 0 && P.mp >= 12) {
      var fd = Math.max(1, Math.round(P.atk * 1.8) - def);
      if (fd > nd) return fd;
    }
    return nd;
  }
  /* 火球判据（真人版）：
   *   · 冷却好了、MP 够 12 —— 这是硬门槛；
   *   · 火球这一发确实比普攻疼 ≥3 点，否则不值得吃 3 回合冷却；
   *   · 普攻这一下就能收尾时不放（伤害溢出，纯浪费蓝）；
   *   · MP ≥ 24（还够再放一次）时放心用；
   *   · 只剩最后一发（12 ≤ MP < 24）时只留给"两发内结束"或"血量 ≤45% 需要速杀"，
   *     也就是留一手应急，而不是见怪就轰。 */
  function d37DecideFireball(P, st) {
    var m = d37Stats(st);
    if (P.mp < 12) return false;
    if (!Game.Skills || Game.Skills.getCooldown('fireball') > 0) return false;
    var nd = dmgOf(P.atk, m.def);
    var fd = Math.max(1, Math.round(P.atk * 1.8) - m.def);
    if (fd <= nd) return false;
    if (Math.ceil(m.hp / nd) <= 1) return false;
    if (fd - nd < 3) return false;
    if (P.mp >= 24) return true;
    if (P.hp <= P.maxHp * 0.45) return true;
    if (m.hp <= fd * 2) return true;
    return false;
  }
  /* 逃跑判据（真人版）：
   *   · 先算"还挨几下会死"（nDie）与"还要几回合能打死它"（nKill）；
   *   · nKill ≤ 2：两下能收掉的怪不逃；
   *   · nDie > 2：还撑得住，不逃（真人不会掉一点血就跑）；
   *   · 只有 nKill > nDie+1（明显打不过）才逃；逃跑失败会被怪立刻反击，
   *     所以这条判据也保证"赌输了那一下通常还挨得住"；若已经 nDie=1（本来就必死），
   *     逃是唯一活路，允许赌；
   *   · 同一场最多试 2 次——连续赌第三次是把命交给骰子，真人不会这么打。 */
  function d37DecideFlee(rec, P, st) {
    if (rec.d37.fleeTriesThisBattle >= 2) return false;
    var m = d37Stats(st);
    var md = dmgOf(m.atk, P.def);
    var my = d37BestHit(P, m.def);
    var nDie = Math.ceil(P.hp / md);
    var nKill = Math.ceil(m.hp / my);
    if (nKill <= 2) return false;
    if (nDie > 2) return false;
    return nKill > nDie + 1;
  }
  /* 刷级判据（真人版）：
   *   · 血量 ≥60%（与既有寻路的"血少绕怪"同一条边界，翻转过来就是"血够就顺手清一只"）；
   *   · 等级 ≥4 后不再刻意刷（够用即可，不做全图清怪机器）；
   *   · 每层最多主动打 2 只，打完继续探图/下楼；
   *   · 只挑"算下来能稳赢"的怪：nDie ≥ nKill+2 且 nKill ≤ 8，打之前就知道不会翻车。 */
  function d37SafeFight(P, enemy) {
    var m = (Game.Data.MONSTERS || {})[enemy.monsterId];
    if (!m) return false;
    var md = dmgOf(m.atk, P.def);
    var my = d37BestHit(P, m.def);
    var nDie = Math.ceil(P.hp / md);
    var nKill = Math.ceil(m.hp / my);
    return nDie >= nKill + 2 && nKill <= 8;
  }
  function d37Snap(P, floor) {
    return {
      floor: floor, hp: P.hp, maxHp: P.maxHp, mp: P.mp, maxMp: P.maxMp,
      level: P.level, gold: P.gold, equip: equipScore(),
      weaponId: P.equipment.weapon || null, armorId: P.equipment.armor || null
    };
  }
  function d37New(cfg) {
    return {
      cfg: { fireball: !!cfg.fireball, flee: !!cfg.flee, grind: !!cfg.grind },
      fireballCasts: 0, fireballMp: 0, fireballDmg: 0, fireballNormalWould: 0, fireballCastMpBad: 0,
      shieldCasts: 0, shieldMp: 0,
      fleeAttempts: 0, fleeSuccess: 0, fleeFail: 0, reengagedAfterFlee: 0,
      fleeTriesThisBattle: 0, sinceFlee: -1, respite: 0,
      fleeLog: [], mpDry: [],
      grindKills: 0, grindKillsOnFloor: 0, grindTargets: 0, grindEngaged: false, grindTarget: null,
      battleStartPos: null, lastBattleMonster: null, mpDryLogged: false,
      floorEnd: [], final: null
    };
  }
  /* 每回合动作后：用真实前后差值记账（不信任推演值） */
  function d37AfterBattleAct(rec, code, pre, st) {
    var P = Game.Data.Player, d = rec.d37;
    if (!d || !pre) return;
    var mpDrop = pre.mp - P.mp;
    if (code === 'Digit4') {
      if (mpDrop === 12) {
        d.fireballCasts++;
        d.fireballMp += 12;
        var after = (st.monster && typeof st.monster.hp === 'number') ? st.monster.hp : 0;
        var dealt = Math.min(pre.mhp, Math.max(0, pre.mhp - after)); /* 溢出伤害不计入 */
        d.fireballDmg += dealt;
        d.fireballNormalWould += pre.normalWould;
      } else if (mpDrop === 0) {
        /* 施放失败（MP/冷却在按键瞬间不满足）：不计次数，记一笔异常 */
        d.fireballCastMpBad++;
      } else {
        d.fireballCastMpBad++;
      }
    } else if (code === 'Digit6' && mpDrop === 10) {
      d.shieldCasts++; d.shieldMp += 10;
    }
    if (d.cfg.fireball && !d.mpDryLogged && P.mp < 12) {
      d.mpDryLogged = true;
      d.mpDry.push({ floor: P.floor, round: pre.round, mp: P.mp });
    }
  }
  /* 主动刷级：BFS 找"最近且算得赢"的怪；找不到返回 null（回落到正常探图/下楼） */
  function d37GrindDir(rec) {
    var P = Game.Data.Player, Map = Game.Systems.Map, grid = Map.getGrid(), d = rec.d37;
    if (!grid) return null;
    if (P.hp < P.maxHp * 0.6) return null;
    if (P.level >= 4) return null;
    if (d.grindKillsOnFloor >= 2) return null;
    if (d.respite > 0) return null;
    var h = grid.length, w = grid[0].length;
    var FLOORS = (Game.Data.MAPS && Game.Data.MAPS.floors) || 5;
    var upNoop = P.floor <= 1, downNoop = P.floor >= FLOORS;
    var walk = function (t) {
      if (t === 0) return false;
      if (t === 3) return upNoop;
      if (t === 2) return downNoop;
      return true;
    };
    var start = P.x + ',' + P.y;
    var prev = Object.create(null), dep = Object.create(null);
    prev[start] = null; dep[start] = 0;
    var q = [start], head = 0, found = null;
    while (head < q.length) {
      var k = q[head++], c = k.split(','), x = +c[0], y = +c[1];
      var e = Map.enemyAt(x, y);
      if (e) {
        if (d37SafeFight(P, e)) { found = k; break; }
        continue; /* 打不过的怪不碰，也不当通路 */
      }
      if (dep[k] >= 12) continue; /* 太远的怪不值得专程跑过去 */
      for (var i = 0; i < 4; i++) {
        var nx = x + DIRS[i][0], ny = y + DIRS[i][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var nk = nx + ',' + ny;
        if (prev[nk] !== undefined) continue;
        if (!walk(grid[ny][nx])) continue;
        prev[nk] = k; dep[nk] = dep[k] + 1; q.push(nk);
      }
    }
    if (!found) return null;
    var fc = found.split(',');
    d.grindTarget = { x: +fc[0], y: +fc[1], floor: P.floor };
    return firstStep(prev, found);
  }

  /* ── D-39：纯潜行（S1）——只测量"一路不打能走多远" ─────────────
   * 规则：怪物格一律当障碍；走不通时才朝挡路的怪迈一步（记录为强制遭遇）。
   * 遭遇战：巡逻怪（非必经）打不过就逃；走廊被怪堵死 / 最终 Boss → 不逃、直接打
   * ——逃跑不会搬走挡路的怪，只会白挨一轮，所以这里放弃逃跑。 */
  function d39New(cfg) {
    return {
      avoid: cfg.avoid !== false,   /* 负例开关：false = 不把怪当障碍（用来证明"绕怪"真的在起作用） */
      skill: cfg.skill !== false,
      battles: 0, forced: 0, active: 0, byBlock: 0, byPatrol: 0, byBoss: 0,
      fleeAttempts: 0, fleeSuccess: 0, fleeFail: 0, fleeTriesThisBattle: 0,
      reengaged: 0, respite: 0, lastFleeWhy: null,
      blockedCount: 0, blocked: [],
      pathDiffs: [],
      lastStep: null, battleKind: null,
      ledger: [], floorStart: null, floorEnter: [], floorEnd: [], final: null
    };
  }
  /* 怪物格朝向：方向码 → 位移（负例寻路要按方向看目标格有没有怪） */
  var DIR_DELTA = { ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowDown: [0, 1], ArrowLeft: [-1, 0] };
  function d39BossId(floor) {
    var bs = (Game.Data.MAPS && Game.Data.MAPS.bosses) || [];
    for (var i = 0; i < bs.length; i++) if (bs[i].floor === floor) return bs[i].id;
    return null;
  }
  /* 纯 BFS：起点→首个满足 goal 的格；pass 决定哪些格可走。
   * 返回 { ok, first:{x,y}, steps, path }，供潜行寻路与 verify_d39 共用同一份实现。 */
  function d39Bfs(gx, start, goalFn, passFn) {
    var w = gx[0].length, h = gx.length;
    var sk = start.x + ',' + start.y;
    var prev = Object.create(null), dep = Object.create(null);
    prev[sk] = null; dep[sk] = 0;
    var q = [sk], head = 0, dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]], hit = null;
    while (head < q.length) {
      var k = q[head++], c = k.split(','), x = +c[0], y = +c[1];
      if (k !== sk && goalFn(x, y, gx[y][x])) { hit = k; break; }
      for (var i = 0; i < 4; i++) {
        var nx = x + dirs[i][0], ny = y + dirs[i][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var nk = nx + ',' + ny;
        if (prev[nk] !== undefined) continue;
        if (!passFn(nx, ny, gx[ny][nx])) continue;
        prev[nk] = k; dep[nk] = dep[k] + 1; q.push(nk);
      }
    }
    if (!hit) return { ok: false, first: null, steps: -1, path: [] };
    var path = [], cur = hit;
    while (cur !== null) {
      var cc = cur.split(',');
      path.push({ x: +cc[0], y: +cc[1] });
      cur = prev[cur];
    }
    path.reverse();
    return { ok: true, first: path[1] || null, steps: dep[hit], path: path };
  }
  function d39Dir(P, cell) {
    if (!cell) return null;
    var dx = cell.x - P.x, dy = cell.y - P.y;
    for (var i = 0; i < 4; i++) if (DIRS[i][0] === dx && DIRS[i][1] === dy) return DIRS[i][2];
    return null;
  }
  /* 本层潜行目标：非最终层=下行梯，最终层=Boss（胜利条件） */
  function d39Goal(P, Map) {
    var FLOORS = (Game.Data.MAPS && Game.Data.MAPS.floors) || 5;
    if (P.floor >= FLOORS) {
      var bossId = d39BossId(P.floor);
      if (!bossId) return null;
      return {
        boss: true, bossId: bossId, desc: 'boss:' + bossId,
        fn: function (x, y) {
          var e = Map.enemyAt(x, y);
          return !!(e && e.monsterId === bossId);
        }
      };
    }
    return { boss: false, desc: 'stairs-down', fn: function (x, y, t) { return t === 2; } };
  }
  /* B 组证据：同一个起点、同一格终点，"把怪当墙"的路径 vs "无视怪"的直线路径。
   * 只在真实运行中记录（不构造数据），最多 3 条；两条路径都必须是本次真实 BFS 的结果。 */
  function d39Diff(rec, grid, start, goalCell, walkable, avoidPath, tag) {
    var d = rec.d39;
    if (d.pathDiffs.length >= 2 || !goalCell) return;
    var goalFn = function (x, y) { return x === goalCell.x && y === goalCell.y; };
    var plain = d39Bfs(grid, start, goalFn, walkable);
    if (!plain.ok) return;
    var same = plain.path.length === avoidPath.length;
    if (same) {
      for (var i = 0; i < plain.path.length; i++) {
        if (plain.path[i].x !== avoidPath[i].x || plain.path[i].y !== avoidPath[i].y) { same = false; break; }
      }
    }
    if (same) return;
    d.pathDiffs.push({
      tag: tag, floor: Game.Data.Player.floor,
      from: start.x + ',' + start.y, goal: goalCell.x + ',' + goalCell.y,
      avoidSteps: avoidPath.length - 1, plainSteps: plain.path.length - 1,
      avoidPath: avoidPath, plainPath: plain.path
    });
  }
  /* 三级规划：① 敌人当墙探图 → ② 敌人当墙去下楼/Boss → ③ 仍无路则走向最近的挡路怪（记录绕不过去） */
  function d39Plan(rec) {
    var P = Game.Data.Player, Map = Game.Systems.Map, grid = Map.getGrid();
    var d = rec.d39;
    if (!grid) { d.lastStep = null; return null; }
    var FLOORS = (Game.Data.MAPS && Game.Data.MAPS.floors) || 5;
    var upNoop = P.floor <= 1, downNoop = P.floor >= FLOORS;
    /* 注意：d39Bfs 以 passFn(nx, ny, tile) 三参调用，这里必须写成三参函数再转调 walkT，
     * 否则 1 参函数会把 nx 当成 tile（D-38 踩过同一个坑）。 */
    var walkT = function (t) {
      if (t === 0) return false;
      if (t === 3) return upNoop;
      if (t === 2) return downNoop;
      return true;
    };
    var walkable = function (x, y, t) { return walkT(t); };
    var free = function (x, y, t) { return walkT(t) && !Map.enemyAt(x, y); };
    /* 目标格本身要允许入队：非最终层的下行梯是"终点"而不是走廊，
     * 只走 walkT 会让楼梯永远不进队列，BFS 永远找不到它（本卡实测 catches 到的第一版 bug）。 */
    var walkGoal = function (x, y, t) { return walkT(t) || t === 2; };
    var freeGoal = function (x, y, t) { return free(x, y, t) || (t === 2 && !Map.enemyAt(x, y)); };
    var start = { x: P.x, y: P.y };
    var r = d39Bfs(grid, start, function (x, y) { return !Game.fov.isExplored(x, y); }, free);
    if (r.ok) {
      d39Diff(rec, grid, start, r.path[r.path.length - 1], walkGoal, r.path, 'explore');
      d.lastStep = { intoEnemy: false, forced: false, boss: false };
      return d39Dir(P, r.first);
    }
    var goal = d39Goal(P, Map);
    if (!goal) { d.lastStep = null; return null; }
    r = d39Bfs(grid, start, goal.fn, freeGoal);
    if (r.ok) {
      d39Diff(rec, grid, start, r.path[r.path.length - 1], walkGoal, r.path, goal.desc);
      d.lastStep = { intoEnemy: false, forced: false, boss: false };
      return d39Dir(P, r.first);
    }
    r = d39Bfs(grid, start, goal.fn, walkGoal);
    if (!r.ok) { d.lastStep = null; return null; }
    var fe = r.first ? Map.enemyAt(r.first.x, r.first.y) : null;
    if (fe) {
      var isBoss = !!(goal.boss && fe.monsterId === goal.bossId);
      if (!isBoss) {
        d.blockedCount++;
        if (d.blocked.length < 40) {
          var bk = {
            floor: P.floor, at: rec.actions, from: P.x + ',' + P.y,
            step: r.first.x + ',' + r.first.y, monsterId: fe.monsterId,
            goal: goal.desc, steps: r.steps
          };
          if (d.blocked.length < 2) {
            /* 前两条留完整网格 + 怪位，verify_d39 C 组据此复算"必经" */
            bk.w = grid[0].length; bk.h = grid.length;
            bk.grid = grid.map(function (row) { return row.join(''); }).join('|');
            bk.enemies = Map.getEnemies().map(function (e) { return { id: e.monsterId, x: e.x, y: e.y }; });
          }
          bk.window = d39Window(grid, r.first, 5);
          d.blocked.push(bk);
        }
      }
      d.lastStep = { intoEnemy: true, forced: !isBoss, boss: isBoss, monsterId: fe.monsterId };
      return d39Dir(P, r.first);
    }
    d.lastStep = { intoEnemy: false, forced: false, boss: false };
    return d39Dir(P, r.first);
  }
  /* 局部地形（11×11 ASCII）：C 组"手工还原当时的走廊形态"直接看这个 */
  function d39Window(grid, c, rad) {
    var h = grid.length, w = grid[0].length, rows = [];
    for (var y = c.y - rad; y <= c.y + rad; y++) {
      var line = '';
      for (var x = c.x - rad; x <= c.x + rad; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) line += ' ';
        else if (x === c.x && y === c.y) line += 'M';
        else line += (grid[y][x] === 0 ? '#' : '.');
      }
      rows.push(line);
    }
    return { x0: c.x - rad, y0: c.y - rad, w: rad * 2 + 1, h: rad * 2 + 1, rows: rows.join('\n') };
  }
  /* D-39 负例寻路：不把怪当障碍（沿用 D-34/D-37 的 planPath），并记录"这一步是踩怪"。
   * 只用于 verify_d39 A 组的负例对照，S1 永远走 d39Plan。 */
  function d39FallbackDir(rec) {
    var P = Game.Data.Player, Map = Game.Systems.Map;
    var dir = nextDir(rec);
    if (!dir) { rec.d39.lastStep = null; return null; }
    var dd = DIR_DELTA[dir];
    var e = Map.enemyAt(P.x + dd[0], P.y + dd[1]);
    rec.d39.lastStep = { intoEnemy: !!e, forced: false, boss: false, monsterId: e ? e.monsterId : null };
    return dir;
  }
  /* D-39 逃跑判据（S1）：先分类，再决定跑不跑。
   * 放弃逃跑、直接硬打的条件（任一满足）：
   *   ① 本层 Boss —— 胜利条件就是杀它，逃跑只会拖时间；
   *   ② 挡路怪（走廊/门口被堵）—— 逃跑后怪留在原地，下一步还会撞上，等于死循环；
   *   ③ 本场已经连试 2 次都失败 —— 骰子赌两次够了，再赌是送命；
   *   ④ 一击就能收掉（nKill ≤ 1）—— 转身逃反而多挨一轮。
   * 其余（巡逻怪贴脸，非必经）一律先逃。 */
  function d39FleeDecision(rec, P, st) {
    var d = rec.d39;
    if (d.fleeTriesThisBattle >= 2) { d.lastFleeWhy = 'tried2'; return false; }
    if (d.battleKind === 'boss') { d.lastFleeWhy = 'boss'; return false; }
    if (d.battleKind === 'blocked') { d.lastFleeWhy = 'blocked'; return false; }
    var m = d37Stats(st);
    var my = d37BestHit(P, m.def);
    if (Math.ceil(m.hp / my) <= 1) { d.lastFleeWhy = 'onehit'; return false; }
    d.lastFleeWhy = 'patrol';
    return true;
  }
  /* 每层 HP 台账：按动作类型把 HP 增量分桶；桶和必须严格等于层内 hpIn→hpOut */
  function d39LedgerStart(rec) {
    var P = Game.Data.Player;
    rec.d39.floorStart = {
      floor: P.floor, hpIn: P.hp, mpIn: P.mp, battle: 0, explore: 0,
      potionHeal: 0, trapDmg: 0, statusDmg: 0, levelUps: 0
    };
    rec.d39.floorEnter.push(d37Snap(P, P.floor));
  }
  function d39AfterAction(rec, kind, hp0, lv0) {
    var d = rec.d39, P = Game.Data.Player;
    if (!d.floorStart) d39LedgerStart(rec);
    var delta = P.hp - hp0;
    if (kind === 'battle') d.floorStart.battle += delta;
    else d.floorStart.explore += delta;
    if (P.level > lv0) d.floorStart.levelUps += (P.level - lv0);
  }
  function d39LedgerEnd(rec) {
    var d = rec.d39, P = Game.Data.Player, s = d.floorStart;
    if (!s) return;
    d.ledger.push({
      floor: s.floor, hpIn: s.hpIn, mpIn: s.mpIn, hpOut: P.hp, mpOut: P.mp,
      battleDelta: s.battle, exploreDelta: s.explore,
      potionHeal: s.potionHeal, trapDmg: s.trapDmg, statusDmg: s.statusDmg, levelUps: s.levelUps
    });
    d.floorEnd.push(d37Snap(P, s.floor));
    d.floorStart = null;
  }

  /* ── D-40：M1「刷满」——每层全清怪 / 拿宝箱 / 买最贵 / 用卷轴 ──────────
   * 与 S1 相反：把"能打的全打掉"当目标，用来测量"追求最强"要付什么代价。
   * 只测量，不改游戏；不传 opts.m1 时一行都不会执行。 */
  function m1New(cfg) {
    return {
      clear: cfg.clear !== false,
      floors: [], floorStart: null, lastKind: '',
      bought: [], scrollsUsed: 0, extrapolated: null, shoppedAfterClear: 0, final: null
    };
  }
  /* 累计经验（跨级不丢）：升级会从 exp 里扣阈值，层内增量必须用累计值相减 */
  function expCum(P) {
    var s = 0;
    for (var i = 1; i < (P.level || 1); i++) s += 60 * i;
    return s + (P.exp || 0);
  }
  function ownedCount(id) {
    var p = Game.Data.Player;
    if (p.equipment.weapon === id || p.equipment.armor === id) return 1;
    return p.inventory[id] || 0;
  }
  function m1Start(rec) {
    var P = Game.Data.Player;
    rec.m1.floorStart = { floor: P.floor, exp: expCum(P), battles: rec.battles, kills: rec.kills, actions: rec.actions };
  }
  function m1End(rec) {
    var P = Game.Data.Player, d = rec.m1, s = d.floorStart;
    if (!s) return;
    d.floors.push({
      floor: s.floor,
      actions: rec.actions - s.actions,
      battles: rec.battles - s.battles,
      kills: rec.kills - s.kills,
      expGain: expCum(P) - s.exp,
      atk: P.atk, def: P.def, maxHp: P.maxHp, maxMp: P.maxMp,
      hp: P.hp, mp: P.mp, level: P.level, gold: P.gold,
      equip: equipScore(),
      weaponId: P.equipment.weapon || null, armorId: P.equipment.armor || null,
      weaponPlus: (P.equipment.weapon && P.upg) ? (P.upg[P.equipment.weapon] || 0) : 0,
      armorPlus: (P.equipment.armor && P.upg) ? (P.upg[P.equipment.armor] || 0) : 0,
      potions: hpPotionCount()
    });
    d.floorStart = null;
  }
  /* 刷满寻路：最近的怪（含 Boss）→ 最近的宝箱 → 未探索格 → 下楼/最终层 Boss */
  function m1Plan(rec) {
    var P = Game.Data.Player, Map = Game.Systems.Map, grid = Map.getGrid();
    if (!grid) return null;
    var FLOORS = (Game.Data.MAPS && Game.Data.MAPS.floors) || 5;
    var upNoop = P.floor <= 1, downNoop = P.floor >= FLOORS;
    var walkT = function (t) {
      if (t === 0) return false;
      if (t === 3) return upNoop;
      if (t === 2) return downNoop;
      return true;
    };
    /* d39Bfs 以 passFn(nx, ny, tile) 三参调用，这里必须三参 */
    var walkable = function (x, y, t) { return walkT(t); };
    var start = { x: P.x, y: P.y };
    var r = d39Bfs(grid, start, function (x, y) { return !!Map.enemyAt(x, y); }, walkable);
    if (r.ok) { rec.m1.lastKind = 'enemy'; return d39Dir(P, r.first); }
    r = d39Bfs(grid, start, function (x, y) {
      var dc = Map.getDecor(x, y);
      return dc === 'chest' || dc === 'room_chest';
    }, walkable);
    if (r.ok) { rec.m1.lastKind = 'chest'; return d39Dir(P, r.first); }
    r = d39Bfs(grid, start, function (x, y) { return !Game.fov.isExplored(x, y); }, walkable);
    if (r.ok) { rec.m1.lastKind = 'explore'; return d39Dir(P, r.first); }
    var goal = d39Goal(P, Map);
    if (!goal) { rec.m1.lastKind = 'none'; return null; }
    r = d39Bfs(grid, start, goal.fn, function (x, y, t) { return walkT(t) || t === 2; });
    rec.m1.lastKind = goal.desc;
    return r.ok ? d39Dir(P, r.first) : null;
  }
  /* 刷满购物：装备优先（只买没拥有且更强的），其次卷轴（每次最多 2 张），最后药水（<3 瓶）。
   * 同价内取更贵者——这就是"每层买最贵的"的落地口径。 */
  function m1ShopAct(rec) {
    var P = Game.Data.Player, it = items();
    rec.shopVisitedFloor = P.floor;
    press('KeyE', MOVE_MS);
    if (Game.Modal.current() !== 'shop') { rec.shopFail++; return; }
    rec.shopVisits++; rec.actions++;
    var scrollBuys = 0, guard = 0;
    while (guard++ < 8) {
      var stock = Game.Systems.Shop.getStock();
      var pick = -1, pickPrice = -1, kind = '';
      for (var i = 0; i < stock.length; i++) {
        var d = stock[i].item;
        if (!d || d.price > P.gold) continue;
        var worth = false;
        if (d.type === 'weapon') {
          var ca = (P.equipment.weapon && it[P.equipment.weapon]) ? (it[P.equipment.weapon].effect.atk || 0) : 0;
          worth = !ownedCount(d.id) && (d.effect.atk || 0) > ca;
        } else if (d.type === 'armor') {
          var cd = (P.equipment.armor && it[P.equipment.armor]) ? (it[P.equipment.armor].effect.def || 0) : 0;
          worth = !ownedCount(d.id) && (d.effect.def || 0) > cd;
        } else if (d.scroll) {
          worth = scrollBuys < 2;
        } else if (d.type === 'consumable' && d.effect && d.effect.hp > 0) {
          /* "买最贵"= 先攒大件：金币不够 160 时不拿零碎药水，留着买装备/卷轴 */
          worth = hpPotionCount() < 3 && P.gold >= 160;
        }
        if (!worth) continue;
        if (d.price > pickPrice) { pickPrice = d.price; pick = i; kind = d.scroll ? 'scroll' : d.type; }
      }
      if (pick < 0) break;
      shopSelect(pick);
      var g0 = P.gold;
      press('Enter', STEP);
      var spent = g0 - P.gold;
      if (spent <= 0) break;
      rec.actions++; rec.shopBuys++; rec.shopSpent += spent;
      if (kind === 'scroll') scrollBuys++;
      rec.m1.bought.push({ floor: P.floor, id: stock[pick].id, price: spent, kind: kind });
    }
    if (Game.Modal.isOpen()) press('Escape', MOVE_MS);
  }
  /* 背包里的第一张强化卷轴索引（没有返回 -1） */
  function scrollIndex() {
    var list = Game.Systems.Inventory.list(), it = items();
    for (var i = 0; i < list.length; i++) {
      if (it[list[i].id] && it[list[i].id].scroll) return i;
    }
    return -1;
  }
  /* 活不到 F5 时的外推：按本局每层平均经验线性推到第 5 层，逐字段标注 extrapolated=true。
   * 只做算数与标注，不改玩家状态。 */
  function m1Extrapolate(rec) {
    var d = rec.m1, arr = d.floors;
    if (!arr.length) { d.extrapolated = null; return; }
    var P = Game.Data.Player, it = items();
    /* 只按"已完整清完的楼层"取每层收益：死亡那一层是残缺的，算进去会把速率拖低 */
    var base = arr.length > 1 ? arr.slice(0, arr.length - 1) : arr;
    var sumExp = 0;
    for (var i = 0; i < base.length; i++) sumExp += base[i].expGain;
    var avgExp = sumExp / base.length;
    var lastFloor = arr[arr.length - 1].floor;
    var remain = Math.max(0, 5 - lastFloor);
    var lv = P.level, exp = (P.exp || 0) + avgExp * remain;
    while (exp >= 60 * lv) { exp -= 60 * lv; lv++; }
    var w = P.equipment.weapon ? it[P.equipment.weapon] : null;
    var a = P.equipment.armor ? it[P.equipment.armor] : null;
    var wN = w ? Math.min(Math.max((P.upg && P.upg[w.id]) || 0, 0), 5) : 0;
    var aN = a ? Math.min(Math.max((P.upg && P.upg[a.id]) || 0, 0), 5) : 0;
    var eff = Game.Systems.Inventory.effValue;
    d.extrapolated = {
      extrapolated: true,
      assumedFloor: 5, fromFloors: arr.length,
      diedOnFloor: lastFloor,
      avgExpPerFloor: Math.round(avgExp * 100) / 100,
      projectedLevel: lv,
      projectedExpInLevel: exp,
      projectedAtk: 10 + (lv - 1) + (w ? eff(w.effect.atk || 0, wN) : 0),
      projectedDef: 5 + (lv - 1) + (a ? eff(a.effect.def || 0, aN) : 0),
      projectedMaxHp: 100 + (lv - 1) * 10 + (w && w.effect.maxHp ? w.effect.maxHp : 0) + (a && a.effect.maxHp ? a.effect.maxHp : 0),
      weaponId: P.equipment.weapon || null, armorId: P.equipment.armor || null,
      note: '外推：按本局每层平均经验线性外推到第 5 层，非实测'
    };
  }

  /* ── 寻路：BFS（只读 grid + fov 记忆；格子 0=墙、1=地板、2=下行梯、3=上行梯） ── */
  function firstStep(prev, key) {
    var P = Game.Data.Player;
    var start = P.x + ',' + P.y;
    var k = key;
    /* 回溯到"父节点 = 起点"的那一格，它就是第一步的落点 */
    while (prev[k] !== undefined && prev[k] !== null && prev[k] !== start) k = prev[k];
    if (k === start) return null;
    var c = k.split(','), x = +c[0], y = +c[1];
    var dx = x - P.x, dy = y - P.y;
    for (var i = 0; i < 4; i++) if (DIRS[i][0] === dx && DIRS[i][1] === dy) return DIRS[i][2];
    return null;
  }
  /* 策略：① 未探索格优先 ② 全探索完则下楼 ③ 都不行就朝任意可走方向挪一格 */
  function planPath(avoidAll) {
    var Map = Game.Systems.Map, P = Game.Data.Player;
    var grid = Map.getGrid();
    if (!grid) { planDbg = { why: 'noGrid' }; return null; }
    var h = grid.length, w = grid[0].length;
    /* D-37：逃跑成功后的 6 步里，无论血量多少都绕开所有怪（"刚逃出来先拉开距离"）；
     * avoidAll 默认 false，G0 走的是原来那条 60% 阈值，行为不变。 */
    var strong = P.hp < P.maxHp * 0.6 || !!avoidAll;
    var start = P.x + ',' + P.y;

    function bfsPass(pass, goal, st) {
      var prevMap = Object.create(null);
      prevMap[start] = null;
      var q = [start], head = 0;
      while (head < q.length) {
        var k = q[head++], c = k.split(','), x = +c[0], y = +c[1];
        st.vis++;
        if (k !== start) {
          if (!Game.fov.isExplored(x, y)) st.unexp++;
          if (goal(x, y, grid[y][x])) { st.hit = k; return { key: k, prev: prevMap }; }
        }
        for (var i = 0; i < 4; i++) {
          var nx = x + DIRS[i][0], ny = y + DIRS[i][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var nk = nx + ',' + ny;
          if (prevMap[nk] !== undefined) continue;
          if (!pass(nx, ny, grid[ny][nx])) continue;
          prevMap[nk] = k;
          q.push(nk);
        }
      }
      return null;
    }

    var FLOORS = (Game.Data.MAPS && Game.Data.MAPS.floors) || 5;
    /* map.placeStairs 每层都放上行梯(3)+下行梯(2)，但越界的 changeFloor 返回 null：
     * 第 1 层的上行梯、最深层(第 5 层)的下行梯都是"踩了不换层"的普通格。
     * 反之会真正换层的楼梯不能当通路走（否则两层之间反复上下）。 */
    var upNoop = P.floor <= 1, downNoop = P.floor >= FLOORS;
    var walkable = function (t) {
      if (t === 0) return false;
      if (t === 3) return upNoop;
      if (t === 2) return downNoop;
      return true;
    };
    var avoidEnemy = function (x, y, t) {
      if (!walkable(t)) return false;
      if (strong && Map.enemyAt(x, y)) return false; /* 血少时绕开怪（"强敌先回血"） */
      return true;
    };
    /* 楼梯格不是走廊，但它本身就是目标：允许入队才能被判为"到达" */
    var stairPass = function (t) { return walkable(t) || t === 2; };
    var toStairs = function (x, y, t) { return stairPass(t) && !(strong && Map.enemyAt(x, y)); };
    var toStairsFree = function (x, y, t) { return stairPass(t); };
    var isDownStair = function (x, y, t) { return t === 2 && !downNoop; };
    var s1 = { vis: 0, unexp: 0, hit: null }, s2 = { vis: 0, unexp: 0, hit: null }, s3 = { vis: 0, unexp: 0, hit: null };
    var s4 = { vis: 0, unexp: 0, hit: null };
    var stage = 'explore';
    var hit = bfsPass(avoidEnemy, function (x, y) { return !Game.fov.isExplored(x, y); }, s1);
    if (!hit) { stage = 'stairs'; hit = bfsPass(toStairs, isDownStair, s2); }
    if (!hit) { stage = 'stairs-any'; hit = bfsPass(toStairsFree, isDownStair, s3); }
    /* D-38：最后一层的必经目标是 Boss（胜利条件），而该层的下行梯是空转格——
     * 于是 isDownStair 永远不会命中，探索完就会原地空转（D-37 种子 1013 卡 1400+ 步的真因）。
     * 这里新增第 4 阶段：只剩最后一层且前三阶段无目标时，朝本层 Boss 走；
     * 打不打得过由战斗分支决定，至少不会"路没堵却站着不动"。非最终层不进入此阶段。 */
    if (!hit && P.floor >= FLOORS) {
      var bossId = null;
      var bs = (Game.Data.MAPS && Game.Data.MAPS.bosses) || [];
      for (var bi = 0; bi < bs.length; bi++) if (bs[bi].floor === P.floor) { bossId = bs[bi].id; break; }
      if (bossId) {
        stage = 'boss';
        hit = bfsPass(function (x, y, t) { return walkable(t); }, function (x, y) {
          var e = Map.enemyAt(x, y);
          return !!(e && e.monsterId === bossId);
        }, s4);
      }
    }
    if (!hit) {
      planDbg = { why: 'noTarget', stage: stage, start: start, w: w, h: h,
        tile: grid[P.y] ? grid[P.y][P.x] : 'OOB', s1: s1, s2: s2, s3: s3 };
      return null;
    }
    var dir = firstStep(hit.prev, hit.key);
    if (!dir) planDbg = { why: 'noFirstStep', stage: stage, key: hit.key };
    return dir;
  }
  var planDbg = null;
  /* 路径缓存：只缓存"下一格方向"，位置一变就重算（保证不会照着旧路径撞墙） */
  function nextDir(rec) {
    var P = Game.Data.Player;
    var key = P.x + ',' + P.y;
    if (!rec.path || rec.pathKey !== key || rec.pathFloor !== P.floor) {
      rec.path = planPath(!!(rec.d37 && rec.d37.respite > 0));
      rec.pathKey = key;
      rec.pathFloor = P.floor;
    }
    return rec.path;
  }

  /* ── 面板操作：全走真实按键（B 开背包 / ↑↓ 选择 / Enter 使用 / Esc 关闭） ── */
  function useIndex(idx) {
    press('KeyB', MOVE_MS);
    for (var i = 0; i < idx; i++) { kd('ArrowDown'); ku('ArrowDown'); }
    press('Enter', MOVE_MS);
    if (Game.Modal.isOpen()) press('Escape', MOVE_MS);
  }

  /* ── D-18 商店：真实按键 E 进店，↑↓ 选行 + Enter 购买（绝不直接调 Shop.buy） ──
   * 判断口径只用游戏已有的数值，不新造评分公式：
   *   · 装备：type=weapon 比 effect.atk、type=armor 比 effect.def，严格高于当前装备才买
   *     （与背包换装 betterEquipIndex 完全同一口径）；
   *   · 药水：effect.hp>0 的消耗品，金币够且身上回血药少于 POTION_CAP 瓶才补，
   *     同价位内挑回复量最高的（真人也会选更划算的那瓶）。 */
  var POTION_CAP = 2;
  function hpPotionCount() {
    var list = Game.Systems.Inventory.list(), n = 0;
    for (var i = 0; i < list.length; i++) {
      var d = items()[list[i].id];
      if (d && d.type === 'consumable' && d.effect && d.effect.hp > 0) n += list[i].count;
    }
    return n;
  }
  /* 返回 { idx, kind } 或 null；stock 必须是当前展示的货架（Shop.getStock() 纯读，不推进换货相位） */
  function pickShopTarget(stock, allowEquip) {
    var P = Game.Data.Player, it = items();
    var best = -1, bestGain = 0;
    if (allowEquip) {
      for (var i = 0; i < stock.length; i++) {
        var d = stock[i].item;
        if (!d || !d.effect) continue;
        if (d.type !== 'weapon' && d.type !== 'armor') continue;
        if (d.price > P.gold) continue;
        var gain = 0;
        if (d.type === 'weapon') {
          var ca = (P.equipment.weapon && it[P.equipment.weapon]) ? (it[P.equipment.weapon].effect.atk || 0) : 0;
          gain = (d.effect.atk || 0) - ca;
        } else {
          var cd = (P.equipment.armor && it[P.equipment.armor]) ? (it[P.equipment.armor].effect.def || 0) : 0;
          gain = (d.effect.def || 0) - cd;
        }
        if (gain > bestGain) { bestGain = gain; best = i; }
      }
      if (best >= 0) return { idx: best, kind: 'equip' };
    }
    if (hpPotionCount() < POTION_CAP) {
      var bestHeal = 0;
      best = -1;
      for (var j = 0; j < stock.length; j++) {
        var e = stock[j].item;
        if (!e || e.type !== 'consumable' || !e.effect || !(e.effect.hp > 0)) continue;
        if (e.price > P.gold) continue;
        if (e.effect.hp > bestHeal) { bestHeal = e.effect.hp; best = j; }
      }
      if (best >= 0) return { idx: best, kind: 'potion' };
    }
    return null;
  }
  /* 光标归位：Modal 不暴露 sel，用 ↑ 顶到 0 再 ↓ 到目标行（行数上限 12，24 次足够） */
  function shopSelect(idx) {
    for (var i = 0; i < 24; i++) { kd('ArrowUp'); ku('ArrowUp'); }
    for (var j = 0; j < idx; j++) { kd('ArrowDown'); ku('ArrowDown'); }
  }
  function shopAct(rec) {
    var P = Game.Data.Player;
    rec.shopVisitedFloor = P.floor;   /* 无论买成不成，本层只进一次 */
    press('KeyE', MOVE_MS);
    if (Game.Modal.current() !== 'shop') { rec.shopFail++; return; }
    rec.shopVisits++;
    rec.actions++;
    var equips = 0, potions = 0, guard = 0;
    while (guard++ < 4) {
      var stock = Game.Systems.Shop.getStock();
      var t = pickShopTarget(stock, equips === 0);
      if (!t) break;
      if (t.kind === 'potion' && potions >= 2) break;
      shopSelect(t.idx);
      var gold0 = P.gold;
      press('Enter', STEP);
      var spent = gold0 - P.gold;
      if (spent <= 0) break;   /* 没买成（金币或货架变了），不硬撞 */
      rec.actions++;
      rec.shopBuys++;
      rec.shopSpent += spent;
      if (t.kind === 'equip') equips++; else potions++;
    }
    if (Game.Modal.isOpen()) press('Escape', MOVE_MS);
  }

  /* ── 记账 ────────────────────────────────────────────────────── */
  function newRec(seed, maxActions) {
    return {
      seed: seed, maxActions: maxActions, outcome: '', deathCause: '', deathFloor: 0,
      actions: 0, keys: 0, loops: 0, crashes: 0, simSec: 0, wallMs: 0,
      floorNow: 1, floorActions: 0, floors: [],
      battles: 0, kills: 0, goblinKills: 0, traps: 0,
      potions: 0, battlePotions: 0, equips: 0, blockedSteps: 0, noDir: 0, modalStuck: 0,
      shopVisits: 0, shopBuys: 0, shopSpent: 0, shopFail: 0, shopVisitedFloor: 0,
      noShop: false,
      startPos: '', endPos: '',
      lastMonster: null, lastTrapAt: -1, diedInBattle: false, noPotionAtDeath: null,
      death: null, /* D-23：死亡归因快照（battle:end lose 的 payload 副本；只读） */
      gold: 0, level: 1, hp: 0, equip: 0, quests: {}
    };
  }
  /* 记录"离开第 N 层时的状态"；结局层（死亡/卡关/胜利）由 flushFloor 在收尾时补记 */
  function pushFloor(rec, ended) {
    var P = Game.Data.Player;
    rec.floors.push({
      floor: rec.floorNow, actions: rec.floorActions,
      gold: P.gold, equip: equipScore(), hp: P.hp, level: P.level,
      ended: !!ended
    });
  }
  function bumpFloor(rec) {
    var P = Game.Data.Player;
    if (P.floor === rec.floorNow) return;
    if (P.floor > rec.floorNow) {
      pushFloor(rec, false);
      /* D-37：离开某层时的 HP/MP/等级/金币/装备快照（只读，追加在 rec.d37 下） */
      if (rec.d37) rec.d37.floorEnd.push(d37Snap(P, rec.floorNow));
    }
    /* D-39：换层即结账——上一层台账收尾、新一层重新起账（上下楼都算） */
    if (rec.d39) { d39LedgerEnd(rec); }
    /* D-40：M1 每层收尾快照 */
    if (rec.m1) m1End(rec);
    rec.floorNow = P.floor;
    rec.floorActions = 0;
    /* D-37：刷级额度按层计，换层清零 */
    if (rec.d37) { rec.d37.grindKillsOnFloor = 0; rec.d37.grindTarget = null; rec.d37.grindEngaged = false; }
    /* D-39：新一层重新起账 */
    if (rec.d39) d39LedgerStart(rec);
    /* D-40：M1 新一层起账 */
    if (rec.m1) m1Start(rec);
  }

  /* ── 一局 ────────────────────────────────────────────────────── */
  function battleAct(rec) {
    var B = Game.Systems.Battle, P = Game.Data.Player;
    if (B.isInputLocked()) { frame(STEP); return; }
    var st = B.getState();
    if (!st || !st.monster) { frame(STEP); return; }
    var code = 'Digit1';
    var potionsBefore = healPotions().length;
    var useItem = false;
    /* D-19：低血且有回血药 → 战斗中按 7 用药（与探索补药同一 45% 阈值，未放宽）。
     * 真人行为：血量见底时先嗑药再继续打，而不是站着被补掉。 */
    if (P.hp <= Math.floor(P.maxHp * 0.45) && potionsBefore > 0) {
      code = 'Digit7';
      useItem = true;
    }
    /* 低血 + 有 MP + 本场没套过盾 → 套盾（每场一次），否则平砍；不逃、不用火球（保守可解释策略） */
    else if (!rec.shieldOn && P.hp <= P.maxHp * 0.25 && P.mp >= 10) { code = 'Digit6'; rec.shieldOn = true; }
    /* D-37：以下两条是新增分支，G0（未传 opts.d37）永远不进入；上一行原有的嗑药/套盾优先级保持不变 */
    else if (rec.d37 && rec.d37.cfg.flee && d37DecideFlee(rec, P, st)) {
      code = 'Digit3';
      rec.d37.fleeAttempts++;
      rec.d37.fleeTriesThisBattle++;
    }
    else if (rec.d37 && rec.d37.cfg.fireball && d37DecideFireball(P, st)) {
      code = 'Digit4';
    }
    /* D-39：S1 的强制遭遇分支（同样放在既有优先级之后，只有传了 opts.d39 才可能进入） */
    else if (rec.d39 && d39FleeDecision(rec, P, st)) {
      code = 'Digit3';
      rec.d39.fleeAttempts++;
      rec.d39.fleeTriesThisBattle++;
    }
    else if (rec.d39 && rec.d39.skill && d37DecideFireball(P, st)) {
      code = 'Digit4';
    }
    /* D-40：M1 不逃，只按同一套火球判据决定用不用技能 */
    else if (rec.m1 && d37DecideFireball(P, st)) {
      code = 'Digit4';
    }
    var pre = rec.d37 ? {
      mp: P.mp, mhp: st.monster.hp, round: st.roundNo,
      normalWould: dmgOf(P.atk, d37Stats(st).def)
    } : null;
    rec.actions++;
    press(code, STEP);
    var n = 0;
    while (n < 30 && Game.Core.Main._scene === 'battle' && B.isInputLocked()) { frame(STEP); n++; }
    if (useItem && healPotions().length < potionsBefore) rec.battlePotions++;
    if (rec.d37) d37AfterBattleAct(rec, code, pre, st);
  }

  function exploreAct(rec) {
    var P = Game.Data.Player;
    bumpFloor(rec);
    rec.floorActions++;
    /* 面板残留保护：正常流程不会走到；若真卡住，按 Esc 收场并计数（不当作玩家动作） */
    if (Game.Modal.isOpen()) { rec.modalStuck++; press('Escape', MOVE_MS); return; }
    /* ① 低血用药（<45%），有药就立刻喝 */
    if (P.hp <= Math.floor(P.maxHp * 0.45)) {
      var hp = healPotions();
      if (hp.length) {
        var hpB = P.hp;
        useIndex(hp[0].idx); rec.potions++; rec.actions++;
        /* D-39 台账：把药水回血量单独记一笔（只测量，不参与决策） */
        if (rec.d39 && rec.d39.floorStart) rec.d39.floorStart.potionHeal += (P.hp - hpB);
        return;
      }
    }
    /* ② 有更好的装备就换 */
    var eq = betterEquipIndex();
    if (eq >= 0) { useIndex(eq); rec.equips++; rec.actions++; return; }
    /* ②b D-40 M1：背包里有强化卷轴就立刻用（等价真人"拿到就用"） */
    if (rec.m1) {
      var si = scrollIndex();
      if (si >= 0) { useIndex(si); rec.m1.scrollsUsed++; rec.actions++; return; }
    }
    /* ③ D-18：每到新一层先看一眼商店（真人到新层也会先看货），本层只进一次 */
    if (!rec.noShop && rec.shopVisitedFloor !== P.floor) {
      if (rec.m1) m1ShopAct(rec); else shopAct(rec);
      return;
    }
    /* ③b D-40 M1：把本层的怪清完之后再回商店买一次（刷满玩家的真实节奏：先赚钱再花钱） */
    if (rec.m1 && rec.m1.shoppedAfterClear !== P.floor &&
        Game.Systems.Map.getEnemies().length === 0 && P.gold >= 80) {
      rec.m1.shoppedAfterClear = P.floor;
      m1ShopAct(rec);
      return;
    }
    /* ④ D-37：逃跑后的 6 步喘息（计数）与主动刷级，只在 opts.d37 下生效 */
    if (rec.d37) {
      if (rec.d37.respite > 0) rec.d37.respite--;
      if (rec.d37.sinceFlee >= 0) { rec.d37.sinceFlee++; if (rec.d37.sinceFlee > 6) rec.d37.sinceFlee = -1; }
      if (rec.d37.cfg.grind) {
        var gdir = d37GrindDir(rec);
        if (gdir) {
          var gx = P.x, gy = P.y;
          rec.actions++;
          press(gdir, MOVE_MS);
          if (P.x === gx && P.y === gy) rec.blockedSteps++;
          return;
        }
      }
    }
    /* ④b D-39：逃跑后的 6 tick 喘息期只做倒计时（寻路本来就绕开所有怪，
     * 这里只统计"喘息期内又被拉进战斗"的次数，见 battle:start 监听器） */
    if (rec.d39 && rec.d39.respite > 0) rec.d39.respite--;
    /* ⑤ 移动（D-39：潜行规划；其余情况沿用既有寻路） */
    var dir;
    if (rec.m1) dir = m1Plan(rec);
    else if (rec.d39) dir = rec.d39.avoid ? d39Plan(rec) : d39FallbackDir(rec);
    else dir = nextDir(rec);
    if (!dir) { rec.noDir++; frame(MOVE_MS); rec.actions++; rec.blockedSteps++; return; }
    var bx = P.x, by = P.y, traps0 = rec.traps, hp0m = P.hp;
    rec.actions++;
    press(dir, MOVE_MS);
    if (P.x === bx && P.y === by) { rec.path = null; rec.blockedSteps++; }
    /* D-39 台账：踩陷阱 / 探索期状态扣血各记一笔（否则"探索期掉血"混在一起无法对账） */
    if (rec.d39 && rec.d39.floorStart) {
      var dhp = P.hp - hp0m;
      if (rec.traps > traps0) rec.d39.floorStart.trapDmg += dhp;
      else if (dhp < 0) rec.d39.floorStart.statusDmg += dhp;
    }
  }

  /* 卡关诊断：区分"楼梯把通路堵死"与"本层根本没有下部可走的路"。
   * 全格 BFS（允许踩任何非墙格）能到下行梯、但策略 BFS 到不了 ⇒ 楼梯堵路。
   * 换层会把玩家传送到目标层出生点（main.js resetPlayer），所以被上行梯封住的区域
   * 对真人同样不可达 —— 这是地图生成层的结构问题，只记录不修。 */
  function stuckReason() {
    var Map = Game.Systems.Map, P = Game.Data.Player, grid = Map.getGrid();
    var h = grid.length, w = grid[0].length;
    var start = P.x + ',' + P.y, seen = {}, q = [start], head = 0, down = 0;

    function bfs(allowStairs) {
      var s = {}, qq = [start], hd = 0, d = 0;
      s[start] = 1;
      while (hd < qq.length) {
        var c = qq[hd++].split(','), x = +c[0], y = +c[1];
        if (grid[y][x] === 2) d++;
        for (var i = 0; i < 4; i++) {
          var nx = x + DIRS[i][0], ny = y + DIRS[i][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || grid[ny][nx] === 0) continue;
          if (!allowStairs && grid[ny][nx] === 3) continue;
          var nk = nx + ',' + ny;
          if (s[nk]) continue;
          s[nk] = 1; qq.push(nk);
        }
      }
      return { seen: s, down: d };
    }
    var all = bfs(true);
    /* D-38：再跑一次"真实移动语义"的 BFS——会换层的楼梯可以走上去，但不能穿过。
     * 只有这一版也到不了下行梯，才是真的"楼梯把路堵死"；否则旧实现会把任何
     * 探索完没目标的卡关都误报成"上行梯封住唯一走廊"（D-37 种子 1013 就是这么被误诊的）。 */
    var FLOORS = (Game.Data.MAPS && Game.Data.MAPS.floors) || 5;
    var upBlocks = P.floor > 1, downBlocks = P.floor < FLOORS;
    function bfsStrict() {
      var s = {}, qq = [start], hd = 0, d = 0;
      s[start] = 1;
      while (hd < qq.length) {
        var c = qq[hd++].split(','), x = +c[0], y = +c[1];
        if (grid[y][x] === 2) d++;
        if ((grid[y][x] === 3 && upBlocks) || (grid[y][x] === 2 && downBlocks)) continue;
        for (var i = 0; i < 4; i++) {
          var nx = x + DIRS[i][0], ny = y + DIRS[i][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || grid[ny][nx] === 0) continue;
          var nk = nx + ',' + ny;
          if (s[nk]) continue;
          s[nk] = 1; qq.push(nk);
        }
      }
      return { seen: s, down: d };
    }
    var strict = bfsStrict();
    var sp = Map.getSpawn();
    if (!all.down) {
      var hasDown = false;
      for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) if (grid[y2][x2] === 2) hasDown = true;
      return { reason: hasDown ? '下行梯不可达' : '本层无下行梯', spawnInPocket: null };
    }
    /* 出生点是否与玩家同处被上行梯封住的区域：是 ⇒ 真人靠换层传送也回不来 */
    if (!strict.down) {
      return { reason: '上行梯封住唯一走廊', spawnInPocket: !!all.seen[sp.x + ',' + sp.y] };
    }
    return { reason: '本层无可用目标', spawnInPocket: !!all.seen[sp.x + ',' + sp.y] };
  }

  /* D-38：死因归类（纯函数，classify 与 verify_d38 共用同一份口径）。
   * 以死亡遥测的 source 为准，不再用"本局是否见过 battle:end(lose)"推断：
   * 探索期中毒/流血结算致死同样会走 lose 事件（D-37 G3 的 4 局就是这样被错记的）。
   * 只有没有遥测时才退回旧口径。 */
  function deathCauseOf(rec) {
    var src = rec.death && rec.death.source;
    if (src === 'battle') return '被怪打死';
    if (src === 'trap') return '陷阱';
    if (src === 'other' || src === 'status') return '状态效果';
    if (src) return '状态/其它';
    if (rec.lastTrapAt === rec.actions) return '陷阱';
    if (rec.diedInBattle) return '被怪打死';
    return '状态/其它';
  }
  function classify(rec) {
    var P = Game.Data.Player;
    rec.deathFloor = P.floor;
    rec.noPotionAtDeath = healPotions().length === 0;
    rec.deathCause = deathCauseOf(rec);
  }

  Bot.run = function (seed, opts) {
    opts = opts || {};
    var M = Game.Core.Main, B = Game.Systems.Battle, P = Game.Data.Player;
    Bot.install();
    var rec = newRec(seed | 0, opts.maxActions || 2500);
    rec.noShop = !!opts.noShop;   /* D-18 负例开关：禁用商店步骤，验证"进店计数"确实来自这一步 */
    /* D-37：四组对照的开关。不传时 rec.d37 为 null，所有新增分支与记账都不执行。 */
    if (opts.d37) rec.d37 = d37New(opts.d37);
    /* D-39：S1 纯潜行的开关与遥测。不传时 rec.d39 为 null，行为与 D-37/D-34 完全一致。 */
    if (opts.d39) rec.d39 = d39New(opts.d39);
    /* D-40：M1 刷满（全清怪 / 买最贵 / 用卷轴），只测量。 */
    if (opts.m1) rec.m1 = m1New(opts.m1);
    var wall0 = Date.now();
    var spy0 = { pa: spy.pa, keys: spy.keys, loops: spy.loops };
    cur = rec;
    vNow = 0;
    Math.random = mulberry32(seed);
    if (Game.Fx && typeof Game.Fx._reset === 'function') Game.Fx._reset();
    M.restart();
    rec.floorNow = P.floor;
    rec.shieldOn = false;
    rec.startPos = P.x + ',' + P.y;
    /* D-39：开局（玩家已满血满蓝）起第一层台账 */
    if (rec.d39) d39LedgerStart(rec);
    /* D-40：M1 开局起账 */
    if (rec.m1) m1Start(rec);
    while (rec.actions < rec.maxActions) {
      if (M._scene === 'victory') { rec.outcome = 'win'; break; }
      if (Game.Modal.isOpen() && Game.Modal.current() === 'gameover') { rec.outcome = 'dead'; break; }
      if (M._scene === 'battle') {
        var bhp = P.hp, blv = P.level;
        battleAct(rec);
        if (rec.d39) d39AfterAction(rec, 'battle', bhp, blv);
      } else if (M._scene === 'explore') {
        var ehp = P.hp, elv = P.level;
        exploreAct(rec);
        if (rec.d39) d39AfterAction(rec, 'explore', ehp, elv);
      } else { press('Escape', STEP); rec.actions++; }
    }
    if (!rec.outcome) rec.outcome = 'stuck';
    if (rec.outcome === 'dead') classify(rec);
    if (rec.outcome === 'stuck') {
      var sr = stuckReason();
      rec.stuckReason = sr.reason;
      rec.stuckSpawnInPocket = sr.spawnInPocket;
      rec.deathFloor = P.floor;
    }
    /* 收尾快照 */
    rec.floor = P.floor;
    rec.endPos = P.x + ',' + P.y;
    rec.gold = P.gold;
    rec.level = P.level;
    rec.hp = P.hp;
    rec.equip = equipScore();
    /* 结局层：只在"还没记过这一层"时补记（换层当帧结束则已经记过上一层） */
    if (rec.floorNow === P.floor) pushFloor(rec, true);
    if (rec.d37) {
      rec.d37.floorEnd.push(d37Snap(P, P.floor));
      rec.d37.final = d37Snap(P, P.floor);
      rec.d37.fleeFail = rec.d37.fleeAttempts - rec.d37.fleeSuccess;
      if (rec.d37.fleeFail < 0) rec.d37.fleeFail = 0;
    }
    if (rec.d39) {
      d39LedgerEnd(rec);
      rec.d39.final = d37Snap(P, P.floor);
      rec.d39.fleeFail = Math.max(0, rec.d39.fleeAttempts - rec.d39.fleeSuccess);
      /* 强制遭遇 = 全部战斗 − 主动踩怪（S1 的 A 组断言就是 active === 0） */
      rec.d39.forced = rec.d39.battles - rec.d39.active;
    }
    if (rec.m1) {
      m1End(rec);
      m1Extrapolate(rec);
      rec.m1.final = d37Snap(P, P.floor);
    }
    delete rec.floorNow; delete rec.floorActions;
    delete rec.path; delete rec.pathKey; delete rec.pathFloor; delete rec.shieldOn;
    delete rec.shopVisitedFloor; delete rec.noShop;
    rec.simSec = Math.round(rec.actions * ACTION_SEC * 100) / 100;
    rec.wallMs = Date.now() - wall0;
    rec.keys = spy.keys - spy0.keys;
    rec.loops = spy.loops - spy0.loops;
    rec.playerActions = spy.pa - spy0.pa;
    var q = Game.Systems.Quest;
    if (q && typeof q.isDone === 'function') {
      var arr = Game.Data.QUESTS || [];
      for (var i = 0; i < arr.length; i++) rec.quests[arr[i].id] = !!q.isDone(arr[i].id);
    }
    cur = null;
    Bot._last = rec;
    return rec;
  };

  /* ── 事件记账（装一次，靠 cur 是否为空隔离局间） ─────────────── */
  function hookEvents() {
    var EB = Game.Core.EventBus;
    EB.on('battle:start', function (e) {
      if (!cur) return;
      cur.battles++;
      cur.lastMonster = e && e.monsterId;
      cur.shieldOn = false;
    });
    EB.on('battle:end', function (e) {
      if (!cur) return;
      if (e && e.result === 'win') {
        cur.kills++;
        if (cur.lastMonster === 'goblin') cur.goblinKills++;
      } else if (e && e.result === 'lose') {
        cur.diedInBattle = true;
        /* D-23：死亡归因——只复制 payload 字段（纯观测，不参与决策，不消耗随机数）。
         * 缺字段一律 null、键始终存在；source=trap 时怪/回合字段由产生方置 null。 */
        var pick = function (k) { return (e[k] !== undefined) ? e[k] : null; };
        cur.death = {
          at: cur.actions,
          source: pick('source'),
          monsterId: pick('monsterId'),
          monsterName: pick('monsterName'),
          floor: pick('floor'),
          playerLevel: pick('playerLevel'),
          roundNo: pick('roundNo'),
          hpAtDeath: pick('hpAtDeath'),
          maxHp: pick('maxHp'),
          potionsLeft: pick('potionsLeft'),
          weaponId: pick('weaponId'),
          armorId: pick('armorId')
        };
      }
    });
    EB.on('trap:triggered', function (e) {
      if (!cur) return;
      cur.traps++;
      cur.lastTrapAt = cur.actions;
      cur.lastTrapId = e && e.id;
    });
    /* ── D-37：独立监听器（不改上面三个既有 handler；无 d37 时立即返回） ── */
    EB.on('battle:start', function (e) {
      if (!cur || !cur.d37) return;
      var P = Game.Data.Player, d = cur.d37;
      d.battleStartPos = { x: P.x, y: P.y, floor: P.floor };
      d.lastBattleMonster = e && e.monsterId;
      d.fleeTriesThisBattle = 0;
      d.mpDryLogged = false;
      if (d.grindTarget && d.grindTarget.floor === P.floor &&
          d.grindTarget.x === P.x && d.grindTarget.y === P.y) {
        d.grindEngaged = true;
        d.grindTargets++;
      }
      if (d.sinceFlee >= 0 && d.sinceFlee <= 6) d.reengagedAfterFlee++;
    });
    EB.on('battle:end', function (e) {
      if (!cur || !cur.d37) return;
      var P = Game.Data.Player, d = cur.d37;
      if (e && e.result === 'run') {
        d.fleeSuccess++;
        var from = d.battleStartPos || { x: P.x, y: P.y, floor: P.floor };
        d.fleeLog.push({
          at: cur.actions, floor: P.floor, monsterId: d.lastBattleMonster || null,
          from: from.x + ',' + from.y, to: P.x + ',' + P.y,
          retreat: Math.abs(P.x - from.x) + Math.abs(P.y - from.y)
        });
        d.respite = 6;
        d.sinceFlee = 0;
        /* 命比经验重要：逃出来后放弃这次刷级目标，先拉开距离 */
        d.grindEngaged = false;
        d.grindTarget = null;
      } else if (e && e.result === 'win' && d.grindEngaged) {
        d.grindKills++;
        d.grindKillsOnFloor++;
        d.grindEngaged = false;
        d.grindTarget = null;
      }
    });
    /* ── D-39：遭遇分类（再挂独立监听器，仍然不触碰上面任何既有 handler） ──
     * 判据一律用"战斗开始那一刻玩家站的那格"：
     *   · 站在静态怪格上 → 是我们走进去的（ambush）：lastStep.forced 决定算"挡路"还是负例的"主动"；
     *   · 没站在怪格上 → 巡逻怪贴脸（ai:encounter），属于被动遭遇。
     * 怪格用 Map.enemyAt（只含静态刷怪点，巡逻怪不在其中），所以不会把巡逻误判成踩怪。 */
    EB.on('battle:start', function (e) {
      if (!cur || !cur.d39) return;
      var d = cur.d39, P = Game.Data.Player, Map = Game.Systems.Map;
      var bid = d39BossId(P.floor);
      var isBoss = !!(bid && e && e.monsterId === bid);
      var onMe = Map.enemyAt(P.x, P.y);
      var stepped = !!(onMe && e && onMe.monsterId === e.monsterId);
      d.battles++;
      if (isBoss) { d.byBoss++; d.battleKind = 'boss'; }
      else if (stepped && d.lastStep && d.lastStep.forced) { d.byBlock++; d.battleKind = 'blocked'; }
      else if (stepped) { d.active++; d.battleKind = 'active'; }
      else { d.byPatrol++; d.battleKind = 'patrol'; }
      /* "被 6 tick 喘息期拖回战斗"：上一次逃跑成功的喘息还没走完就又开打 */
      if (d.respite > 0) d.reengaged++;
      d.fleeTriesThisBattle = 0;
      d.lastStep = null;
    });
    EB.on('battle:end', function (e) {
      if (!cur || !cur.d39) return;
      if (e && e.result === 'run') {
        cur.d39.fleeSuccess++;
        cur.d39.respite = 6;
      }
    });
  }

  Bot.install = function () {
    if (installed) return;
    installed = true;
    var M = Game.Core.Main, B = Game.Systems.Battle;
    /* 渲染空转：只为提速，不改变任何状态 */
    var R = Game.Core.Render, noop = function () {};
    saved = { draws: {}, ub: M._updateBattle, ue: M._updateExplore, pa: B.playerAction, perf: performance.now, rnd: Math.random };
    for (var k in R) {
      if (typeof R[k] === 'function' && k.indexOf('draw') === 0) { saved.draws[k] = R[k]; R[k] = noop; }
    }
    /* 输入路径桩：playerAction / 玩家位移必须发生在 _updateBattle / _updateExplore 内部 */
    M._updateBattle = function () {
      inUpdate++; spy.updates++;
      try { return saved.ub.apply(this, arguments); } finally { inUpdate--; }
    };
    M._updateExplore = function () {
      inUpdate++;
      try { return saved.ue.apply(this, arguments); } finally { inUpdate--; }
    };
    B.playerAction = function () {
      spy.pa++;
      if (!inUpdate) spy.paOutside++;
      return saved.pa.apply(this, arguments);
    };
    if (Game.Motion && typeof Game.Motion.setStep === 'function') {
      var ms = Game.Motion.setStep;
      saved.motion = ms;
      Game.Motion.setStep = function (who) {
        if (who === 'player') { spy.moves++; if (!inUpdate) spy.movesOutside++; }
        return saved.motion.apply(this, arguments);
      };
    }
    /* 虚拟时钟：让 dying / 各种墙钟计时都可复现 */
    performance.now = function () { return vNow; };
    /* 诊断：记录 A* 上次返回的首节点，便于定位越界来源 */
    if (window.astar && typeof window.astar.search === 'function') {
      var as = window.astar.search;
      saved.astar = as;
      window.astar.search = function (g2) {
        var p = as.apply(this, arguments);
        if (p && p.length) saved.lastPath = { x: p[0].x, y: p[0].y, n: p.length };
        return p;
      };
    }
    /* 诊断：AI 抛错时把当场状态带出来（只读，不修游戏） */
    if (Game.Systems.AI && typeof Game.Systems.AI.tick === 'function') {
      var at = Game.Systems.AI.tick;
      saved.aiTick = at;
      Game.Systems.AI.tick = function () {
        try { return at.apply(this, arguments); }
        catch (e) {
          var g = Game.Systems.Map.getGrid(), p = Game.Data.Player;
          var ps = (Game.Systems.AI.getPatrols ? Game.Systems.AI.getPatrols() : []).map(function (q) {
            return q.x + ',' + q.y;
          }).join(' ');
          var msg = e.message + ' | grid=' + (g ? g.length + 'x' + g[0].length : 'null') +
            ' player=' + p.x + ',' + p.y + ' floor=' + p.floor + ' patrols=[' + ps + ']' +
            ' lastPath=' + (saved.lastPath ? (saved.lastPath.x + ',' + saved.lastPath.y + '/n' + saved.lastPath.n) : 'null');
          var e2 = new Error(msg);
          e2.orig = e.stack;
          throw e2;
        }
      };
    }
    hookEvents();
  };

  Bot.uninstall = function () {
    if (!installed) return;
    installed = false;
    performance.now = saved.perf;
    Math.random = saved.rnd;
    var R = Game.Core.Render;
    for (var k in saved.draws) R[k] = saved.draws[k];
    Game.Core.Main._updateBattle = saved.ub;
    Game.Core.Main._updateExplore = saved.ue;
    Game.Systems.Battle.playerAction = saved.pa;
    if (saved.motion) Game.Motion.setStep = saved.motion;
  };

  /* 测试钩子：只推进主循环、不产生任何输入。
   * verify 用它做"无输入则无动作"的负例，证明位移与出招来自按键事件而非内部调用。 */
  Bot.tickFrames = function (n) { for (var i = 0; i < n; i++) frame(STEP); };
  Bot.spy = function () { return spy; };
  Bot.resetSpy = function () {
    for (var k in spy) spy[k] = 0;
  };

  /* ── 批量 + 汇总 ─────────────────────────────────────────────── */
  Bot.batch = function (seeds, opts) {
    var runs = [], wall0 = Date.now();
    for (var i = 0; i < seeds.length; i++) runs.push(Bot.run(seeds[i], opts));
    return { runs: runs, summary: summarize(runs, seeds.length, opts), wallMs: Date.now() - wall0 };
  };

  function mean(a) {
    if (!a.length) return 0;
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return Math.round((s / a.length) * 100) / 100;
  }
  function summarize(runs, n, opts) {
    var win = 0, dead = 0, stuck = 0, bucket = {}, causes = {}, noPotion = 0, stuckReasons = {};
    var floorAgg = {}, floorPass = {};
    var simSec = [], actions = [];
    var goblinRuns = 0, goblinKills = 0;
    var shopVisits = 0, shopBuys = 0, shopSpent = 0, shopRuns = 0, shopFails = 0, crashes = 0;
    var potionsOut = 0, battlePotions = 0;
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      shopVisits += r.shopVisits || 0;
      shopBuys += r.shopBuys || 0;
      shopSpent += r.shopSpent || 0;
      shopFails += r.shopFail || 0;
      crashes += r.crashes || 0;
      potionsOut += r.potions || 0;
      battlePotions += r.battlePotions || 0;
      if ((r.shopVisits || 0) > 0) shopRuns++;
      if (r.outcome === 'win') win++;
      else if (r.outcome === 'dead') dead++;
      else {
        stuck++;
        stuckReasons[r.stuckReason || '未诊断'] = (stuckReasons[r.stuckReason || '未诊断'] || 0) + 1;
      }
      if (r.outcome === 'dead') {
        bucket[r.deathFloor] = (bucket[r.deathFloor] || 0) + 1;
        causes[r.deathCause || '未分类'] = (causes[r.deathCause || '未分类'] || 0) + 1;
        if (r.noPotionAtDeath) noPotion++;
      }
      simSec.push(r.simSec);
      actions.push(r.actions);
      if (r.quests && r.quests.kill_goblins) goblinRuns++;
      goblinKills += r.goblinKills || 0;
      for (var f = 0; f < r.floors.length; f++) {
        var fl = r.floors[f];
        if (!floorAgg[fl.floor]) floorAgg[fl.floor] = { actions: [], gold: [], equip: [], hp: [], reach: 0 };
        floorAgg[fl.floor].actions.push(fl.actions);
        floorAgg[fl.floor].gold.push(fl.gold);
        floorAgg[fl.floor].equip.push(fl.equip);
        floorAgg[fl.floor].hp.push(fl.hp);
        floorAgg[fl.floor].reach++;
      }
    }
    var floors = [];
    for (var k in floorAgg) {
      var a = floorAgg[k];
      floors.push({
        floor: +k, reached: a.reach,
        reachRate: Math.round((a.reach / n) * 10000) / 10000,
        avgActions: mean(a.actions), avgGold: mean(a.gold),
        avgEquip: mean(a.equip), avgHp: mean(a.hp)
      });
    }
    floors.sort(function (x, y) { return x.floor - y.floor; });
    return {
      runs: n,
      seeds: runs.map(function (r) { return r.seed; }),
      winRate: Math.round((win / n) * 10000) / 10000,
      deadRate: Math.round((dead / n) * 10000) / 10000,
      stuckRate: Math.round((stuck / n) * 10000) / 10000,
      win: win, dead: dead, stuck: stuck,
      deathFloorDist: bucket,
      deathCauses: causes,
      stuckReasons: stuckReasons,
      deathsWithoutPotion: noPotion,
      avgSimSec: mean(simSec),
      medianSimSec: (function () { var s = simSec.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : 0; })(),
      avgActions: mean(actions),
      floorStats: floors,
      shop: { visits: shopVisits, buys: shopBuys, spent: shopSpent,
        runsWithVisit: shopRuns, openFail: shopFails },
      potions: { outside: potionsOut, inside: battlePotions },
      crashes: crashes,
      goblinQuest: {
        questId: 'kill_goblins', need: 5,
        completedRuns: goblinRuns, runs: n,
        rate: Math.round((goblinRuns / n) * 10000) / 10000,
        totalGoblinKills: goblinKills,
        claimedRate: 0.0012
      },
      wallMs: 0
    };
  }

  Bot.mulberry32 = mulberry32;
  Bot.ACTION_SEC = ACTION_SEC;
  Bot.STEP_MS = STEP;
  Bot.deathCauseOf = deathCauseOf; /* D-38：死因归类口径（verify_d38 C 组直接调用） */
  Bot.d39Bfs = d39Bfs;             /* D-39：绕怪 BFS（verify_d39 B/C 组共用同一份实现） */
  Bot.d39BossId = d39BossId;       /* D-39：本层 Boss id（verify 复算"必经"时用） */
  /* 诊断出口（只读，供 preflight 调试页/verify 观察内部状态） */
  Bot._planPath = function () { return planPath(); };
  Bot._diag = function () {
    var P = Game.Data.Player, Map = Game.Systems.Map, grid = Map.getGrid();
    return {
      px: P.x, py: P.y, floor: P.floor, hp: P.hp, maxHp: P.maxHp,
      dims: grid ? grid.length + 'x' + grid[0].length : 'null',
      startTile: (grid && grid[P.y]) ? grid[P.y][P.x] : 'OOB',
      strong: P.hp < P.maxHp * 0.6,
      plan: planPath(),
      dbg: planDbg
    };
  };
})();
