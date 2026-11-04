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
    },
    /* P2-1：怪物扩量 4→10 种（数值按任务卡建议；掉落一律复用现有物品 id，
     * 装备掉落沿用 M8-3 tiers 格式（60/30/10 普通/优秀/稀有）；color 供程序化色块兜底） */
    goblin: {
      id: 'goblin', name: '哥布林',
      hp: 45, atk: 7, def: 3,
      exp: 14, gold: [4, 10],
      drops: [{ itemId: 'potion_small', rate: 0.25 }],
      color: '#7ac143'
    },
    tiny_zombie: {
      id: 'tiny_zombie', name: '小僵尸',
      hp: 50, atk: 8, def: 2,
      exp: 16, gold: [5, 12],
      drops: [{ itemId: 'potion_small', rate: 0.2 }],
      color: '#8fa88f'
    },
    orc_warrior: {
      id: 'orc_warrior', name: '兽人战士',
      hp: 85, atk: 14, def: 6,
      exp: 30, gold: [12, 24],
      drops: [{
        itemId: 'sword_bone', rate: 0.12,
        tiers: [
          { itemId: 'sword_bone', w: 60 },
          { itemId: 'sword_bone_rare', w: 30 },
          { itemId: 'sword_bone_epic', w: 10 }
        ]
      }],
      color: '#c98a4b'
    },
    orc_shaman: {
      id: 'orc_shaman', name: '兽人萨满',
      hp: 75, atk: 16, def: 4,
      exp: 32, gold: [14, 26],
      drops: [{ itemId: 'potion_large', rate: 0.2 }],
      color: '#9b6bd6'
    },
    wogol: {
      id: 'wogol', name: '兽人沃古尔',
      hp: 95, atk: 17, def: 7,
      exp: 38, gold: [16, 30],
      drops: [{
        itemId: 'sword_bone', rate: 0.15,
        tiers: [
          { itemId: 'sword_bone', w: 60 },
          { itemId: 'sword_bone_rare', w: 30 },
          { itemId: 'sword_bone_epic', w: 10 }
        ]
      }],
      color: '#b07a3a'
    },
    ogre: {
      id: 'ogre', name: '食人魔',
      hp: 130, atk: 20, def: 9,
      exp: 45, gold: [22, 40],
      drops: [{
        itemId: 'sword_dragon', rate: 0.2,
        tiers: [
          { itemId: 'sword_dragon', w: 60 },
          { itemId: 'sword_dragon_rare', w: 30 },
          { itemId: 'sword_dragon_epic', w: 10 }
        ]
      }],
      color: '#a0522d'
    }
  };
})();
