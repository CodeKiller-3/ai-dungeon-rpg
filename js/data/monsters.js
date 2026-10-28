/* js/data/monsters.js — 怪物数据（PLAN.md §7.1 MONSTERS Schema）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  Game.Data.MONSTERS = {
    slime: {
      id: 'slime', name: '史莱姆',
      hp: 40, atk: 6, def: 2,
      exp: 10, gold: [3, 8],
      drops: [{ itemId: 'potion_small', rate: 0.3 }],
      color: '#52c41a'
    },
    bat: {
      id: 'bat', name: '暗影蝙蝠',
      hp: 30, atk: 9, def: 1,
      exp: 12, gold: [4, 10],
      drops: [{ itemId: 'potion_small', rate: 0.2 }],
      color: '#9eacea'
    },
    skeleton: {
      id: 'skeleton', name: '骷髅士兵',
      hp: 70, atk: 12, def: 5,
      exp: 25, gold: [10, 20],
      drops: [{ itemId: 'sword_bone', rate: 0.15 }],
      color: '#e1b98f'
    },
    dragon: {
      id: 'dragon', name: '地牢巨龙',
      hp: 150, atk: 18, def: 8,
      exp: 60, gold: [40, 80],
      drops: [{ itemId: 'sword_dragon', rate: 0.25 }, { itemId: 'potion_large', rate: 0.5 }],
      color: '#ea6668'
    }
  };
})();
