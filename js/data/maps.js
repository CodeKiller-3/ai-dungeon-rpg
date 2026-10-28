/* js/data/maps.js — 地图配置（PLAN.md §7.1 MAPS Schema）
 * M9-1 扩展：新增 TILE_DETAILS（tile 细节候选池）与 DECOR（装饰物定义）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  Game.Data.MAPS = {
    floors: 3,                                   /* 楼层数 */
    sizes: [[21, 15], [25, 17], [29, 19]],       /* 每层网格尺寸 */
    enemyTable: [                               /* 每层怪物概率表（M2 使用） */
      [{ id: 'slime', rate: 0.6 }, { id: 'bat', rate: 0.4 }],
      [{ id: 'bat', rate: 0.5 }, { id: 'skeleton', rate: 0.5 }],
      [{ id: 'skeleton', rate: 0.6 }, { id: 'dragon', rate: 0.4 }]
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
