/* js/systems/battle.js — 回合制战斗系统
 * 接口：start / playerAction / getState / tick（见 PLAN.md §4.4）
 * 伤害公式：max(攻击方 atk - 防御方 def, 1)；防御指令本回合减伤 50%
 * 来源：参考 freeCodeCamp RPG 教程重构（自写实现）
 * 事件：battle:start / battle:end */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var state = null; /* { monster, log, turn, defending, dying, dyingAt, dyingMs, playerActionAt, monsterActionAt } */

  var DYING_MS = 700; /* 死亡消散动画时长 ms（渐隐+上浮+缩小） */

  function roll(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  function damage(atk, def) { return Math.max(atk - def, 1); }

  function logPush(msg) {
    state.log.push(msg);
    if (state.log.length > 6) state.log.shift();
  }

  /* S3-4：战斗反馈坐标——取自 render.js drawBattle 现有绘制位置，反馈层不重算地图
   * 怪物 sprite：左上角 (cv.width/2 - 45, 90)，尺寸 90x90，中心 y = 135
   * 玩家 sprite：左上角 (cv.width/2 - 45, cv.height - 190)，尺寸 90x90，中心 y = cv.height - 145 */
  function battleCanvas() {
    return (Game.Core && Game.Core.Render && Game.Core.Render._canvas) || document.getElementById('game');
  }
  function monsterPos() {
    var cv = battleCanvas();
    var cx = cv ? cv.width / 2 : 200;
    return { x: cx - 45, y: 90, w: 90, h: 90, cx: cx, cy: 135 };
  }
  function playerPos() {
    var cv = battleCanvas();
    var cx = cv ? cv.width / 2 : 200;
    var top = cv ? cv.height - 190 : 290;
    return { x: cx - 45, y: top, w: 90, h: 90, cx: cx, cy: top + 45 };
  }

  /* S3-4：仅在统一伤害入口触发反馈，不修改任何数值与 emit
   * M9-3：命中处同时生成 spark 粒子 */
  function spawnHitMonster(dmg) {
    var m = monsterPos();
    if (Game.Feedback && typeof Game.Feedback.spawn === 'function') {
      Game.Feedback.spawn({ x: m.cx, y: m.cy, text: '-' + dmg, color: '#ffffff' });
      Game.Feedback.spawn({ x: m.x, y: m.y, kind: 'hit', w: m.w, h: m.h });
    }
    if (Game.Particles && typeof Game.Particles.spawn === 'function') {
      Game.Particles.spawn('spark', m.cx, m.cy, { count: 6 });
    }
  }
  function spawnHurtPlayer(dmg) {
    var p = playerPos();
    if (Game.Feedback && typeof Game.Feedback.spawn === 'function') {
      Game.Feedback.spawn({ x: p.cx, y: p.cy, text: '-' + dmg, color: '#ff5555' });
      Game.Feedback.spawn({ x: p.x, y: p.y, kind: 'hurt', w: p.w, h: p.h });
    }
    if (Game.Particles && typeof Game.Particles.spawn === 'function') {
      Game.Particles.spawn('spark', p.cx, p.cy, { count: 5, color: '#ff8888' });
    }
  }

  /* M9-3：怪物死亡——生成 soul（灵魂上浮）+ shard（碎片飞溅）粒子 */
  function spawnDeathParticles() {
    if (!Game.Particles || typeof Game.Particles.spawn !== 'function') return;
    var m = monsterPos();
    Game.Particles.spawn('soul', m.cx, m.cy, { count: 4 });
    Game.Particles.spawn('shard', m.cx, m.cy, { count: 8, color: state.monster.color });
  }

  /* 怪物死亡结算（逻辑部分）：经验/金币/掉落 + 任务推进
   * M9-3：结算立即执行，但 battle:end 延迟到消散动画结束后由 tick 发出 */
  var pendingWin = null; /* 暂存胜利结算结果，消散动画结束后 emit */
  function settleWin() {
    var p = Game.Data.Player;
    var m = state.monster;
    p.exp += m.exp;
    var gold = roll(m.gold[0], m.gold[1]);
    p.gold += gold;
    var drops = [];
    for (var i = 0; i < m.drops.length; i++) {
      if (Math.random() < m.drops[i].rate) {
        var id = m.drops[i].itemId;
        drops.push(id);
        if (!p.inventory[id]) p.inventory[id] = 0;
        p.inventory[id]++;
      }
    }
    logPush('胜利！经验 +' + m.exp + ' 金币 +' + gold + (drops.length ? ' 获得:' + drops.join(',') : ''));
    if (Game.Systems.Quest) Game.Systems.Quest.progress('gold', gold);
    Game.Core.EventBus.emit('audio:play', { sfx: 'gold' });
    /* M9-3：标记死亡消散状态，暂存胜利结果 */
    state.dying = true;
    state.dyingAt = performance.now();
    state.dyingMs = DYING_MS;
    spawnDeathParticles();
    pendingWin = { result: 'win', monsterId: m.id, exp: m.exp, gold: gold, drops: drops };
  }

  /* 怪物行动：反击（玩家未逃跑且怪物存活）
   * M9-3：怪物攻击设置动作帧时间戳（纯视觉） */
  function monsterTurn() {
    var p = Game.Data.Player;
    var m = state.monster;
    state.monsterActionAt = performance.now(); /* M9-3：怪物攻击前摇帧 */
    var dmg = state.defending ? Math.max(Math.floor(damage(m.atk, p.def) / 2), 1) : damage(m.atk, p.def);
    p.hp = Math.max(p.hp - dmg, 0);
    spawnHurtPlayer(dmg); /* S3-4：玩家受击反馈（仅展示，不改数值） */
    state.defending = false;
    logPush(m.name + ' 攻击了你，造成 ' + dmg + ' 伤害');
    Game.Core.EventBus.emit('audio:play', { sfx: 'hit' });
    if (p.hp <= 0) {
      logPush('你被击败了…');
      Game.Core.EventBus.emit('audio:play', { sfx: 'lose' });
      Game.Core.EventBus.emit('battle:end', { result: 'lose' });
    }
  }

  Game.Systems.Battle = {
    start: function (monsterId) {
      var def = Game.Data.MONSTERS[monsterId];
      state = {
        monster: { id: def.id, name: def.name, hp: def.hp, maxHp: def.hp, atk: def.atk, def: def.def, exp: def.exp, gold: def.gold, drops: def.drops, color: def.color },
        log: ['遭遇 ' + def.name + '！战斗开始'],
        turn: 0,
        defending: false
      };
      Game.Core.EventBus.emit('battle:start', { monsterId: monsterId });
      return state;
    },

    playerAction: function (cmd) {
      if (!state) return null;
      if (state.dying) return state; /* M9-3：消散期间不接受任何操作 */
      if (cmd === 'attack') {
        state.playerActionAt = performance.now(); /* M9-3：玩家攻击前摇帧（纯视觉） */
        Game.Core.EventBus.emit('audio:play', { sfx: 'attack' });
        var dmg = damage(Game.Data.Player.atk, state.monster.def);
        state.monster.hp -= dmg;
        spawnHitMonster(dmg); /* S3-4：命中怪物反馈（仅展示，不改数值） */
        logPush('你对 ' + state.monster.name + ' 造成 ' + dmg + ' 伤害');
        if (state.monster.hp <= 0) {
          settleWin();
          return state;
        }
        Game.Core.EventBus.emit('audio:play', { sfx: 'hit' });
        monsterTurn();
      } else if (cmd === 'defend') {
        state.defending = true;
        Game.Core.EventBus.emit('audio:play', { sfx: 'defend' });
        logPush('你进入防御姿态，本回合减伤 50%');
        monsterTurn();
      } else if (cmd === 'run') {
        if (Math.random() < 0.5) {
          Game.Core.EventBus.emit('audio:play', { sfx: 'run' });
          logPush('你成功逃离了战斗');
          Game.Core.EventBus.emit('battle:end', { result: 'run' });
        } else {
          logPush('逃跑失败！');
          monsterTurn();
        }
      }
      state.turn++;
      return state;
    },

    getState: function () { return state; },

    /* M9-3：推进死亡消散计时；消散结束后发出 battle:end（此前结算已执行） */
    tick: function () {
      if (!state || !state.dying) return;
      var elapsed = performance.now() - state.dyingAt;
      if (elapsed >= (state.dyingMs || DYING_MS)) {
        var result = pendingWin;
        pendingWin = null;
        state = null;
        if (result) Game.Core.EventBus.emit('battle:end', result);
      }
    }
  };
})();
