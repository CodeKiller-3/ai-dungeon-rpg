/* js/systems/modal.js — 游戏内弹窗系统（S3-3，参考 Shattered Pixel Dungeon 物品栏弹窗）
 * 契约（docs/tasks/S3-3-modal.md，纯新增，不改既有接口）：
 *   Game.Modal.open(kind)   // kind: 'inventory' | 'shop' | 'quests'
 *   Game.Modal.close()
 *   Game.Modal.isOpen() -> bool
 *   Game.Modal.current() -> kind | null
 *   Game.Modal.draw()        // 绘制半透明遮罩 + 居中面板
 * 行为：
 *   - Esc 或点击面板外遮罩 → 关闭并清掉 Input 残留按键
 *   - ↑↓/WS 选择，Enter 确认（消耗品使用 / 武器防具装备 / 商店买 / 卖；任务仅查看）
 *   - 商店按 Tab 切换 购买/出售
 *   - 点击条目行 = 直接执行该条目操作
 * 数据：use/equip/buy/sell 仍由 Game.Systems.Inventory/Shop 执行，弹窗只负责选中与调用
 * 降级：ctx 缺失或数据异常时 draw 静默返回，不影响主画面
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var MAX_VISIBLE = 12;   /* 面板最多显示行数（安全阀：单次最多渲染行数，语义不变） */
  var ROW_H = 30;
  var HEADER_H = 46;
  var FOOTER_H = 34;
  var MARGIN = 16;        /* C-03：面板与逻辑视口上下的最小留白（滚动的判定依据） */
  var MAX_W = 520;
  var W_RATIO = 0.88;    /* 窄窗口时面板宽 ≤ 画布 88% */
  /* D-29：背包双栏——逻辑宽 ≥ RAIL_MIN_W 时右侧展开只读装备栏。
   * 左列表仍受 MAX_W(520) 约束（单列宽上限不变）；面板总宽上限 = 520 + 12 + 200 = 732。
   * < RAIL_MIN_W 整体回退单列（右栏不占位、不画、不参与命中），页头摘要仍在。 */
  var RAIL_MIN_W = 700;
  var RAIL_W = 200;
  var RAIL_GAP = 12;
  var RAIL_H = 184;      /* 右栏内容高（页头之下）：标题 + 两槽 */

  var kind = null;
  var data = [];
  var sel = 0;
  var shopMode = 'buy';
  var page = 0;        /* M8-4：quests 三页签（0=任务 / 1=怪物 / 2=物品），open 时重置 */
  var qScroll = 0;     /* P2-3b：图鉴（quests page1/2）滚动窗口起点；其他页恒为 0（行为不变） */
  var rect = null;       /* 最近一帧面板矩形 {x,y,w,h}，点击命中用 */
  var onKey = null, onClick = null;
  /* M9-4：设置面板状态 */
  var volTrack = null;   /* 音量滑块轨道矩形 {x,y,w,h} */
  var muteRect = null;   /* 静音开关矩形 {x,y,w,h} */
  var volDragging = false;
  var onMouseDown = null, onMouseMove = null, onMouseUp = null;
  /* M9-5：死亡结算状态 */
  var gameStats = null;       /* gameover 战绩 {floor,kills,gold,elapsedMs}（open 传入或现场拉取） */
  var gameRestartRect = null; /* 重新开始按钮矩形 {x,y,w,h} */
  var npcId = null;           /* D-47：当前对话的 NPC id（npcquest 面板专用） */

  function canvas() {
    return (Game.Core && Game.Core.Render && Game.Core.Render._canvas) || document.getElementById('game');
  }
  function cctx() {
    return Game.Core && Game.Core.Render && Game.Core.Render._ctx;
  }
  /* M9-5：取 CSS 像素尺寸（DPR 适配后 canvas.width 为物理像素，绘制坐标用 CSS 像素） */
  function cssSize() {
    var R = Game.Core && Game.Core.Render;
    var cv = canvas();
    var w = (R && typeof R.cssW === 'number') ? R.cssW : (cv && cv.clientWidth) || (cv && cv.width) || 0;
    var h = (R && typeof R.cssH === 'number') ? R.cssH : (cv && cv.clientHeight) || (cv && cv.height) || 0;
    return { w: w, h: h };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* D-29：右栏可见性——只看逻辑宽，与 kind 无关（调用方叠加 kind === 'inventory'）。
   * 单独抽出便于验证页在 699/700 两个边界直接判定，而不是靠"画出来看不见"。 */
  function railVisible(cw) { return cw >= RAIL_MIN_W; }

  /* D-29：面板总宽 / 左列表宽。双栏时总宽上限 732（左列仍 ≤520），
   * 仅在视口太窄时装不下才被 cw - 2*MARGIN 压回；单列公式与 D-28 完全一致。 */
  function panelWidth(cw, rail) {
    return rail ? Math.min(cw - 2 * MARGIN, MAX_W + RAIL_GAP + RAIL_W)
      : Math.min(cw * W_RATIO, MAX_W);
  }
  function listWidth(cw, rail) {
    var pw = panelWidth(cw, rail);
    return rail ? pw - RAIL_GAP - RAIL_W : pw;
  }

  /* C-03：当前视口可容纳的列表行数 = min(MAX_VISIBLE, 可用高度能放下的行数)。
   * 可用高度 = 逻辑视口高 - 上下留白 - 页头 - 页尾；至少 1 行（极小视口降级，不出现负高度）。
   * 1280×800（逻辑 1024×640）下算得 17 行 → 被 MAX_VISIBLE 压回 12，与改动前完全一致；
   * 逻辑高 ≤ 450 时可用高度不足 12 行，列表转为滚动而不是被视口裁切。 */
  function visibleRowCount(sz) {
    var h = (sz && typeof sz.h === 'number') ? sz.h : 0;
    var byH = Math.floor((h - 2 * MARGIN - HEADER_H - FOOTER_H) / ROW_H);
    if (!isFinite(byH) || byH < 1) byH = 1;
    return Math.max(1, Math.min(MAX_VISIBLE, byH));
  }

  /* D-28：强化后的实际数值——与 Inventory.effValue 同一公式。
   * modal.js 先于 inventory.js 加载，故运行时取；缺失时按同式兜底（不产生第二套口径）。 */
  function effOf(base, plus) {
    var I = Game.Systems && Game.Systems.Inventory;
    if (I && typeof I.effValue === 'function') return I.effValue(base, plus);
    var b = Number(base) || 0;
    var n = Math.min(Math.max(Number(plus) || 0, 0), 5);
    return b + (b ? Math.ceil(b * n * 0.1) : 0);
  }

  function itemDesc(item, plus) {
    if (!item) return '';
    var hp = (item.effect && item.effect.maxHp) ? (' 生命+' + item.effect.maxHp) : '';
    if (item.type === 'consumable') {
      /* S-03：强化卷轴（scroll:true）不靠 effect 字段，单独描述 */
      if (item.scroll === true) return '强化装备 +1（上限 +5）';
      var parts = [];
      if (item.effect && item.effect.hp) parts.push('恢复HP+' + item.effect.hp);
      if (item.effect && item.effect.mp) parts.push('恢复MP+' + item.effect.mp);
      return parts.length ? parts.join(' ') : '回复道具';
    }
    /* D-28：plus 只在背包上下文传入；商店/图鉴不传（默认 0）→ 仍显示原始基础值 */
    if (item.type === 'weapon') return '攻击+' + effOf((item.effect && item.effect.atk) || 0, plus) + hp;
    if (item.type === 'armor') return '防御+' + effOf((item.effect && item.effect.def) || 0, plus) + hp;
    return '';
  }

  /* S-03：背包行强化后缀 +N（只对已强化的武器/护甲有意义；商店卖的是未强化新货，不加后缀） */
  function upgSuffix(id) {
    var p = Game.Data && Game.Data.Player;
    var n = (p && p.upg && p.upg[id]) || 0;
    return n > 0 ? ' +' + n : '';
  }

  /* D-30：物品 id → 图标名只查显式表（Game.Data.ITEM_ICONS，见 js/data/items.js）。
   * 表缺失或该 id 未登记 → null（不再按 id 命名规则猜；画不出图标就退回纯文字行）。
   * 品质变体（_rare/_epic）在表里逐条写明，映射关系可机器读、可断言。 */
  function itemIcon(id) {
    if (typeof id !== 'string' || !id) return null;
    var map = Game.Data && Game.Data.ITEM_ICONS;
    if (!map || !Object.prototype.hasOwnProperty.call(map, id)) return null;
    var name = map[id];
    var S = Game.Core && Game.Core.Sprites;
    if (!S || typeof S.get !== 'function') return null;
    return S.get(name) || null;
  }

  /* M8-4：枚举数据表为图鉴条目 [{id, def}]（保持插入序；for-in + hasOwnProperty） */
  function collectEntries(dict) {
    var out = [];
    for (var id in dict) {
      if (Object.prototype.hasOwnProperty.call(dict, id)) out.push({ id: id, def: dict[id] });
    }
    return out;
  }

  Game.Modal = {
    /* D-28：供验证页断言"背包上下文传强化等级 / 商店图鉴走基础值"的只读入口 */
    _itemDesc: function (item, plus) { return itemDesc(item, plus); },
    open: function (k, stats) {
      if (k !== 'inventory' && k !== 'shop' && k !== 'quests' && k !== 'settings' && k !== 'gameover' && k !== 'npcquest') return;
      /* D-18：连开（如死亡结算被重复触发）时先解绑旧的键盘/点击监听。
       * 原来直接 _bind() 会把上一份监听器引用覆盖掉，导致它永远删不掉：
       * 之后每次 Enter 都会被重复确认 N 次（实测长跑后一次 Enter 触发 8 次确认）。 */
      if (kind !== null) this._unbind();
      kind = k;
      sel = 0;
      shopMode = 'buy';
      /* S-01：每次开张推进一次确定性换货（同级守卫，Shop 未加载时跳过） */
      if (k === 'shop' && Game.Systems.Shop && typeof Game.Systems.Shop.refresh === 'function') {
        Game.Systems.Shop.refresh();
      }
      page = 0; /* M8-4：每次打开 quests 默认回到任务页 */
      qScroll = 0; /* P2-3b：打开面板重置滚动窗口 */
      volDragging = false;
      gameStats = (k === 'gameover') ? (stats || null) : null;
      gameRestartRect = null;
      npcId = (k === 'npcquest' && stats && stats.id) ? stats.id : null;
      this._refresh();
      this._bind();
    },

    close: function () {
      kind = null;
      data = [];
      qScroll = 0;
      volDragging = false;
      volTrack = null;
      muteRect = null;
      gameStats = null;
      gameRestartRect = null;
      if (kind === 'npcquest') npcId = null;
      this._unbind();
      /* 关闭时清掉 Input 残留按键，避免移动键粘滞导致关闭瞬间移动 */
      if (Game.Core && Game.Core.Input && typeof Game.Core.Input.clear === 'function') {
        Game.Core.Input.clear();
      }
    },

    isOpen: function () { return kind !== null; },
    current: function () { return kind; },

    /* 按当前 kind 重建数据快照（调用既有系统方法，不改它们） */
    _refresh: function () {
      data = [];
      try {
        if (kind === 'inventory') data = Game.Systems.Inventory.list();
        else if (kind === 'shop') data = (shopMode === 'buy') ? Game.Systems.Shop.getStock() : Game.Systems.Inventory.list();
        else if (kind === 'quests') {
          /* M8-4：三页数据源——任务页保持 getActive（行为不变）；怪物/物品页枚举 Data 全量 */
          if (page === 1) data = collectEntries(Game.Data.MONSTERS);
          else if (page === 2) data = collectEntries(Game.Data.ITEMS);
          else data = Game.Systems.Quest.getActive();
        }
        /* D-47：NPC 任务面板——行文本来自 NpcQuest.panel（四态 + 操作提示） */
        else if (kind === 'npcquest') {
          data = (Game.Systems.NpcQuest && typeof Game.Systems.NpcQuest.panel === 'function')
            ? Game.Systems.NpcQuest.panel(npcId) : [];
        }
        /* gameover 无列表，战绩在 _drawGameover 现场拉取 */
      } catch (e) { data = []; }
      sel = clamp(sel, 0, Math.max(data.length - 1, 0));
      /* P2-3b/C-03：数据变化后把滚动窗口夹回有效区间（列表超出当前可见行数时生效） */
      var maxScroll = Math.max(0, data.length - visibleRowCount(cssSize()));
      if (qScroll > maxScroll) qScroll = maxScroll;
      if (qScroll < 0) qScroll = 0;
    },

    _bind: function () {
      var self = this;
      var cv = canvas();
      onKey = function (e) {
        if (!self.isOpen()) return;
        var c = e.code;
        if (c === 'Escape') {
          e.preventDefault();
          /* 修复：死亡结算不允许 Esc 关闭。原逻辑关闭后留下 hp=0 且已清档的探索场景，
           * 玩家无法重新开始也无法正常继续。 */
          if (kind === 'gameover') return;
          self.close(); return;
        }
        /* M9-4：设置面板键盘——左右调音量、空格/回车切换静音 */
        if (kind === 'settings') {
          if (c === 'ArrowLeft') { e.preventDefault(); self._adjVolume(-0.05); return; }
          if (c === 'ArrowRight') { e.preventDefault(); self._adjVolume(0.05); return; }
          if (c === 'Space' || c === 'Enter' || c === 'NumpadEnter') { e.preventDefault(); self._toggleMute(); return; }
          return;
        }
        /* M9-5：死亡结算——回车/R/空格重新开始 */
        if (kind === 'gameover') {
          if (c === 'Enter' || c === 'NumpadEnter' || c === 'KeyR' || c === 'Space') {
            e.preventDefault(); self._restart(); return;
          }
          return;
        }
        if (c === 'ArrowUp' || c === 'KeyW') { e.preventDefault(); sel = clamp(sel - 1, 0, Math.max(data.length - 1, 0)); self._syncScroll(); return; }
        if (c === 'ArrowDown' || c === 'KeyS') { e.preventDefault(); sel = clamp(sel + 1, 0, Math.max(data.length - 1, 0)); self._syncScroll(); return; }
        if (c === 'Enter' || c === 'NumpadEnter') { e.preventDefault(); self._confirm(); return; }
        if (c === 'Tab' && kind === 'shop') { e.preventDefault(); self._toggleShopMode(); return; }
        /* M8-4：quests 三页签切页——Tab/→ 下一页、← 上一页（↑↓ 仍是列表选择，无冲突） */
        if (kind === 'quests') {
          if (c === 'Tab' || c === 'ArrowRight') { e.preventDefault(); self._setPage(page + 1); return; }
          if (c === 'ArrowLeft') { e.preventDefault(); self._setPage(page - 1); return; }
        }
      };
      onClick = function (e) {
        if (!self.isOpen()) return;
        var v = canvas();
        if (!v) return;
        /* 自适应缩放：统一用 Render.toLogical 换算，避免 scale≠1 时点击偏移 */
        var R = Game.Core && Game.Core.Render;
        var pt = (R && typeof R.toLogical === 'function') ? R.toLogical(e.clientX, e.clientY)
          : { x: e.clientX, y: e.clientY };
        self._handleClick(pt.x, pt.y);
      };
      /* M9-4：设置面板音量滑块拖拽 */
      onMouseDown = function (e) {
        if (!self.isOpen() || kind !== 'settings' || !volTrack) return;
        var v = canvas();
        if (!v) return;
        var R = Game.Core && Game.Core.Render;
        var pt = (R && typeof R.toLogical === 'function') ? R.toLogical(e.clientX, e.clientY)
          : { x: e.clientX, y: e.clientY };
        var mx = pt.x;
        var my = pt.y;
        if (mx >= volTrack.x && mx <= volTrack.x + volTrack.w &&
            my >= volTrack.y - 8 && my <= volTrack.y + volTrack.h + 8) {
          volDragging = true;
          self._setVolumeFromX(mx);
          e.preventDefault();
        }
      };
      onMouseMove = function (e) {
        if (!volDragging) return;
        var v = canvas();
        if (!v) return;
        var R = Game.Core && Game.Core.Render;
        var pt = (R && typeof R.toLogical === 'function') ? R.toLogical(e.clientX, e.clientY)
          : { x: e.clientX, y: e.clientY };
        self._setVolumeFromX(pt.x);
      };
      onMouseUp = function () { volDragging = false; };
      window.addEventListener('keydown', onKey);
      if (cv) {
        cv.addEventListener('click', onClick);
        cv.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      }
    },

    _unbind: function () {
      window.removeEventListener('keydown', onKey);
      var cv = canvas();
      if (cv) {
        cv.removeEventListener('click', onClick);
        cv.removeEventListener('mousedown', onMouseDown);
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      onKey = null; onClick = null;
      onMouseDown = null; onMouseMove = null; onMouseUp = null;
    },

    _toggleShopMode: function () {
      shopMode = (shopMode === 'buy') ? 'sell' : 'buy';
      this._refresh();
    },

    /* M8-4：quests 页签切换（环形 0→1→2→0；← 反向），切页后选中行归零 */
    _setPage: function (p) {
      page = ((p % 3) + 3) % 3;
      sel = 0;
      qScroll = 0; /* P2-3b：切页重置滚动窗口，避免停在上次中间位置 */
      this._refresh();
    },

    /* P2-3b/C-03：选中行变化后让滚动窗口跟随（列表超出当前可见行数时生效，四类列表统一） */
    _syncScroll: function () {
      var vr = visibleRowCount(cssSize());
      if (data.length <= vr) return;
      if (sel < qScroll) qScroll = sel;
      else if (sel >= qScroll + vr) qScroll = sel - vr + 1;
      var maxScroll = Math.max(0, data.length - vr);
      if (qScroll > maxScroll) qScroll = maxScroll;
      if (qScroll < 0) qScroll = 0;
    },

    /* P2-3b/C-03：当前可见窗口（验证/调试读取）：{start, rows, total, sel} */
    _visibleRange: function () {
      var vr = visibleRowCount(cssSize());
      var start = (data.length > vr) ? qScroll : 0;
      return { start: start, rows: Math.min(Math.max(data.length - start, 0), vr), total: data.length, sel: sel };
    },

    /* C-03：布局快照（验证/调试读取）——与 draw 使用同一套行数/起点计算，
     * 返回逻辑视口、可见行数、面板高、完整内容高、是否滚动、面板顶 y 与逐行 y。 */
    _layout: function () {
      var sz = cssSize();
      var vr = visibleRowCount(sz);
      var start = (data.length > vr) ? qScroll : 0;
      var rows = Math.min(Math.max(data.length - start, 0), vr);
      var panelH = (kind === 'settings') ? HEADER_H + 280 + FOOTER_H
        : (kind === 'gameover') ? HEADER_H + 220 + FOOTER_H
        : HEADER_H + rows * ROW_H + FOOTER_H;
      /* D-29：与 draw 共用同一套双栏度量 */
      var railOn = (kind === 'inventory') && railVisible(sz.w);
      if (railOn) panelH = Math.max(panelH, HEADER_H + RAIL_H + FOOTER_H);
      var panelW = panelWidth(sz.w, railOn);
      var listW = listWidth(sz.w, railOn);
      var px = (sz.w - panelW) / 2;
      var py = (sz.h - panelH) / 2;
      var rowYs = [];
      for (var i = 0; i < rows; i++) rowYs.push(py + HEADER_H + i * ROW_H);
      return {
        viewport: sz, visibleRows: vr, start: start, rows: rows,
        panelH: panelH, contentH: HEADER_H + data.length * ROW_H + FOOTER_H,
        scrollable: data.length > vr, panelTop: py, panelBottom: py + panelH,
        panelW: panelW, listW: listW, panelLeft: px,
        rail: railOn ? this._railLayout(px, py, listW, panelH) : null,
        firstRowY: rowYs.length ? rowYs[0] : null,
        lastRowY: rowYs.length ? rowYs[rowYs.length - 1] : null,
        rowYs: rowYs, total: data.length, sel: sel
      };
    },

    /* D-29：布局度量（验证/调试读取）——不绘制，纯算。 */
    _metrics: function (cw) {
      var rail = railVisible(cw);
      return {
        cw: cw, railVisible: rail, panelW: panelWidth(cw, rail),
        listW: listWidth(cw, rail), margin: (cw - panelWidth(cw, rail)) / 2,
        minFont: 11
      };
    },

    /* D-29：右栏几何 + 槽位内容快照（与 draw 共用；只读，不可选中）。
     * 槽内 name/plus/value 全部从 Player.equipment / Player.upg 现场取，
     * 空槽显式 empty:true、name:'空'、value 归零（不允许留白）。 */
    _railLayout: function (px, py, listW, panelH) {
      var x = px + listW + RAIL_GAP;
      var top = py + HEADER_H;
      var bottom = py + panelH - FOOTER_H;
      var p = Game.Data.Player || {};
      var eq = p.equipment || {};
      var upg = p.upg || {};
      var IT = Game.Data.ITEMS || {};
      function buildSlot(key, label, field, id, sy) {
        var it = id ? IT[id] : null;
        var base = (it && it.effect && it.effect[field]) ? it.effect[field] : 0;
        var n = it ? Math.min(Math.max(upg[id] || 0, 0), 5) : 0;
        return {
          slot: key, label: label, field: field,
          x: x + 8, y: sy, w: RAIL_W - 16, h: 60,
          empty: !it, id: it ? id : null,
          name: it ? it.name : '空', plus: n,
          value: (field === 'atk' ? '攻+' : '防+') + (it ? effOf(base, n) : 0)
        };
      }
      return {
        x: x, y: top, w: RAIL_W, h: Math.max(0, bottom - top),
        title: '装备栏（只读）', selectable: false,
        slots: [
          buildSlot('weapon', '武器', 'atk', eq.weapon, top + 40),
          buildSlot('armor', '护甲', 'def', eq.armor, top + 120)
        ]
      };
    },

    /* M8-4：当前页签（验证/调试读取） */
    getPage: function () { return page; },

    /* M9-4：设置面板辅助方法 */
    _getAudio: function () {
      return (Game.Systems && Game.Systems.Audio) ? Game.Systems.Audio : null;
    },
    _adjVolume: function (delta) {
      var a = this._getAudio();
      if (!a) return;
      a.setVolume(a.getVolume() + delta);
    },
    _toggleMute: function () {
      var a = this._getAudio();
      if (!a) return;
      a.setMuted(!a.isMuted());
    },
    _setVolumeFromX: function (mx) {
      if (!volTrack) return;
      var a = this._getAudio();
      if (!a) return;
      var ratio = clamp((mx - volTrack.x) / volTrack.w, 0, 1);
      a.setVolume(ratio);
    },

    /* M9-5：死亡结算战绩（open 传入优先，否则现场取 Player/HUD 状态） */
    _gameoverStats: function () {
      var p = (Game.Data && Game.Data.Player) || {};
      var kills = (Game.hud && typeof Game.hud.getKills === 'function') ? Game.hud.getKills() : 0;
      var s = gameStats || {};
      return {
        floor: (typeof s.floor === 'number') ? s.floor : (typeof p.floor === 'number' ? p.floor : 0),
        kills: (typeof s.kills === 'number') ? s.kills : kills,
        gold: (typeof s.gold === 'number') ? s.gold : (typeof p.gold === 'number' ? p.gold : 0),
        elapsedMs: (typeof s.elapsedMs === 'number') ? s.elapsedMs : 0
      };
    },

    /* M9-5：重新开始——走 Main.restart（既有 reset 逻辑），Main 不可用时兜底重置 Player */
    _restart: function () {
      try {
        var M = Game.Core && Game.Core.Main;
        if (M && typeof M.restart === 'function') {
          M.restart();
          return;
        }
        /* 兜底：无 Main 时仅重置 Player 字段（验证页场景） */
        var p = Game.Data && Game.Data.Player;
        if (p) {
          p.hp = 100; p.maxHp = 100; p.atk = 10; p.def = 5;
          p.gold = 0; p.exp = 0; p.level = 1;
          p.inventory = {}; p.equipment = { weapon: null, armor: null };
          p.quests = {};
          p.upg = {};
        }
        this.close();
      } catch (e) { this.close(); }
    },

    /* D-14：把 {ok,msg} 的结果接到提示条（notice.js 底部提示）。原先返回值被直接丢弃，
     * 金币不足 / MP 已满 / 未装备武器 / 生命已满 全部无声失败。 */
    _report: function (res) {
      if (!res || typeof res.msg !== 'string' || !res.msg) return;
      var EB = Game.Core && Game.Core.EventBus;
      if (EB && typeof EB.emit === 'function') {
        EB.emit('ui:notice', { msg: res.msg, ok: res.ok === true });
      }
    },

    _confirm: function () {
      if (data.length === 0) return;
      /* D-47：NPC 任务面板——Enter 按状态执行 接取 / 交付；其余状态只给提示。
       * 交付由 NpcQuest.deliver 内部拦截"已交付"，这里不再重复判断。 */
      if (kind === 'npcquest') {
        var NQ = Game.Systems.NpcQuest;
        var nres = null;
        try {
          var nst = NQ.state(npcId);
          if (nst === 'unaccepted') nres = NQ.accept(npcId);
          else if (nst === 'ready') nres = NQ.deliver(npcId);
          else { this.close(); return; }
          this._refresh();
        } catch (e) { /* 降级：面板异常不影响主游戏 */ }
        if (nres && nres.ok === true && Game.Systems.Save && typeof Game.Systems.Save.save === 'function') {
          Game.Systems.Save.save();
        }
        this._report(nres);
        return;
      }
      var entry = data[sel];
      var res = null;
      try {
        if (kind === 'inventory') {
          var it = Game.Data.ITEMS[entry.id];
          if (it && it.type === 'consumable') res = Game.Systems.Inventory.use(entry.id);
          else res = Game.Systems.Inventory.equip(entry.id);
        } else if (kind === 'shop') {
          if (shopMode === 'buy') res = Game.Systems.Shop.buy(entry.id);
          else res = Game.Systems.Shop.sell(entry.id);
        } else if (kind === 'quests') {
          this.close(); return;
        }
        this._refresh();
      } catch (e) { /* 降级：弹窗内操作异常不影响主游戏 */ }
      /* D-15：背包/商店的成功操作会改金币、背包、装备、HP/MP 等持久状态。
       * 旧实现只有换层/战斗结算才写档，于是"买到的装备/药水效果"刷新即消失。
       * 失败（res.ok 非 true）不写档，避免把"没发生"的操作写进存档。 */
      if (res && res.ok === true && Game.Systems.Save && typeof Game.Systems.Save.save === 'function') {
        Game.Systems.Save.save();
      }
      this._report(res);
    },

    /* 点击：面板外→关闭；命中条目行→选中并执行；设置面板→静音开关；结算→重新开始 */
    _handleClick: function (x, y) {
      if (!rect) return;
      if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) {
        /* 修复：死亡结算点遮罩不关闭（与 Esc 同理，避免 0 HP 游离态） */
        if (kind !== 'gameover') this.close();
        return;
      }
      if (kind === 'settings') {
        /* M9-4：点击静音开关区域切换静音 */
        if (muteRect && x >= muteRect.x && x <= muteRect.x + muteRect.w &&
            y >= muteRect.y && y <= muteRect.y + muteRect.h) {
          this._toggleMute();
        }
        return;
      }
      if (kind === 'gameover') {
        /* M9-5：点击重新开始按钮 */
        if (gameRestartRect && x >= gameRestartRect.x && x <= gameRestartRect.x + gameRestartRect.w &&
            y >= gameRestartRect.y && y <= gameRestartRect.y + gameRestartRect.h) {
          this._restart();
        }
        return;
      }
      /* D-29：命中统一走 _rowAt——落在右栏（≥700 的装备栏）或列表区外一律返回 null，
       * 右栏点不中、也不会改 sel；键盘路径本就不把右栏放进 data，同样选不中。 */
      var absIdx = this._rowAt(x, y);
      if (absIdx !== null) {
        sel = absIdx;
        this._confirm();
      }
    },

    /* D-29：行命中测试——返回绝对行索引；x 落在左列表之外（含右栏）返回 null。
     * 抽出独立函数是为了让"右栏不可被选中"可被验证页用真实点击坐标反复断言。 */
    _rowAt: function (x, y) {
      if (!rect) return null;
      var cw = cssSize().w;
      var railOn = (kind === 'inventory') && railVisible(cw);
      var lw = railOn ? listWidth(cw, true) : rect.w;
      if (x < rect.x || x > rect.x + lw) return null;
      var rowIdx = Math.floor((y - (rect.y + HEADER_H)) / ROW_H);
      var vr = visibleRowCount(cssSize());
      if (rowIdx < 0 || rowIdx >= vr) return null;
      /* P2-3b/C-03：点击行按滚动窗口偏移换算为绝对索引（超出可见行数时 start 才非 0） */
      var start = (data.length > vr) ? qScroll : 0;
      var absIdx = rowIdx + start;
      if (absIdx < 0 || absIdx >= data.length) return null;
      return absIdx;
    },

    /* D-29：状态快照（验证/调试只读）——sel 一定指向 data 下标；rail.selectable 恒 false */
    _debugState: function () {
      return {
        kind: kind, sel: sel, total: data.length, page: page, shopMode: shopMode,
        rect: rect,
        layout: this._layout()
      };
    },

    /* M9-4：绘制设置面板——音量滑块（拖拽）/静音开关（点击）/操作说明 */
    _drawSettings: function (c, cv, px, py, w, h) {
      var a = this._getAudio();
      var vol = a ? a.getVolume() : 0.7;
      var muted = a ? a.isMuted() : false;

      var left = px + 20;
      var contentW = w - 40;
      var y = py + HEADER_H + 10;

      /* ---- 音量滑块 ---- */
      c.fillStyle = '#cfcfcf';
      c.font = '14px monospace';
      c.fillText('音量  ' + Math.round(vol * 100) + '%', left, y + 14);

      var trackY = y + 24;
      var trackH = 8;
      volTrack = { x: left, y: trackY, w: contentW, h: trackH };
      /* 轨道背景 */
      c.fillStyle = '#3a3a55';
      c.fillRect(volTrack.x, volTrack.y, volTrack.w, volTrack.h);
      /* 已填充 */
      c.fillStyle = '#ffcf6e';
      c.fillRect(volTrack.x, volTrack.y, Math.max(0, volTrack.w * vol), volTrack.h);
      /* thumb */
      var thumbX = volTrack.x + volTrack.w * vol;
      c.fillStyle = '#ffffff';
      c.fillRect(thumbX - 5, volTrack.y - 5, 10, volTrack.h + 10);

      y = trackY + trackH + 28;

      /* ---- 静音开关 ---- */
      muteRect = { x: left, y: y, w: 18, h: 18 };
      c.fillStyle = '#1a1a2e';
      c.fillRect(muteRect.x, muteRect.y, muteRect.w, muteRect.h);
      c.strokeStyle = '#cfcfcf';
      c.lineWidth = 1;
      c.strokeRect(muteRect.x + 0.5, muteRect.y + 0.5, muteRect.w - 1, muteRect.h - 1);
      if (muted) {
        c.fillStyle = '#ffcf6e';
        c.fillRect(muteRect.x + 3, muteRect.y + 3, muteRect.w - 6, muteRect.h - 6);
      }
      c.fillStyle = muted ? '#ff6b6b' : '#cfcfcf';
      c.font = '14px monospace';
      c.fillText('静音（' + (muted ? '开' : '关') + '）', muteRect.x + muteRect.w + 10, y + 14);

      y += muteRect.h + 24;

      /* ---- 操作说明 ---- */
      c.fillStyle = '#9bbbf4';
      c.font = 'bold 13px monospace';
      c.fillText('操作说明', left, y + 12);
      y += 26;

      c.fillStyle = '#cfcfcf';
      c.font = '12px monospace';
      var lines = [
        '方向键 / WASD : 移动',
        'B 背包 · E 商店 · M 任务',
        'T 对话 · L AI 演示',
        'K 静音 · Q 设置 · H 重看引导',
        'F 战斗特效（关/低/高）', /* D-16：三档强度入口（设置说明 + 战斗内按键） */
        'Esc : 关闭弹窗'
      ];
      for (var i = 0; i < lines.length; i++) {
        c.fillText(lines[i], left, y + i * 18);
      }

      /* 底部提示（窄屏缩字号，避免 320 宽溢出） */
      c.fillStyle = '#9bbbf4';
      c.font = (cssSize().w < 420 ? '11px monospace' : '12px monospace');
      c.fillText('← → 调音量 · 空格切换静音 · Esc/点遮罩关闭', px + 14, py + h - 12);
    },

    /* M9-5：死亡结算面板——战绩 + 重新开始按钮（战绩来自 Player/HUD 状态） */
    _drawGameover: function (c, px, py, w, h) {
      var st = this._gameoverStats();
      var left = px + 20;
      var y = py + HEADER_H + 8;

      /* 用时格式：mm:ss（elapsedMs 为 0 时显示 00:00） */
      var secs = Math.max(0, Math.floor((st.elapsedMs || 0) / 1000));
      var mm = Math.floor(secs / 60);
      var ss = secs % 60;
      var timeStr = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;

      c.fillStyle = '#cfcfcf';
      c.font = '14px monospace';
      var lines = [
        '到达楼层：第 ' + st.floor + ' 层',
        '击杀怪物：' + st.kills + ' 只',
        '获得金币：' + st.gold,
        '冒险用时：' + timeStr
      ];
      for (var i = 0; i < lines.length; i++) {
        c.fillText(lines[i], left, y + i * 24);
      }

      /* 重新开始按钮 */
      var btnW = 180, btnH = 34;
      var bx = px + (w - btnW) / 2;
      var by = y + lines.length * 24 + 18;
      gameRestartRect = { x: bx, y: by, w: btnW, h: btnH };
      c.fillStyle = '#3a3a5c';
      c.fillRect(bx, by, btnW, btnH);
      c.strokeStyle = '#ffcf6e';
      c.lineWidth = 1;
      c.strokeRect(bx + 0.5, by + 0.5, btnW - 1, btnH - 1);
      c.fillStyle = '#ffcf6e';
      c.font = 'bold 14px monospace';
      c.textAlign = 'center';
      c.fillText('重新开始 (R / 回车)', px + w / 2, by + btnH / 2 + 5);
      c.textAlign = 'left';

      /* 底部提示（窄屏缩字号，避免 320 宽溢出） */
      c.fillStyle = '#9bbbf4';
      c.font = (cssSize().w < 420 ? '11px monospace' : '12px monospace');
      c.fillText('本局战绩 · R/回车/点击按钮重新开始', px + 14, py + h - 12);
    },

    draw: function () {
      if (!this.isOpen()) return;
      var c = cctx();
      var cv = canvas();
      if (!c || !cv) return;
      /* M9-5：确保 DPR 变换已应用（直接调用 draw 时兜底），绘制坐标用 CSS 像素 */
      if (Game.Core && Game.Core.Render && typeof Game.Core.Render._applyDpr === 'function') {
        Game.Core.Render._applyDpr();
      }
      var sz = cssSize();
      var cw = sz.w, ch = sz.h;

      /* P2-3b/C-03：滚动窗口起点；列表未超出当前可见行数时 start 恒为 0（高视口行为不变） */
      var vr = visibleRowCount(sz);
      var start = (data.length > vr) ? qScroll : 0;
      var rows = Math.min(Math.max(data.length - start, 0), vr);
      /* D-29：只有背包在逻辑宽 ≥700 时展开右栏；w 为面板总宽，listW 为左侧列表可用宽 */
      var railOn = (kind === 'inventory') && railVisible(cw);
      var w = panelWidth(cw, railOn);
      var listW = listWidth(cw, railOn);
      /* M9-4/M9-5：设置面板与死亡结算使用固定内容高度（非列表） */
      var h = (kind === 'settings') ? HEADER_H + 280 + FOOTER_H
        : (kind === 'gameover') ? HEADER_H + 220 + FOOTER_H
        /* D-27：空列表也保留 1 行高度，避免"空态提示"与底部操作提示叠在同一条线上
         * （新档背包为空是首屏常态，页头又加了装备摘要，必须让空态有独立一行） */
        : HEADER_H + Math.max(rows, 1) * ROW_H + FOOTER_H;
      /* D-29：右栏两槽最小需要 RAIL_H 内容高（行数很少时也不许把槽压扁/裁切） */
      if (railOn) h = Math.max(h, HEADER_H + RAIL_H + FOOTER_H);
      var px = (cw - w) / 2;
      var py = (ch - h) / 2;
      rect = { x: px, y: py, w: w, h: h };
      var rail = railOn ? this._railLayout(px, py, listW, h) : null;

      /* 半透明遮罩（压暗地图与 HUD，HUD 仍每帧同步在遮罩下） */
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(0, 0, cw, ch);

      /* 居中面板：P1-2 双层像素边框（外黑 1px + 内白 1px） */
      c.fillStyle = '#14142a';
      c.fillRect(px, py, w, h);
      /* 底部操作提示区分隔线（设置/结算面板同样适用，先于各自 return 绘制） */
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(px + 10, py + h - FOOTER_H, w - 20, 1);
      c.strokeStyle = 'rgba(0,0,0,0.9)';
      c.lineWidth = 1;
      c.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.strokeRect(px + 1.5, py + 1.5, w - 3, h - 3);

      /* P1-2：标题行分隔线（金色 1px，标题 y=py+30，线在 y=py+34） */
      c.fillStyle = 'rgba(255,207,110,0.35)';
      c.fillRect(px + 10, py + 34, w - 20, 1);

      /* 标题 + 金币 */
      var title = '';
      if (kind === 'inventory') title = '背包';
      else if (kind === 'shop') title = '商店 · ' + (shopMode === 'buy' ? '购买' : '出售');
      else if (kind === 'settings') title = '设置';
      else if (kind === 'gameover') title = '冒险结束';
      else if (kind === 'npcquest') {
        var nd = (Game.Systems.NpcQuest && Game.Systems.NpcQuest.def) ? Game.Systems.NpcQuest.def(npcId) : null;
        title = (nd ? nd.name : '???') + ' · 任务';
      }
      if (kind === 'quests') {
        /* M8-4：三页签标题（任务/怪物/物品，当前页高亮加粗） */
        var tabs = ['任务', '怪物', '物品'];
        for (var ti = 0; ti < tabs.length; ti++) {
          c.fillStyle = (ti === page) ? '#ffcf6e' : '#8a8aa0';
          c.font = (ti === page) ? 'bold 18px monospace' : '15px monospace';
          c.fillText(tabs[ti], px + 14 + ti * 72, py + 30);
        }
      } else {
        c.fillStyle = '#ffcf6e';
        c.font = 'bold 18px monospace';
        c.fillText(title, px + 14, py + 30);
      }
      if (kind === 'inventory' || kind === 'shop') {
        var p = Game.Data.Player;
        c.fillStyle = '#ffcf6e';
        c.font = '13px monospace';
        c.fillText('金币: ' + (p ? p.gold : 0), px + w - 90, py + 30);
      }

      /* D-27：背包页头装备摘要——让"已装备"在界面上看得见（新档起手就有匕首，
       * 但背包为空，不能只显示"背包空空如也"）。文本由 equipSummary() 统一生成，
       * 后续 UI 重做时替换/扩写该函数即可，绘制这里只负责排版与截断。 */
      if (kind === 'inventory') {
        c.fillStyle = '#9fb6cf';
        c.font = '11px monospace';
        var sumMaxW = Math.max(0, w - 84 - 100);
        c.fillText(this._fitRow(c, this.equipSummary(), sumMaxW), px + 84, py + 30);
      }

      /* M9-4：设置面板专用渲染（音量滑块/静音开关/操作说明） */
      if (kind === 'settings') {
        this._drawSettings(c, cv, px, py, w, h);
        return;
      }

      /* M9-5：死亡结算专用渲染（战绩 + 重新开始按钮） */
      if (kind === 'gameover') {
        this._drawGameover(c, px, py, w, h);
        return;
      }

      /* 条目列表（窄屏单行超长时截断加省略号，避免 320 宽溢出） */
      c.font = '14px monospace';
      for (var i = 0; i < rows; i++) {
        var ry = py + HEADER_H + i * ROW_H;
        var entry = data[start + i]; /* P2-3b：按滚动窗口取行数据 */
        if (i + start === sel) {
          c.fillStyle = 'rgba(255,207,110,0.18)';
          /* D-29：高亮只铺左列表宽（listW），不跨到右栏去 */
          c.fillRect(px + 6, ry + 2, listW - 12, ROW_H - 4);
          /* P1-2：选中行左侧 2px 金色竖条 */
          c.fillStyle = '#ffcf6e';
          c.fillRect(px + 6, ry + 2, 2, ROW_H - 4);
          c.fillStyle = '#ffcf6e';
        } else {
          c.fillStyle = '#cfcfcf';
        }
        /* P1-2：行左物品图标（16×16，y 居中）；无图标时文字保持原位 */
        var ric = this._rowIcon(entry);
        var rowTextX = px + 14;
        var rowMaxW = listW - 28;
        if (ric) {
          rowTextX = px + 14 + 22;
          rowMaxW = listW - 28 - 22;
          var riy = ry + Math.floor((ROW_H - 16) / 2);
          c.drawImage(ric, px + 14 + 2, riy, 16, 16);
        }
        /* D-28：行尾徽标独立绘制（已装备 / 强化后数值），行串本身不变
         * D-29：再往右独立绘制差值徽标（▲+N / ▼-N / 持平），两者都不拼进 _rowText */
        var badge = this._rowBadges(kind, entry);
        var delta = this._rowDelta(entry);
        var badgeW = 0, deltaW = 0;
        c.font = '11px monospace';
        if (badge) badgeW = Math.round(c.measureText(badge.text).width) + 14;
        if (delta) deltaW = Math.round(c.measureText(delta.text).width) + 10;
        c.font = '14px monospace';
        c.fillText(this._fitRow(c, this._rowText(entry), rowMaxW - badgeW - deltaW), rowTextX, ry + 20);
        var rightEdge = px + listW - 14;
        if (delta) {
          c.fillStyle = delta.color;
          c.font = '11px monospace';
          c.textAlign = 'right';
          c.fillText(delta.text, rightEdge, ry + 20);
          c.textAlign = 'left';
          rightEdge -= deltaW;
        }
        if (badge) {
          c.fillStyle = badge.color;
          c.font = '11px monospace';
          c.textAlign = 'right';
          c.fillText(badge.text, rightEdge, ry + 20);
          c.textAlign = 'left';
        }
      }
      /* M9-5：空状态——居中灰字提示（背包/任务各自文案） */
      if (data.length === 0) {
        c.fillStyle = '#9bbbf4';
        c.font = '14px monospace';
        var emptyMsg = '（空）';
        if (kind === 'inventory') emptyMsg = '背包空空如也';
        else if (kind === 'quests') emptyMsg = '暂无任务';
        /* 居中：估算文字宽度后水平居中（灰字）；D-29 双栏时居中于左列表 */
        c.textAlign = 'center';
        c.fillText(emptyMsg, px + listW / 2, py + HEADER_H + 20);
        c.textAlign = 'left';
      }

      /* D-29：右栏只读装备栏（仅背包、逻辑宽 ≥700 时存在；否则一行都不画） */
      if (rail) this._drawRail(c, rail);

      /* 底部操作提示（窄屏缩字号，避免 320 宽溢出；D-28：溢出时折两行且保留操作指导） */
      c.fillStyle = '#9bbbf4';
      var hintInfo = this._hintFor(c, kind, cw, sz);
      if (hintInfo.lines.length > 1) {
        c.fillText(hintInfo.lines[0], px + 14, py + h - 25);
        c.fillText(hintInfo.lines[1], px + 14, py + h - 10);
      } else {
        c.fillText(hintInfo.lines[0], px + 14, py + h - 12);
      }
    },

    /* D-28：底栏提示文本——非溢出态返回原串（逐字节不变，D-25 精确比对依赖它）；
     * 溢出态（320 逻辑宽实测）保留「Enter 使用/装备」，把 Esc 提示折到第二行，
     * 丢掉的是浏览计数那一侧，不是操作指导。 */
    _hintFor: function (c, kind, cw, sz) {
      c.font = (cw < 420 ? '11px monospace' : '12px monospace');
      var hint;
      if (kind === 'inventory') hint = '↑↓ 选择 · Enter 使用/装备 · Esc/点遮罩关闭';
      else if (kind === 'shop') hint = '↑↓ 选择 · Enter ' + (shopMode === 'buy' ? '购买' : '出售') + ' · Tab 切换 · Esc/点遮罩关闭';
      else if (kind === 'quests') hint = 'Tab/←→ 切页 · ↑↓ 选择 · Esc/点遮罩关闭'; /* M8-4 */
      else if (kind === 'npcquest') hint = 'Enter 接取/交付 · Esc/点遮罩关闭'; /* D-47 */
      else hint = '↑↓ 选择 · Esc/点遮罩关闭';
      /* P2-3b/C-03：列表滚动时底部显示当前位置 (sel+1)/total */
      var scrolling = data.length > visibleRowCount(sz);
      if (scrolling) {
        hint = '↑↓ 浏览 · ' + (sel + 1) + '/' + data.length + ' · ' +
          (kind === 'quests' ? 'Tab 切页 · ' : '') + 'Esc 关闭';
      }
      var maxW = Math.min(cw * W_RATIO, MAX_W) - 28;
      var hintW = c.measureText(hint).width;
      /* 字宽随环境字体 fallback 浮动，留 24px 安全边距；320 逻辑宽实测触发两行，1024 不触发 */
      var overflow = hintW > (maxW - 24);
      if (overflow && kind === 'inventory') {
        return {
          lines: [(scrolling ? '↑↓ 浏览 · ' : '↑↓ 选择 · ') + 'Enter 使用/装备', 'Esc/点遮罩关闭'],
          full: hint, overflow: true, width: hintW, maxW: maxW
        };
      }
      return { lines: [hint], full: hint, overflow: overflow, width: hintW, maxW: maxW };
    },

    /* D-28：背包页头装备摘要（在 D-27 的函数上扩写，不另造第二套）。
     * 两槽各带强化等级与强化后数值；护甲为空显式写"无"；末尾给两槽合计加成。 */
    equipSummary: function () {
      var p = Game.Data.Player || {};
      var IT = Game.Data.ITEMS || {};
      var eq = p.equipment || {};
      var upg = p.upg || {};
      function slot(id, field, label) {
        if (!id) return label + '无';
        var it = IT[id];
        if (!it) return label + id;
        var base = (it.effect && it.effect[field]) ? it.effect[field] : 0;
        var n = Math.min(Math.max(upg[id] || 0, 0), 5);
        return label + it.name + '+' + n + '（' + (field === 'atk' ? '攻击+' : '防御+') + effOf(base, n) + '）';
      }
      var wIt = IT[eq.weapon], aIt = IT[eq.armor];
      var wAdd = wIt ? effOf((wIt.effect && wIt.effect.atk) || 0, upg[eq.weapon] || 0) : 0;
      var aAdd = aIt ? effOf((aIt.effect && aIt.effect.def) || 0, upg[eq.armor] || 0) : 0;
      return '已装备：' + slot(eq.weapon, 'atk', '') +
        ' · ' + slot(eq.armor, 'def', '护甲：') +
        ' · 合计 攻+' + wAdd + ' 防+' + aAdd;
    },

    /* D-28：背包行尾徽标（独立绘制元素，绝不拼进 _rowText 串）。
     * - 已装备：把总数拆成「已装备 1｜背包 N」——equip() 不扣物品，
     *   所以 x2 里有一件在身上，N=count-1 明确指出背包里还剩几件，杜绝误读
     * - 强化：画强化后的实际数值（攻击+4）；商店/图鉴不画，仍用基础值 */
    _rowBadges: function (kind, entry) {
      if (kind !== 'inventory' || !entry || !entry.id) return null;
      var IT = Game.Data.ITEMS || {};
      var it = IT[entry.id];
      if (!it || (it.type !== 'weapon' && it.type !== 'armor')) return null;
      var p = Game.Data.Player || {};
      var eq = p.equipment || {};
      var equipped = (eq.weapon === entry.id) || (eq.armor === entry.id);
      var plus = Math.min(Math.max((p.upg && p.upg[entry.id]) || 0, 0), 5);
      var field = it.type === 'weapon' ? 'atk' : 'def';
      var base = (it.effect && it.effect[field]) ? it.effect[field] : 0;
      var parts = [];
      if (equipped) parts.push('已装备 1｜背包 ' + Math.max((entry.count || 1) - 1, 0));
      if (plus > 0) parts.push((field === 'atk' ? '攻击+' : '防御+') + effOf(base, plus));
      if (!parts.length) return null;
      return { text: parts.join(' · '), color: equipped ? '#ffcf6e' : '#7fd1ff' };
    },

    /* D-29：装备对比差值——"这件装上之后，该槽位的实际变化"，口径与 recalcEquip 完全一致：
     *   主属性 = effOf(候选基础值, 候选强化等级) − effOf(当前槽基础值, 当前强化等级)
     *   生命   = 候选 effect.maxHp − 当前槽 effect.maxHp（maxHp 不参与强化倍率，故取原始差）
     * 规则：
     *   - 只对背包里的武器/护甲出徽标；消耗品、强化卷轴、其他类型 → null（不显示）
     *   - 当前槽为空 → 当前值按 0 起算（即"从 0 起算"，不写"首次装备"特例）
     *   - 主属性为 0 且生命为 0 → "持平"
     *   - 符号以主属性优先；主属性为 0 时看生命。混合符号（攻升血降）会同时列出两项
     *     （如 ▲+2 生命-10），不隐藏任何一边
     * 商店/图鉴：kind !== 'inventory' 直接 null（沿用 D-28 的上下文分离）。 */
    _rowDelta: function (entry) {
      if (kind !== 'inventory' || !entry || !entry.id) return null;
      var IT = Game.Data.ITEMS || {};
      var it = IT[entry.id];
      if (!it || (it.type !== 'weapon' && it.type !== 'armor')) return null;
      var p = Game.Data.Player || {};
      var eq = p.equipment || {};
      var upg = p.upg || {};
      var field = it.type === 'weapon' ? 'atk' : 'def';
      var curId = (it.type === 'weapon') ? (eq.weapon || null) : (eq.armor || null);
      var cur = curId ? IT[curId] : null;
      var candBase = (it.effect && it.effect[field]) ? it.effect[field] : 0;
      var curBase = (cur && cur.effect && cur.effect[field]) ? cur.effect[field] : 0;
      var candPlus = Math.min(Math.max(upg[entry.id] || 0, 0), 5);
      var curPlus = curId ? Math.min(Math.max(upg[curId] || 0, 0), 5) : 0;
      var dMain = effOf(candBase, candPlus) - effOf(curBase, curPlus);
      var dHp = ((it.effect && it.effect.maxHp) || 0) - ((cur && cur.effect && cur.effect.maxHp) || 0);

      var sign = (dMain !== 0) ? dMain : dHp;   /* 主属性优先，其为 0 时看生命 */
      var parts = [];
      if (dMain !== 0) parts.push((dMain > 0 ? '+' : '') + dMain);
      if (dHp !== 0) parts.push('生命' + (dHp > 0 ? '+' : '') + dHp);
      var text, color;
      if (!parts.length) {
        text = '持平';
        color = '#9aa0b0';
      } else {
        text = (sign > 0 ? '▲' : '▼') + parts.join(' ');
        color = sign > 0 ? '#7ce38b' : '#ff8080';
      }
      return { text: text, color: color, sign: sign, dMain: dMain, dHp: dHp, cur: curId };
    },

    /* D-29：右栏装备栏绘制——两个槽（武器/护甲），程序化色块占位，不引入新 PNG。
     * 只读：不参与 sel、不响应点击（_rowAt 在 listW 之外直接返回 null）。 */
    _drawRail: function (c, rail) {
      if (!rail) return;
      /* 与左列表之间的竖分隔线 */
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(rail.x - RAIL_GAP / 2, rail.y, 1, rail.h);

      c.fillStyle = '#9fb6cf';
      c.font = '11px monospace';
      c.fillText(rail.title, rail.x + 8, rail.y + 16);

      for (var i = 0; i < rail.slots.length; i++) {
        var s = rail.slots[i];
        /* 槽位标签（武器 / 护甲） */
        c.fillStyle = '#8a8aa0';
        c.font = '11px monospace';
        c.fillText(s.label, s.x, s.y - 6);
        /* 槽框：外黑 1px + 内亮 1px——形状与边框要能一眼看出"这是一个槽" */
        c.fillStyle = '#1b1b33';
        c.fillRect(s.x, s.y, s.w, s.h);
        c.strokeStyle = 'rgba(0,0,0,0.9)';
        c.lineWidth = 1;
        c.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
        c.strokeStyle = s.empty ? 'rgba(255,255,255,0.22)' : 'rgba(255,207,110,0.45)';
        c.strokeRect(s.x + 1.5, s.y + 1.5, s.w - 3, s.h - 3);

        /* 图标位 26×26：程序化色块（武器=剑形，护甲=胸甲形，空槽=短横） */
        var ix = s.x + 8, iy = s.y + Math.floor((s.h - 26) / 2);
        c.fillStyle = '#0f0f1e';
        c.fillRect(ix, iy, 26, 26);
        c.strokeStyle = 'rgba(255,255,255,0.18)';
        c.strokeRect(ix + 0.5, iy + 0.5, 25, 25);
        if (s.empty) {
          c.fillStyle = 'rgba(255,255,255,0.16)';
          c.fillRect(ix + 9, iy + 12, 8, 2);
        } else if (s.slot === 'weapon') {
          c.fillStyle = '#c9d4e3';
          c.fillRect(ix + 12, iy + 5, 2, 12);
          c.fillStyle = '#ffcf6e';
          c.fillRect(ix + 8, iy + 17, 10, 2);
          c.fillStyle = '#b5793f';
          c.fillRect(ix + 12, iy + 19, 2, 4);
        } else {
          c.fillStyle = '#6f8bb5';
          c.fillRect(ix + 7, iy + 7, 12, 12);
          c.fillStyle = '#4d6389';
          c.fillRect(ix + 7, iy + 7, 4, 12);
          c.fillStyle = '#a9c0e0';
          c.fillRect(ix + 13, iy + 7, 2, 7);
        }

        /* 名称+强化等级 / 实际加成（空槽写"空"与 0 加成，不许留白） */
        var tx = ix + 34;
        var maxW = s.x + s.w - tx - 6;
        c.fillStyle = s.empty ? '#7c8296' : '#e8e8f0';
        c.font = '12px monospace';
        c.fillText(this._fitRow(c, s.empty ? '空' : (s.name + '+' + s.plus), maxW), tx, s.y + 26);
        c.fillStyle = s.empty ? '#5f6578' : '#7fd1ff';
        c.font = '11px monospace';
        c.fillText(s.value, tx, s.y + 46);
      }
    },

    /* 自适应：单行文本超宽时按实际字宽截断并加省略号（调用前已设好字体） */
    _fitRow: function (c, text, maxW) {
      var str = String(text);
      if (!c || c.measureText(str).width <= maxW) return str;
      var ell = '…';
      while (str.length > 0 && c.measureText(str + ell).width > maxW) {
        str = str.slice(0, -1);
      }
      return str + ell;
    },

    /* P1-2：当前行物品图标（inventory/shop/图鉴物品页）。D-30 起物品 id → 图标名走显式表，
     * 表里没有的 id（含未知物品）返回 null，不画图标、行文字保持原位。
     * shop 条目结构为 {id, item}，inventory 为 {id, count}，图鉴 page2 为 {id, def} */
    _rowIcon: function (entry) {
      if (!entry) return null;
      /* D-30：逻辑宽 < 420（含 320 档）一律不画图标——那里连正文都在截断，
       * 再让图标占 22px 行首只会更挤；宽屏照常。宽度未知（0）时保持旧行为。 */
      var vw = cssSize().w;
      if (vw && vw < 420) return null;
      var id = null;
      if (kind === 'shop') id = (entry.item && entry.item.id) || entry.id;
      else if (kind === 'inventory') id = entry.id;
      else if (kind === 'quests' && page === 2) id = entry.id;
      if (!id) return null;
      return itemIcon(id);
    },

    _rowText: function (entry) {
      if (kind === 'inventory') {
        var it = Game.Data.ITEMS[entry.id];
        var nm = (it && it.name) ? it.name : entry.id;
        return nm + upgSuffix(entry.id) + ' x' + entry.count + '   ' + itemDesc(it);
      } else if (kind === 'shop') {
        var item = entry.item || Game.Data.ITEMS[entry.id];
        var name = (item && item.name) ? item.name : entry.id;
        var price = (shopMode === 'buy' ? (item ? item.price : 0) : (item ? item.sell : 0)) + ' 金币';
        return name + '   ' + itemDesc(item) + '   ' + price;
      } else if (kind === 'quests') {
        /* M8-4：page 0 任务页（行格式与改造前完全一致，行为不变） */
        if (page === 0) {
          var q = entry.q;
          var prog = Math.min(entry.progress, q.count);
          return q.desc + ' [' + prog + '/' + q.count + '] +' + q.reward.gold + '金+' + q.reward.exp + 'exp';
        }
        /* M8-4：page 1 怪物图鉴——已击杀显示 HP/ATK/DEF + 击杀数；未击杀只显示名称 + ???（隐藏数值，不新增描述文案） */
        var b = Game.Systems && Game.Systems.Bestiary;
        if (page === 1) {
          var mc = (b && typeof b.getMonsterCount === 'function') ? b.getMonsterCount(entry.id) : 0;
          if (mc > 0) {
            return entry.def.name + '   HP:' + entry.def.hp + ' ATK:' + entry.def.atk + ' DEF:' + entry.def.def + '   击杀x' + mc;
          }
          return entry.def.name + '   ???';
        }
        /* M8-4：page 2 物品图鉴——已获得显示 类型/效果 + 价格 + 获得数；未获得只显示名称 + ???（变体 id 同理） */
        var ic = (b && typeof b.getItemCount === 'function') ? b.getItemCount(entry.id) : 0;
        if (ic > 0) {
          return entry.def.name + '   ' + itemDesc(entry.def) + '   ' + entry.def.price + ' 金币   获得x' + ic;
        }
        return entry.def.name + '   ???';
      } else if (kind === 'npcquest') {
        /* D-47：面板行文本由 NpcQuest.panel 统一生成（状态 / 进度 / 奖励 / 操作） */
        return entry.text || '';
      }
      return '';
    }
  };
})();
