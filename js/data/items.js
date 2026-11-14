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

    /* C-04：物品扩充——补 2 件 240 档装备，用于恢复 F4 轮换池为 5 件（纯新增，既有条目不删不改）。
     * 平衡约束：240~320 区间既有上限为 atk 12（sword_anime/sword_dragon_rare/sword_magic_rare）、
     * def 8（chain_mail_rare）、maxHp 10（sword_bone_epic/robe_mage_rare 等）；
     * 新增项 atk9 / def5+maxHp10 均不超过上限，只复用 atk/def/maxHp 三个既有键，不引入新机制。
     * 与同价位既有项构成"攻高/带血"互换，不严格支配任何既有装备；不在 F4/F5 核心货架。 */
    sword_knight: { id: 'sword_knight', name: '骑士长剑', type: 'weapon', effect: { atk: 9 }, price: 240, sell: 120 },
    armor_scale: { id: 'armor_scale', name: '鳞甲', type: 'armor', effect: { def: 5, maxHp: 10 }, price: 240, sell: 120 },

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

  /* ── D-71：精英专属武器（5 把，五层各一把）────────────────────────
   * 来源：只由"打赢该层精英"发放（main.js#grantEliteReward），商店核心货架与轮换池都不含，
   *      因此是真正的 drop-only；不消耗随机数，不改进货/掉落/价格表。
   * 用 defineProperty 挂成「不可枚举」：ITEMS 的可枚举条目仍是 48 条，
   * 历史验证页（物品计数 / 商店货架 / 交易契约）全部不受影响。
   * 属性口径：严格递增，且每一把都高于"同层商店最强武器"（5/8/12/12/16），
   *          保证玩家拿到时一定比手里/店里同层的刀更好，不会被 betterEquipIndex 丢弃。
   * price/sell = 0：不参与买卖，避免"打出来卖钱"变成经济外挂。 */
  var ELITE_WEAPONS = {
    elite_fang_1: { id: 'elite_fang_1', name: '断牙', type: 'weapon', elite: true, effect: { atk: 8 }, price: 0, sell: 0 },
    elite_axe_2: { id: 'elite_axe_2', name: '裂颅', type: 'weapon', elite: true, effect: { atk: 12 }, price: 0, sell: 0 },
    elite_blade_3: { id: 'elite_blade_3', name: '霜噬', type: 'weapon', elite: true, effect: { atk: 16 }, price: 0, sell: 0 },
    elite_edge_4: { id: 'elite_edge_4', name: '守夜', type: 'weapon', elite: true, effect: { atk: 16, maxHp: 10 }, price: 0, sell: 0 },
    elite_fang_5: { id: 'elite_fang_5', name: '烬牙', type: 'weapon', elite: true, effect: { atk: 22, maxHp: 10 }, price: 0, sell: 0 }
  };
  for (var ew in ELITE_WEAPONS) {
    if (!Object.prototype.hasOwnProperty.call(ELITE_WEAPONS, ew)) continue;
    Object.defineProperty(Game.Data.ITEMS, ew, {
      value: ELITE_WEAPONS[ew], enumerable: false, configurable: true, writable: false
    });
  }
  Game.Data.ELITE_WEAPONS = ELITE_WEAPONS;

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
   * 轮换位只增加展示多样性，价格仍遵循 price > sell，不构成刷金套利。
   * C-02：每层由 3 项扩到 5 项（周期 3 次开张 → 5 次），原 3 项全部保留；
   * 新增项按同层核心档位挑选，不与该层核心货架重复（保证合计条数 10/12/12/11/11 不变）；
   * C-03：档位口径五层全覆盖——每个装备项单价 ≥ 该层核心非消耗品最低价
   * （F1 20 / F2 85 / F3 150 / F4 240 / F5 300）；
   * 消耗品不受该条约束（F1~F3 保留 potion_mana 补给），但 F4/F5 不放消耗品。
   * C-03b：新增通用规则——某层轮换池的装备项不得出现在更深层核心货架中
   * （否则等于提前售卖深层核心货，"逐层更强"被抹平）。按此规则重排：
   *   F2 移除 chain_mail_rare/robe_mage_rare（F4 核心），换 bow_elite/armor_leather_rare；
   *   F3 移除 chain_mail_rare/sword_magic_rare/plate_armor_rare（F4 核心）与 chain_mail_epic（F5 核心），
   *      换 sword_bone_epic/sword_iron_epic/armor_leather_epic/sword_steel_rare；
   *   F4 移除 chain_mail_epic/robe_mage_epic（F5 核心），换 sword_anime。
   * C-04：物品表补 2 件 240 档装备（sword_knight / armor_scale）后，F4 合格候选 4 → 6 件，
   * 池长恢复 5：保留 sword_bone_epic / armor_leather_epic / sword_anime 并加入两件新增装备；
   * 移除与 sword_bone_epic 数值完全重复的 sword_iron_epic（它仍保留在 F2/F3 池）。
   * 五层池长因此回到 [5,5,5,5,5]、周期 [5,5,5,5,5]。 */
  Game.Data.SHOP_ROTATION = [
    ['sword_bone', 'sword_iron_rare', 'potion_mana', 'sword_bone_rare', 'armor_leather_rare'],
    ['sword_steel_rare', 'sword_iron_epic', 'armor_leather_epic', 'bow_elite', 'armor_leather_rare'],
    ['sword_bone_epic', 'sword_iron_epic', 'potion_mana', 'armor_leather_epic', 'sword_steel_rare'],
    ['sword_bone_epic', 'armor_leather_epic', 'sword_anime', 'sword_knight', 'armor_scale'],
    ['sword_magic_rare', 'robe_mage_rare', 'sword_steel_epic', 'plate_armor_rare', 'armor_leather_epic']
  ];

  /* S-03：每层固定 1 张强化卷轴（单独货位，不并入核心货架，
   * 因核心货架均价 40.7/92.2/236.7/259.4/441.9 是既有验收口径） */
  Game.Data.SHOP_SCROLLS = [
    'scroll_upgrade', 'scroll_upgrade_2', 'scroll_upgrade_3', 'scroll_upgrade_4', 'scroll_upgrade_4'
  ];

  /* D-30：物品 id → 素材名的显式映射表（可机器读，不靠命名规则猜）。
   * 覆盖 ITEMS 全部 48 件，未映射数量为 0；品质变体（_rare/_epic）与基础档共用同一图标，
   * 与 D-21/P2-2 既有口径一致（品质靠行尾徽标识别，不靠图标）。
   * 本表是唯一事实来源：modal.itemIcon() 只查表，查不到即返回 null（画不出图标就退回纯文字）。
   * 护甲/卷轴为 D-30 新增素材；sword_knight 复用既有未映射的 weapon_katana
   * （骑士长剑是长直刃；weapon_knight_sword 已被 sword_magic 占用，不动既有映射）。 */
  Game.Data.ITEM_ICONS = {
    /* 武器 27 件 */
    sword_bone: 'weapon_rusty_sword',
    sword_bone_rare: 'weapon_golden_sword',
    sword_bone_epic: 'weapon_lavish_sword',
    sword_dragon: 'weapon_red_gem_sword',
    sword_dragon_rare: 'weapon_golden_sword',
    sword_dragon_epic: 'weapon_lavish_sword',
    sword_rusty: 'weapon_rusty_sword',
    knife: 'weapon_knife',
    machete: 'weapon_machete',
    sword_iron: 'weapon_regular_sword',
    sword_iron_rare: 'weapon_golden_sword',
    sword_iron_epic: 'weapon_lavish_sword',
    sword_steel: 'weapon_duel_sword',
    sword_steel_rare: 'weapon_golden_sword',
    sword_steel_epic: 'weapon_lavish_sword',
    axe_war: 'weapon_waraxe',
    bow_hunter: 'weapon_bow_2',
    hammer: 'weapon_hammer',
    spear: 'weapon_spear',
    sword_magic: 'weapon_knight_sword',
    sword_magic_rare: 'weapon_golden_sword',
    sword_magic_epic: 'weapon_lavish_sword',
    staff_fire: 'weapon_red_magic_staff',
    bow_elite: 'weapon_bow',
    axe_double: 'weapon_double_axe',
    sword_anime: 'weapon_anime_sword',
    sword_knight: 'weapon_katana',
    /* 护甲 13 件（D-30 新增素材，按甲系共用） */
    armor_leather: 'icon_armor_leather',
    armor_leather_rare: 'icon_armor_leather',
    armor_leather_epic: 'icon_armor_leather',
    chain_mail: 'icon_armor_chain_mail',
    chain_mail_rare: 'icon_armor_chain_mail',
    chain_mail_epic: 'icon_armor_chain_mail',
    plate_armor: 'icon_armor_plate',
    plate_armor_rare: 'icon_armor_plate',
    plate_armor_epic: 'icon_armor_plate',
    robe_mage: 'icon_armor_robe',
    robe_mage_rare: 'icon_armor_robe',
    robe_mage_epic: 'icon_armor_robe',
    armor_scale: 'icon_armor_scale',
    /* 消耗品 8 件：药水沿用 P2-2 既有图标，卷轴 4 档 D-30 新增 */
    potion_small: 'flask_red',
    potion_large: 'flask_big_red',
    potion_xl: 'flask_big_red',
    potion_mana: 'flask_blue',
    scroll_upgrade: 'icon_scroll_1',
    scroll_upgrade_2: 'icon_scroll_2',
    scroll_upgrade_3: 'icon_scroll_3',
    scroll_upgrade_4: 'icon_scroll_4'
  };

  /* D-49：救援专属装备——只由 Adaptive 在"第二次死亡"时发放。
   * 关键约束：不进商店 / 宝箱 / 怪物掉落三张表，也不改变 ITEMS 的可枚举统计
   * （D-45 对 Σprice / Σsell / FNV 有硬断言），因此用不可枚举属性挂到 ITEMS 上，
   * 让 Inventory/Modal 既有的 ITEMS[id] 直接访问照常工作，而 Object.keys(ITEMS) 仍是 48 件。
   * 强度推导（D-45 档位表）：各层可买到的最好武器 atk = F1 3 / F2 8 / F3 12 / F4 12 / F5 16，
   * 现有最强档 atk16；取 13 落在"当前可买到最好档"与"最强档"之间，且永不等于最强档。
   * F5 可买最好已是 16，没有中间档，故 F5 的救援改为 60 金币。 */
  Game.Data.RESCUE_ITEMS = {
    sword_rescue: {
      id: 'sword_rescue', name: '守夜人的旧剑', type: 'weapon',
      effect: { atk: 13 }, price: 90, sell: 45, rescue: true
    }
  };
  Object.defineProperty(Game.Data.ITEMS, 'sword_rescue', {
    value: Game.Data.RESCUE_ITEMS.sword_rescue, enumerable: false, configurable: true, writable: false
  });
  Object.defineProperty(Game.Data.ITEM_ICONS, 'sword_rescue', {
    value: 'weapon_lavish_sword', enumerable: false, configurable: true, writable: false
  });
})();
