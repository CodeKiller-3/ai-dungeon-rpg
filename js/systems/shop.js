/* js/systems/shop.js — 商店系统（按楼层解锁货架）
 * 接口：getStock / buy / sell（见 PLAN.md §4.4）
 * 来源：自写
 * 事件：shop:changed */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  /* S-01：确定性换货状态——
   * tick = 本层已开张次数，(楼层×3 + tick) 取模决定轮换窗口起点；
   * 换层时 tick 归零，保证"回到同一层首页货架一致"。全程不使用 Math.random。
   * C-02：新局由 resetPhase() 显式归零（restart 调用），避免新局沿用上一局相位。 */
  var ROT_SLOTS = 2;   /* 每次展示的轮换商品位数量 */
  var tick = 0;
  var tickFloor = 0;

  function syncFloor(floor) {
    if (floor !== tickFloor) { tickFloor = floor; tick = 0; }
  }

  function rowOf(list, floor) {
    if (!list || !list.length) return [];
    return list[Math.min(floor - 1, list.length - 1)] || [];
  }

  Game.Systems.Shop = {
    /* 货架 = 本层核心货架（常驻）+ 轮换池窗口（2 位，按 tick 滑动）。
     * 纯函数式读取：不调用 getStock 不会改变 tick，因此同一层同一时刻结果稳定。 */
    getStock: function () {
      var floor = Game.Systems.Map.getFloor();
      syncFloor(floor);
      var core = rowOf(Game.Data.SHOP_STOCK, floor);
      var pool = rowOf(Game.Data.SHOP_ROTATION, floor);
      var out = [], seen = {};
      var i, id;
      for (i = 0; i < core.length; i++) {
        id = core[i];
        if (seen[id] || !Game.Data.ITEMS[id]) continue;
        seen[id] = 1;
        out.push({ id: id, item: Game.Data.ITEMS[id] });
      }
      if (pool.length) {
        var start = (floor * 3 + tick) % pool.length;
        var added = 0;
        for (i = 0; i < pool.length && added < ROT_SLOTS; i++) {
          id = pool[(start + i) % pool.length];
          if (seen[id] || !Game.Data.ITEMS[id]) continue;
          seen[id] = 1;
          out.push({ id: id, item: Game.Data.ITEMS[id] });
          added++;
        }
      }
      /* S-03：每层固定 1 张强化卷轴（独立货位，不动核心货架均价口径） */
      var sc = (Game.Data.SHOP_SCROLLS || [])[Math.min(floor - 1, (Game.Data.SHOP_SCROLLS || []).length - 1)];
      if (sc && !seen[sc] && Game.Data.ITEMS[sc]) {
        out.push({ id: sc, item: Game.Data.ITEMS[sc] });
      }
      return out;
    },

    /* 开张换货：每次打开商店调用一次（Modal.open → 这里），tick 前进 1 格。
     * 返回新的 tick，便于验证页断言"可复现序列"。 */
    refresh: function () {
      var floor = Game.Systems.Map.getFloor();
      syncFloor(floor);
      tick++;
      return tick;
    },

    /* C-02：新局相位归零——只重置计数并把楼层对齐当前层，不推进 tick。
     * 与 refresh() 语义相反：refresh 每开张推进 1 位，这里只回到首相位。
     * 换层归零仍由 syncFloor 负责；两者都归零时不重复推进（此处不含 tick++）。 */
    resetPhase: function () {
      tick = 0;
      tickFloor = (Game.Systems.Map && typeof Game.Systems.Map.getFloor === 'function')
        ? Game.Systems.Map.getFloor() : 0;
      return tick;
    },

    buy: function (id) {
      var p = Game.Data.Player;
      var item = Game.Data.ITEMS[id];
      if (!item) return { ok: false, msg: '商品不存在' };
      if (p.gold < item.price) return { ok: false, msg: '金币不足' };
      p.gold -= item.price;
      Game.Systems.Inventory.add(id, 1);
      /* M8-4：图鉴登记——购买成功登记物品（守卫式调用，无硬依赖） */
      if (Game.Systems.Bestiary && typeof Game.Systems.Bestiary.record === 'function') {
        Game.Systems.Bestiary.record('item', id);
      }
      Game.Core.EventBus.emit('audio:play', { sfx: 'buy' });
      Game.Core.EventBus.emit('shop:changed', { action: 'buy', id: id });
      return { ok: true, msg: '购买 ' + item.name + '，花费 ' + item.price + ' 金币' };
    },

    sell: function (id) {
      var p = Game.Data.Player;
      var item = Game.Data.ITEMS[id];
      if (!item) return { ok: false, msg: '物品不存在' };
      if (!p.inventory[id] || p.inventory[id] <= 0) return { ok: false, msg: '没有该物品' };
      /* 已装备的不可卖 */
      if (p.equipment.weapon === id || p.equipment.armor === id) return { ok: false, msg: '已装备，请先卸下' };
      Game.Systems.Inventory.remove(id, 1);
      p.gold += item.sell;
      Game.Core.EventBus.emit('shop:changed', { action: 'sell', id: id });
      return { ok: true, msg: '出售 ' + item.name + '，获得 ' + item.sell + ' 金币' };
    }
  };
})();
