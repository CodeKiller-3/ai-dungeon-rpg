/* js/data/items.js — 物品数据（PLAN.md §7.1 ITEMS Schema）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  Game.Data.ITEMS = {
    potion_small: { id: 'potion_small', name: '小血瓶', type: 'consumable', effect: { hp: 30 }, price: 10, sell: 5 },
    potion_large: { id: 'potion_large', name: '大血瓶', type: 'consumable', effect: { hp: 80 }, price: 40, sell: 20 },
    sword_bone: { id: 'sword_bone', name: '白骨剑', type: 'weapon', effect: { atk: 3 }, price: 60, sell: 30 },
    sword_dragon: { id: 'sword_dragon', name: '龙牙剑', type: 'weapon', effect: { atk: 8 }, price: 150, sell: 75 },
    armor_leather: { id: 'armor_leather', name: '皮革甲', type: 'armor', effect: { def: 3 }, price: 80, sell: 40 }
  };

  /* 商店货架（按楼层解锁，越深越强） */
  Game.Data.SHOP_STOCK = [
    ['potion_small', 'potion_large'],
    ['potion_small', 'sword_bone', 'armor_leather'],
    ['potion_large', 'sword_dragon', 'armor_leather']
  ];
})();
