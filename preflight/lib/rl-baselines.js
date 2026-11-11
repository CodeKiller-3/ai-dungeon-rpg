/* preflight/lib/rl-baselines.js — D-13：R1/R2 基线与 greedy 独立评估的共享实现
 * 使用方：preflight/d13_harness.html（产出证据 JSON）
 *         preflight/verify_d13.html（复算并与证据/文档逐值比对）
 * 不进游戏运行时，index.html 不加载。
 *
 * 口径（三个跑者共用同一套：起点采样 / 60 步上限 / 成功判定）：
 *   R1    = 每步在 4 个动作里均匀随机，撞墙算一步（对应「玩家乱按方向键」）
 *   R2    = 每步在合法动作里均匀随机（标准 random policy；合法 = 目标格或可通行格）
 *   greedy= 训练后 ε=0、Q 冻结、独立随机起点，按 argmax 选动作
 *           （并列取最小下标，与 learner.js 的 bestAction 完全一致）
 * 成功判定 = 60 步内从随机起点走到目标格；起点采样与 learner.randomOpen 同算法。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RlBaselines = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var ACTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; /* 上右下左（同 learner.js） */
  var MAX_STEPS = 60;                                /* 同 learner.js maxSteps */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 与 learner.randomOpen 完全同算法（300 次尝试、1..w-2 / 1..h-2、grid===1 才取） */
  function randomOpenLike(grid, rnd) {
    var h = grid.length, w = grid[0].length;
    for (var i = 0; i < 300; i++) {
      var x = 1 + Math.floor(rnd() * (w - 2));
      var y = 1 + Math.floor(rnd() * (h - 2));
      if (grid[y][x] === 1) return { x: x, y: y };
    }
    return { x: 1, y: 1 };
  }

  function isLegal(grid, x, y) {
    var h = grid.length, w = grid[0].length;
    return x >= 0 && y >= 0 && x < w && y < h && grid[y][x] === 1;
  }

  /* 单步推进（与 learner.stepOne 的转移语义一致）：
   * 先判目标（目标格本身可通行），再判阻挡；阻挡时位置不变、步数照算。 */
  function advance(grid, agent, target, act) {
    var nx = agent.x + ACTIONS[act][0];
    var ny = agent.y + ACTIONS[act][1];
    if (nx === target.x && ny === target.y) return { win: true, x: nx, y: ny };
    if (isLegal(grid, nx, ny)) return { win: false, x: nx, y: ny };
    return { win: false, x: agent.x, y: agent.y };
  }

  function runR1(grid, target, episodes, seed) {
    var rnd = mulberry32(seed), successes = 0;
    for (var e = 0; e < episodes; e++) {
      var a = randomOpenLike(grid, rnd), win = false;
      for (var s = 1; s <= MAX_STEPS; s++) {
        var r = advance(grid, a, target, Math.floor(rnd() * 4));
        a = { x: r.x, y: r.y };
        if (r.win) { win = true; break; }
      }
      if (win) successes++;
    }
    return { episodes: episodes, successes: successes, rate: episodes ? Math.round(successes * 100 / episodes) : 0 };
  }

  function runR2(grid, target, episodes, seed) {
    var rnd = mulberry32(seed), successes = 0;
    for (var e = 0; e < episodes; e++) {
      var a = randomOpenLike(grid, rnd), win = false;
      for (var s = 1; s <= MAX_STEPS; s++) {
        var legal = [];
        for (var i = 0; i < 4; i++) {
          if (isLegal(grid, a.x + ACTIONS[i][0], a.y + ACTIONS[i][1])) legal.push(i);
        }
        if (!legal.length) break;
        var r = advance(grid, a, target, legal[Math.floor(rnd() * legal.length)]);
        a = { x: r.x, y: r.y };
        if (r.win) { win = true; break; }
      }
      if (win) successes++;
    }
    return { episodes: episodes, successes: successes, rate: episodes ? Math.round(successes * 100 / episodes) : 0 };
  }

  /* greedy：argmax 与 learner.bestAction 同规则（严格大于才换，故并列取最小下标） */
  function argmax(qrow) {
    var best = 0;
    for (var i = 1; i < 4; i++) if (qrow[i] > qrow[best]) best = i;
    return best;
  }

  function runGreedy(grid, target, Q, episodes, seed) {
    var rnd = mulberry32(seed), successes = 0;
    for (var e = 0; e < episodes; e++) {
      var a = randomOpenLike(grid, rnd), win = false;
      for (var s = 1; s <= MAX_STEPS; s++) {
        var r = advance(grid, a, target, argmax(Q[a.y][a.x]));
        a = { x: r.x, y: r.y };
        if (r.win) { win = true; break; }
      }
      if (win) successes++;
    }
    return { episodes: episodes, successes: successes, rate: episodes ? Math.round(successes * 100 / episodes) : 0 };
  }

  function medianOf(arr) {
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  }

  /* 7 图汇总：中位数 + 区间端点 + 逐图原始值 */
  function summarize(rates) {
    return {
      values: rates.slice(),
      median: medianOf(rates),
      min: Math.min.apply(null, rates),
      max: Math.max.apply(null, rates)
    };
  }

  /* 文档白名单：把一批汇总里的全部百分数摊平（供 checkC55 的 demoAllow 使用） */
  function percentsOf() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var s = arguments[i];
      if (!s) continue;
      [s.median, s.min, s.max].forEach(function (v) {
        if (typeof v === 'number' && out.indexOf(v) < 0) out.push(v);
      });
    }
    return out.sort(function (a, b) { return a - b; });
  }

  return {
    ACTIONS: ACTIONS,
    MAX_STEPS: MAX_STEPS,
    mulberry32: mulberry32,
    randomOpenLike: randomOpenLike,
    isLegal: isLegal,
    advance: advance,
    runR1: runR1,
    runR2: runR2,
    runGreedy: runGreedy,
    medianOf: medianOf,
    summarize: summarize,
    percentsOf: percentsOf
  };
});
