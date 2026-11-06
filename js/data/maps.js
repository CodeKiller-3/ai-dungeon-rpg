/* js/data/maps.js — 地图配置（PLAN.md §7.1 MAPS Schema）
 * M9-1 扩展：新增 TILE_DETAILS（tile 细节候选池）与 DECOR（装饰物定义）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  Game.Data.MAPS = {
    floors: 5,                                   /* 楼层数（P2-3：3→5，dragon 移至 F5） */
    sizes: [[21, 15], [25, 17], [29, 19], [33, 21], [37, 23]], /* 每层网格尺寸 */
    enemyTable: [                               /* 每层怪物概率表（M2 使用；每行概率和=1，逐层期望强度严格递增） */
      /* F1 地牢杂兵（P2-1，期望 11.125） */
      [{ id: 'slime', rate: 0.45 }, { id: 'bat', rate: 0.3 },
        { id: 'goblin', rate: 0.15 }, { id: 'tiny_zombie', rate: 0.1 }],
      /* F2 兽人营地（P2-1，期望 20.125） */
      [{ id: 'bat', rate: 0.15 }, { id: 'skeleton', rate: 0.3 },
        { id: 'orc_warrior', rate: 0.3 }, { id: 'orc_shaman', rate: 0.25 }],
      /* F3 龙巢前哨（P2-3：dragon 移出、imp 独立登场，期望 23.75） */
      [{ id: 'skeleton', rate: 0.3 }, { id: 'ogre', rate: 0.25 },
        { id: 'wogol', rate: 0.2 }, { id: 'imp', rate: 0.25 }],
      /* F4 冰霜墓穴（P2-3b 数值上调后期望 36.85） */
      [{ id: 'big_zombie', rate: 0.2 }, { id: 'necromancer', rate: 0.2 },
        { id: 'pumpkin_dude', rate: 0.15 }, { id: 'masked_orc', rate: 0.3 },
        { id: 'skeleton', rate: 0.15 }],
      /* F5 恶魔深渊（P2-4：Boss（dragon）不再出现在普通表，由 MAPS.bosses + map.js 注入恰 1 只；
       * 普通怪权重 big_zombie .35 / necromancer .2 / masked_orc .2 / angel .25，期望强度 44.1） */
      [{ id: 'big_zombie', rate: 0.35 }, { id: 'necromancer', rate: 0.2 },
        { id: 'masked_orc', rate: 0.2 }, { id: 'angel', rate: 0.25 }]
    ],
    /* P2-4：层 Boss 配置（floor 为 1-based；普通 enemyTable 不含 Boss id，
     * map.js 按此表在对应层注入恰好 1 只 Boss） */
    bosses: [
      { floor: 2, id: 'ogre_boss' },
      { floor: 4, id: 'zombie_king' },
      { floor: 5, id: 'dragon' }
    ],
    /* P2-3：层主题（纯视觉参数，透明度 ≤0.12，避免压暗贴图；drawMap 叠色用） */
    themes: [
      { name: '地牢', tint: 'rgba(120,130,150,0.06)' },
      { name: '兽人营地', tint: 'rgba(150,120,70,0.08)' },
      { name: '龙巢前哨', tint: 'rgba(160,60,50,0.10)' },
      { name: '冰霜墓穴', tint: 'rgba(80,140,200,0.10)' },
      { name: '恶魔深渊', tint: 'rgba(110,60,160,0.12)' }
    ]
  };

  /* M9-1：tile 细节候选池——按权重随机出现在地板/墙上，纯视觉不影响通行
   * type: grass(草丛) | puddle(水洼) | bones(碎骨) | moss(苔藓) */
  Game.Data.TILE_DETAILS = {
    floor: [
      { type: 'grass', weight: 12 },
      { type: 'puddle', weight: 6 },
      { type: 'bones', weight: 4 },
      { type: 'moss', weight: 8 }
    ],
    wall: [
      { type: 'moss', weight: 6 }
    ],
    boss: []
  };

  /* M9-1：装饰物定义——不阻挡移动；chest 可拾取（金币或道具）
   * loot: 'gold' | 'item' | 'random' */
  Game.Data.DECOR = {
    chest:  { id: 'chest',  name: '宝箱', desc: '内含金币或道具', loot: 'random' },
    barrel: { id: 'barrel', name: '木桶', desc: '装饰物' },
    torch:  { id: 'torch',  name: '火把', desc: '照亮周围（静态，M9-2 加光晕）' },
    vine:   { id: 'vine',   name: '藤蔓', desc: '装饰物' }
  };

  /* S-04：陷阱定义——踩中即触发一次，触发后该格永久显现（seen=true）且不再伤人
   * spike：伤害 = 当前 HP 8%，全层上限 30（F1 单次 ≤15），并附带流血
   * gas：不直接扣血，施加中毒（3 回合 × -2 HP/回合） */
  Game.Data.TRAPS = {
    spike: { id: 'spike', name: '地刺', dmgPct: 0.08, dmgCap30: 30, dmgCap1: 15, status: 'bleed', turns: 2 },
    gas:   { id: 'gas',   name: '毒气', dmgPct: 0, status: 'poison', turns: 3 }
  };

  /* S-04：状态效果——只作用于玩家；每「回合」（探索走一步 / 战斗行动一次）结算一次，
   * tickDmg 直接扣 HP，回合数归零即移除。不写入 ITEMS/MONSTERS，不影响 Boss 狂暴 */
  Game.Data.STATUS = {
    bleed:  { id: 'bleed',  name: '流血', tickDmg: 3, color: '#ef4444' },
    poison: { id: 'poison', name: '中毒', tickDmg: 2, color: '#84cc16' }
  };

  /* S-04：陷阱放置参数——每层 3~6 个，出生点 3 格内不放，F1 只放地刺 */
  Game.Data.TRAP_PLACEMENT = {
    min: 3, max: 6, safeRadius: 3,
    firstFloorOnly: 'spike',
    gasRate: 0.45 /* F2 起每个陷阱为毒气的概率 */
  };
})();
