/* js/systems/quest.js — 任务系统
 * 接口：init / progress / getActive / isDone（见 PLAN.md §4.4）
 * 来源：自写
 * 事件：quest:complete */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  Game.Systems.Quest = {
    /* 初始化任务状态（读档后补齐缺失项） */
    init: function () {
      var p = Game.Data.Player;
      if (!p.quests) p.quests = {};
      var list = Game.Data.QUESTS;
      for (var i = 0; i < list.length; i++) {
        if (!p.quests[list[i].id]) {
          p.quests[list[i].id] = { progress: 0, done: false };
        }
      }
    },

    /* 事件推进：type=kill 传怪物 id；type=gold 传金币数；
     * P2-5：type=floor/level 传到达值（>=target 即完成）；type=collect 传物品 id */
    progress: function (type, arg) {
      var p = Game.Data.Player;
      var list = Game.Data.QUESTS;
      var changed = false;
      for (var i = 0; i < list.length; i++) {
        var q = list[i];
        var st = p.quests[q.id];
        if (!st || st.done) continue;
        var match = false;
        if (q.type === 'kill' && type === 'kill' && q.target === arg) match = true;
        if (q.type === 'gold' && type === 'gold') match = true;
        /* P2-5：floor/level 到达即完成；collect 与 kill 同构按目标 id 匹配 */
        if (q.type === 'floor' && type === 'floor' && arg >= q.target) match = true;
        if (q.type === 'level' && type === 'level' && arg >= q.target) match = true;
        if (q.type === 'collect' && type === 'collect' && q.target === arg) match = true;
        if (match) {
          /* gold 按金额累加；floor/level 到达即置满；kill/collect 按 +1 累加 */
          if (q.type === 'gold') st.progress += arg;
          else if (q.type === 'floor' || q.type === 'level') st.progress = q.count;
          else st.progress += 1;
          if (st.progress >= q.count) {
            st.done = true;
            p.gold += q.reward.gold;
            p.exp += q.reward.exp;
            /* M8-6：任务奖励 exp 后统一走升级检查（Battle 未加载时跳过；幂等） */
            if (Game.Systems.Battle && typeof Game.Systems.Battle.checkLevelUp === 'function') {
              Game.Systems.Battle.checkLevelUp();
            }
            Game.Core.EventBus.emit('quest:complete', { id: q.id, reward: q.reward });
          }
          changed = true;
        }
      }
      return changed;
    },

    getActive: function () {
      var out = [];
      var list = Game.Data.QUESTS;
      var p = Game.Data.Player;
      for (var i = 0; i < list.length; i++) {
        var st = p.quests[list[i].id];
        if (st && !st.done) out.push({ q: list[i], progress: st.progress });
      }
      return out;
    },

    isDone: function (id) {
      var p = Game.Data.Player;
      return !!(p.quests && p.quests[id] && p.quests[id].done);
    }
  };
})();
