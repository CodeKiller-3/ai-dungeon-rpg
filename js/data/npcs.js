/* js/data/npcs.js — 实体 NPC 与 NPC 任务数据（D-47）
 * 每个 NPC 固定在一个楼层、一个可达格上（位置由 map.js 的 placeNpc 确定性生成，
 * 不消耗 Math.random，因此不改变宝箱/怪物/奖励点的既有布局）。
 * 任务只在定义层内可完成；reward.exclusiveItem 是"任务专属装备"的数据留口，
 * 当前全部为 null —— D-47 只结算 gold/exp，不发装备。
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  Game.Data.NPCS = {
    /* 渲染占位：不引入新素材，render.js 用程序化色块画一个提灯守夜人 */
    list: [
      {
        id: 'warden_f1',
        name: '守夜人·洛恩',
        floor: 1,
        quest: {
          id: 'npc_f1_scout',
          title: '探路',
          /* 一层内闭环：NPC 站在"出生点→下行梯"主路 72% 处（离楼梯 3~6 步），
           * 接取后走到下行梯旁边即达成，再回头两步交付。不依赖战斗随机数，
           * 也不会因为下楼而永久错过（F1 的上行梯空转，但 F2 的上行梯能回来）。 */
          desc: '走到第一层下行梯旁查看，然后回来向守夜人复命',
          need: 1,
          event: 'nearStairs',
          reward: {
            gold: 60,
            exp: 0,
            /* 任务专属装备留口：非 null 时形如
             * { id:'warden_blade', name:'守夜人佩剑', type:'weapon',
             *   effect:{ atk:6 }, price:240, sell:60 }
             * NpcQuest.deliver 只读 gold/exp；exclusiveItem 仅作为数据表达，
             * D-47 不实现发放（不写背包、不写装备栏）。 */
            exclusiveItem: null
          }
        }
      }
    ]
  };
})();
