/* js/data/quests.js — 任务数据（PLAN.md §7.1 QUESTS Schema）
 * 主线：击败地牢深处的巨龙（通关条件，P2-3 起巨龙位于第 5 层）；支线：击杀计数与金币累计
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
      desc: '主线：击败地牢深处的巨龙'
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
    },
    /* P2-5：任务扩量 3→12——新增 9 条（分层击杀 / Boss 支线 / 抵达 / 等级 / 收集）。
     * floor/level 为"到达即完成"（progress 匹配后直接置满）；collect 与 kill 同构按 +1 累加 */
    {
      id: 'kill_goblins',
      type: 'kill', target: 'goblin', count: 5,
      reward: { gold: 40, exp: 25 },
      desc: '支线：清理 5 只哥布林'
    },
    {
      id: 'kill_orcs',
      type: 'kill', target: 'orc_warrior', count: 5,
      reward: { gold: 70, exp: 45 },
      desc: '支线：击退 5 名兽人战士'
    },
    {
      id: 'kill_undead',
      type: 'kill', target: 'skeleton', count: 5,
      reward: { gold: 60, exp: 40 },
      desc: '支线：净化 5 具骷髅'
    },
    {
      id: 'kill_zombies',
      type: 'kill', target: 'big_zombie', count: 3,
      reward: { gold: 90, exp: 60 },
      desc: '支线：重创 3 只大僵尸'
    },
    {
      id: 'slay_ogre_chief',
      type: 'kill', target: 'ogre_boss', count: 1,
      reward: { gold: 120, exp: 80 },
      desc: '支线：击败第 2 层独眼酋长'
    },
    {
      id: 'slay_zombie_king',
      type: 'kill', target: 'zombie_king', count: 1,
      reward: { gold: 160, exp: 110 },
      desc: '支线：击败第 4 层僵尸王'
    },
    {
      id: 'reach_floor3',
      type: 'floor', target: 3, count: 3,
      reward: { gold: 60, exp: 40 },
      desc: '支线：抵达第 3 层'
    },
    {
      id: 'level_5',
      type: 'level', target: 5, count: 5,
      reward: { gold: 80, exp: 60 },
      desc: '支线：达到 5 级'
    },
    {
      id: 'collect_potions',
      type: 'collect', target: 'potion_large', count: 3,
      reward: { gold: 50, exp: 30 },
      desc: '支线：收集 3 个大血瓶'
    }
  ];
})();
