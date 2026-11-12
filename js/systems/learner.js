/* js/systems/learner.js — 强化学习演示：Q-learning 寻宝鼠（M7，AI 亮点 4）
 * 场景：在真实迷宫网格上训练一只 AI 从随机位置学会走到目标（金币）处。
 * 算法：标准 Q-learning（TD 更新 Q(s,a) ← Q(s,a) + α[r + γ·maxQ(s') - Q(s,a)]）
 * 参考：开源 Q-learning 教学实现（如 Grid-World-RL、catch-cheese 等仓库，
 *       MIT/教学性质），算法为标准教材内容，本项目在真实游戏网格上自写落地。
 * 接口：init / reset / tick / getStats（见 PLAN.md §4.4）
 * 来源：自写（标准算法） */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var ACTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; /* 上右下左 */

  var ROLL = 20;      /* D-36：走势图口径 = 最近 20 个 episode 的滚动成功率 */
  var EPS_INIT = 0.4; /* D-36：每次 init 必须回到这个初始探索率 */

  var Q = null;       /* Q[h][w][4] */
  var alpha = 0.8;
  var gamma = 0.9;
  var epsilon = EPS_INIT;  /* 探索率：随训练衰减 */
  var grid = null;
  var w = 0;
  var h = 0;
  var target = { x: 0, y: 0 };
  var agent = { x: 0, y: 0 };
  var episode = 0;
  var step = 0;
  var maxSteps = 60;
  var successes = 0;
  var history = [];   /* 每 episode 一条 { episode, rate }，rate=最近 ROLL 轮滚动成功率 */
  var recent = [];    /* 最近 ROLL 个 episode 的成败（1/0），history.rate 的唯一数据源 */
  var episodeWon = false;
  var running = false;

  function dist(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }

  function randomOpen() {
    for (var i = 0; i < 300; i++) {
      var x = 1 + Math.floor(Math.random() * (w - 2));
      var y = 1 + Math.floor(Math.random() * (h - 2));
      if (grid[y][x] === 1) return { x: x, y: y };
    }
    return { x: 1, y: 1 };
  }

  function bestAction(x, y) {
    var best = 0;
    var bestV = Q[y][x][0];
    for (var a = 1; a < 4; a++) {
      if (Q[y][x][a] > bestV) { bestV = Q[y][x][a]; best = a; }
    }
    return best;
  }

  function rollingRate() {
    if (!recent.length) return 0;
    var s = 0;
    for (var i = 0; i < recent.length; i++) s += recent[i];
    return Math.round((s * 100) / recent.length);
  }

  function reset() {
    /* D-36：先结算"刚结束的那个 episode"的成败，再写走势图采样。
     * 旧实现写的是累计成功率 successes/episode，图下标却写"近 20 轮"——展示层口径说谎；
     * 现在 rate 由 recent 窗口（最近 ROLL 个 episode 的 1/0）算出，与标签同口径。 */
    if (episode > 0) {
      recent.push(episodeWon ? 1 : 0);
      if (recent.length > ROLL) recent.shift();
    }
    episodeWon = false;
    episode++;
    agent = randomOpen();
    step = 0;
    /* 探索率衰减：随训练轮次下降，从探索走向利用 */
    epsilon = Math.max(0.05, epsilon - 0.006);
    if (history.length > 40) history.shift();
    history.push({
      episode: episode,
      rate: rollingRate()
    });
  }

  function stepOne() {
    if (!running) return;
    step++;
    if (step > maxSteps) { reset(); return; }
    /* ε-greedy 选动作 */
    var action;
    if (Math.random() < epsilon) {
      action = Math.floor(Math.random() * 4);
    } else {
      action = bestAction(agent.x, agent.y);
    }
    /* TD 更新要用「选动作时」的状态 s：先存下来，后面移动改的是 s' */
    var sx = agent.x;
    var sy = agent.y;
    var oldDist = dist(agent.x, agent.y, target.x, target.y);
    var nx = agent.x + ACTIONS[action][0];
    var ny = agent.y + ACTIONS[action][1];
    var reward;
    var done = false;
    if (nx === target.x && ny === target.y) {
      reward = 10;
      agent = { x: nx, y: ny };
      successes++;
      episodeWon = true;
      done = true;
    } else if (nx >= 0 && ny >= 0 && nx < w && ny < h && grid[ny][nx] === 1) {
      agent = { x: nx, y: ny };
      /* 距离势引导（reward shaping）：向目标靠近 +0.5，远离 -0.5 */
      var newDist = dist(agent.x, agent.y, target.x, target.y);
      reward = 0.5 + (oldDist - newDist);
    } else {
      reward = -1;   /* 撞墙惩罚 */
    }
    /* TD 更新：Q(s,a) ← Q(s,a) + α·[r + γ·max_a' Q(s',a') − Q(s,a)]
     * 更新对象必须是「选动作时」的 s（sy/sx），max 取「执行后」的 s'（agent）。
     * · 撞墙：s' 与 s 相同，转移退化为自环，公式不变；
     * · 到达目标：终止转移没有后继价值，maxQ 记 0；
     * · max 仍在 4 个动作上取：「撞墙」在本实现里是可执行、也会被更新的动作
     *   （reward −1、自环），属于动作集的一部分，改成只取合法动作会改变 MDP 语义。 */
    var maxQ = done ? 0 : Q[agent.y][agent.x][bestAction(agent.x, agent.y)];
    Q[sy][sx][action] = Q[sy][sx][action] + alpha * (reward + gamma * maxQ - Q[sy][sx][action]);
    if (done) reset();
  }

  Game.Systems.Learner = {
    init: function (g) {
      grid = g;
      h = grid.length;
      w = grid[0].length;
      Q = [];
      for (var y = 0; y < h; y++) {
        Q[y] = [];
        for (var x = 0; x < w; x++) Q[y][x] = [0, 0, 0, 0];
      }
      target = randomOpen();
      /* 目标尽量远离出生点 */
      var sp = Game.Systems.Map.getSpawn();
      var tries = 0;
      while (Math.abs(target.x - sp.x) + Math.abs(target.y - sp.y) < 8 && tries < 100) {
        target = randomOpen();
        tries++;
      }
      episode = 0;
      successes = 0;
      history = [];
      recent = [];
      episodeWon = false;
      step = 0;
      /* D-36：每一次 init 都必须把训练状态完整复位到初始值。
       * 旧实现只重置 Q/episode/successes/history，漏了 epsilon——第二次按 L 进来时
       * Q 表是空的、ε 却停在 0.05，策略直接退化成"撞墙鼠"（第一次正常，第二次就坏）。 */
      epsilon = EPS_INIT;
      running = true;
      reset();
    },

    tick: function (stepsPerFrame) {
      if (!running) return;
      var n = stepsPerFrame || 8;
      for (var i = 0; i < n; i++) {
        if (!running) break;
        stepOne();
      }
    },

    getStats: function () {
      return {
        episode: episode,
        successRate: episode === 0 ? 0 : Math.round((successes * 100) / episode),
        successes: successes,
        epsilon: epsilon,
        agent: { x: agent.x, y: agent.y },
        target: { x: target.x, y: target.y },
        history: history
      };
    },

    stop: function () { running = false; }
  };
})();
