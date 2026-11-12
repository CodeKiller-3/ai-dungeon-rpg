/* js/systems/battle.js — 回合制战斗系统
 * 接口：start / playerAction / getState / tick（见 PLAN.md §4.4）
 * M8-1：playerAction 纯新增 'skill:fireball' / 'skill:dash' / 'skill:shield'（attack/defend/run 语义不变）
 * 伤害公式：max(攻击方 atk - 防御方 def, 1)；防御指令本回合减伤 50%
 * 技能伤害：max(round(atk × 技能倍率) - 敌方 def, 1)（倍率版既有公式）
 * 护盾：battle state.shieldValue 本次战斗内抵挡等量伤害，扣完归零
 * M8-6：exp 达标自动升级（D-41 起 L1–L4 为 15×level、L5+ 为 60×level，每级 atk/def+1、maxHp+10，升级回满 HP/MP）
 * 来源：参考 freeCodeCamp RPG 教程重构（自写实现）
 * 事件：battle:start / battle:end */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var state = null; /* { monster, log, turn, defending, shieldValue, enraged, enrageAtk, enrageDef, dying, dyingAt, dyingMs, playerActionAt, monsterActionAt,
                       D-16: phase, pending, buffered, lockUntil, roundNo, turnRec, events, lastAction } */

  /* D-43：血量账遥测（默认关闭，不参与任何数值/顺序/随机数）。
   * 只把"已经发生的 HP 增减"复制成一条 {kind,source,amount}，供测量页按楼层对账；
   * 不注册时 hpLog 为 null，所有调用立即返回，游戏行为与改动前逐帧一致。 */
  var hpLog = null;
  function logHp(kind, source, amount, extra) {
    if (typeof hpLog !== 'function') return;
    if (typeof amount !== 'number' || !isFinite(amount) || amount === 0) return;
    var e = { kind: kind, source: source, amount: amount };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k];
    hpLog(e);
  }

  var DYING_MS = 700; /* 死亡消散动画时长 ms（渐隐+上浮+缩小） */

  /* D-16：单回合表现时间轴（ms）。
   * 玩家段立即结算并出反馈；怪物段推迟 seg1 后由 tick 推进结算/反馈——两段落在不同帧。
   * lock：输入锁时长（卡面要求 ≤160ms）；total：整回合表现时长（卡面要求 ≤240ms）。
   * 只推迟"结算发生的时刻"与反馈，伤害公式/数值/顺序（玩家先、怪物后）一概不动。 */
  var TL = { seg1: 100, lock: 150, total: 180 };
  var clock = null;  /* D-16：可注入时钟（验证页用；默认 performance.now，与肉眼节奏一致） */
  var frameNow = null; /* D-16：主循环帧时间戳（rAF 同钟）；定步长驱动的验证页据此对齐时间轴 */
  var timeOffset = 0; /* D-51：暂停累计时长。now() 统一扣除，等价于把整条时间轴挂起；
                       * 恢复时只补一次偏移，未到点的怪物段/输入锁/回合计时保持原剩余量。 */
  var turnSeq = 0;

  function now() {
    if (typeof clock === 'function') {
      var v = clock();
      if (typeof v === 'number' && isFinite(v)) return v - timeOffset;
    }
    if (typeof frameNow === 'number') return frameNow - timeOffset;
    return performance.now() - timeOffset;
  }

  /* D-16：伤害分级（游戏无暴击系统，仅按量级区分显示）
   * 高伤 = 单次 ≥20 点，或 ≥ 目标生命上限的 20% */
  function isHeavy(dmg, maxHp) {
    if (dmg >= 20) return true;
    return !!(maxHp > 0 && dmg / maxHp >= 0.2);
  }

  function roll(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  /* D-34：伤害公式解冻（仅此一项）——减法改「比例减伤」。
   *   dmg = max(1, round(atk² / (atk + def)))
   *   等价形式：减伤率 = def / (atk + def)，攻击越高越难被完全防住。
   * 旧式 max(atk-def,1) 的问题：def ≥ atk-1 时恒为 1（免疫点），且 def 越高曲线越平，
   * 导致第 5 层（玩家 def≈26）普通怪只能打 1~3 点、最终 Boss 反而比普通怪更软。 */
  function damage(atk, def) {
    var a = Math.max(Number(atk) || 0, 0);
    var d = Math.max(Number(def) || 0, 0);
    if (a + d <= 0) return 1;
    return Math.max(1, Math.round(a * a / (a + d)));
  }

  /* M8-6：升级成长——经验阈值 expToNext(level) = 基数 × level（L1→L2 需 基数，全部可复算）
   * D-41：分两段。L1–L4 基数 15（早期等级便宜，普通推进在 F2–F3 就能到 L5）；
   * L5 起基数仍 60（后期不加速，全图清完约 L9–L10，不把终局抬到无人区）。
   * D-40 实测旧曲线（全程 60）下 L5 要 600 经验、M1 全清必死 F2；本卡只改阈值，
   * 每级增量（+1/+1/+10/+0）与伤害公式都不动。
   * 两个基数挂在导出对象上，仅为 D-41 的负例能还原旧曲线（early=60）做同种子对照，正常游戏不改它。 */
  var EXP_EARLY_DEFAULT = 15;
  var EXP_LATE_DEFAULT = 60;
  function expBase(level) {
    var B = Game.Systems.Battle;
    var early = (B && typeof B.expEarlyBase === 'number') ? B.expEarlyBase : EXP_EARLY_DEFAULT;
    var late = (B && typeof B.expCurveBase === 'number') ? B.expCurveBase : EXP_LATE_DEFAULT;
    var base = (level < 5) ? early : late;
    return base > 0 ? base : EXP_EARLY_DEFAULT;
  }
  function expToNext(level) {
    var lv = (typeof level === 'number' && level >= 1) ? level : 1;
    return expBase(lv) * lv;
  }

  /* M8-6：exp 达标自动升级（可连续、溢出保留）；每级 atk+1/def+1/maxHp+10（L1 基础 10/5/100），
   * 升级回满 hp/mp。幂等：exp 不足时无变化，重复调用不重复升级。
   * 属性重算交给 Inventory.recalcEquip（基础属性随等级 + 装备加成），未加载时按成长公式兜底 */
  function checkLevelUp() {
    var p = Game.Data && Game.Data.Player;
    if (!p) return 0;
    if (typeof p.level !== 'number' || p.level < 1) p.level = 1;
    if (typeof p.exp !== 'number' || !isFinite(p.exp)) p.exp = 0;
    var oldLv = p.level, oldAtk = p.atk || 0, oldDef = p.def || 0, oldMax = p.maxHp || 0;
    var hpBeforeUp = p.hp; /* D-43：升级回满的实际回血量 = 新上限 − 旧 HP */
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
      logHp('heal', 'levelup', p.hp - hpBeforeUp, { level: p.level });
      /* P2-5：level 任务推进——只在确实升级时调用（ups>0），避免每战重复 */
      if (Game.Systems.Quest && typeof Game.Systems.Quest.progress === 'function') {
        Game.Systems.Quest.progress('level', p.level);
      }
      /* D-14：升级补一条文字提示（升到几级 + 哪些属性变了）。战斗内进日志，同时发提示条；
       * 战斗外（任务奖励经验触发升级）只发提示条，不触碰不存在的战斗日志。 */
      var upMsg = '升级！Lv.' + oldLv + ' → Lv.' + p.level +
        '（攻击+' + ((p.atk || 0) - oldAtk) + ' 防御+' + ((p.def || 0) - oldDef) +
        ' 生命上限+' + ((p.maxHp || 0) - oldMax) + '，HP/MP 已回满）';
      if (state && state.log) logPush(upMsg);
      if (Game.Core && Game.Core.EventBus) {
        Game.Core.EventBus.emit('ui:notice', { msg: upMsg, ok: true });
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
      logPush(state.monster.name + ' 发出怒吼，陷入狂暴。攻击与防御提升');
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

  /* D-16：时间轴事件登记（顺序断言读这里：player-hit 必须早于 monster-hit） */
  function pushEvent(kind, extra) {
    if (!state) return null;
    var ev = { kind: kind, at: now(), turn: state.roundNo };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) ev[k] = extra[k];
    if (!state.events) state.events = [];
    state.events.push(ev);
    if (state.events.length > 24) state.events.shift();
    var rec = state.turnRec;
    if (rec) {
      if (kind === 'player-hit') rec.playerAt = ev.at;
      else if (kind === 'monster-hit') rec.monsterAt = ev.at;
    }
    return ev;
  }

  /* D-16：一次命中的表现打包（顿帧/震屏/挤退/局部闪白/斩击弧）——纯视觉，Game.Fx 缺失时静默跳过 */
  function fxHit(who, dmg, opt) {
    var Fx = Game.Fx;
    if (!Fx || typeof Fx.hit !== 'function') return;
    var o = opt || {};
    var pos = (who === 'monster') ? monsterPos() : playerPos();
    Fx.hit({
      who: who,
      dir: (who === 'monster') ? -1 : 1,
      color: o.flash || (who === 'monster' ? '#ffffff' : '#ff6b6b'),
      slash: o.slash === false ? null : {
        x: pos.cx, y: pos.cy, r: 40,
        a0: (who === 'monster') ? -1.1 : 1.9,
        color: o.color || '#ffffff'
      }
    });
  }

  /* S3-4：仅在统一伤害入口触发反馈，不修改任何数值与 emit
   * M9-3：命中处同时生成 spark 粒子
   * D-16：登记时间轴事件 + 记录"上次行动"（战斗界面中段信息带用）+ 触发 Fx */
  function spawnHitMonster(dmg, opt) {
    var m = monsterPos();
    var heavy = isHeavy(dmg, state ? state.monster.maxHp : 0);
    var o = opt || {};
    pushEvent('player-hit', { dmg: dmg, heavy: heavy });
    if (state) {
      state.lastAction = { by: 'player', name: state.monster.name, dmg: dmg, heavy: heavy, at: now() };
    }
    if (Game.Feedback && typeof Game.Feedback.spawn === 'function') {
      Game.Feedback.spawn({
        x: m.cx, y: m.cy, text: '-' + dmg,
        color: heavy ? '#ffc14d' : '#ffffff',
        size: heavy ? 26 : 18, life: heavy ? 760 : 620
      });
    }
    fxHit('monster', dmg, { color: o.color, slash: o.slash !== false });
    if (Game.Particles && typeof Game.Particles.spawn === 'function') {
      Game.Particles.spawn('spark', m.cx, m.cy, o.color ? { count: 6, color: o.color } : { count: 6 });
    }
  }
  function spawnHurtPlayer(dmg) {
    var p = playerPos();
    var heavy = isHeavy(dmg, Game.Data.Player.maxHp);
    pushEvent('monster-hit', { dmg: dmg, heavy: heavy });
    if (state) {
      state.lastAction = { by: 'monster', name: state.monster.name, dmg: dmg, heavy: heavy, at: now() };
    }
    if (Game.Feedback && typeof Game.Feedback.spawn === 'function') {
      Game.Feedback.spawn({
        x: p.cx, y: p.cy, text: '-' + dmg,
        color: heavy ? '#ff8a3d' : '#ff5555',
        size: heavy ? 24 : 18
      });
    }
    fxHit('player', dmg, {});
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
    /* D-14：胜利日志——物品用中文名（取自 items.js 的 name），不再输出英文 id；
     * 多件物品写成「获得 N 件：A、B」，与经验/金币分行，不挤成一行。 */
    var dropNames = [];
    for (var di = 0; di < drops.length; di++) {
      var dit = (Game.Data.ITEMS) ? Game.Data.ITEMS[drops[di]] : null;
      dropNames.push((dit && dit.name) ? dit.name : drops[di]);
    }
    logPush('胜利！经验 +' + m.exp + ' 金币 +' + gold);
    if (dropNames.length === 1) logPush('获得：' + dropNames[0]);
    else if (dropNames.length > 1) logPush('获得 ' + dropNames.length + ' 件：' + dropNames.join('、'));
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
    /* D-19：无论伤害是否被护盾吃满，都登记一次「怪物反击发生」——用药/防御等
     * 非伤害行动的"该被反击就被反击"要靠这条事件证明，不能靠 monster-hit 是否出现。 */
    pushEvent('monster-attack');
    /* M8-2：狂暴后每回合 chance 概率用烈焰吐息替代普攻（伤害 = round(狂暴atk × dmgMul)） */
    var useBreath = !!(state.enraged && ed && ed.skill && Math.random() < ed.skill.chance);
    state.monsterActionAt = performance.now(); /* M9-3：怪物攻击前摇帧 */
    var atkVal = useBreath ? Math.round(monsterAtk() * ed.skill.dmgMul) : monsterAtk();
    var raw = state.defending ? Math.max(Math.floor(damage(atkVal, p.def) / 2), 1) : damage(atkVal, p.def);
    state.defending = false;
    if (useBreath) logPush(m.name + ' 喷出' + ed.skill.name + '。');
    /* M8-1：护盾先抵挡等量伤害（扣完归零），剩余伤害才进 HP */
    var absorbed = 0;
    if (state.shieldValue > 0) {
      absorbed = Math.min(state.shieldValue, raw);
      state.shieldValue -= absorbed;
    }
    var dmg = raw - absorbed;
    if (dmg > 0) {
      var hpBeforeHit = p.hp;
      p.hp = Math.max(p.hp - dmg, 0);
      /* D-43：按机制分账——二阶段技能记为 boss_skill，其余为 monster_attack；
       * 记账用实际掉血量（致死溢出不算），保证 hpIn−hpOut 能严格配平 */
      logHp('damage', useBreath ? 'boss_skill' : 'monster_attack', hpBeforeHit - p.hp, { monsterId: m.id });
      spawnHurtPlayer(dmg); /* S3-4：玩家受击反馈（仅展示，不改数值） */
    }
    if (absorbed > 0) {
      logHp('absorb', 'shield', absorbed, { monsterId: m.id });
      logPush('护盾抵挡了 ' + absorbed + ' 点伤害' + (state.shieldValue <= 0 ? '（护盾破碎）' : ''));
    }
    logPush(dmg > 0 ? m.name + ' 攻击了你，造成 ' + dmg + ' 伤害' : m.name + ' 的攻击被护盾完全抵挡');
    Game.Core.EventBus.emit('audio:play', { sfx: 'hit' });
    if (p.hp <= 0) {
      /* D-50：一次原地复活（仅 F5、仅本层第 1 次死亡、需定档形态）。见 systems/adaptive.js。
       * 不结束战斗、不重置怪物血量，只把玩家从 0 拉回；未启用时行为与 D-49 完全一致。 */
      var Ad = Game.Systems && Game.Systems.Adaptive;
      if (Ad && typeof Ad.reviveInPlace === 'function' && Ad.reviveInPlace(Pfloor())) {
        logPush('守夜人把你按回地上：「还没到闭眼的时候。」');
        return;
      }
      logPush('你被击败了…');
      Game.Core.EventBus.emit('audio:play', { sfx: 'lose' });
      Game.Core.EventBus.emit('battle:end', loseTelemetry());
    }
  }

  function Pfloor() { return (Game.Data.Player && Game.Data.Player.floor) || 1; }

  /* D-19：战斗内用药——候选严格限定为「消耗品 + 非卷轴 + 带 hp/mp 回复」。
   * 卷轴（S-03 强化）与装备不能在战斗中使用：前者作用于装备、属战斗外养成动作，
   * 后者不是消耗品；两者的判定都直接读 items.js 的 type/scroll 字段，不新造分类。
   * 选瓶口径（全部读 items.js 的 effect，不新造数值）：
   *   ① 先补 HP，HP 已满才补 MP；
   *   ② 同类里优先「够补满缺口且回复量最小」的那瓶（避免拿大药补小口）；
   *   ③ 没有一瓶够补满 → 用回复量最大的（先活下来）。
   * 返回 { id, item, gain, key } 或 null。 */
  function combatPotions(key) {
    var inv = (Game.Data.Player && Game.Data.Player.inventory) || {};
    var out = [];
    for (var id in inv) {
      if (!Object.prototype.hasOwnProperty.call(inv, id) || inv[id] <= 0) continue;
      var it = Game.Data.ITEMS && Game.Data.ITEMS[id];
      if (!it || it.type !== 'consumable' || it.scroll === true) continue;
      var gain = (it.effect && it.effect[key]) || 0;
      if (gain > 0) out.push({ id: id, item: it, gain: gain, key: key });
    }
    return out;
  }

  function pickBattlePotion() {
    var p = Game.Data.Player;
    var needHp = (p.maxHp || 0) - (p.hp || 0);
    var needMp = (p.maxMp || 0) - (p.mp || 0);
    function choose(list, need) {
      if (!list.length) return null;
      var best = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].gain >= need && (!best || list[i].gain < best.gain)) best = list[i];
      }
      if (best) return best;
      for (var j = 0; j < list.length; j++) {
        if (!best || list[j].gain > best.gain) best = list[j];
      }
      return best;
    }
    if (needHp > 0) { var h = choose(combatPotions('hp'), needHp); if (h) return h; }
    if (needMp > 0) { var m = choose(combatPotions('mp'), needMp); if (m) return m; }
    return null;
  }

  /* D-19：战斗内提示统一走 D-14 的 ui:notice（notice.js 是唯一订阅方），不另造通道 */
  function notice(msg, ok) {
    if (Game.Core && Game.Core.EventBus && typeof Game.Core.EventBus.emit === 'function') {
      Game.Core.EventBus.emit('ui:notice', { msg: msg, ok: ok === true });
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
        if (dmg > 0) {
          var hpBeforeTick = p.hp;
          p.hp = Math.max(p.hp - dmg, 0);
          logHp('damage', 'status:' + id, hpBeforeTick - p.hp);
        }
        left -= 1;
        if (left > 0) p.status[id] = left; else delete p.status[id];
        res.push({ id: id, name: (def ? def.name : id), dmg: dmg, left: left });
      }
      if (res.length && p.hp <= 0) {
        Game.Core.EventBus.emit('audio:play', { sfx: 'lose' });
        Game.Core.EventBus.emit('battle:end', loseTelemetry());
      }
      return res;
    }
  };

  /* D-16：玩家段结束——把怪物段排到 seg1 之后（不锁死输入、不用 setTimeout 链） */
  function scheduleMonster(t0) {
    if (!state) return;
    state.pending = { due: t0 + TL.seg1 };
    state.phase = 'monster';
  }

  /* D-16：怪物段结算/反馈（由 tick 在到点时调用；catch-up 时由 playerAction 提前调用） */
  function runMonsterSegment(at) {
    if (!state || !state.pending) return;
    var rec = state.turnRec;
    if (rec) rec.monsterAt = Math.max(at, rec.playerAt);
    state.pending = null;
    state.phase = 'monster';
    monsterTurn();
    if (state.dying) state.phase = 'dead';
  }

  /* ── D-23：死亡归因遥测（纯只读）──────────────────────────────
   * 只把"死亡当场已经存在的状态"复制成事件字段：不参与命中/伤害/回合顺序判断，
   * 不写存档、不加 UI。取不到的字段一律 null（键始终存在，不抛错、不省略）。
   * over：非战斗致死（陷阱）显式把战斗相关字段压成 null，避免把上一场残留的怪
   *       错记成本次凶手——宁可写 null，也不编。 */
  function numOrNull(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
  function idOrNull(v) { return (typeof v === 'string' && v) ? v : null; }
  function healPotionCount() {
    var inv = (Game.Data.Player && Game.Data.Player.inventory) || {};
    var n = 0;
    for (var id in inv) {
      if (!Object.prototype.hasOwnProperty.call(inv, id)) continue;
      var qty = inv[id];
      var it = Game.Data.ITEMS && Game.Data.ITEMS[id];
      if (!it || it.type !== 'consumable' || it.scroll === true) continue;
      if (!(it.effect && it.effect.hp > 0)) continue;
      if (typeof qty !== 'number' || qty <= 0) continue;
      n += qty;
    }
    return n;
  }
  function loseTelemetry(over) {
    var p = (Game.Data && Game.Data.Player) || null;
    var m = (state && state.monster) ? state.monster : null;
    var eq = (p && p.equipment) || {};
    var t = {
      result: 'lose',
      source: m ? 'battle' : 'other',
      monsterId: m ? idOrNull(m.id) : null,
      monsterName: m ? idOrNull(m.name) : null,
      floor: numOrNull(p && p.floor),
      playerLevel: numOrNull(p && p.level),
      roundNo: state ? numOrNull(state.roundNo) : null,
      hpAtDeath: numOrNull(p && p.hp),
      maxHp: numOrNull(p && p.maxHp),
      potionsLeft: healPotionCount(),
      weaponId: idOrNull(eq.weapon),
      armorId: idOrNull(eq.armor)
    };
    if (over) {
      for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) t[k] = over[k];
    }
    return t;
  }

  Game.Systems.Battle = {
    /* D-23：暴露只读快照构造器（验证页用它构造空值场景；游戏内只由下面两处 lose 调用） */
    loseTelemetry: loseTelemetry,

    /* D-16：时间轴参数（只读；验证页据此断言预算） */
    timeline: function () { return { seg1: TL.seg1, lock: TL.lock, total: TL.total }; },

    start: function (monsterId) {
      var def = Game.Data.MONSTERS[monsterId];
      state = {
        monster: { id: def.id, name: def.name, hp: def.hp, maxHp: def.hp, atk: def.atk, def: def.def, exp: def.exp, gold: def.gold, drops: def.drops, color: def.color, enrage: def.enrage },
        log: ['遭遇 ' + def.name + '，战斗开始'],
        turn: 0,
        defending: false,
        shieldValue: 0, /* M8-1：本次战斗临时护盾 */
        enraged: false, /* M8-2：狂暴二阶段标记 */
        enrageAtk: 0,
        enrageDef: 0,
        /* D-16：分段表现状态机 */
        phase: 'idle',   /* idle=可输入 / player=玩家段 / monster=怪物段 / dead=消散中 */
        roundNo: 1,      /* 当前回合号（1 起） */
        pending: null,   /* { due } 待播放的怪物段 */
        buffered: null,  /* 输入锁期间缓冲的一条指令 */
        lockUntil: 0,
        turnRec: null,   /* 回合时间轴记录（时长断言读这里） */
        events: [],      /* [{kind:'player-hit'|'monster-hit', at, turn, dmg, heavy}] */
        lastAction: null
      };
      /* M8-1：新战斗冷却清零（战斗外残留冷却不带到本场） */
      if (Game.Skills && typeof Game.Skills.resetCooldowns === 'function') Game.Skills.resetCooldowns();
      Game.Core.EventBus.emit('battle:start', { monsterId: monsterId });
      return state;
    },

    playerAction: function (cmd) {
      if (!state) return null;
      if (state.dying) return state; /* M9-3：消散期间不接受任何操作 */
      var t0 = now();
      /* D-16：上一回合的怪物段还没播完（只可能来自直接 API 调用；正常输入被锁挡住）→ 先补结算，
       * 保证"一次行动 = 一个回合"，不会把两次玩家行动压到同一时间轴。 */
      if (state.pending) runMonsterSegment(state.pending.due);
      if (state.dying || Game.Data.Player.hp <= 0) return state;
      /* D-19：用药先判可用性——不可用时不占回合、不上输入锁、不消耗（提示走 ui:notice）。
       * 判定放在回合起拍之前，避免"按了没用的键"也被算成一次行动。 */
      if (cmd === 'item' && !pickBattlePotion()) {
        var pc = Game.Data.Player;
        var why;
        if ((pc.hp || 0) >= (pc.maxHp || 0) && (pc.mp || 0) >= (pc.maxMp || 0)) {
          why = '生命与魔法都已满，不需要用药';
        } else if (!combatPotions('hp').length && !combatPotions('mp').length) {
          why = '背包里没有可用的药剂（卷轴与装备不能在战斗中使用）';
        } else {
          why = '没有适合当前状态的药剂';
        }
        logPush(why);
        notice(why, false);
        return state;
      }
      /* D-16：回合起拍——登记时间轴（顺序/时长断言读 turnRec 与 events） */
      state.roundNo = (state.turn | 0) + 1;
      state.phase = 'player';
      state.lockUntil = t0 + TL.lock;
      state.turnRec = {
        id: ++turnSeq, startedAt: t0, playerAt: t0, monsterAt: 0,
        unlockAt: 0, endedAt: 0, presentMs: 0, lockMs: 0,
        planMs: TL.total, lockPlanMs: TL.lock, finalizeAt: t0 + TL.total, settled: false
      };
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
          state.phase = 'idle';
          return state;
        }
        Game.Core.EventBus.emit('audio:play', { sfx: 'hit' });
        scheduleMonster(t0);
      } else if (cmd === 'skill:fireball' || cmd === 'skill:dash' || cmd === 'skill:shield') {
        skillId = cmd.slice(6); /* 'skill:'.length === 6 */
        state.playerActionAt = performance.now(); /* M9-3：动作帧复用玩家前摇 */
        /* Skills.cast 负责校验 MP/冷却并触发效果；失败时不进入行动序列、不推进冷却 */
        var castOk = Game.Skills && typeof Game.Skills.cast === 'function' && Game.Skills.cast(skillId);
        if (!castOk) { state.phase = 'idle'; state.lockUntil = 0; return state; }
        if (state.dying || state.monster.hp <= 0) { /* 技能击杀：消散中，怪物不反击 */
          Game.Skills.tick(skillId);
          state.phase = 'idle';
          return state;
        }
        scheduleMonster(t0);
      } else if (cmd === 'defend') {
        state.defending = true;
        Game.Core.EventBus.emit('audio:play', { sfx: 'defend' });
        logPush('你进入防御姿态，本回合减伤 50%');
        scheduleMonster(t0);
      } else if (cmd === 'item') {
        /* D-19：用药 = 一个回合行动。数值全部由 Inventory.use 按 items.js 的 effect 结算，
         * 这里只负责"消耗一瓶 + 记事件 + 让怪物照常反击"，不写第二套回复逻辑。 */
        var pIt = Game.Data.Player;
        var sel = pickBattlePotion();
        var before = { hp: pIt.hp, mp: pIt.mp };
        var useRes = Game.Systems.Inventory.use(sel.id);
        if (!useRes.ok) {   /* 兜底：probe 已排除；真出现也不吞回合、不锁输入 */
          logPush(useRes.msg);
          notice(useRes.msg, false);
          state.phase = 'idle';
          state.lockUntil = 0;
          state.turnRec = null;
          return state;
        }
        var dHp = Math.max(0, pIt.hp - before.hp);
        var dMp = Math.max(0, pIt.mp - before.mp);
        pushEvent('player-item', { itemId: sel.id, hp: dHp, mp: dMp });
        logPush(useRes.msg);
        notice(useRes.msg, true);
        scheduleMonster(t0);   /* 与攻击/防御同一时序：怪物段照常反击 */
      } else if (cmd === 'run') {
        if (Math.random() < 0.5) {
          Game.Core.EventBus.emit('audio:play', { sfx: 'run' });
          logPush('你成功逃离了战斗');
          state.phase = 'idle';
          state.pending = null;
          Game.Core.EventBus.emit('battle:end', { result: 'run' });
        } else {
          logPush('逃跑失败，怪物立刻反击。');
          scheduleMonster(t0);
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

    /* M8-6：升级成长接口（供 quest.js 任务奖励后调用与验证页断言）
     * D-41：expEarlyBase（L1–L4）/ expCurveBase（L5+）是本卡改动的唯一数值入口，
     * 默认 15 / 60；验证页可把 early 赋 60 复现旧曲线（全程 60） */
    expToNext: expToNext,
    expEarlyBase: EXP_EARLY_DEFAULT,
    expCurveBase: EXP_LATE_DEFAULT,
    /* D-43：血量账钩子（验证/测量页注入；传 null 关闭）。手动用药与陷阱的记账点
     * 分别在 inventory.js / map.js，统一调用这里，保证"一处口径" */
    _setHpLog: function (fn) { hpLog = (typeof fn === 'function') ? fn : null; return !!hpLog; },
    _logHp: logHp,
    checkLevelUp: checkLevelUp,

    /* M8-1：技能伤害落地（由 Game.Skills.cast 调用）——倍率版既有伤害公式
     * 伤害 = max(round(atk × 倍率) - 敌方 def, 1)；命中反馈/音效/胜利结算复用既有通道 */
    applySkillDamage: function (id, def) {
      if (!state || state.dying) return;
      var p = Game.Data.Player;
      var dmg = Math.max(def.dmg(p.atk) - monsterDef(), 1);
      Game.Core.EventBus.emit('audio:play', { sfx: 'attack' });
      state.monster.hp -= dmg;
      /* D-16：技能命中带元素色（斩击弧/粒子用色区分技能归属，不做额外帧动画） */
      spawnHitMonster(dmg, {
        color: (Game.Fx && typeof Game.Fx.skillColor === 'function') ? Game.Fx.skillColor(id) : null
      });
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

    /* D-16：输入是否处于锁定（玩家段→怪物段的表现窗口内）。
     * 锁定期间按键由调用方 bufferCommand 缓冲一条，解锁后由 tick 执行一次。 */
    isInputLocked: function () {
      if (!state || state.dying) return false;
      return now() < state.lockUntil;
    },

    /* D-16：缓冲一条指令（不覆盖先按的：先按的意图优先，且保证解锁后只执行一次） */
    bufferCommand: function (cmd) {
      if (!state || state.dying || !cmd) return false;
      if (state.buffered) return false;
      state.buffered = cmd;
      return true;
    },

    /* D-16：时间轴快照（顺序/时长/输入锁断言读这里） */
    getTimeline: function () {
      if (!state) return null;
      var rec = state.turnRec;
      return {
        id: rec ? rec.id : 0,
        turn: state.turn,
        round: state.roundNo,
        phase: state.phase,
        locked: this.isInputLocked(),
        buffered: state.buffered || null,
        plan: { seg1: TL.seg1, lock: TL.lock, total: TL.total },
        rec: rec ? {
          startedAt: rec.startedAt, playerAt: rec.playerAt, monsterAt: rec.monsterAt,
          unlockAt: rec.unlockAt, endedAt: rec.endedAt,
          presentMs: rec.presentMs, lockMs: rec.lockMs,
          planMs: rec.planMs, lockPlanMs: rec.lockPlanMs
        } : null,
        events: (state.events || []).slice(-10)
      };
    },

    /* D-16：立即结算待播放的怪物段并收尾本回合。
     * 主循环里由 tick 按时间推进；只有"不走帧循环、直接调 playerAction"的调用方（验证页/脚本）才需要它。 */
    flush: function () {
      if (!state) return null;
      if (state.pending) runMonsterSegment(state.pending.due);
      var rec = state.turnRec;
      if (rec && !rec.settled) {
        rec.settled = true;
        rec.endedAt = now();
        rec.presentMs = rec.endedAt - rec.startedAt;
        if (!state.dying) state.phase = 'idle';
      }
      return state;
    },

    /* D-16：注入时钟（验证页用；null 还原为 performance.now） */
    _setClock: function (fn) { clock = (typeof fn === 'function') ? fn : null; return clock; },
    /* D-51：暂停恢复——把"暂停期间流逝的真实时长"一次性补进偏移量。
     * 恢复后的第一帧 now() 仍等于暂停前的时刻，pending/lockUntil/finalizeAt 的剩余量分毫不动，
     * 因此不会跳帧、不会把怪物段补结算两次，输入锁也照原样继续倒数。 */
    _shiftClock: function (ms) {
      if (typeof ms === 'number' && isFinite(ms) && ms > 0) timeOffset += ms;
      return timeOffset;
    },
    _clockOffset: function () { return timeOffset; },
    /* D-51：重新初始化/新页测试时清掉暂停偏移与帧钟（生产环境只在 init 调一次） */
    _resetClock: function () { timeOffset = 0; frameNow = null; return timeOffset; },
    /* D-51：离开战斗（暂停 → 返回主菜单 / 放弃本局）时静默终止本场战斗。
     * 不发 battle:end，因此不结算胜负、不给奖励、不触发死亡；地图上的怪物保持原样。 */
    abort: function () {
      if (!state) return false;
      state = null;
      pendingWin = null;
      return true;
    },
    isActive: function () { return !!state; },
    /* D-16：验证用——临时改时间轴参数（负例：seg1=0 即把两段合回同一帧，顺序断言必须 FAIL） */
    _setTimeline: function (o) {
      if (o && typeof o.seg1 === 'number') TL.seg1 = o.seg1;
      if (o && typeof o.lock === 'number') TL.lock = o.lock;
      if (o && typeof o.total === 'number') TL.total = o.total;
      return { seg1: TL.seg1, lock: TL.lock, total: TL.total };
    },
    _now: now,

    /* M9-3：推进死亡消散计时；消散结束后发出 battle:end（此前结算已执行）
     * D-16：同时推进回合时间轴——怪物段到点结算、输入锁到点解锁并执行缓冲指令、回合表现收尾 */
    tick: function (ts) {
      if (typeof ts === 'number' && isFinite(ts)) frameNow = ts;  /* 与主循环同钟 */
      if (!state) return;
      var t = now();
      /* 1) 怪物段到点 → 结算/反馈（玩家伤害与怪物反击因此分属两帧） */
      if (state.pending && t >= state.pending.due) runMonsterSegment(state.pending.due);
      if (!state) return;
      /* 2) 输入锁到点 → 记录实测解锁时刻 */
      var rec = state.turnRec;
      if (rec && !rec.unlockAt && t >= state.lockUntil) {
        rec.unlockAt = t;
        rec.lockMs = t - rec.startedAt;
      }
      /* 3) 整回合表现收尾 → 记录实测总时长，回到可输入相位 */
      if (rec && !rec.settled && t >= rec.finalizeAt) {
        rec.settled = true;
        rec.endedAt = t;
        rec.presentMs = t - rec.startedAt;
        if (!state.dying) state.phase = 'idle';
      }
      /* 4) 解锁 → 缓冲的一条指令执行一次（不丢弃、不重复） */
      if (state.buffered && t >= state.lockUntil && !state.dying && Game.Data.Player.hp > 0) {
        var cmd = state.buffered;
        state.buffered = null;
        Game.Systems.Battle.playerAction(cmd);
      }
      if (!state) return;
      /* 5) 死亡消散（沿用真实时钟，与 M9-3 的既有断言一致） */
      if (!state.dying) return;
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
