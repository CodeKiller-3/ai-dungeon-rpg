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
    enemyTable: [                               /* 每层怪物概率表（M2 使用；P2-1 三层扩为 3~4 种，概率和均为 1） */
      /* P2-1：1 层主题"地牢杂兵"（slime/bat/goblin/tiny_zombie），期望强度 10.8→11.125 */
      [{ id: 'slime', rate: 0.45 }, { id: 'bat', rate: 0.3 },
        { id: 'goblin', rate: 0.15 }, { id: 'tiny_zombie', rate: 0.1 }],
      /* P2-1：2 层主题"兽人营地"（bat/skeleton/orc_warrior/orc_shaman），期望强度 15.5→20.125 */
      [{ id: 'bat', rate: 0.15 }, { id: 'skeleton', rate: 0.3 },
        { id: 'orc_warrior', rate: 0.3 }, { id: 'orc_shaman', rate: 0.25 }],
      /* P2-1：3 层主题"龙巢"（skeleton/dragon/ogre/wogol），dragon 仅此层；期望强度 22.5→27.5。
       * imp 目前只作 bat 的视觉帧组，不占出现位（任务卡允许留待 P2-3） */
      [{ id: 'skeleton', rate: 0.3 }, { id: 'dragon', rate: 0.25 },
        { id: 'ogre', rate: 0.25 }, { id: 'wogol', rate: 0.2 }]
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
