/* js/systems/skills.js — 技能运行时（任务卡 M8-1）
 * 接口契约（docs/tasks/M8-1-skills.md §2.3）：
 *   Game.Skills.cast(id) -> bool          检查 MP 与冷却 → 扣 MP、设冷却、触发效果；失败 emit ui:notice
 *   Game.Skills.getCooldown(id) -> number 剩余冷却回合（0=可用）
 *   Game.Skills.resetCooldowns()          新战斗开始时清零
 * 冷却口径：按回合计数（玩家每行动 1 次 -1，最小 0），不使用时间戳。
 * 效果触发：战斗中经 Game.Systems.Battle 的 applySkillDamage / applySkillShield 落到 battle state；
 *           非战斗场景调用 cast 只结算 MP/冷却（无目标可作用）。
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};

  var cooldowns = {}; /* id -> 剩余回合 */

  function notice(msg) {
    if (Game.Core && Game.Core.EventBus) {
      Game.Core.EventBus.emit('ui:notice', { msg: msg });
    }
  }

  Game.Skills = {
    /* 释放技能：先校验冷却与 MP（失败不扣资源、不进入行动序列），成功后扣 MP、设冷却、触发效果 */
    cast: function (id) {
      var def = Game.Data && Game.Data.SKILLS && Game.Data.SKILLS[id];
      var p = Game.Data && Game.Data.Player;
      if (!def || !p) { notice('技能不存在：' + id); return false; }

      var cd = cooldowns[id] || 0;
      if (cd > 0) {
        notice(def.name + ' 冷却中：剩余 ' + cd + ' 回合');
        return false;
      }
      var cost = def.mpCost;
      if ((p.mp || 0) < cost) {
        notice('MP 不足：' + def.name + ' 需要 ' + cost + ' 点（当前 ' + (p.mp || 0) + '）');
        return false;
      }

      p.mp -= cost;
      cooldowns[id] = def.cd;

      /* 触发效果：仅战斗中生效；battle.js 未就绪时静默跳过（降级） */
      var B = Game.Systems && Game.Systems.Battle;
      if (B && typeof B.getState === 'function' && B.getState()) {
        if (typeof def.dmg === 'function' && typeof B.applySkillDamage === 'function') {
          B.applySkillDamage(id, def);
        } else if (typeof def.effect === 'function' && typeof B.applySkillShield === 'function') {
          B.applySkillShield(id, def);
        }
      }
      return true;
    },

    getCooldown: function (id) {
      return cooldowns[id] || 0;
    },

    resetCooldowns: function () {
      cooldowns = {};
    },

    /* 回合推进：玩家每行动 1 次，除本次刚释放的技能外，其余冷却 -1（最小 0）
     * skipId：本次行动释放的技能 id（保留其刚设置的冷却，避免同一行动立刻 -1） */
    tick: function (skipId) {
      for (var id in cooldowns) {
        if (!cooldowns.hasOwnProperty(id)) continue;
        if (skipId && id === skipId) continue;
        if (cooldowns[id] > 0) cooldowns[id]--;
      }
    },

    /* 验证页/调试用：当前冷却快照 */
    _cooldowns: function () {
      var o = {};
      for (var id in cooldowns) {
        if (cooldowns.hasOwnProperty(id)) o[id] = cooldowns[id];
      }
      return o;
    }
  };
})();
