/* js/systems/inventory.js — 背包与装备系统
 * 接口：use / equip / add / remove / recalcEquip（见 PLAN.md §4.4）
 * 来源：参考 freeCodeCamp RPG 教程重构（自写实现）
 * 事件：inventory:changed */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  function notify() {
    Game.Core.EventBus.emit('inventory:changed', {
      inventory: Game.Data.Player.inventory,
      equipment: Game.Data.Player.equipment
    });
  }

  /* D-28：强化后的实际数值——基础值 + 每级 10%、向上取整，等级 n∈[0,5]。
   * recalcEquip 与弹窗（背包行徽标 / 页头摘要）共用这一份公式，避免两处漂移。 */
  function effValue(base, plus) {
    var b = Number(base) || 0;
    var n = Math.min(Math.max(Number(plus) || 0, 0), 5);
    return b + (b ? Math.ceil(b * n * 0.1) : 0);
  }

  Game.Systems.Inventory = {
    effValue: effValue,
    /* 使用消耗品（P2-2：新增 effect.mp 回蓝分支，与 hp 同构；满 MP 时拒绝使用蓝瓶）
     * S-03：scroll:true 的卷轴走 upgrade()，不消耗血量逻辑 */
    use: function (id) {
      var p = Game.Data.Player;
      var item = Game.Data.ITEMS[id];
      if (!item || item.type !== 'consumable') return { ok: false, msg: '不是消耗品' };
      if (!p.inventory[id] || p.inventory[id] <= 0) return { ok: false, msg: '没有该物品' };
      if (item.scroll === true) {
        var up = this.upgrade();
        if (!up.ok) return up;
        p.inventory[id]--;
        if (p.inventory[id] === 0) delete p.inventory[id];
        notify();
        return up;
      }
      var hpGain = item.effect.hp || 0;
      var mpGain = item.effect.mp || 0;
      /* D-14：满血喝红瓶一律拒绝（不再允许满血浪费）；蓝瓶同理，口径统一为「已满则拒绝并提示」。
       * 同时回 HP+MP 的药剂，只有两者都已满时才拒绝。 */
      if (hpGain > 0 && p.hp >= p.maxHp && (mpGain === 0 || p.mp >= p.maxMp)) {
        return { ok: false, msg: '生命已满，无需使用 ' + item.name };
      }
      if (mpGain > 0 && p.mp >= p.maxMp) return { ok: false, msg: '魔法已满，无需使用 ' + item.name };
      var hpBefore = p.hp;
      p.hp = Math.min(p.hp + hpGain, p.maxHp);
      p.mp = Math.min((p.mp || 0) + mpGain, p.maxMp);
      /* D-43：血量账——只记实际恢复量（满血部分被钳掉的不算） */
      if (p.hp > hpBefore) {
        var B = Game.Systems.Battle;
        if (B && typeof B._logHp === 'function') B._logHp('heal', 'potion', p.hp - hpBefore, { itemId: id });
      }
      p.inventory[id]--;
      if (p.inventory[id] === 0) delete p.inventory[id];
      /* D-52：真实喝下的药剂计数（卷轴走上面的分支，不计入） */
      if (Game.Core && Game.Core.Main && typeof Game.Core.Main._notePotion === 'function') {
        Game.Core.Main._notePotion();
      }
      notify();
      var msg = '使用 ' + item.name + '，';
      if (hpGain > 0 && mpGain > 0) msg += '回复 ' + hpGain + ' HP、' + mpGain + ' MP';
      else if (mpGain > 0) msg += '回复 ' + mpGain + ' MP';
      else msg += '回复 ' + hpGain + ' HP';
      return { ok: true, msg: msg };
    },

    /* 装备武器/防具 */
    equip: function (id) {
      var p = Game.Data.Player;
      var item = Game.Data.ITEMS[id];
      if (!item) return { ok: false, msg: '物品不存在' };
      if (item.type !== 'weapon' && item.type !== 'armor') return { ok: false, msg: '不可装备' };
      if (!p.inventory[id] || p.inventory[id] <= 0) return { ok: false, msg: '没有该物品' };
      if (item.type === 'weapon') p.equipment.weapon = id;
      else p.equipment.armor = id;
      this.recalcEquip();
      notify();
      return { ok: true, msg: '装备了 ' + item.name };
    },

    /* S-03：强化卷轴结算——给"当前装备中强化等级较低者" +1（等级相同优先武器）；
     * 只装一件则升那件；两件都未装备 → 失败（不扣卷轴，由 use() 保证）。
     * 上限 +5。数值加成在 recalcEquip 里按物品基础值 ×10%/级、向上取整。 */
    upgrade: function () {
      var p = Game.Data.Player;
      if (!p.upg) p.upg = {};
      var w = p.equipment.weapon ? Game.Data.ITEMS[p.equipment.weapon] : null;
      var a = p.equipment.armor ? Game.Data.ITEMS[p.equipment.armor] : null;
      if (!w && !a) return { ok: false, msg: '需先装备武器或护甲' };
      var wlv = w ? (p.upg[w.id] || 0) : 99;
      var alv = a ? (p.upg[a.id] || 0) : 99;
      var target = (w && (!a || wlv <= alv)) ? w : a;
      var lv = p.upg[target.id] || 0;
      if (lv >= 5) target = (target === w ? a : w);
      if (!target) return { ok: false, msg: '装备已全部强化至 +5（上限）' };
      lv = p.upg[target.id] || 0;
      if (lv >= 5) return { ok: false, msg: target.name + ' 已强化至 +5（上限）' };
      p.upg[target.id] = lv + 1;
      this.recalcEquip();
      notify();
      return { ok: true, msg: target.name + ' 强化至 +' + (lv + 1), target: target.id, level: lv + 1 };
    },

    /* 重算装备加成：基础属性 + 装备效果
     * M8-3：稀有词缀 maxHp 加成（基础 100 + 各装备 maxHp 之和），hp 钳制不超新上限（卸下回落同理）
     * M8-6：基础属性随等级成长（L1=10/5/100，每级 atk/def+1、maxHp+10），装备加成叠加在其上
     * S-03：强化等级 n=0..5，每级 +10% 物品基础 atk/def（向上取整），不改 ITEMS.effect 原值 */
    recalcEquip: function () {
      var p = Game.Data.Player;
      if (!p.upg) p.upg = {};
      var lv = (typeof p.level === 'number' && p.level >= 1) ? p.level : 1;
      var baseAtk = 10 + (lv - 1);
      var baseDef = 5 + (lv - 1);
      var baseMaxHp = 100 + (lv - 1) * 10;
      var w = p.equipment.weapon ? Game.Data.ITEMS[p.equipment.weapon] : null;
      var a = p.equipment.armor ? Game.Data.ITEMS[p.equipment.armor] : null;
      var wN = w ? Math.min(Math.max(p.upg[w.id] || 0, 0), 5) : 0;
      var aN = a ? Math.min(Math.max(p.upg[a.id] || 0, 0), 5) : 0;
      var wAtk = (w && w.effect.atk) ? w.effect.atk : 0;
      var aDef = (a && a.effect.def) ? a.effect.def : 0;
      p.atk = baseAtk + effValue(wAtk, wN);
      p.def = baseDef + effValue(aDef, aN);
      p.maxHp = baseMaxHp +
        (w && w.effect.maxHp ? w.effect.maxHp : 0) +
        (a && a.effect.maxHp ? a.effect.maxHp : 0);
      if (p.hp > p.maxHp) {
        var hpLostByCap = p.hp - p.maxHp;
        p.hp = p.maxHp;
        /* D-43：换装导致上限回落时的 HP 钳制记一笔，避免血量账出现无主缺口 */
        var B2 = Game.Systems.Battle;
        if (B2 && typeof B2._logHp === 'function') B2._logHp('damage', 'adjust:maxhp', hpLostByCap);
      }
    },

    add: function (id, count) {
      if (!Game.Data.ITEMS[id]) return false;
      if (!count) count = 1;
      var p = Game.Data.Player;
      if (!p.inventory[id]) p.inventory[id] = 0;
      p.inventory[id] += count;
      notify();
      /* P2-5：collect 任务推进——物品真正入包后调用（每次入包 +1）；
       * 数量 ≤0 不推进（!count 会把 0 兜底成 1，故须以原始入参判断）；物品不存在已在上方 return false */
      if (arguments.length >= 2 && !(arguments[1] > 0)) return true;
      if (Game.Systems.Quest && typeof Game.Systems.Quest.progress === 'function') {
        Game.Systems.Quest.progress('collect', id);
      }
      return true;
    },

    remove: function (id, count) {
      var p = Game.Data.Player;
      if (!p.inventory[id]) return false;
      if (!count) count = 1;
      p.inventory[id] -= count;
      if (p.inventory[id] <= 0) delete p.inventory[id];
      notify();
      return true;
    },

    list: function () {
      var p = Game.Data.Player;
      var out = [];
      for (var id in p.inventory) {
        if (p.inventory.hasOwnProperty(id) && p.inventory[id] > 0) {
          out.push({ id: id, count: p.inventory[id] });
        }
      }
      return out;
    }
  };
})();
