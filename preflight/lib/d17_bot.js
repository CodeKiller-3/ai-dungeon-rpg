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
  function planPath() {
    var Map = Game.Systems.Map, P = Game.Data.Player;
    var grid = Map.getGrid();
    if (!grid) { planDbg = { why: 'noGrid' }; return null; }
    var h = grid.length, w = grid[0].length;
    var strong = P.hp < P.maxHp * 0.6;
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
    var stage = 'explore';
    var hit = bfsPass(avoidEnemy, function (x, y) { return !Game.fov.isExplored(x, y); }, s1);
    if (!hit) { stage = 'stairs'; hit = bfsPass(toStairs, isDownStair, s2); }
    if (!hit) { stage = 'stairs-any'; hit = bfsPass(toStairsFree, isDownStair, s3); }
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
      rec.path = planPath();
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

  /* ── 记账 ────────────────────────────────────────────────────── */
  function newRec(seed, maxActions) {
    return {
      seed: seed, maxActions: maxActions, outcome: '', deathCause: '', deathFloor: 0,
      actions: 0, keys: 0, loops: 0, crashes: 0, simSec: 0, wallMs: 0,
      floorNow: 1, floorActions: 0, floors: [],
      battles: 0, kills: 0, goblinKills: 0, traps: 0,
      potions: 0, equips: 0, blockedSteps: 0, noDir: 0, modalStuck: 0,
      startPos: '', endPos: '',
      lastMonster: null, lastTrapAt: -1, diedInBattle: false, noPotionAtDeath: null,
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
    if (P.floor > rec.floorNow) pushFloor(rec, false);
    rec.floorNow = P.floor;
    rec.floorActions = 0;
  }

  /* ── 一局 ────────────────────────────────────────────────────── */
  function battleAct(rec) {
    var B = Game.Systems.Battle, P = Game.Data.Player;
    if (B.isInputLocked()) { frame(STEP); return; }
    var st = B.getState();
    if (!st || !st.monster) { frame(STEP); return; }
    var code = 'Digit1';
    /* 低血 + 有 MP → 先套盾（每场一次），否则平砍；不逃、不用火球（保守可解释策略） */
    if (!rec.shieldOn && P.hp <= P.maxHp * 0.25 && P.mp >= 10) { code = 'Digit6'; rec.shieldOn = true; }
    rec.actions++;
    press(code, STEP);
    var n = 0;
    while (n < 30 && Game.Core.Main._scene === 'battle' && B.isInputLocked()) { frame(STEP); n++; }
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
      if (hp.length) { useIndex(hp[0].idx); rec.potions++; rec.actions++; return; }
    }
    /* ② 有更好的装备就换 */
    var eq = betterEquipIndex();
    if (eq >= 0) { useIndex(eq); rec.equips++; rec.actions++; return; }
    /* ③ 移动（未探索 → 下楼） */
    var dir = nextDir(rec);
    if (!dir) { rec.noDir++; frame(MOVE_MS); rec.actions++; rec.blockedSteps++; return; }
    var bx = P.x, by = P.y;
    rec.actions++;
    press(dir, MOVE_MS);
    if (P.x === bx && P.y === by) { rec.path = null; rec.blockedSteps++; }
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
    if (!all.down) {
      var hasDown = false;
      for (var y2 = 0; y2 < h; y2++) for (var x2 = 0; x2 < w; x2++) if (grid[y2][x2] === 2) hasDown = true;
      return { reason: hasDown ? '下行梯不可达' : '本层无下行梯', spawnInPocket: null };
    }
    /* 出生点是否与玩家同处被上行梯封住的区域：是 ⇒ 真人靠换层传送也回不来 */
    var sp = Map.getSpawn();
    return { reason: '上行梯封住唯一走廊', spawnInPocket: !!all.seen[sp.x + ',' + sp.y] };
  }

  function classify(rec) {
    var P = Game.Data.Player;
    rec.deathFloor = P.floor;
    rec.noPotionAtDeath = healPotions().length === 0;
    if (rec.lastTrapAt === rec.actions) rec.deathCause = '陷阱';
    else if (rec.diedInBattle) rec.deathCause = '被怪打死';
    else rec.deathCause = '状态/其它';
  }

  Bot.run = function (seed, opts) {
    opts = opts || {};
    var M = Game.Core.Main, B = Game.Systems.Battle, P = Game.Data.Player;
    Bot.install();
    var rec = newRec(seed | 0, opts.maxActions || 2500);
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
    while (rec.actions < rec.maxActions) {
      if (M._scene === 'victory') { rec.outcome = 'win'; break; }
      if (Game.Modal.isOpen() && Game.Modal.current() === 'gameover') { rec.outcome = 'dead'; break; }
      if (M._scene === 'battle') battleAct(rec);
      else if (M._scene === 'explore') exploreAct(rec);
      else { press('Escape', STEP); rec.actions++; }
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
    delete rec.floorNow; delete rec.floorActions;
    delete rec.path; delete rec.pathKey; delete rec.pathFloor; delete rec.shieldOn;
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
      }
    });
    EB.on('trap:triggered', function (e) {
      if (!cur) return;
      cur.traps++;
      cur.lastTrapAt = cur.actions;
      cur.lastTrapId = e && e.id;
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
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
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
