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
      /* F5 恶魔深渊（P2-3b：dragon 降至 .05 作为稀有 roll，map.js 再钳制为恰好 1 只 Boss；
       * F5 权重向高阶怪倾斜（big_zombie .3 / angel .35 / necromancer .15 / masked_orc .15），
       * 期望强度 44.075，落在卡面 44~48 目标区间） */
      [{ id: 'dragon', rate: 0.05 }, { id: 'big_zombie', rate: 0.3 },
        { id: 'necromancer', rate: 0.15 }, { id: 'masked_orc', rate: 0.15 },
        { id: 'angel', rate: 0.35 }]
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
})();
