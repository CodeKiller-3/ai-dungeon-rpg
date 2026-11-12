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
            /* D-15：任务奖励会加金币/经验（经验可能直接升级），也必须落盘；
             * 战斗内完成的任务本次会被 battle:end 的写档覆盖，这里多写一次是幂等的。 */
            if (Game.Systems.Save && typeof Game.Systems.Save.save === 'function') {
              Game.Systems.Save.save();
            }
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

  /* ── D-47：NPC 任务（四态：unaccepted / active / ready / done） ─────────
   * 与上面的固定 QUESTS 完全分离：不写 Player.quests、不发经验、不参与主线判定，
   * 状态只存在 Player.npcQuests（存档新增字段，旧档缺省补 {}）。
   * 状态由 accepted / progress / delivered 三个布尔+计数推导，四态天然互斥。
   * 进度事件 = "走到下行梯旁"（Chebyshev 距离 1，不含楼梯格本身），由 main.js 每步调用
   * checkPosition 推进；不依赖战斗随机数，所以一层内必定可完成。 */
  var NPC_STATES = { UNACCEPTED: 'unaccepted', ACTIVE: 'active', READY: 'ready', DONE: 'done' };

  function npcList() {
    var cfg = Game.Data && Game.Data.NPCS;
    return (cfg && Array.isArray(cfg.list)) ? cfg.list : [];
  }
  function npcDef(id) {
    var list = npcList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function npcDefOnFloor(floor) {
    var list = npcList();
    for (var i = 0; i < list.length; i++) if (list[i].floor === floor) return list[i];
    return null;
  }
  function npcRecord(id) {
    var p = Game.Data.Player;
    if (!p.npcQuests || typeof p.npcQuests !== 'object') p.npcQuests = {};
    var st = p.npcQuests[id];
    if (!st || typeof st !== 'object') {
      st = p.npcQuests[id] = { accepted: false, progress: 0, delivered: false };
    }
    if (typeof st.accepted !== 'boolean') st.accepted = false;
    if (typeof st.delivered !== 'boolean') st.delivered = false;
    if (typeof st.progress !== 'number' || !isFinite(st.progress)) st.progress = 0;
    return st;
  }
  function npcStateOf(id) {
    var def = npcDef(id);
    if (!def) return 'none';
    var st = npcRecord(id);
    var need = (def.quest && def.quest.need) || 1;
    if (st.delivered) return NPC_STATES.DONE;
    if (!st.accepted) return NPC_STATES.UNACCEPTED;
    if (st.progress >= need) return NPC_STATES.READY;
    return NPC_STATES.ACTIVE;
  }
  function npcSave() {
    if (Game.Systems.Save && typeof Game.Systems.Save.save === 'function') {
      Game.Systems.Save.save();
    }
  }

  /* ── D-55：任务指引（只读，不入档）─────────────────────────────
   * 目标：接了「探路」之后，HUD 给出真实可走的方向与步数。
   * 只指引已接任务：unaccepted / done 一律 null；active 指"下行梯旁"，
   * ready 指本层可复命的 NPC。全部用 BFS 实测，不读 FOV/未探索状态。 */
  var GUIDE_DIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]]; /* 上/左/下/右：并列固定取先者 */

  /* 可走 = 地板；会真正传送的楼梯不是走廊，指引绝不从梯子上穿过去。
   * 与 D-18 的真实移动语义一致：第 1 层的上行梯、最深层的下行梯是空转，等同地板。 */
  function guideWalkable(x, y) {
    var Map = Game.Systems.Map;
    if (!Map || typeof Map.tileAt !== 'function') return false;
    var t = Map.tileAt(x, y);
    if (t === 0) return false;
    var p = Game.Data && Game.Data.Player;
    var floor = p ? p.floor : 1;
    var total = (Game.Data && Game.Data.MAPS && Game.Data.MAPS.floors) || 5;
    if (t === 2 && floor < total) return false;
    if (t === 3 && floor > 1) return false;
    return true;
  }

  /* 下行梯"旁边"的可站立格（Chebyshev 1，与 checkPosition 的达成判定同口径） */
  function stairsSideCells() {
    var Map = Game.Systems.Map;
    var g = Map && typeof Map.getGrid === 'function' ? Map.getGrid() : null;
    var out = [];
    if (!g) return out;
    var ring = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    for (var y = 0; y < g.length; y++) {
      for (var x = 0; x < g[y].length; x++) {
        if (g[y][x] !== 2) continue;
        for (var i = 0; i < ring.length; i++) {
          var nx = x + ring[i][0], ny = y + ring[i][1];
          if (Map.tileAt(nx, ny) === 1) out.push({ x: nx, y: ny });
        }
      }
    }
    return out;
  }

  /* 单源 BFS：返回 {x,y,distance,dir:{dx,dy}}；dir 是"从起点出发的第一步"。
   * target(x,y) 为目标判定；起点本身是目标时 dir=null、distance=0。 */
  function bfsGuide(sx, sy, target) {
    var seen = {}, q = [{ x: sx, y: sy, d: 0, first: null }], qi = 0;
    seen[sx + ',' + sy] = 1;
    while (qi < q.length) {
      var c = q[qi++];
      if (target(c.x, c.y)) return { x: c.x, y: c.y, distance: c.d, dir: c.first };
      for (var i = 0; i < GUIDE_DIRS.length; i++) {
        var nx = c.x + GUIDE_DIRS[i][0], ny = c.y + GUIDE_DIRS[i][1];
        if (!guideWalkable(nx, ny)) continue;
        var key = nx + ',' + ny;
        if (seen[key]) continue;
        seen[key] = 1;
        q.push({
          x: nx, y: ny, d: c.d + 1,
          first: c.first || { dx: GUIDE_DIRS[i][0], dy: GUIDE_DIRS[i][1] }
        });
      }
    }
    return null;
  }

  function shortName(def) {
    var n = (def && def.name) || '目标';
    var k = n.indexOf('·');
    return k > 0 ? n.slice(0, k) : n;
  }

  Game.Systems.NpcQuest = {
    STATES: NPC_STATES,

    /* 读档后补齐：只保证 npcQuests 是可写对象；未知 id 原样保留（前向兼容） */
    init: function () {
      var p = Game.Data.Player;
      if (!p.npcQuests || typeof p.npcQuests !== 'object') p.npcQuests = {};
      var list = npcList();
      for (var i = 0; i < list.length; i++) npcRecord(list[i].id);
    },

    /* 测试/重开用：清空所有 NPC 任务状态 */
    reset: function () {
      Game.Data.Player.npcQuests = {};
      this.init();
    },

    def: npcDef,
    defOnFloor: npcDefOnFloor,
    list: npcList,
    state: npcStateOf,

    /* 只读快照（验证页与面板共用） */
    get: function (id) {
      var def = npcDef(id);
      if (!def) return null;
      var st = npcRecord(id);
      var need = (def.quest && def.quest.need) || 1;
      return {
        id: id, state: npcStateOf(id),
        accepted: st.accepted, delivered: st.delivered,
        progress: Math.min(st.progress, need), need: need,
        def: def, quest: def.quest || null
      };
    },

    /* 距离判定：相邻格（含斜向）才可交互；距离 0（站在 NPC 格上）也算相邻 */
    nearby: function (x, y) {
      var Map = Game.Systems.Map;
      if (!Map || typeof Map.getNpcs !== 'function') return null;
      var ns = Map.getNpcs();
      for (var i = 0; i < ns.length; i++) {
        var d = Math.max(Math.abs(x - ns[i].x), Math.abs(y - ns[i].y));
        if (d <= 1 && npcDef(ns[i].id)) return { id: ns[i].id, x: ns[i].x, y: ns[i].y, distance: d };
      }
      return null;
    },

    accept: function (id) {
      var def = npcDef(id);
      if (!def) return { ok: false, msg: '这个人不想说话', state: 'none' };
      if (npcStateOf(id) !== NPC_STATES.UNACCEPTED) {
        return { ok: false, msg: '任务已经接过了', state: npcStateOf(id) };
      }
      var st = npcRecord(id);
      st.accepted = true;
      st.progress = 0;
      st.delivered = false;
      Game.Core.EventBus.emit('npc:accepted', { id: id, questId: def.quest.id });
      this.checkPosition(Game.Data.Player.x, Game.Data.Player.y);
      npcSave();
      return { ok: true, msg: '接取任务：' + def.quest.title, state: npcStateOf(id) };
    },

    /* 进度判定：玩家当前格是否紧邻一个"会换层的下行梯"。
     * 只认 Chebyshev 距离 1（含斜向），不含楼梯格自身——踩上楼梯就换层，
     * 那不是"查看"，也不是本任务要的动作。 */
    checkPosition: function (x, y) {
      var Map = Game.Systems.Map;
      if (!Map || typeof Map.tileAt !== 'function') return null;
      var p = Game.Data.Player;
      var def = npcDefOnFloor(p.floor);
      if (!def) return null;
      if (npcStateOf(def.id) !== NPC_STATES.ACTIVE) return null;
      var dirs = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
      for (var i = 0; i < dirs.length; i++) {
        if (Map.tileAt(x + dirs[i][0], y + dirs[i][1]) !== 2) continue;
        var st = npcRecord(def.id);
        st.progress = (def.quest && def.quest.need) || 1;
        Game.Core.EventBus.emit('npc:ready', { id: def.id, questId: def.quest.id });
        npcSave();
        return NPC_STATES.READY;
      }
      return null;
    },

    /* 交付：只有 ready 才发奖；done 后重复调用一律拒绝（不重复加钱）。
     * 奖励只读 gold/exp；exclusiveItem 仅为数据留口，D-47 不发放。 */
    deliver: function (id) {
      var def = npcDef(id);
      if (!def) return { ok: false, msg: '这个人不想说话', state: 'none' };
      var st = npcStateOf(id);
      if (st === NPC_STATES.DONE) return { ok: false, msg: '任务已经交付过了', state: st, gold: 0 };
      if (st !== NPC_STATES.READY) return { ok: false, msg: '任务还没完成', state: st, gold: 0 };
      var p = Game.Data.Player;
      var rw = def.quest.reward || {};
      var gold = typeof rw.gold === 'number' ? rw.gold : 0;
      var exp = typeof rw.exp === 'number' ? rw.exp : 0;
      npcRecord(id).delivered = true;
      p.gold += gold;
      p.exp += exp;
      if (exp > 0 && Game.Systems.Battle && typeof Game.Systems.Battle.checkLevelUp === 'function') {
        Game.Systems.Battle.checkLevelUp();
      }
      Game.Core.EventBus.emit('npc:delivered', { id: id, questId: def.quest.id, gold: gold, exp: exp });
      /* 复用既有任务完成通道：钱包/提示/金币账（D-46 的 quest 分类）都认这一条 */
      Game.Core.EventBus.emit('quest:complete', {
        id: def.quest.id,
        reward: { gold: gold, exp: exp, exclusiveItem: rw.exclusiveItem || null }
      });
      npcSave();
      return {
        ok: true, msg: '任务完成：+金币' + gold + (exp ? ' +经验' + exp : ''),
        state: NPC_STATES.DONE, gold: gold, exp: exp,
        exclusiveItem: rw.exclusiveItem || null
      };
    },

    /* D-55：HUD 指引快照。只读；state 不入档，由 npcQuests 推导。
     * 返回 null 的场景：设置关闭 / 非探索场景 / 无本层 NPC / 未接取 / 已交付 /
     * 找不到可走目标。返回 {kind,label,target,distance,dir}。 */
    guidance: function () {
      var M = Game.Core && Game.Core.Main;
      var Map = Game.Systems.Map;
      var p = Game.Data && Game.Data.Player;
      if (!M || !Map || !p) return null;
      if (M._scene && M._scene !== 'explore') return null;
      var s = (typeof M.getSettings === 'function') ? M.getSettings() : null;
      if (s && s.guide === false) return null;
      var def = npcDefOnFloor(p.floor);
      if (!def) return null;
      var st = npcStateOf(def.id);
      if (st !== NPC_STATES.ACTIVE && st !== NPC_STATES.READY) return null;
      if (st === NPC_STATES.READY) {
        var ns = (typeof Map.getNpcs === 'function') ? Map.getNpcs() : [];
        var npc = null;
        for (var i = 0; i < ns.length; i++) if (ns[i].id === def.id) { npc = ns[i]; break; }
        if (!npc) return null;
        var r = bfsGuide(p.x, p.y, function (x, y) { return x === npc.x && y === npc.y; });
        if (!r) return null;
        return {
          kind: 'npc', label: shortName(def), target: { x: npc.x, y: npc.y },
          distance: r.distance, dir: r.dir
        };
      }
      var cells = stairsSideCells();
      if (!cells.length) return null;
      var r2 = bfsGuide(p.x, p.y, function (x, y) {
        for (var j = 0; j < cells.length; j++) if (cells[j].x === x && cells[j].y === y) return true;
        return false;
      });
      if (!r2) return null;
      return {
        kind: 'stairs', label: '下行梯', target: { x: r2.x, y: r2.y },
        distance: r2.distance, dir: r2.dir
      };
    },

    /* 任务面板行（modal 'npcquest' 的数据源；纯只读快照） */
    panel: function (id) {
      var def = npcDef(id);
      if (!def) return [];
      var q = def.quest || {};
      var st = npcRecord(id);
      var state = npcStateOf(id);
      var need = q.need || 1;
      var prog = Math.min(st.progress, need);
      var label = { unaccepted: '未接取', active: '进行中', ready: '可交付', done: '已交付' }[state] || state;
      var rw = q.reward || {};
      var rows = [
        { type: 'npc', text: def.name + '：' + (q.desc || '') },
        { type: 'state', text: '状态：' + label },
        { type: 'progress', text: '进度：' + prog + '/' + need }
      ];
      if (rw.gold) rows.push({ type: 'reward', text: '奖励：' + rw.gold + ' 金币' + (rw.exclusiveItem ? ' + 任务专属装备' : '') });
      if (state === NPC_STATES.UNACCEPTED) rows.push({ type: 'action', text: '按 Enter 接取任务' });
      else if (state === NPC_STATES.READY) rows.push({ type: 'action', text: '按 Enter 交付任务' });
      else if (state === NPC_STATES.DONE) rows.push({ type: 'action', text: '已交付，没有更多奖励' });
      else rows.push({ type: 'action', text: '走到下行梯旁查看，再回来复命' });
      return rows;
    }
  };
})();
