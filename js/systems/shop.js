/* js/systems/shop.js — 商店系统（按楼层解锁货架）
 * 接口：getStock / buy / sell（见 PLAN.md §4.4）
 * 来源：自写
 * 事件：shop:changed */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  Game.Systems.Shop = {
    getStock: function () {
      var floor = Game.Systems.Map.getFloor();
      var stock = Game.Data.SHOP_STOCK[Math.min(floor - 1, Game.Data.SHOP_STOCK.length - 1)];
      var out = [];
      for (var i = 0; i < stock.length; i++) {
        out.push({ id: stock[i], item: Game.Data.ITEMS[stock[i]] });
      }
      return out;
    },

    buy: function (id) {
      var p = Game.Data.Player;
      var item = Game.Data.ITEMS[id];
      if (!item) return { ok: false, msg: '商品不存在' };
      if (p.gold < item.price) return { ok: false, msg: '金币不足' };
      p.gold -= item.price;
      Game.Systems.Inventory.add(id, 1);
      Game.Core.EventBus.emit('shop:changed', { action: 'buy', id: id });
      return { ok: true, msg: '购买 ' + item.name + '，花费 ' + item.price + ' 金币' };
    },

    sell: function (id) {
      var p = Game.Data.Player;
      var item = Game.Data.ITEMS[id];
      if (!item) return { ok: false, msg: '物品不存在' };
      if (!p.inventory[id] || p.inventory[id] <= 0) return { ok: false, msg: '没有该物品' };
      /* 已装备的不可卖 */
      if (p.equipment.weapon === id || p.equipment.armor === id) return { ok: false, msg: '已装备，请先卸下' };
      Game.Systems.Inventory.remove(id, 1);
      p.gold += item.sell;
      Game.Core.EventBus.emit('shop:changed', { action: 'sell', id: id });
      return { ok: true, msg: '出售 ' + item.name + '，获得 ' + item.sell + ' 金币' };
    }
  };
})();
