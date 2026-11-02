/* js/data/skills.js — 技能数据（任务卡 M8-1，PLAN.md §14.3 / §15.4 M8-1）
 * 契约（docs/tasks/M8-1-skills.md §2.2）：
 *   key     战斗场景快捷键（数字键 4/5/6）
 *   mpCost  MP 消耗
 *   cd      冷却回合数（玩家每行动 1 次 -1）
 *   dmg     伤害公式：基于玩家 atk 的倍率（可复算，不硬编码）
 *   effect  增益公式：基于玩家 maxHp 的比例（可复算，不硬编码）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  Game.Data.SKILLS = {
    fireball: {
      name: '火球', key: 4, mpCost: 12, cd: 3,
      dmg: function (atk) { return Math.round(atk * 1.8); },
      desc: '远程火球，1.8×攻击伤害'
    },
    dash: {
      name: '冲刺', key: 5, mpCost: 8, cd: 2,
      dmg: function (atk) { return Math.round(atk * 1.2); },
      desc: '迅捷突刺，1.2×攻击伤害'
    },
    shield: {
      name: '护盾', key: 6, mpCost: 10, cd: 4,
      effect: function (p) { return Math.round(p.maxHp * 0.25); },
      desc: '抵消 25% 最大生命值的伤害'
    }
  };
})();
