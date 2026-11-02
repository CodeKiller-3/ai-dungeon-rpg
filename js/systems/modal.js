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
    if (item.type === 'consumable') return '恢复HP+' + ((item.effect && item.effect.hp) || 0);
    if (item.type === 'weapon') return '攻击+' + ((item.effect && item.effect.atk) || 0);
    if (item.type === 'armor') return '防御+' + ((item.effect && item.effect.def) || 0);
    return '';
  }

  Game.Modal = {
    open: function (k, stats) {
      if (k !== 'inventory' && k !== 'shop' && k !== 'quests' && k !== 'settings' && k !== 'gameover') return;
      kind = k;
      sel = 0;
      shopMode = 'buy';
      volDragging = false;
      gameStats = (k === 'gameover') ? (stats || null) : null;
      gameRestartRect = null;
      this._refresh();
      this._bind();
    },

    close: function () {
      kind = null;
      data = [];
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
        else if (kind === 'quests') data = Game.Systems.Quest.getActive();
        /* gameover 无列表，战绩在 _drawGameover 现场拉取 */
      } catch (e) { data = []; }
      sel = clamp(sel, 0, Math.max(data.length - 1, 0));
    },

    _bind: function () {
      var self = this;
      var cv = canvas();
      onKey = function (e) {
        if (!self.isOpen()) return;
        var c = e.code;
        if (c === 'Escape') { e.preventDefault(); self.close(); return; }
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
        if (c === 'ArrowUp' || c === 'KeyW') { e.preventDefault(); sel = clamp(sel - 1, 0, Math.max(data.length - 1, 0)); return; }
        if (c === 'ArrowDown' || c === 'KeyS') { e.preventDefault(); sel = clamp(sel + 1, 0, Math.max(data.length - 1, 0)); return; }
        if (c === 'Enter' || c === 'NumpadEnter') { e.preventDefault(); self._confirm(); return; }
        if (c === 'Tab' && kind === 'shop') { e.preventDefault(); self._toggleShopMode(); return; }
      };
      onClick = function (e) {
        if (!self.isOpen()) return;
        var v = canvas();
        if (!v) return;
        var r = v.getBoundingClientRect();
        var sz = cssSize();
        var sx = sz.w / r.width, sy = sz.h / r.height;
        self._handleClick((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
      };
      /* M9-4：设置面板音量滑块拖拽 */
      onMouseDown = function (e) {
        if (!self.isOpen() || kind !== 'settings' || !volTrack) return;
        var v = canvas();
        if (!v) return;
        var r = v.getBoundingClientRect();
        var sz = cssSize();
        var sx = sz.w / r.width, sy = sz.h / r.height;
        var mx = (e.clientX - r.left) * sx;
        var my = (e.clientY - r.top) * sy;
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
        var r = v.getBoundingClientRect();
        var sz = cssSize();
        var sx = sz.w / r.width;
        var mx = (e.clientX - r.left) * sx;
        self._setVolumeFromX(mx);
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
        this.close(); return;
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
      if (rowIdx >= 0 && rowIdx < data.length && rowIdx < MAX_VISIBLE) {
        sel = rowIdx;
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
        'B 背包 · S 商店 · M 任务',
        'T 对话 · L 强化学习',
        'K 静音 · Q 设置',
        'Esc : 关闭弹窗'
      ];
      for (var i = 0; i < lines.length; i++) {
        c.fillText(lines[i], left, y + i * 18);
      }

      /* 底部提示 */
      c.fillStyle = '#9bbbf4';
      c.font = '12px monospace';
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

      /* 底部提示 */
      c.fillStyle = '#9bbbf4';
      c.font = '12px monospace';
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

      var rows = Math.min(data.length, MAX_VISIBLE);
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

      /* 居中面板 */
      c.fillStyle = '#14142a';
      c.fillRect(px, py, w, h);
      c.strokeStyle = 'rgba(255,255,255,0.18)';
      c.lineWidth = 2;
      c.strokeRect(px + 1, py + 1, w - 2, h - 2);

      /* 标题 + 金币 */
      var title = '';
      if (kind === 'inventory') title = '背包';
      else if (kind === 'shop') title = '商店 · ' + (shopMode === 'buy' ? '购买' : '出售');
      else if (kind === 'quests') title = '任务';
      else if (kind === 'settings') title = '设置';
      else if (kind === 'gameover') title = '冒险结束';
      c.fillStyle = '#ffcf6e';
      c.font = 'bold 18px monospace';
      c.fillText(title, px + 14, py + 30);
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

      /* 条目列表 */
      c.font = '14px monospace';
      for (var i = 0; i < rows; i++) {
        var ry = py + HEADER_H + i * ROW_H;
        if (i === sel) {
          c.fillStyle = 'rgba(255,207,110,0.18)';
          c.fillRect(px + 6, ry + 2, w - 12, ROW_H - 4);
          c.fillStyle = '#ffcf6e';
        } else {
          c.fillStyle = '#cfcfcf';
        }
        c.fillText(this._rowText(data[i]), px + 14, ry + 20);
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

      /* 底部操作提示 */
      c.fillStyle = '#9bbbf4';
      c.font = '12px monospace';
      var hint;
      if (kind === 'inventory') hint = '↑↓ 选择 · Enter 使用/装备 · Esc/点遮罩关闭';
      else if (kind === 'shop') hint = '↑↓ 选择 · Enter ' + (shopMode === 'buy' ? '购买' : '出售') + ' · Tab 切换 · Esc/点遮罩关闭';
      else hint = '↑↓ 选择 · Esc/点遮罩关闭';
      c.fillText(hint, px + 14, py + h - 12);
    },

    _rowText: function (entry) {
      if (kind === 'inventory') {
        var it = Game.Data.ITEMS[entry.id];
        var nm = (it && it.name) ? it.name : entry.id;
        return nm + ' x' + entry.count + '   ' + itemDesc(it);
      } else if (kind === 'shop') {
        var item = entry.item || Game.Data.ITEMS[entry.id];
        var name = (item && item.name) ? item.name : entry.id;
        var price = (shopMode === 'buy' ? (item ? item.price : 0) : (item ? item.sell : 0)) + ' 金币';
        return name + '   ' + itemDesc(item) + '   ' + price;
      } else if (kind === 'quests') {
        var q = entry.q;
        var prog = Math.min(entry.progress, q.count);
        return q.desc + ' [' + prog + '/' + q.count + '] +' + q.reward.gold + '金+' + q.reward.exp + 'exp';
      }
      return '';
    }
  };
})();
