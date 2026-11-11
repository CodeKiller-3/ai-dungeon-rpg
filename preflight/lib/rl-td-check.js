/* preflight/lib/rl-td-check.js — D-13：TD 目标的手算断言与负例变异
 * 使用方：preflight/d13_harness.html（把结果写进证据 JSON）
 *         preflight/verify_d13.html（复算 + 与证据逐值比对）
 * 不进游戏运行时，index.html 不加载。
 *
 * 做法：把 js/systems/learner.js 的源码原样 eval，并在 IIFE 结束前注入一个只在测试期存在的
 * 观测口（读写闭包内的 Q / agent / target / epsilon，并直接调 stepOne），从而在完全受控的
 * 小网格上驱动真实生产代码；不复制、不改写 TD 逻辑。
 * 负例：把同一份源码里的新更新行替换成旧写法（更新 Q[s',a]），用同一组断言必须判 FAIL，
 * 证明断言本身能抓到这个 bug，而不是恒真。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RlTdCheck = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var NEW_UPDATE = 'Q[sy][sx][action] = Q[sy][sx][action] + alpha * (reward + gamma * maxQ - Q[sy][sx][action]);';
  var OLD_UPDATE = 'Q[agent.y][agent.x][action] = Q[agent.y][agent.x][action] + alpha * (reward + gamma * maxQ - Q[agent.y][agent.x][action]);';
  var EPS = 1e-9;

  function close(a, b) { return Math.abs(a - b) <= EPS; }

  /* 在 IIFE 结尾前注入观测口（只读/受控写，不改变任何游戏逻辑） */
  function instrument(src) {
    var anchor = '})();';
    var i = src.lastIndexOf(anchor);
    if (i < 0) throw new Error('learner.js 结构变化：找不到 IIFE 结尾');
    var hook = [
      '',
      '  Game.Systems.__learnerTest = {',
      '    getQ: function () { return Q; },',
      '    getState: function () { return { agent: { x: agent.x, y: agent.y }, target: { x: target.x, y: target.y },',
      '      step: step, epsilon: epsilon, w: w, h: h }; },',
      '    setState: function (o) {',
      '      if (o.grid) { grid = o.grid; h = grid.length; w = grid[0].length; }',
      '      if (o.agent) agent = { x: o.agent.x, y: o.agent.y };',
      '      if (o.target) target = { x: o.target.x, y: o.target.y };',
      '      if (o.Q) Q = o.Q;',
      '      if (o.step !== undefined) step = o.step;',
      '      if (o.epsilon !== undefined) epsilon = o.epsilon;',
      '    },',
      '    stepOnce: stepOne',
      '  };',
      ''
    ].join('\n');
    return src.slice(0, i) + hook + src.slice(i);
  }

  /* 载入一份被观测的 learner，返回 { L, hook } */
  function loadLearner(src, tag) {
    (0, eval)(src + '\n//# sourceURL=learner-' + (tag || 'td') + '.js');
    if (!window.Game || !Game.Systems || !Game.Systems.Learner || !Game.Systems.__learnerTest) {
      throw new Error('learner 观测口注入失败');
    }
    return { L: Game.Systems.Learner, hook: Game.Systems.__learnerTest };
  }

  function openGrid(w, h, wallRows) {
    var g = [];
    for (var y = 0; y < h; y++) {
      g[y] = [];
      for (var x = 0; x < w; x++) g[y][x] = 1;
    }
    (wallRows || []).forEach(function (y) {
      for (var x = 0; x < w; x++) g[y][x] = 0;
    });
    return g;
  }

  function zerosQ(w, h) {
    var Q = [];
    for (var y = 0; y < h; y++) { Q[y] = []; for (var x = 0; x < w; x++) Q[y][x] = [0, 0, 0, 0]; }
    return Q;
  }

  /* ── 场景（全部手算，见 verify_d13 页面注释） ─────────────
   * 公共：α=0.8、γ=0.9；grid 全 1（除撞墙场景首行）；ε=0 → 选 bestAction（并列取最小下标）。 */

  /* 1 步合法转移：s=(1,1) → s'=(2,1)，target=(3,1)
   * Q[s]=[0,5,0,0] → a=1（右）；Q[s']=[0,2,0,0]
   * r = 0.5 + (2 - 1) = 1.5；maxQ(s') = 2
   * Q[s][1] = 5 + 0.8·(1.5 + 0.9·2 − 5) = 5 − 1.36 = 3.64 */
  function oneStep() {
    return {
      grid: openGrid(4, 4), agent: { x: 1, y: 1 }, target: { x: 3, y: 1 },
      Q: (function () { var Q = zerosQ(4, 4); Q[1][1] = [0, 5, 0, 0]; Q[1][2] = [0, 2, 0, 0]; return Q; })(),
      steps: 1,
      expect: function (Q) { return close(Q[1][1][1], 3.64) && close(Q[1][2][1], 2); }
    };
  }

  /* 2 步连续转移：s0=(1,1) → s1=(2,1) → s2=(3,1)，target=(4,1)
   * Q[s0]=[0,5,0,0]、Q[s1]=[0,3,0,0]、Q[s2]=[0,4,0,0]
   * 第 1 步：r=1.5，maxQ(s1)=3 → Q[s0][1] = 5 + 0.8·(1.5+2.7−5) = 4.36
   * 第 2 步：r=1.5，maxQ(s2)=4 → Q[s1][1] = 3 + 0.8·(1.5+3.6−3) = 4.68 */
  function twoStep() {
    return {
      grid: openGrid(5, 5), agent: { x: 1, y: 1 }, target: { x: 4, y: 1 },
      Q: (function () {
        var Q = zerosQ(5, 5);
        Q[1][1] = [0, 5, 0, 0]; Q[1][2] = [0, 3, 0, 0]; Q[1][3] = [0, 4, 0, 0];
        return Q;
      })(),
      steps: 2,
      expect: function (Q) { return close(Q[1][1][1], 4.36) && close(Q[1][2][1], 4.68); }
    };
  }

  /* 撞墙（自环）：s=(1,1)，首行全墙，Q[s]=[5,0,0,0] → a=0（上），被挡
   * r = −1，s'==s，maxQ(s)=5
   * Q[s][0] = 5 + 0.8·(−1 + 4.5 − 5) = 3.8（其余分量不变） */
  function wall() {
    return {
      grid: openGrid(5, 5, [0]), agent: { x: 1, y: 1 }, target: { x: 4, y: 4 },
      Q: (function () { var Q = zerosQ(5, 5); Q[1][1] = [5, 0, 0, 0]; return Q; })(),
      steps: 1,
      expect: function (Q) {
        return close(Q[1][1][0], 3.8) && close(Q[1][1][1], 0) && close(Q[1][1][2], 0);
      }
    };
  }

  /* 终止转移：s=(3,1) → target=(4,1)，Q[s]=[0,5,0,0] → a=1（右）到达目标
   * r=10，终止无后继 → maxQ=0
   * Q[s][1] = 5 + 0.8·(10 − 5) = 9（旧写法会把 8 写到目标格的 Q[s'][1]） */
  function terminal() {
    return {
      grid: openGrid(5, 5), agent: { x: 3, y: 1 }, target: { x: 4, y: 1 },
      Q: (function () { var Q = zerosQ(5, 5); Q[1][3] = [0, 5, 0, 0]; return Q; })(),
      steps: 1,
      expect: function (Q) { return close(Q[1][3][1], 9) && close(Q[1][4][1], 0); }
    };
  }

  var CASES = { oneStep: oneStep, twoStep: twoStep, wall: wall, terminal: terminal };

  /* 在指定源码上跑一个场景，返回 { ok, Q } */
  function runCase(src, spec) {
    var lr = loadLearner(src, 'tdcase');
    lr.L.init(spec.grid);
    lr.hook.setState({ agent: spec.agent, target: spec.target, Q: spec.Q, step: 0, epsilon: 0 });
    var origRandom = Math.random;
    Math.random = function () { return 1; }; /* ε=0 下不会被调用，仍兜住实现变化 */
    try {
      for (var i = 0; i < spec.steps; i++) lr.hook.stepOnce();
    } finally { Math.random = origRandom; }
    var Q = lr.hook.getQ();
    return { ok: !!spec.expect(Q), Q: Q };
  }

  /* 对一份源码跑全部场景 → { ok, cases } */
  function evaluate(src) {
    var out = { ok: true, cases: {} };
    Object.keys(CASES).forEach(function (name) {
      var r = runCase(src, CASES[name]());
      out.cases[name] = r.ok;
      if (!r.ok) out.ok = false;
    });
    return out;
  }

  return {
    NEW_UPDATE: NEW_UPDATE,
    OLD_UPDATE: OLD_UPDATE,
    instrument: instrument,
    loadLearner: loadLearner,
    runCase: runCase,
    evaluate: evaluate,
    CASES: CASES,
    close: close
  };
});
