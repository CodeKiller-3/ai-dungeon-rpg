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
          hp: p.hp, maxHp: p.maxHp, atk: p.atk, def: p.def,
          gold: p.gold, exp: p.exp, level: p.level,
          inventory: p.inventory, equipment: p.equipment, quests: p.quests
        }
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
        if (typeof s.maxHp === 'number') p.maxHp = s.maxHp;
        if (typeof s.atk === 'number') p.atk = s.atk;
        if (typeof s.def === 'number') p.def = s.def;
        if (typeof s.gold === 'number') p.gold = s.gold;
        if (typeof s.exp === 'number') p.exp = s.exp;
        if (typeof s.level === 'number') p.level = s.level;
        if (s.inventory) p.inventory = s.inventory;
        if (s.equipment) p.equipment = s.equipment;
        if (s.quests) p.quests = s.quests;
        Game.Systems.Quest.init();
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
