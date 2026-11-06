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

  var MAX_VISIBLE = 12;   /* 面板最多显示行数（当前数据量远小于此） */
  var ROW_H = 30;
  var HEADER_H = 46;
  var FOOTER_H = 34;
  var MAX_W = 520;
  var W_RATIO = 0.88;    /* 窄窗口时面板宽 ≤ 画布 88% */

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

  function itemDesc(item) {
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
    if (item.type === 'weapon') return '攻击+' + ((item.effect && item.effect.atk) || 0) + hp;
    if (item.type === 'armor') return '防御+' + ((item.effect && item.effect.def) || 0) + hp;
    return '';
  }

  /* S-03：背包行强化后缀 +N（只对已强化的武器/护甲有意义；商店卖的是未强化新货，不加后缀） */
  function upgSuffix(id) {
    var p = Game.Data && Game.Data.Player;
    var n = (p && p.upg && p.upg[id]) || 0;
    return n > 0 ? ' +' + n : '';
  }

  /* P2-2：物品行图标映射（以 js/data/items.js 实际 id 为准）：
   *   potion_small→flask_red、potion_large/potion_xl→flask_big_red、potion_mana→flask_blue；
   *   新武器按卡面逐一映射（sword_rusty→weapon_rusty_sword、knife→weapon_knife、
   *   machete→weapon_machete、sword_iron→weapon_regular_sword、sword_steel→weapon_duel_sword、
   *   axe_war→weapon_waraxe、bow_hunter→weapon_bow_2、hammer→weapon_hammer、spear→weapon_spear、
   *   sword_magic→weapon_knight_sword、staff_fire→weapon_red_magic_staff、bow_elite→weapon_bow、
   *   axe_double→weapon_double_axe、sword_anime→weapon_anime_sword）；
   *   品质档沿用 P1-2 既有规则（*_rare→weapon_golden_sword、*_epic→weapon_lavish_sword，
   *   保持品质可辨识，不改为基础档图标）；armor_* / 未知 → null（不画，行文字原位）。素材缺失同样返回 null。 */
  function itemIcon(id) {
    if (typeof id !== 'string' || !id) return null;
    var name;
    if (id === 'potion_small') name = 'flask_red';
    else if (id === 'potion_large') name = 'flask_big_red';
    else if (id === 'potion_xl') name = 'flask_big_red';
    else if (id === 'potion_mana') name = 'flask_blue';
    else if (id === 'sword_bone') name = 'weapon_rusty_sword';
    else if (id === 'sword_dragon') name = 'weapon_red_gem_sword';
    else if (id === 'sword_rusty') name = 'weapon_rusty_sword';
    else if (id === 'knife') name = 'weapon_knife';
    else if (id === 'machete') name = 'weapon_machete';
    else if (id === 'sword_iron') name = 'weapon_regular_sword';
    else if (id === 'sword_steel') name = 'weapon_duel_sword';
    else if (id === 'axe_war') name = 'weapon_waraxe';
    else if (id === 'bow_hunter') name = 'weapon_bow_2';
    else if (id === 'hammer') name = 'weapon_hammer';
    else if (id === 'spear') name = 'weapon_spear';
    else if (id === 'sword_magic') name = 'weapon_knight_sword';
    else if (id === 'staff_fire') name = 'weapon_red_magic_staff';
    else if (id === 'bow_elite') name = 'weapon_bow';
    else if (id === 'axe_double') name = 'weapon_double_axe';
    else if (id === 'sword_anime') name = 'weapon_anime_sword';
    else if (/^sword_.+_rare$/.test(id)) name = 'weapon_golden_sword';
    else if (/^sword_.+_epic$/.test(id)) name = 'weapon_lavish_sword';
    else return null;
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
    open: function (k, stats) {
      if (k !== 'inventory' && k !== 'shop' && k !== 'quests' && k !== 'settings' && k !== 'gameover') return;
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
        /* gameover 无列表，战绩在 _drawGameover 现场拉取 */
      } catch (e) { data = []; }
      sel = clamp(sel, 0, Math.max(data.length - 1, 0));
      /* P2-3b：数据变化后把滚动窗口夹回有效区间（仅 quests 图鉴会 >0） */
      var maxScroll = Math.max(0, data.length - MAX_VISIBLE);
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

    /* P2-3b：选中行变化后让滚动窗口跟随（仅 quests 图鉴且条目超一屏时生效） */
    _syncScroll: function () {
      if (kind !== 'quests' || data.length <= MAX_VISIBLE) return;
      if (sel < qScroll) qScroll = sel;
      else if (sel >= qScroll + MAX_VISIBLE) qScroll = sel - MAX_VISIBLE + 1;
      var maxScroll = Math.max(0, data.length - MAX_VISIBLE);
      if (qScroll > maxScroll) qScroll = maxScroll;
      if (qScroll < 0) qScroll = 0;
    },

    /* P2-3b：当前可见窗口（验证/调试读取）：{start, rows, total, sel} */
    _visibleRange: function () {
      var start = (kind === 'quests' && data.length > MAX_VISIBLE) ? qScroll : 0;
      return { start: start, rows: Math.min(data.length - start, MAX_VISIBLE), total: data.length, sel: sel };
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

    _confirm: function () {
      if (data.length === 0) return;
      var entry = data[sel];
      try {
        if (kind === 'inventory') {
          var it = Game.Data.ITEMS[entry.id];
          if (it && it.type === 'consumable') Game.Systems.Inventory.use(entry.id);
          else Game.Systems.Inventory.equip(entry.id);
        } else if (kind === 'shop') {
          if (shopMode === 'buy') Game.Systems.Shop.buy(entry.id);
          else Game.Systems.Shop.sell(entry.id);
        } else if (kind === 'quests') {
          this.close(); return;
        }
        this._refresh();
      } catch (e) { /* 降级：弹窗内操作异常不影响主游戏 */ }
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
      var rowY = rect.y + HEADER_H;
      var rowIdx = Math.floor((y - rowY) / ROW_H);
      /* P2-3b：点击行按滚动窗口偏移换算为绝对索引（tasks/shop/inventory 的 start 恒为 0） */
      var start = (kind === 'quests' && data.length > MAX_VISIBLE) ? qScroll : 0;
      var absIdx = rowIdx + start;
      if (rowIdx >= 0 && rowIdx < MAX_VISIBLE && absIdx >= 0 && absIdx < data.length) {
        sel = absIdx;
        this._confirm();
      }
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
        'T 对话 · L 强化学习',
        'K 静音 · Q 设置',
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

      /* P2-3b：图鉴滚动窗口起点；非 quests 图鉴页 start 恒为 0（tasks/shop/inventory 行为不变） */
      var start = (kind === 'quests' && data.length > MAX_VISIBLE) ? qScroll : 0;
      var rows = Math.min(data.length - start, MAX_VISIBLE);
      var w = Math.min(cw * W_RATIO, MAX_W);
      /* M9-4/M9-5：设置面板与死亡结算使用固定内容高度（非列表） */
      var h = (kind === 'settings') ? HEADER_H + 280 + FOOTER_H
        : (kind === 'gameover') ? HEADER_H + 220 + FOOTER_H
        : HEADER_H + rows * ROW_H + FOOTER_H;
      var px = (cw - w) / 2;
      var py = (ch - h) / 2;
      rect = { x: px, y: py, w: w, h: h };

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
          c.fillRect(px + 6, ry + 2, w - 12, ROW_H - 4);
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
        var rowMaxW = w - 28;
        if (ric) {
          rowTextX = px + 14 + 22;
          rowMaxW = w - 28 - 22;
          var riy = ry + Math.floor((ROW_H - 16) / 2);
          c.drawImage(ric, px + 14 + 2, riy, 16, 16);
        }
        c.fillText(this._fitRow(c, this._rowText(entry), rowMaxW), rowTextX, ry + 20);
      }
      /* M9-5：空状态——居中灰字提示（背包/任务各自文案） */
      if (data.length === 0) {
        c.fillStyle = '#9bbbf4';
        c.font = '14px monospace';
        var emptyMsg = '（空）';
        if (kind === 'inventory') emptyMsg = '背包空空如也';
        else if (kind === 'quests') emptyMsg = '暂无任务';
        /* 居中：估算文字宽度后水平居中（灰字） */
        c.textAlign = 'center';
        c.fillText(emptyMsg, px + w / 2, py + HEADER_H + 20);
        c.textAlign = 'left';
      }

      /* 底部操作提示（窄屏缩字号，避免 320 宽溢出） */
      c.fillStyle = '#9bbbf4';
      c.font = (cw < 420 ? '11px monospace' : '12px monospace');
      var hint;
      if (kind === 'inventory') hint = '↑↓ 选择 · Enter 使用/装备 · Esc/点遮罩关闭';
      else if (kind === 'shop') hint = '↑↓ 选择 · Enter ' + (shopMode === 'buy' ? '购买' : '出售') + ' · Tab 切换 · Esc/点遮罩关闭';
      else if (kind === 'quests') hint = 'Tab/←→ 切页 · ↑↓ 选择 · Esc/点遮罩关闭'; /* M8-4 */
      else hint = '↑↓ 选择 · Esc/点遮罩关闭';
      /* P2-3b：图鉴滚动时底部显示当前位置 (sel+1)/total（窄屏用短文案避免溢出） */
      if (kind === 'quests' && data.length > MAX_VISIBLE) {
        hint = '↑↓ 浏览 · ' + (sel + 1) + '/' + data.length + ' · Tab 切页 · Esc 关闭';
      }
      c.fillText(hint, px + 14, py + h - 12);
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

    /* P1-2：当前行物品图标（inventory/shop/图鉴物品页；armor/未知返回 null 不画）
     * shop 条目结构为 {id, item}，inventory 为 {id, count}，图鉴 page2 为 {id, def} */
    _rowIcon: function (entry) {
      if (!entry) return null;
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
      }
      return '';
    }
  };
})();
