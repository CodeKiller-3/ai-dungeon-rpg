/* js/data/quests.js — 任务数据（PLAN.md §7.1 QUESTS Schema）
 * 主线：击败第 3 层巨龙（通关条件）；支线：击杀计数与金币累计
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  Game.Data.QUESTS = [
    {
      id: 'main_clear_dragon',
      type: 'kill', target: 'dragon', count: 1,
      reward: { gold: 200, exp: 100 },
      desc: '主线：击败地牢深处的巨龙（第3层）'
    },
    {
      id: 'kill_slimes',
      type: 'kill', target: 'slime', count: 5,
      reward: { gold: 30, exp: 20 },
      desc: '支线：击败 5 只史莱姆'
    },
    {
      id: 'gold_rich',
      type: 'gold', target: 100, count: 100,
      reward: { gold: 50, exp: 30 },
      desc: '支线：累计获得 100 金币'
    }
  ];
})();
