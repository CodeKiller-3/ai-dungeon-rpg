/* js/systems/bestiary.js — 图鉴收集系统（M8-4，纯新增模块）
 * 契约（docs/tasks/M8-4-bestiary.md §2.1）：
 *   Game.Systems.Bestiary.record(type, id)      // type: 'monster' | 'item'；计数 +1
 *   Game.Systems.Bestiary.getMonsterCount(id) -> number
 *   Game.Systems.Bestiary.getItemCount(id) -> number
 *   Game.Systems.Bestiary.data -> { monsters: {id:count}, items: {id:count} }（顶层引用，供存档/验证读取）
 * 登记点：battle.settleWin 胜利（怪物击杀 + 掉落物品）、shop.buy 购买成功（变体 id 原样登记）
 * 存档：save.js 顶层 bestiary 字段；load 时 mergeFrom 合并（计数取较大者，防旧档回退覆盖）
 * 图鉴只提供计数，不存储任何自由描述文案（防幻觉；展示层 modal.js 只读 Data 表字段 + 本计数 + ???）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  Game.Systems.Bestiary = {
    /* 运行时状态：顶层引用（save.js 序列化与验证页断言直接读这里） */
    data: { monsters: {}, items: {} },

    record: function (type, id) {
      if (!id) return;
      var bucket = (type === 'monster') ? this.data.monsters
        : (type === 'item') ? this.data.items : null;
      if (!bucket) return;
      bucket[id] = (bucket[id] || 0) + 1;
    },

    getMonsterCount: function (id) {
      return this.data.monsters[id] || 0;
    },

    getItemCount: function (id) {
      return this.data.items[id] || 0;
    },

    /* 修复 P2：死亡/重开时清空内存图鉴，与已清除的存档保持一致
     *（原实现只删磁盘存档，内存仍留计数，下一次保存会把旧图鉴写回） */
    reset: function () {
      this.data = { monsters: {}, items: {} };
    },

    /* 存档恢复合并：缺失（旧档无 bestiary 字段）静默保持默认空表；存在则逐项取较大计数 */
    mergeFrom: function (saved) {
      if (!saved) return;
      var sm = saved.monsters || {};
      var si = saved.items || {};
      for (var k in sm) {
        if (Object.prototype.hasOwnProperty.call(sm, k) && typeof sm[k] === 'number') {
          this.data.monsters[k] = Math.max(this.data.monsters[k] || 0, sm[k]);
        }
      }
      for (var k2 in si) {
        if (Object.prototype.hasOwnProperty.call(si, k2) && typeof si[k2] === 'number') {
          this.data.items[k2] = Math.max(this.data.items[k2] || 0, si[k2]);
        }
      }
    }
  };
})();
