/* js/systems/motion.js — 格子间移动平滑插值（任务卡 M9-3，PLAN.md §16.6 A-4）
 * 契约（docs/tasks/M9-3-animation.md，纯新增渲染层，逻辑语义不变）：
 *   Game.Motion.setStep(entityId, fromX, fromY, toX, toY, durationMs)  登记一次格子间移动
 *   Game.Motion.getRenderPos(entityId) -> {x, y, t}                     插值后渲染坐标（格坐标）
 *   Game.Motion.update(dtMs)                                            推进插值计时
 *   Game.Motion.clear()                                                 清空所有插值
 * 设计：
 *   - 逻辑层不动：Map/怪物逻辑坐标、FOV、碰撞全部仍用格子坐标；getRenderPos 只给渲染层取视觉位置
 *   - 插值：t = clamp(elapsed/duration, 0, 1)，位置 = from + (to-from) * easeOutQuad(t)
 *   - easeOutQuad：t' = 1 - (1-t)^2，起步快、收尾缓，符合"滑动"手感
 *   - 未登记移动的实体 getRenderPos 返回 null（调用方降级用逻辑坐标）
 *   - 同一 entityId 重复 setStep 会覆盖（移动中再次移动以新目标为准）
 * 依赖：无（纯数据状态机，坐标单位为格，由调用方 *TILE 换算像素）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};

  var steps = {}; /* entityId -> { fromX, fromY, toX, toY, duration, elapsed } */

  /* easeOutQuad：t ∈ [0,1] → [0,1]，单调递增，起步快收尾缓 */
  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  Game.Motion = {
    /* 登记一次格子间移动。from/to 为格坐标，durationMs 为插值时长 */
    setStep: function (entityId, fromX, fromY, toX, toY, durationMs) {
      if (!entityId) return;
      var dur = (typeof durationMs === 'number' && durationMs > 0) ? durationMs : 140;
      steps[entityId] = {
        fromX: fromX, fromY: fromY,
        toX: toX, toY: toY,
        duration: dur,
        elapsed: 0
      };
    },

    /* 返回插值后的渲染坐标 {x, y, t}；未登记或已完成返回 null（调用方用逻辑坐标） */
    getRenderPos: function (entityId) {
      var s = steps[entityId];
      if (!s) return null;
      var t = clamp(s.elapsed / s.duration, 0, 1);
      var e = easeOutQuad(t);
      return {
        x: s.fromX + (s.toX - s.fromX) * e,
        y: s.fromY + (s.toY - s.fromY) * e,
        t: t
      };
    },

    /* 推进所有插值计时；已完成的条目保留（getRenderPos 返回终点），由 clear 或新 setStep 清理 */
    update: function (dtMs) {
      var dt = (typeof dtMs === 'number' && dtMs > 0) ? dtMs : 0;
      for (var id in steps) {
        if (!steps.hasOwnProperty(id)) continue;
        var s = steps[id];
        s.elapsed += dt;
        if (s.elapsed >= s.duration) {
          s.elapsed = s.duration; /* 钳制到终点，避免浮点溢出 */
        }
      }
    },

    /* 清空所有插值（换层/重置时调用） */
    clear: function () {
      steps = {};
    },

    /* 调试用：当前登记的插值数 */
    _size: function () {
      var n = 0;
      for (var id in steps) { if (steps.hasOwnProperty(id)) n++; }
      return n;
    }
  };
})();
