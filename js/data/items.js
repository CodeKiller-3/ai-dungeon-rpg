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
    armor_leather: { id: 'armor_leather', name: '皮革甲', type: 'armor', effect: { def: 3 }, price: 80, sell: 40 },

    /* M8-3：品质变体——优秀档 effect=round(普通×1.5)、价格×2；稀有档 effect=round(普通×2)+maxHp:10、价格×4
     * 全部公式化可复算（round(3×1.5)=5、round(3×2)=6、round(8×1.5)=12、round(8×2)=16），不删改原 3 条 */
    sword_bone_rare: { id: 'sword_bone_rare', name: '优秀白骨剑', type: 'weapon', effect: { atk: 5 }, price: 120, sell: 60 },
    sword_bone_epic: { id: 'sword_bone_epic', name: '稀有白骨剑', type: 'weapon', effect: { atk: 6, maxHp: 10 }, price: 240, sell: 120 },
    sword_dragon_rare: { id: 'sword_dragon_rare', name: '优秀龙牙剑', type: 'weapon', effect: { atk: 12 }, price: 300, sell: 150 },
    sword_dragon_epic: { id: 'sword_dragon_epic', name: '稀有龙牙剑', type: 'weapon', effect: { atk: 16, maxHp: 10 }, price: 600, sell: 300 },
    armor_leather_rare: { id: 'armor_leather_rare', name: '优秀皮革甲', type: 'armor', effect: { def: 5 }, price: 160, sell: 80 },
    armor_leather_epic: { id: 'armor_leather_epic', name: '稀有皮革甲', type: 'armor', effect: { def: 6, maxHp: 10 }, price: 320, sell: 160 }
  };

  /* 商店货架（按楼层解锁，越深越强；M8-3：装备三档变体并排售卖） */
  Game.Data.SHOP_STOCK = [
    ['potion_small', 'potion_large'],
    ['potion_small', 'sword_bone', 'sword_bone_rare', 'sword_bone_epic', 'armor_leather', 'armor_leather_rare', 'armor_leather_epic'],
    ['potion_large', 'sword_dragon', 'sword_dragon_rare', 'sword_dragon_epic', 'armor_leather', 'armor_leather_rare', 'armor_leather_epic']
  ];
})();
