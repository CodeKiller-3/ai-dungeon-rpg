/* js/systems/save.js — 存档系统（localStorage，PLAN.md §7.1 SAVE Schema）
 * 接口：save / load / clear（见 PLAN.md §4.4）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var KEY = 'ai_dungeon_rpg_save_v1';

  /* D-15：存档结构版本号。v1 = 只有玩家/图鉴（旧档无该字段，读档时视为 1）；
   * v2 = 追加 map（地图/怪物/宝箱/陷阱/巡逻的每层快照）。键名不变，只新增字段。 */
  var SAVE_VERSION = 2;

  Game.Systems.Save = {
    save: function () {
      var p = Game.Data.Player;
      var M = Game.Systems.Map;
      var data = {
        saveVersion: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        floor: M.getFloor(),
        player: {
          hp: p.hp, maxHp: p.maxHp,
          mp: p.mp, maxMp: p.maxMp, /* M8-1：MP 存档字段 */
          atk: p.atk, def: p.def,
          gold: p.gold, exp: p.exp, level: p.level,
          inventory: p.inventory, equipment: p.equipment, quests: p.quests,
          /* S-03：强化等级表（按物品 id）；旧档无此字段时读档补 {} */
          upg: p.upg || {},
          /* D-47：NPC 任务四态（旧档无此字段，读档补 {}，不报错） */
          npcQuests: p.npcQuests || {}
        },
        /* M8-4：图鉴存档顶层字段（Bestiary 未加载时补默认空表；JSON 序列化时值展开） */
        bestiary: (Game.Systems.Bestiary && Game.Systems.Bestiary.data)
          ? Game.Systems.Bestiary.data : { monsters: {}, items: {} },
        /* D-15：地图状态（玩家到过的每层快照）。没有它刷新就会重生成整张图，
         * 于是宝箱/怪物可以反复刷。exportState 返回深拷贝，与运行期互不引用。 */
        map: (M && typeof M.exportState === 'function') ? M.exportState() : null
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
        /* D-15：旧档无 saveVersion 字段 → 视为 v1（只有玩家/图鉴，没有地图快照） */
        var ver = (typeof data.saveVersion === 'number' && data.saveVersion >= 1)
          ? Math.floor(data.saveVersion) : 1;
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
        /* D-27：旧档不补发起手武器——缺 equipment 字段的极老档明确落回"无装备"，
         * 不能继承新档初值（否则等于给老玩家凭空发刀，且在降级路径上有重复发放风险）。 */
        p.equipment = s.equipment || { weapon: null, armor: null };
        if (s.quests) p.quests = s.quests;
        /* S-03：旧档无 upg 字段 → 补空表，不破坏已读档的既有数值 */
        p.upg = (s.upg && typeof s.upg === 'object') ? s.upg : {};
        /* D-47：旧档（D-46 及之前）无 npcQuests → 补 {}；缺失不影响任何既有字段 */
        p.npcQuests = (s.npcQuests && typeof s.npcQuests === 'object') ? s.npcQuests : {};
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
        /* D-47：NPC 任务状态补齐（旧档无字段 → 全部未接取，可正常接取/交付） */
        if (Game.Systems.NpcQuest && typeof Game.Systems.NpcQuest.init === 'function') {
          Game.Systems.NpcQuest.init();
        }
        /* M8-4：图鉴恢复——旧档无 bestiary 字段时 mergeFrom(undefined) 静默保持默认空表；
         * 有则逐项合并取较大计数（防旧档回退覆盖新进度） */
        if (Game.Systems.Bestiary && typeof Game.Systems.Bestiary.mergeFrom === 'function') {
          Game.Systems.Bestiary.mergeFrom(data.bestiary);
        }
        /* 恢复到存档楼层 */
        var targetFloor = data.floor || 1;
        var M = Game.Systems.Map;
        /* D-15：优先用存档里的地图快照恢复现场（地图/怪物/宝箱/陷阱/巡逻），
         * 这样刷新后"已开的箱、已杀的怪"不会被重生成，无法反复刷资源。
         * 只有"缺 map 字段 / 版本或结构不合法 / 存档层没有快照"才降级。 */
        var restored = false;
        if (data.map && typeof M.importState === 'function') {
          var mi = (typeof data.map.floorIndex === 'number') ? Math.floor(data.map.floorIndex) : -1;
          if (mi + 1 === targetFloor) { /* 版本内自洽：floorIndex 与 floor 必须对应同一层 */
            try { restored = M.importState(data.map) === true; } catch (e) { restored = false; }
          }
        }
        if (restored) {
          /* 命中缓存分支：恢复地图/敌人/装饰/陷阱/巡逻（含 AI.setPatrols）。
           * quietQuest：读档不是"到达该层"，不能重复推进楼层任务、重复发奖励。 */
          M.generate({ quietQuest: true });
        } else {
          var cur = M.getFloor();
          var diff = targetFloor - cur;
          if (diff > 0) { for (var i = 0; i < diff; i++) M.changeFloor(1); }
          else if (diff < 0) { for (var j = 0; j < -diff; j++) M.changeFloor(-1); }
        }
        var sp = M.getSpawn();
        p.x = sp.x;
        p.y = sp.y;
        p.floor = M.getFloor();
        /* D-15：降级只发生一次——重建出来的地图立即固化为 v2 档，
         * 之后再刷新直接命中快照，不会每次重生成；并用提示条告知一次（D-14 通道）。 */
        if (!restored) {
          Game.Systems.Save.save();
          Game.Core.EventBus.emit('ui:notice', {
            msg: ver < 2 ? '存档已升级：地图重建了一次，此后不再重置'
                         : '存档地图数据不可用，已重建一次'
          });
        }
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
