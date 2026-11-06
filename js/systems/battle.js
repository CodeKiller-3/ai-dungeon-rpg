/* js/systems/battle.js — 回合制战斗系统
 * 接口：start / playerAction / getState / tick（见 PLAN.md §4.4）
 * M8-1：playerAction 纯新增 'skill:fireball' / 'skill:dash' / 'skill:shield'（attack/defend/run 语义不变）
 * 伤害公式：max(攻击方 atk - 防御方 def, 1)；防御指令本回合减伤 50%
 * 技能伤害：max(round(atk × 技能倍率) - 敌方 def, 1)（倍率版既有公式）
 * 护盾：battle state.shieldValue 本次战斗内抵挡等量伤害，扣完归零
 * M8-6：exp 达标自动升级（expToNext(level)=60×level，每级 atk/def+1、maxHp+10，升级回满 HP/MP）
 * 来源：参考 freeCodeCamp RPG 教程重构（自写实现）
 * 事件：battle:start / battle:end */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var state = null; /* { monster, log, turn, defending, shieldValue, enraged, enrageAtk, enrageDef, dying, dyingAt, dyingMs, playerActionAt, monsterActionAt } */

  var DYING_MS = 700; /* 死亡消散动画时长 ms（渐隐+上浮+缩小） */

  function roll(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  function damage(atk, def) { return Math.max(atk - def, 1); }

  /* M8-6：升级成长——经验阈值 expToNext(level) = 60 × level（L1→L2 需 60，全部可复算） */
  function expToNext(level) {
    var lv = (typeof level === 'number' && level >= 1) ? level : 1;
    return 60 * lv;
  }

  /* M8-6：exp 达标自动升级（可连续、溢出保留）；每级 atk+1/def+1/maxHp+10（L1 基础 10/5/100），
   * 升级回满 hp/mp。幂等：exp 不足时无变化，重复调用不重复升级。
   * 属性重算交给 Inventory.recalcEquip（基础属性随等级 + 装备加成），未加载时按成长公式兜底 */
  function checkLevelUp() {
    var p = Game.Data && Game.Data.Player;
    if (!p) return 0;
    if (typeof p.level !== 'number' || p.level < 1) p.level = 1;
    if (typeof p.exp !== 'number' || !isFinite(p.exp)) p.exp = 0;
    var ups = 0;
    while (p.exp >= expToNext(p.level)) {
      p.exp -= expToNext(p.level);
      p.level++;
      ups++;
    }
    if (ups > 0) {
      if (Game.Systems.Inventory && typeof Game.Systems.Inventory.recalcEquip === 'function') {
        Game.Systems.Inventory.recalcEquip();
      } else {
        p.atk = 10 + (p.level - 1);
        p.def = 5 + (p.level - 1);
        p.maxHp = 100 + (p.level - 1) * 10;
      }
      p.hp = p.maxHp;   /* 升级回满 HP */
      p.mp = p.maxMp;   /* 升级回满 MP */
      /* P2-5：level 任务推进——只在确实升级时调用（ups>0），避免每战重复 */
      if (Game.Systems.Quest && typeof Game.Systems.Quest.progress === 'function') {
        Game.Systems.Quest.progress('level', p.level);
      }
    }
    return ups;
  }

  /* M8-2：怪物当前生效的 atk/def——狂暴时取 state.enrageAtk/enrageDef，否则取原始值（不写回 data） */
  function monsterAtk() { return state && state.enraged ? state.enrageAtk : state.monster.atk; }
  function monsterDef() { return state && state.enraged ? state.enrageDef : state.monster.def; }

  /* M8-2：狂暴触发判定——受击后血量 ≤ maxHp×hpPct 且未狂暴时进入二阶段（单次触发） */
  function tryEnrage() {
    if (state.enraged) return;
    var ed = state.monster.enrage;
    if (!ed) return;
    if (state.monster.hp > 0 && state.monster.hp <= state.monster.maxHp * ed.hpPct) {
      state.enraged = true;
      state.enrageAtk = Math.round(state.monster.atk * ed.atkMul);
      state.enrageDef = Math.round(state.monster.def * ed.defMul);
      logPush(state.monster.name + ' 发出怒吼，陷入狂暴！攻击与防御提升');
    }
  }

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
    checkLevelUp(); /* M8-6：exp 累加后统一走升级检查（幂等） */
    var gold = roll(m.gold[0], m.gold[1]);
    p.gold += gold;
    var drops = [];
    for (var i = 0; i < m.drops.length; i++) {
      if (Math.random() < m.drops[i].rate) {
        var id = m.drops[i].itemId;
        /* M8-3：命中后若有 tiers，按权重随机选中一个品质变体（无 tiers 行为与原来完全一致） */
        var tiers = m.drops[i].tiers;
        if (tiers && tiers.length) {
          var totalW = 0;
          for (var j = 0; j < tiers.length; j++) totalW += tiers[j].w;
          var r = Math.random() * totalW;
          for (var k = 0; k < tiers.length; k++) {
            if (r < tiers[k].w) { id = tiers[k].itemId; break; }
            r -= tiers[k].w;
          }
        }
        drops.push(id);
        if (!p.inventory[id]) p.inventory[id] = 0;
        p.inventory[id]++;
      }
    }
    /* M8-4：图鉴登记——胜利时登记怪物击杀与掉落物品（变体 id 原样登记；守卫式调用，无硬依赖） */
    if (Game.Systems.Bestiary && typeof Game.Systems.Bestiary.record === 'function') {
      Game.Systems.Bestiary.record('monster', m.id);
      for (var bi = 0; bi < drops.length; bi++) Game.Systems.Bestiary.record('item', drops[bi]);
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
    var ed = m.enrage;
    /* M8-2：狂暴后每回合 chance 概率用烈焰吐息替代普攻（伤害 = round(狂暴atk × dmgMul)） */
    var useBreath = !!(state.enraged && ed && ed.skill && Math.random() < ed.skill.chance);
    state.monsterActionAt = performance.now(); /* M9-3：怪物攻击前摇帧 */
    var atkVal = useBreath ? Math.round(monsterAtk() * ed.skill.dmgMul) : monsterAtk();
    var raw = state.defending ? Math.max(Math.floor(damage(atkVal, p.def) / 2), 1) : damage(atkVal, p.def);
    state.defending = false;
    if (useBreath) logPush(m.name + ' 喷出' + ed.skill.name + '！');
    /* M8-1：护盾先抵挡等量伤害（扣完归零），剩余伤害才进 HP */
    var absorbed = 0;
    if (state.shieldValue > 0) {
      absorbed = Math.min(state.shieldValue, raw);
      state.shieldValue -= absorbed;
    }
    var dmg = raw - absorbed;
    if (dmg > 0) {
      p.hp = Math.max(p.hp - dmg, 0);
      spawnHurtPlayer(dmg); /* S3-4：玩家受击反馈（仅展示，不改数值） */
    }
    if (absorbed > 0) {
      logPush('护盾抵挡了 ' + absorbed + ' 点伤害' + (state.shieldValue <= 0 ? '（护盾破碎）' : ''));
    }
    logPush(dmg > 0 ? m.name + ' 攻击了你，造成 ' + dmg + ' 伤害' : m.name + ' 的攻击被护盾完全抵挡');
    Game.Core.EventBus.emit('audio:play', { sfx: 'hit' });
    if (p.hp <= 0) {
      logPush('你被击败了…');
      Game.Core.EventBus.emit('audio:play', { sfx: 'lose' });
      Game.Core.EventBus.emit('battle:end', { result: 'lose' });
    }
  }

  /* S-04：状态效果模块（寄宿在 battle.js，避免新增文件与加载序改动）
   * 数据：Game.Data.STATUS（bleed/poison，各含 tickDmg）
   * 状态只作用于玩家；每「回合」（探索走一步 / 战斗行动一次）由调用方 tick 一次 */
  Game.Systems.Status = {
    /* 施加/刷新状态：同一状态叠加时取较大剩余回合（不叠层数，避免连续踩毒气无限中毒） */
    apply: function (id, turns) {
      var def = Game.Data.STATUS && Game.Data.STATUS[id];
      if (!def) return false;
      var p = Game.Data.Player;
      if (!p.status) p.status = {};
      var t = (typeof turns === 'number' && turns > 0) ? turns : 1;
      p.status[id] = Math.max(p.status[id] || 0, t);
      return true;
    },

    clear: function (id) {
      var p = Game.Data.Player;
      if (p && p.status) delete p.status[id];
    },

    clearAll: function () {
      var p = Game.Data.Player;
      if (p) p.status = {};
    },

    /* 取当前生效状态快照 [{id,name,turns,color}]，供 HUD/验证页读取 */
    list: function () {
      var p = Game.Data.Player;
      var out = [];
      if (!p || !p.status) return out;
      for (var id in p.status) {
        if (!p.status.hasOwnProperty(id)) continue;
        var n = p.status[id];
        if (typeof n !== 'number' || n <= 0) continue;
        var def = (Game.Data.STATUS && Game.Data.STATUS[id]) || { name: id, color: '#ffffff' };
        out.push({ id: id, name: def.name, turns: n, tickDmg: def.tickDmg, color: def.color });
      }
      return out;
    },

    /* 回合结算：每个生效状态扣 tickDmg、回合 -1，归零移除；HP 归零走既有 battle:end lose 通道 */
    tick: function () {
      var p = Game.Data.Player;
      var res = [];
      if (!p || !p.status) return res;
      for (var id in p.status) {
        if (!p.status.hasOwnProperty(id)) continue;
        var left = p.status[id];
        if (typeof left !== 'number' || left <= 0) { delete p.status[id]; continue; }
        var def = Game.Data.STATUS && Game.Data.STATUS[id];
        var dmg = (def && typeof def.tickDmg === 'number') ? def.tickDmg : 0;
        if (dmg > 0) p.hp = Math.max(p.hp - dmg, 0);
        left -= 1;
        if (left > 0) p.status[id] = left; else delete p.status[id];
        res.push({ id: id, name: (def ? def.name : id), dmg: dmg, left: left });
      }
      if (res.length && p.hp <= 0) {
        Game.Core.EventBus.emit('audio:play', { sfx: 'lose' });
        Game.Core.EventBus.emit('battle:end', { result: 'lose' });
      }
      return res;
    }
  };

  Game.Systems.Battle = {
    start: function (monsterId) {
      var def = Game.Data.MONSTERS[monsterId];
      state = {
        monster: { id: def.id, name: def.name, hp: def.hp, maxHp: def.hp, atk: def.atk, def: def.def, exp: def.exp, gold: def.gold, drops: def.drops, color: def.color, enrage: def.enrage },
        log: ['遭遇 ' + def.name + '！战斗开始'],
        turn: 0,
        defending: false,
        shieldValue: 0, /* M8-1：本次战斗临时护盾 */
        enraged: false, /* M8-2：狂暴二阶段标记 */
        enrageAtk: 0,
        enrageDef: 0
      };
      /* M8-1：新战斗冷却清零（战斗外残留冷却不带到本场） */
      if (Game.Skills && typeof Game.Skills.resetCooldowns === 'function') Game.Skills.resetCooldowns();
      Game.Core.EventBus.emit('battle:start', { monsterId: monsterId });
      return state;
    },

    playerAction: function (cmd) {
      if (!state) return null;
      if (state.dying) return state; /* M9-3：消散期间不接受任何操作 */
      var skillId = null; /* M8-1：本次行动释放的技能（冷却推进时跳过它自己） */
      if (cmd === 'attack') {
        state.playerActionAt = performance.now(); /* M9-3：玩家攻击前摇帧（纯视觉） */
        Game.Core.EventBus.emit('audio:play', { sfx: 'attack' });
        var dmg = damage(Game.Data.Player.atk, monsterDef());
        state.monster.hp -= dmg;
        spawnHitMonster(dmg); /* S3-4：命中怪物反馈（仅展示，不改数值） */
        logPush('你对 ' + state.monster.name + ' 造成 ' + dmg + ' 伤害');
        tryEnrage(); /* M8-2：受击后判定狂暴 */
        if (state.monster.hp <= 0) {
          settleWin();
          if (Game.Skills && typeof Game.Skills.tick === 'function') Game.Skills.tick();
          return state;
        }
        Game.Core.EventBus.emit('audio:play', { sfx: 'hit' });
        monsterTurn();
      } else if (cmd === 'skill:fireball' || cmd === 'skill:dash' || cmd === 'skill:shield') {
        skillId = cmd.slice(6); /* 'skill:'.length === 6 */
        state.playerActionAt = performance.now(); /* M9-3：动作帧复用玩家前摇 */
        /* Skills.cast 负责校验 MP/冷却并触发效果；失败时不进入行动序列、不推进冷却 */
        var castOk = Game.Skills && typeof Game.Skills.cast === 'function' && Game.Skills.cast(skillId);
        if (!castOk) return state;
        if (state.dying || state.monster.hp <= 0) { /* 技能击杀：消散中，怪物不反击 */
          Game.Skills.tick(skillId);
          return state;
        }
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
      /* S-04：回合末结算玩家状态（中毒/流血），扣血与死亡走既有通道 */
      if (Game.Systems.Status && typeof Game.Systems.Status.tick === 'function') {
        var stRes = Game.Systems.Status.tick();
        for (var si = 0; si < stRes.length; si++) {
          logPush('你因' + stRes[si].name + '损失 ' + stRes[si].dmg + ' 点 HP' +
            (stRes[si].left > 0 ? '（剩 ' + stRes[si].left + ' 回合）' : '（' + stRes[si].name + '消退）'));
        }
      }
      /* M8-1：每行动 1 次，除本次刚释放技能外的冷却 -1（最小 0） */
      if (Game.Skills && typeof Game.Skills.tick === 'function') Game.Skills.tick(skillId || undefined);
      return state;
    },

    getState: function () { return state; },

    /* M8-6：升级成长接口（供 quest.js 任务奖励后调用与验证页断言） */
    expToNext: expToNext,
    checkLevelUp: checkLevelUp,

    /* M8-1：技能伤害落地（由 Game.Skills.cast 调用）——倍率版既有伤害公式
     * 伤害 = max(round(atk × 倍率) - 敌方 def, 1)；命中反馈/音效/胜利结算复用既有通道 */
    applySkillDamage: function (id, def) {
      if (!state || state.dying) return;
      var p = Game.Data.Player;
      var dmg = Math.max(def.dmg(p.atk) - monsterDef(), 1);
      Game.Core.EventBus.emit('audio:play', { sfx: 'attack' });
      state.monster.hp -= dmg;
      spawnHitMonster(dmg);
      logPush('你释放「' + def.name + '」，对 ' + state.monster.name + ' 造成 ' + dmg + ' 伤害');
      tryEnrage(); /* M8-2：受击后判定狂暴 */
      if (state.monster.hp <= 0) settleWin();
      else Game.Core.EventBus.emit('audio:play', { sfx: 'hit' });
    },

    /* M8-1：护盾落地（由 Game.Skills.cast 调用）——值为 maxHp 的 25%，存本次战斗 state */
    applySkillShield: function (id, def) {
      if (!state || state.dying) return;
      var p = Game.Data.Player;
      state.shieldValue = def.effect(p);
      Game.Core.EventBus.emit('audio:play', { sfx: 'defend' });
      logPush('你释放「' + def.name + '」，可抵挡 ' + state.shieldValue + ' 点伤害');
    },

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
