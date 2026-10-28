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

  Game.Systems.Inventory = {
    /* 使用消耗品 */
    use: function (id) {
      var p = Game.Data.Player;
      var item = Game.Data.ITEMS[id];
      if (!item || item.type !== 'consumable') return { ok: false, msg: '不是消耗品' };
      if (!p.inventory[id] || p.inventory[id] <= 0) return { ok: false, msg: '没有该物品' };
      var hpGain = item.effect.hp || 0;
      p.hp = Math.min(p.hp + hpGain, p.maxHp);
      p.inventory[id]--;
      if (p.inventory[id] === 0) delete p.inventory[id];
      notify();
      return { ok: true, msg: '使用 ' + item.name + '，回复 ' + hpGain + ' HP' };
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

    /* 重算装备加成：基础属性 + 装备效果 */
    recalcEquip: function () {
      var p = Game.Data.Player;
      var baseAtk = 10;
      var baseDef = 5;
      var w = p.equipment.weapon ? Game.Data.ITEMS[p.equipment.weapon] : null;
      var a = p.equipment.armor ? Game.Data.ITEMS[p.equipment.armor] : null;
      p.atk = baseAtk + (w && w.effect.atk ? w.effect.atk : 0);
      p.def = baseDef + (a && a.effect.def ? a.effect.def : 0);
    },

    add: function (id, count) {
      if (!Game.Data.ITEMS[id]) return false;
      if (!count) count = 1;
      var p = Game.Data.Player;
      if (!p.inventory[id]) p.inventory[id] = 0;
      p.inventory[id] += count;
      notify();
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
