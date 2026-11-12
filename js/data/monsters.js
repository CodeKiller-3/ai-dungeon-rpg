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
      /* D-34：最终 Boss 数值解冻（仅本只）。旧值 hp150/atk18 弱于第 5 层普通怪
       * （天使 hp180/atk28、大僵尸 hp240/atk26），打到最后一层反而更轻松。
       * 新值 hp260/atk32/def8：hp 与 atk 双项严格大于第 5 层全部普通怪；
       * def 不动，二阶段机制（enrage）不动。Boss 不进普通表，故五层期望强度不受影响。 */
      hp: 260, atk: 32, def: 8,
      exp: 60, gold: [40, 80],
      /* P2-4：Boss 标记（仅用于地图保底与战斗强化，数值不动） */
      boss: true,
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
    },
    /* P2-3：imp 由 bat 的视觉帧组转为独立怪物（F3 登场）；数值按 F3 期望介于 F2/F4 配平 */
    imp: {
      id: 'imp', name: '小恶魔',
      hp: 60, atk: 12, def: 4,
      exp: 24, gold: [8, 16],
      drops: [{ itemId: 'potion_small', rate: 0.2 }],
      color: '#ff8c42'
    },
    /* P2-3b：F4/F5 数值上调（F1~F3 不动）——目标 F4 期望 35~38、F5 44~48。
     * 说明：按卡面 atk 全部保留，仅上调 hp 与 F5 权重（卡面原值按 hp/10 公式只能到 F4 34.75 / F5 40.275）。 */
    big_zombie: {
      id: 'big_zombie', name: '大僵尸',
      hp: 240, atk: 26, def: 10,
      exp: 55, gold: [26, 48],
      drops: [{ itemId: 'potion_large', rate: 0.3 }],
      color: '#8f9b6e'
    },
    necromancer: {
      id: 'necromancer', name: '死灵法师',
      hp: 135, atk: 24, def: 6,
      exp: 42, gold: [20, 36],
      drops: [{ itemId: 'potion_mana', rate: 0.35 }],
      color: '#7b5aa6'
    },
    masked_orc: {
      id: 'masked_orc', name: '面具兽人',
      hp: 150, atk: 23, def: 8,
      exp: 41, gold: [18, 34],
      drops: [{
        itemId: 'sword_bone', rate: 0.18,
        tiers: [
          { itemId: 'sword_bone', w: 60 },
          { itemId: 'sword_bone_rare', w: 30 },
          { itemId: 'sword_bone_epic', w: 10 }
        ]
      }],
      color: '#b3743f'
    },
    pumpkin_dude: {
      id: 'pumpkin_dude', name: '南瓜怪',
      hp: 120, atk: 22, def: 7,
      exp: 40, gold: [17, 32],
      drops: [{ itemId: 'potion_xl', rate: 0.2 }],
      color: '#e88a2a'
    },
    angel: {
      id: 'angel', name: '天使',
      hp: 180, atk: 28, def: 5,
      exp: 45, gold: [22, 40],
      drops: [{ itemId: 'potion_mana', rate: 0.3 }],
      color: '#cfe6ff'
    },
    /* P2-4：层 Boss 2 种（enrage 结构复用 battle.js 既有通用实现，不改战斗逻辑；
     * 掉落 id 均为 items.js 已有物品：sword_steel 三档 / chain_mail / plate_armor / potion_xl） */
    ogre_boss: {
      id: 'ogre_boss', name: '独眼酋长',
      boss: true,
      hp: 280, atk: 24, def: 10,
      exp: 130, gold: [60, 110],
      drops: [
        {
          itemId: 'sword_steel', rate: 0.5,
          tiers: [
            { itemId: 'sword_steel', w: 60 },
            { itemId: 'sword_steel_rare', w: 30 },
            { itemId: 'sword_steel_epic', w: 10 }
          ]
        },
        { itemId: 'chain_mail', rate: 0.3 }
      ],
      color: '#c08a3e',
      enrage: {
        hpPct: 0.5,
        atkMul: 1.4,
        defMul: 1.2,
        skill: { name: '战吼重击', chance: 0.35, dmgMul: 1.5 }
      }
    },
    zombie_king: {
      id: 'zombie_king', name: '僵尸王',
      boss: true,
      hp: 420, atk: 30, def: 12,
      exp: 200, gold: [90, 160],
      drops: [
        { itemId: 'plate_armor', rate: 0.4 },
        { itemId: 'potion_xl', rate: 0.5 }
      ],
      color: '#6fae6f',
      enrage: {
        hpPct: 0.5,
        atkMul: 1.35,
        defMul: 1.25,
        skill: { name: '腐毒吐息', chance: 0.3, dmgMul: 1.4 }
      }
    }
  };
})();
