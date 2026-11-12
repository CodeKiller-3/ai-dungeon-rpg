/* js/systems/adaptive.js — D-49 自适应难度与兜底救援
 * 契约：
 *   Game.Systems.Adaptive.setEnabled(bool) / isEnabled()
 *   Game.Systems.Adaptive.reset()             // 新局清零（restart/新档）
 *   Game.Systems.Adaptive.normalize(state)    // 旧档缺字段补默认
 *   Game.Systems.Adaptive.onDeath(floor)      // 战斗失败时调用；返回 null 表示不救（走原死亡流程）
 *   Game.Systems.Adaptive.onFloorArrived(prevFloor) // 层间落点调用；出口血 <20% 时补给
 *   Game.Systems.Adaptive.snapshot()          // 只读遥测（bot/验证页用）
 * 约束：
 *   - 只在死亡结算与换层落点触发，战斗中不塞东西
 *   - 单局触发 ≤2 次；发放物的金币等价总和 ≤150
 *   - 救援装备 sword_rescue 不进商店/宝箱/掉落，也不计入 ITEMS 的可枚举统计
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var GEAR_ID = 'sword_rescue';
  var GEAR_ATK = 13;
  var GEAR_VALUE = 90;      /* 与 60/120/150 口径对齐：60 金币档 + 90 装备档 = 150 上限 */
  var MAX_TRIGGERS = 2;
  var MAX_VALUE = 150;
  var LOW_HP = 0.2;

  /* D-50 定档形态（F5 专用）：一次原地复活。
   *   - 只在 F5 的**第 1 次**死亡触发：不结束战斗、不重置怪物血量，玩家回到 60% 血继续打；
   *     第 2 次死亡仍走 D-49 的「重生 + 60 金币等价补给」。
   *   - 不发物品（本次计入触发次数，金币等价 0）；本局发放物总额仍受 150 硬夹。
   *   - 候选对照（d50a–d50l）的实测数据在 docs/平衡定档.md，代码里只留定档这一种。 */
  var F5_PACK = {
    d50: { inplace: true, first: true, back: 0.6 }
  };

  var enabled = true;
  /* 救助形态开关：'d49' = 还原 D-49（verify_d50 C 组的负例）；'d50' = 本卡定档 */
  var form = 'd50';

  function P() { return Game.Data && Game.Data.Player; }
  function items() { return (Game.Data && Game.Data.ITEMS) || {}; }

  function normalize(s) {
    var o = (s && typeof s === 'object') ? s : {};
    if (!o.deaths || typeof o.deaths !== 'object') o.deaths = {};
    if (typeof o.triggers !== 'number' || !isFinite(o.triggers)) o.triggers = 0;
    if (typeof o.spent !== 'number' || !isFinite(o.spent)) o.spent = 0;
    if (!o.log || typeof o.log !== 'object') o.log = [];
    if (!o.trace || typeof o.trace !== 'object') o.trace = [];
    if (typeof o.gearGranted !== 'boolean') o.gearGranted = false;
    return o;
  }

  function state() {
    var p = P();
    if (!p) return null;
    p.adaptive = normalize(p.adaptive);
    return p.adaptive;
  }

  function totalDeaths(s) {
    var n = 0;
    for (var k in s.deaths) {
      if (Object.prototype.hasOwnProperty.call(s.deaths, k)) n += (s.deaths[k] || 0);
    }
    return n;
  }

  function trace(s, entry) {
    s.trace.push(entry);
    if (s.trace.length > 60) s.trace.splice(0, s.trace.length - 60);
  }

  function notice(msg) {
    if (Game.Core && Game.Core.EventBus) Game.Core.EventBus.emit('ui:notice', { msg: msg });
  }

  function addPotion(id, n) {
    var I = Game.Systems.Inventory;
    if (I && typeof I.add === 'function') return I.add(id, n);
    return false;
  }

  function equipGear(p) {
    var I = Game.Systems.Inventory;
    if (p.inventory[GEAR_ID]) p.inventory[GEAR_ID] += 1;
    else p.inventory[GEAR_ID] = 1;
    var cur = p.equipment && p.equipment.weapon ? items()[p.equipment.weapon] : null;
    var curAtk = (cur && cur.effect && cur.effect.atk) || 0;
    if (!cur || curAtk < GEAR_ATK) {
      p.equipment = p.equipment || {};
      p.equipment.weapon = GEAR_ID;
      if (I && typeof I.recalcEquip === 'function') I.recalcEquip();
    }
  }

  /* 发放一级/二级/三级救助。返回 { id, value, text }；不写 triggers/spent（由调用方统一记账）。 */
  function grant(level, floor, p) {
    var s = state();
    if (level === 1) {
      addPotion('potion_small', 2);
      return { id: 'potion_small x2', value: 20, text: '两瓶小血瓶' };
    }
    if (level === 2) {
      p.gold += 60;
      return { id: 'gold 60', value: 60, text: '60 金币' };
    }
    /* 三级：救援装备。只在 1–4 层、未发过、当前武器确实更差时发；
     * F5 的可买到最好档已是 atk16（= 现有最强档），没有"之间"的档位，改发补给。 */
    var cur = p.equipment && p.equipment.weapon ? items()[p.equipment.weapon] : null;
    var curAtk = (cur && cur.effect && cur.effect.atk) || 0;
    if (floor <= 4 && !s.gearGranted && curAtk < GEAR_ATK) {
      equipGear(p);
      s.gearGranted = true;
      return { id: GEAR_ID, value: GEAR_VALUE, text: '守夜人的旧剑（攻击 +' + GEAR_ATK + '）' };
    }
    /* D-49 原口径：没有"中间档"可发（F5 可买最好=最强 atk16，或当前武器已不差）→ 等值 60 的补给包 */
    addPotion('potion_large', 1);
    addPotion('potion_small', 2);
    return { id: 'potion_large x1 + potion_small x2', value: 60, text: '一大两小血瓶' };
  }

  function pushLog(s, entry) {
    s.log.push(entry);
    if (s.log.length > 20) s.log.splice(0, s.log.length - 20);
  }

  function trigger(level, floor, reason, hpRatio, s) {
    var p = P();
    var g = grant(level, floor, p);
    /* 预算护栏：理论最大值 20+90/60+90=150；这里再做一次硬夹，任何组合都不越线 */
    if (s.spent + g.value > MAX_VALUE) {
      var remain = MAX_VALUE - s.spent;
      if (remain > 0) {
        p.gold += remain;
        g = { id: 'gold ' + remain, value: remain, text: remain + ' 金币' };
      } else {
        g = { id: 'none', value: 0, text: '（预算已用尽）' };
      }
    }
    s.triggers += 1;
    s.spent += g.value;
    var entry = {
      at: reason, floor: floor, level: level, grant: g.id, value: g.value,
      hpRatio: Math.round(hpRatio * 100) / 100, trigger: s.triggers
    };
    pushLog(s, entry);
    trace(s, { at: reason, floor: floor, ok: true, level: level, grant: g.id, value: g.value });
    return { level: level, grant: g, entry: entry };
  }

  var MSG = {
    1: function (n) { return '楼梯口的守夜人递来两瓶小血瓶：「刚才那一下够狠，先活着。」（自适应救援 ' + n + '/2 · 补给）'; },
    2: function (n) { return '守夜人塞来 60 金币：「买点保命的，别硬撑。」（自适应救援 ' + n + '/2 · 金币）'; },
    3: function (n) { return '守夜人把自己的旧剑按进你手里（攻击 +' + GEAR_ATK + '）：「拿着，活着下去比什么都强。」（自适应救援 ' + n + '/2 · 救援装备）'; },
    f5: function (n, g) { return '守夜人把整包药塞给你（' + g.text + '）：「龙不等人，喝完再上。」（自适应救援 ' + n + '/2 · 补给）'; },
    revive: function (n) { return '守夜人把你从地上拽起来：「药留到最后一口气再用。」（自适应救援 ' + n + '/2 · 复活）'; }
  };

  Game.Systems.Adaptive = {
    MAX_TRIGGERS: MAX_TRIGGERS,
    MAX_VALUE: MAX_VALUE,
    LOW_HP: LOW_HP,
    GEAR_ID: GEAR_ID,
    GEAR_ATK: GEAR_ATK,
    GEAR_VALUE: GEAR_VALUE,

    setEnabled: function (b) { enabled = !!b; return enabled; },
    isEnabled: function () { return enabled; },
    /* D-50：'d49' 还原旧形态（负例）；'d50a'/'d50b'/'d50c' 为候选 */
    setForm: function (f) { form = (f === 'd49' || F5_PACK[f]) ? f : 'd50'; return form; },
    getForm: function () { return form; },
    F5_PACK: F5_PACK,

    reset: function () {
      var p = P();
      if (!p) return null;
      p.adaptive = normalize(null);
      return p.adaptive;
    },

    normalize: normalize,

    /* 战斗失败：先记死亡；首次死亡 → 一级；累计第 2 次死亡（含同层连续 2 次）→ 三级。
     * 返回 null 表示不救，交回原死亡/清档流程。 */
    onDeath: function (floor) {
      var s = state();
      if (!s) return null;
      var f = String(floor || 1);
      s.deaths[f] = (s.deaths[f] || 0) + 1;
      var p = P();
      var ratio = (p.maxHp > 0) ? Math.max(0, p.hp) / p.maxHp : 0;
      if (!enabled) {
        trace(s, { at: 'death', floor: floor, ok: false, why: 'disabled', deaths: s.deaths[f] });
        return null;
      }
      if (s.triggers >= MAX_TRIGGERS) {
        trace(s, { at: 'death', floor: floor, ok: false, why: 'budget', deaths: s.deaths[f] });
        return null;
      }
      var weak = (s.deaths[f] >= 2) || (totalDeaths(s) >= 2);
      var level = weak ? 3 : 1;
      var r = trigger(level, floor, 'death', ratio, s);
      /* 复活：一级 50%；三级 60%（F5 形态按 F5_PACK.back） */
      var f5form = (floor >= 5 && form !== 'd49') ? F5_PACK[form] : null;
      var back = (level >= 3) ? (f5form ? f5form.back : 0.6) : 0.5;
      p.hp = Math.max(1, Math.ceil(p.maxHp * back));
      p.status = {};
      if (Game.Systems.Map && typeof Game.Systems.Map.getSpawn === 'function') {
        var sp = Game.Systems.Map.getSpawn();
        p.x = sp.x; p.y = sp.y;
      }
      if (Game.Motion && typeof Game.Motion.clear === 'function') Game.Motion.clear();
      if (Game.Particles && typeof Game.Particles.clear === 'function') Game.Particles.clear();
      var msg = f5form
        ? (r.grant.value === 0 ? MSG.revive(r.entry.trigger) : MSG.f5(r.entry.trigger, r.grant))
        : ((MSG[level] || MSG[1])(r.entry.trigger));
      notice(msg + ' 生命恢复至 ' + Math.round(back * 100) + '%。');
      return { level: level, grant: r.grant, entry: r.entry, hp: p.hp };
    },

    /* D-50：一次原地复活。由 battle.js 在「玩家 HP 归零、即将判定失败」时调用。
     * 条件：定档形态 + F5 + 本层第 1 次死亡（第 2 次仍交给 onDeath）+ 触发未满。
     * 返回 true 时战斗继续、怪物血量保留；返回 false 时战斗照旧结束。 */
    reviveInPlace: function (floor) {
      var s = state();
      if (!s || !enabled) return false;
      var pack = (form !== 'd49') ? F5_PACK[form] : null;
      if (!pack || !pack.inplace) return false;
      var f = String(floor || 1);
      if (+f < 5) return false;
      var prior = s.deaths[f] || 0;
      if (pack.first && prior >= 1) return false;
      if (s.triggers >= MAX_TRIGGERS) return false;
      var p = P();
      s.deaths[f] = (s.deaths[f] || 0) + 1;
      var weak = (s.deaths[f] >= 2) || (totalDeaths(s) >= 2);
      var level = weak ? 3 : 1;
      /* 定档形态不发物品：金币等价 0，只占一次触发名额 */
      var g = { id: 'none', value: 0, text: '（原地复活）' };
      s.triggers += 1;
      var entry = { at: 'death-inplace', floor: +f, level: level, grant: g.id, value: 0,
        hpRatio: 0, trigger: s.triggers };
      pushLog(s, entry);
      trace(s, { at: 'death-inplace', floor: +f, ok: true, level: level, grant: g.id, value: 0 });
      var back = pack.back;
      p.hp = Math.max(1, Math.ceil(p.maxHp * back));
      p.status = {};
      notice(MSG.revive(entry.trigger) + ' 生命恢复至 ' + Math.round(back * 100) + '%，战斗继续。');
      return true;
    },

    /* 层间落点：上一层出口血 <20% → 二级（60 金币）。不复活、不打断。 */
    onFloorArrived: function (prevFloor) {
      var s = state();
      if (!s) return null;
      var p = P();
      var ratio = (p.maxHp > 0) ? Math.max(0, p.hp) / p.maxHp : 1;
      /* 新层的"同层连续死亡"从 0 起算 */
      s.deaths[String(p.floor)] = 0;
      if (!enabled) {
        trace(s, { at: 'floor', floor: prevFloor, ok: false, why: 'disabled', hpRatio: ratio });
        return null;
      }
      if (ratio >= LOW_HP) {
        trace(s, { at: 'floor', floor: prevFloor, ok: false, why: 'hp-ok', hpRatio: Math.round(ratio * 100) / 100 });
        return null;
      }
      if (s.triggers >= MAX_TRIGGERS) {
        trace(s, { at: 'floor', floor: prevFloor, ok: false, why: 'budget', hpRatio: ratio });
        return null;
      }
      var r = trigger(2, prevFloor, 'floor-low-hp', ratio, s);
      notice(MSG[2](r.entry.trigger));
      return { level: 2, grant: r.grant, entry: r.entry };
    },

    snapshot: function () {
      var s = state();
      if (!s) return null;
      return {
        enabled: enabled, triggers: s.triggers, spent: s.spent, gearGranted: s.gearGranted,
        deaths: JSON.parse(JSON.stringify(s.deaths)), log: JSON.parse(JSON.stringify(s.log)),
        trace: JSON.parse(JSON.stringify(s.trace))
      };
    }
  };
})();
