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
      /* M8-3：装备掉落加可选 tiers——命中 rate 后按权重 60/30/10 选普通/优秀/稀有档 */
      drops: [{
        itemId: 'sword_bone', rate: 0.15,
        tiers: [
          { itemId: 'sword_bone', w: 60 },
          { itemId: 'sword_bone_rare', w: 30 },
          { itemId: 'sword_bone_epic', w: 10 }
        ]
      }],
      color: '#e1b98f'
    },
    dragon: {
      id: 'dragon', name: '地牢巨龙',
      hp: 150, atk: 18, def: 8,
      exp: 60, gold: [40, 80],
      /* M8-3：装备掉落加可选 tiers（药水掉落保持原样，无 tiers 行为不变） */
      drops: [
        {
          itemId: 'sword_dragon', rate: 0.25,
          tiers: [
            { itemId: 'sword_dragon', w: 60 },
            { itemId: 'sword_dragon_rare', w: 30 },
            { itemId: 'sword_dragon_epic', w: 10 }
          ]
        },
        { itemId: 'potion_large', rate: 0.5 }
      ],
      color: '#ea6668',
      /* M8-2：Boss 二阶段——血量 ≤50% 狂暴，攻防提升 + 30% 概率释放烈焰吐息；
       * 全部可复算公式，不硬编码最终数值 */
      enrage: {
        hpPct: 0.5,
        atkMul: 1.5,
        defMul: 1.3,
        skill: { name: '烈焰吐息', chance: 0.3, dmgMul: 1.4 }
      }
    }
  };
})();
