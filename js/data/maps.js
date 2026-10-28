/* js/data/maps.js — 地图配置（PLAN.md §7.1 MAPS Schema）
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
})();
