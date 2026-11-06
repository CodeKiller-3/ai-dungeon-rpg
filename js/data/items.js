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
    armor_leather_epic: { id: 'armor_leather_epic', name: '稀有皮革甲', type: 'armor', effect: { def: 6, maxHp: 10 }, price: 320, sell: 160 },

    /* P2-2：物品扩量 11→42 条（纯新增，现有 11 条原文不动）。
     * 武器 effect 仅 atk（价格≈atk×20、sell=price/2 向下取整），护甲仅 def/maxHp，药水 hp/mp。
     * 1 层：sword_rusty / knife / machete / sword_iron */
    sword_rusty: { id: 'sword_rusty', name: '生锈短剑', type: 'weapon', effect: { atk: 1 }, price: 30, sell: 15 },
    knife: { id: 'knife', name: '匕首', type: 'weapon', effect: { atk: 1 }, price: 20, sell: 10 },
    machete: { id: 'machete', name: '砍刀', type: 'weapon', effect: { atk: 2 }, price: 45, sell: 22 },
    sword_iron: { id: 'sword_iron', name: '铁剑', type: 'weapon', effect: { atk: 3 }, price: 60, sell: 30 },
    /* 2 层：sword_steel / axe_war / bow_hunter / hammer / spear */
    sword_steel: { id: 'sword_steel', name: '钢剑', type: 'weapon', effect: { atk: 5 }, price: 100, sell: 50 },
    axe_war: { id: 'axe_war', name: '战斧', type: 'weapon', effect: { atk: 6 }, price: 120, sell: 60 },
    bow_hunter: { id: 'bow_hunter', name: '猎弓', type: 'weapon', effect: { atk: 4 }, price: 90, sell: 45 },
    hammer: { id: 'hammer', name: '战锤', type: 'weapon', effect: { atk: 4 }, price: 85, sell: 42 },
    spear: { id: 'spear', name: '长矛', type: 'weapon', effect: { atk: 4 }, price: 90, sell: 45 },
    /* 3 层：sword_magic / staff_fire / bow_elite / axe_double / sword_anime */
    sword_magic: { id: 'sword_magic', name: '魔剑', type: 'weapon', effect: { atk: 8 }, price: 160, sell: 80 },
    staff_fire: { id: 'staff_fire', name: '烈焰法杖', type: 'weapon', effect: { atk: 9 }, price: 180, sell: 90 },
    bow_elite: { id: 'bow_elite', name: '精弓', type: 'weapon', effect: { atk: 7 }, price: 140, sell: 70 },
    axe_double: { id: 'axe_double', name: '双刃斧', type: 'weapon', effect: { atk: 10 }, price: 200, sell: 100 },
    sword_anime: { id: 'sword_anime', name: '妖刀', type: 'weapon', effect: { atk: 12 }, price: 260, sell: 130 },
    /* 品质档按 M8-3 公式（rare=round(atk×1.5) 价×2；epic=round(atk×2)+maxHp:10 价×4），3 组各 2 档 */
    sword_iron_rare: { id: 'sword_iron_rare', name: '优秀铁剑', type: 'weapon', effect: { atk: 5 }, price: 120, sell: 60 },
    sword_iron_epic: { id: 'sword_iron_epic', name: '稀有铁剑', type: 'weapon', effect: { atk: 6, maxHp: 10 }, price: 240, sell: 120 },
    sword_steel_rare: { id: 'sword_steel_rare', name: '优秀钢剑', type: 'weapon', effect: { atk: 8 }, price: 200, sell: 100 },
    sword_steel_epic: { id: 'sword_steel_epic', name: '稀有钢剑', type: 'weapon', effect: { atk: 10, maxHp: 10 }, price: 400, sell: 200 },
    sword_magic_rare: { id: 'sword_magic_rare', name: '优秀魔剑', type: 'weapon', effect: { atk: 12 }, price: 320, sell: 160 },
    sword_magic_epic: { id: 'sword_magic_epic', name: '稀有魔剑', type: 'weapon', effect: { atk: 16, maxHp: 10 }, price: 640, sell: 320 },
    /* 护甲：chain_mail / plate_armor / robe_mage + 各自品质档（公式同 M8-3，def 阶梯） */
    chain_mail: { id: 'chain_mail', name: '锁链甲', type: 'armor', effect: { def: 5 }, price: 120, sell: 60 },
    plate_armor: { id: 'plate_armor', name: '板甲', type: 'armor', effect: { def: 8 }, price: 200, sell: 100 },
    robe_mage: { id: 'robe_mage', name: '法袍', type: 'armor', effect: { def: 4, maxHp: 10 }, price: 150, sell: 75 },
    chain_mail_rare: { id: 'chain_mail_rare', name: '优秀锁链甲', type: 'armor', effect: { def: 8 }, price: 240, sell: 120 },
    chain_mail_epic: { id: 'chain_mail_epic', name: '稀有锁链甲', type: 'armor', effect: { def: 10, maxHp: 10 }, price: 480, sell: 240 },
    plate_armor_rare: { id: 'plate_armor_rare', name: '优秀板甲', type: 'armor', effect: { def: 12 }, price: 400, sell: 200 },
    plate_armor_epic: { id: 'plate_armor_epic', name: '稀有板甲', type: 'armor', effect: { def: 16, maxHp: 10 }, price: 800, sell: 400 },
    robe_mage_rare: { id: 'robe_mage_rare', name: '优秀法袍', type: 'armor', effect: { def: 6, maxHp: 10 }, price: 300, sell: 150 },
    robe_mage_epic: { id: 'robe_mage_epic', name: '稀有法袍', type: 'armor', effect: { def: 8, maxHp: 20 }, price: 600, sell: 300 },
    /* 药水：特大血瓶（hp150）+ 蓝瓶（mp40，需 Inventory.use 支持 effect.mp） */
    potion_xl: { id: 'potion_xl', name: '特大血瓶', type: 'consumable', effect: { hp: 150 }, price: 80, sell: 40 },
    potion_mana: { id: 'potion_mana', name: '蓝瓶', type: 'consumable', effect: { mp: 40 }, price: 35, sell: 17 },

    /* S-03：强化卷轴——consumable + scroll:true，effect 为空（强化不走 effect 字段）；
     * 价格按层抬升 80/120/200/300，sell=floor(price/2)；使用后给已装备物品 +1，上限 +5 */
    scroll_upgrade: { id: 'scroll_upgrade', name: '强化卷轴', type: 'consumable', scroll: true, effect: {}, price: 80, sell: 40 },
    scroll_upgrade_2: { id: 'scroll_upgrade_2', name: '精制强化卷轴', type: 'consumable', scroll: true, effect: {}, price: 120, sell: 60 },
    scroll_upgrade_3: { id: 'scroll_upgrade_3', name: '秘银强化卷轴', type: 'consumable', scroll: true, effect: {}, price: 200, sell: 100 },
    scroll_upgrade_4: { id: 'scroll_upgrade_4', name: '龙纹强化卷轴', type: 'consumable', scroll: true, effect: {}, price: 300, sell: 150 }
  };

  /* 商店核心货架（S-01：补 F4/F5，五层逐层解锁；每层 6~9 种，核心货架常驻展示）
   * 递进口径按"核心货架平均单价"可复算：F1 40.7 → F2 92.2 → F3 236.7 → F4 259.4 → F5 441.9
   * 只换货架不加快金币产出，保持既有经济节奏；F3 保留 sword_dragon 三档（M8-3 既有验收）
   * 所有条目 buy.price 严格大于 sell（sell=floor(price/2)），刷新货架无法低买高卖套利 */
  Game.Data.SHOP_STOCK = [
    ['potion_small', 'potion_large', 'knife', 'machete', 'sword_rusty', 'sword_iron', 'armor_leather'],
    ['potion_large', 'potion_mana', 'sword_steel', 'axe_war', 'bow_hunter', 'hammer', 'spear', 'chain_mail', 'robe_mage'],
    ['potion_xl', 'sword_magic', 'staff_fire', 'axe_double', 'sword_anime', 'plate_armor',
      'sword_dragon', 'sword_dragon_rare', 'sword_dragon_epic'],
    ['potion_xl', 'potion_mana', 'sword_magic_rare', 'sword_steel_epic',
      'chain_mail_rare', 'plate_armor_rare', 'robe_mage_rare', 'sword_dragon_rare'],
    ['potion_xl', 'potion_mana', 'sword_magic_epic', 'sword_dragon_epic',
      'plate_armor_epic', 'chain_mail_epic', 'robe_mage_epic', 'sword_dragon_rare']
  ];

  /* S-01：每层轮换池——每次开张（Shop.refresh）按"(楼层×3 + 开张次数) % 池长"确定性滑动取 2 个商品位。
   * 纯算术、无 Math.random，因此同一层同一次开张货架稳定、重复开张结果可复现；
   * 轮换位只增加展示多样性，价格仍遵循 price > sell，不构成刷金套利。 */
  Game.Data.SHOP_ROTATION = [
    ['sword_bone', 'sword_iron_rare', 'potion_mana'],
    ['sword_steel_rare', 'sword_iron_epic', 'armor_leather_epic'],
    ['bow_elite', 'sword_magic_rare', 'potion_mana'],
    ['sword_iron_epic', 'armor_leather_epic', 'sword_bone_epic'],
    ['sword_magic_rare', 'chain_mail_rare', 'potion_large']
  ];

  /* S-03：每层固定 1 张强化卷轴（单独货位，不并入核心货架，
   * 因核心货架均价 40.7/92.2/236.7/259.4/441.9 是既有验收口径） */
  Game.Data.SHOP_SCROLLS = [
    'scroll_upgrade', 'scroll_upgrade_2', 'scroll_upgrade_3', 'scroll_upgrade_4', 'scroll_upgrade_4'
  ];
})();
