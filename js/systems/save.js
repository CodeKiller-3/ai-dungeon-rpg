/* js/systems/save.js — 存档系统（localStorage，PLAN.md §7.1 SAVE Schema）
 * 接口：save / load / clear（见 PLAN.md §4.4）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var KEY = 'ai_dungeon_rpg_save_v1';

  Game.Systems.Save = {
    save: function () {
      var p = Game.Data.Player;
      var data = {
        savedAt: new Date().toISOString(),
        floor: Game.Systems.Map.getFloor(),
        player: {
          hp: p.hp, maxHp: p.maxHp,
          mp: p.mp, maxMp: p.maxMp, /* M8-1：MP 存档字段 */
          atk: p.atk, def: p.def,
          gold: p.gold, exp: p.exp, level: p.level,
          inventory: p.inventory, equipment: p.equipment, quests: p.quests,
          /* S-03：强化等级表（按物品 id）；旧档无此字段时读档补 {} */
          upg: p.upg || {}
        },
        /* M8-4：图鉴存档顶层字段（Bestiary 未加载时补默认空表；JSON 序列化时值展开） */
        bestiary: (Game.Systems.Bestiary && Game.Systems.Bestiary.data)
          ? Game.Systems.Bestiary.data : { monsters: {}, items: {} }
      };
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
        return true;
      } catch (e) {
        return false;
      }
    },

    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return null;
        var data = JSON.parse(raw);
        var p = Game.Data.Player;
        var s = data.player || {};
        if (typeof s.hp === 'number') p.hp = s.hp;
        /* M8-1：旧存档（无 mp/maxMp）补默认 50，不破坏旧档 */
        if (typeof s.maxMp === 'number') p.maxMp = s.maxMp; else p.maxMp = 50;
        if (typeof s.mp === 'number') p.mp = s.mp; else p.mp = p.maxMp;
        if (typeof s.gold === 'number') p.gold = s.gold;
        if (typeof s.exp === 'number') p.exp = s.exp;
        if (typeof s.level === 'number') p.level = s.level;
        if (s.inventory) p.inventory = s.inventory;
        if (s.equipment) p.equipment = s.equipment;
        if (s.quests) p.quests = s.quests;
        /* S-03：旧档无 upg 字段 → 补空表，不破坏已读档的既有数值 */
        p.upg = (s.upg && typeof s.upg === 'object') ? s.upg : {};
        /* S-04：状态效果不入档（读档时清空），避免"读档即中毒"与存档瞬间掉血 */
        p.status = {};
        /* M8-6：不信任旧档 atk/def/maxHp 持久值——按当前等级成长规则重算（含装备加成），
         * hp 超新上限时钳制（避免旧档错值带入新成长体系） */
        if (Game.Systems.Inventory && typeof Game.Systems.Inventory.recalcEquip === 'function') {
          Game.Systems.Inventory.recalcEquip();
        } else {
          var lv = (typeof p.level === 'number' && p.level >= 1) ? p.level : 1;
          p.atk = 10 + (lv - 1);
          p.def = 5 + (lv - 1);
          p.maxHp = 100 + (lv - 1) * 10;
          if (p.hp > p.maxHp) p.hp = p.maxHp;
        }
        Game.Systems.Quest.init();
        /* M8-4：图鉴恢复——旧档无 bestiary 字段时 mergeFrom(undefined) 静默保持默认空表；
         * 有则逐项合并取较大计数（防旧档回退覆盖新进度） */
        if (Game.Systems.Bestiary && typeof Game.Systems.Bestiary.mergeFrom === 'function') {
          Game.Systems.Bestiary.mergeFrom(data.bestiary);
        }
        /* 恢复到存档楼层 */
        var targetFloor = data.floor || 1;
        var cur = Game.Systems.Map.getFloor();
        var diff = targetFloor - cur;
        if (diff > 0) { for (var i = 0; i < diff; i++) Game.Systems.Map.changeFloor(1); }
        else if (diff < 0) { for (var j = 0; j < -diff; j++) Game.Systems.Map.changeFloor(-1); }
        var sp = Game.Systems.Map.getSpawn();
        p.x = sp.x;
        p.y = sp.y;
        p.floor = Game.Systems.Map.getFloor();
        return data;
      } catch (e) {
        return null;
      }
    },

    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    }
  };
})();
