/* js/systems/sysviz.js — D-90 系统测量层（第一批：T1 / X1 / X3 / X2 / H1+H2）
 * 口径唯一：颜色与 5 个原语一律取第 4 页已落地的 Game.Modal._sys（不复制第二份 SYS_C）；
 *           突破刻度直接调 Modal._sys.breakthrough()（与第 4 页同一份 sysBreakthroughParts）。
 * 纪律：纯视觉 / 只读。不写 Player、不写存档、不掷 Math.random、不新增按键、
 *       不设 setTimeout 门控输入、不改战斗时钟 100/150/180。
 * 时钟：now() 走可注入时钟（_setClock），验证页可冻结；生产环境用 performance.now。
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  var TILE = 24;                 /* 与 render.js 的 TILE 同值（规格基线） */
  var SURVEY_MS = 520;           /* T1 总时长 */
  /* D-114：T1 黑场只压地图区。顶栏 0–28 + 读数带 28–42 保持原亮度，
   * 因此黑场从 y=43 起画到底边。 */
  var HUD_SAFE_H = 43;

  var injected = null;           /* 注入时钟（ms）；null = 真实时钟 */
  var survey = null;             /* {t0, floor, w, h, rooms} */
  var targets = {};              /* 目标框淡入淡出状态 key -> {x,y,kind,gold,t0,gone} */
  var last = { brackets: [], hud: null, survey: null };

  function now() {
    if (injected !== null) return injected;
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }
  function pal() {
    var m = Game.Modal && Game.Modal._sys;
    return (m && m.C) ? m.C : null;
  }
  function prim(name) {
    var m = Game.Modal && Game.Modal._sys;
    return (m && typeof m[name] === 'function') ? m[name] : null;
  }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function visible(x, y) {
    var F = Game.fov;
    if (F && typeof F.isVisible === 'function') return !!F.isVisible(x, y);
    return true;
  }

  /* ── T1：房间包围盒（只读，floorChanged 时算一次；缓存进 survey，不每帧扫图） ── */
  function roomBoxes(grid) {
    var R = Game.Core && Game.Core.Render;
    var M = Game.Systems && Game.Systems.Map;
    var out = [], secret = (M && typeof M.getRooms === 'function') ? M.getRooms() : [];
    var i, j;
    for (i = 0; i < secret.length; i++) {
      var s = secret[i];
      if (!s || !(s.w >= 3 && s.h >= 3)) continue;
      out.push({ x: s.x, y: s.y, w: s.w, h: s.h, area: s.w * s.h, secret: true });
    }
    if (!grid || !grid.length || !R || typeof R._roomKind !== 'function') {
      out.sort(function (a, b) { return b.area - a.area; });
      return out.slice(0, 6);
    }
    var h = grid.length, w = grid[0].length;
    var seen = [], dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var y = 0; y < h; y++) { seen[y] = []; for (var x = 0; x < w; x++) seen[y][x] = false; }
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        if (seen[y][x] || grid[y][x] === 0) continue;
        if (R._roomKind(grid, x, y, false, false) !== 'room') continue;
        var q = [[x, y]], qi = 0, minx = x, maxx = x, miny = y, maxy = y;
        seen[y][x] = true;
        while (qi < q.length) {
          var cx = q[qi][0], cy = q[qi][1]; qi++;
          if (cx < minx) minx = cx;
          if (cx > maxx) maxx = cx;
          if (cy < miny) miny = cy;
          if (cy > maxy) maxy = cy;
          for (var d = 0; d < 4; d++) {
            var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny][nx]) continue;
            if (grid[ny][nx] === 0) continue;
            if (R._roomKind(grid, nx, ny, false, false) !== 'room') continue;
            seen[ny][nx] = true;
            q.push([nx, ny]);
          }
        }
        var bw = maxx - minx + 1, bh = maxy - miny + 1;
        if (bw >= 3 && bh >= 3) {
          var dup = false;
          for (j = 0; j < out.length; j++) {
            if (out[j].x === minx && out[j].y === miny && out[j].w === bw && out[j].h === bh) dup = true;
          }
          if (!dup) out.push({ x: minx, y: miny, w: bw, h: bh, area: bw * bh, secret: false });
        }
      }
    }
    out.sort(function (a, b) { return (b.area - a.area) || (a.y - b.y) || (a.x - b.x); });
    return out.slice(0, 6);
  }

  function armSurvey() {
    var M = Game.Systems && Game.Systems.Map;
    if (!M || typeof M.getGrid !== 'function') return null;
    var grid = M.getGrid();
    if (!grid || !grid.length) return null;
    var floor = (typeof M.getFloor === 'function') ? M.getFloor() : 1;
    survey = {
      t0: now(), floor: floor,
      w: grid[0].length, h: grid.length,
      rooms: roomBoxes(grid)
    };
    return survey;
  }

  /* 入层测绘的当前帧（纯计算；到 520ms 自动结束，不阻塞任何更新） */
  function surveyFrame() {
    if (!survey) return null;
    var t = now() - survey.t0;
    if (t < 0 || t >= SURVEY_MS) { survey = null; return null; }
    var black, phase;
    if (t < 80) { black = 0.72 * (t / 80); phase = 'in'; }
    else if (t < 360) { black = 0.72; phase = 'survey'; }
    else { black = 0.72 * (1 - (t - 360) / 160); phase = 'out'; }
    var textA;
    if (t < 80) textA = 0;
    else if (t < 160) textA = (t - 80) / 80;
    else if (t < 360) textA = 1;
    else textA = clamp01(1 - (t - 360) / 100);
    var roomA;
    if (t < 200) roomA = 0;
    else if (t < 280) roomA = (t - 200) / 80;
    else if (t < 360) roomA = 1;
    else roomA = clamp01(1 - (t - 360) / 120);
    return {
      t: Math.round(t * 100) / 100, phase: phase,
      black: r3(black), textAlpha: r3(textA), roomAlpha: r3(roomA),
      floor: survey.floor, w: survey.w, h: survey.h, rooms: survey.rooms.length,
      title: 'F' + survey.floor,
      sub: survey.w + ' × ' + survey.h + ' · 已测绘'
    };
  }

  /* X3（六格网格残迹）已在 D-114 整层删除：实测只改地图区 0.02–0.03% 像素，
   * 属于"看不见却占着代码"的测量层。绘图入口 drawUnderlay 一并移除。 */

  /* ── X2：目标四角括号（陷阱 / 容器 / 楼梯 / 精英） ── */
  var CONTAINERS = { chest: 1, room_chest: 1, gold_pile: 1, potion_stash: 1 };
  function collectTargets(player) {
    var M = Game.Systems && Game.Systems.Map;
    var out = [];
    if (!M || typeof M.getGrid !== 'function' || !player) return out;
    var grid = M.getGrid();
    if (!grid) return out;
    var px = player.x, py = player.y, range = 4;
    for (var y = py - range; y <= py + range; y++) {
      if (y < 0 || y >= grid.length) continue;
      for (var x = px - range; x <= px + range; x++) {
        if (x < 0 || x >= grid[y].length) continue;
        if (Math.max(Math.abs(x - px), Math.abs(y - py)) > range) continue;
        if (x === px && y === py) continue;            /* 绝不画在玩家包围盒内 */
        if (!visible(x, y)) continue;
        var kind = null, gold = false;
        var el = (typeof M.eliteAt === 'function') ? M.eliteAt(x, y) : null;
        var dec = (typeof M.getDecor === 'function') ? M.getDecor(x, y) : null;
        var tr = (typeof M.getTrap === 'function') ? M.getTrap(x, y) : null;
        var t = grid[y][x];
        if (el) { kind = 'elite'; gold = true; }
        else if (t === 2 || t === 3) kind = 'stair';
        else if (dec && CONTAINERS[dec]) kind = 'container';
        else if (tr && tr.seen) kind = 'trap';
        if (!kind) continue;
        /* 与玩家包围盒至少留 2px：相邻格的外扩矩形会贴到玩家，直接跳过该目标 */
        var bx = x * TILE - 2, by = y * TILE - 2, bw = TILE + 4, bh = TILE + 4;
        var pxx = px * TILE - 2, pyy = py * TILE - 2, pww = TILE + 4, phh = TILE + 4;
        if (bx < pxx + pww && bx + bw > pxx && by < pyy + phh && by + bh > pyy) continue;
        out.push({ key: kind + ':' + x + ',' + y, kind: kind, x: x, y: y, gold: gold });
      }
    }
    return out;
  }

  function bracket(ctx, x, y, w, h, color, alpha, arm) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    var x0 = Math.round(x) + 0.5, y0 = Math.round(y) + 0.5;
    var x1 = Math.round(x + w) - 0.5, y1 = Math.round(y + h) - 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + arm); ctx.lineTo(x0, y0); ctx.lineTo(x0 + arm, y0);
    ctx.moveTo(x1 - arm, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + arm);
    ctx.moveTo(x1, y1 - arm); ctx.lineTo(x1, y1); ctx.lineTo(x1 - arm, y1);
    ctx.moveTo(x0 + arm, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - arm);
    ctx.stroke();
  }

  function drawMarkers(ctx, player) {
    var C = pal();
    if (!C || !ctx) return;
    var scene = (Game.Core.Main && Game.Core.Main._scene) || 'explore';
    var hidden = !!(Game.Modal && typeof Game.Modal.isOpen === 'function' && Game.Modal.isOpen()) ||
      !!(Game.Core.Main && Game.Core.Main._guideVisible);
    if (scene !== 'explore' || hidden) { last.brackets = []; return; }
    var R = Game.Core.Render;
    var cam = (R && typeof R._cam === 'function') ? R._cam() : { x: 0, y: 0 };
    var W = R ? R.cssW : 960, H = R ? R.cssH : 540;
    var p = player || Game.Data.Player;

    /* X1（右上水印）已在 D-114 删除：楼层归顶栏、地图格数只由 T1 测绘临时显示，
     * 调试坐标（x 14 y 09）不再出现在玩家可见界面。 */

    /* X2：目标框淡入 120ms / 淡出 200ms（时间戳只来自可注入时钟，不掷随机数） */
    var list = collectTargets(p);
    var seenKeys = {}, out = [], k;
    var t = now();
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      seenKeys[g.key] = true;
      var st = targets[g.key];
      if (!st) {
        st = { x: g.x, y: g.y, kind: g.kind, gold: g.gold, t0: t, gone: null };
        targets[g.key] = st;
      }
      st.x = g.x; st.y = g.y; st.kind = g.kind; st.gold = g.gold; st.gone = null;
    }
    for (k in targets) {
      if (!Object.prototype.hasOwnProperty.call(targets, k)) continue;
      if (seenKeys[k]) continue;
      var st2 = targets[k];
      if (st2.gone === null) st2.gone = t;
      if (t - st2.gone >= 200) { delete targets[k]; continue; }
    }
    for (k in targets) {
      if (!Object.prototype.hasOwnProperty.call(targets, k)) continue;
      var s2 = targets[k];
      var a = 1;
      if (s2.gone !== null) a = clamp01(1 - (t - s2.gone) / 200);
      else a = clamp01((t - s2.t0) / 120);
      if (!(a > 0)) continue;
      var sx = s2.x * TILE - cam.x - 2, sy = s2.y * TILE - cam.y - 2;
      if (sx < -30 || sy < -30 || sx > W + 30 || sy > H + 30) continue;
      var base = s2.gold ? 0.32 : 0.28;
      ctx.save();
      bracket(ctx, sx, sy, TILE + 4, TILE + 4, s2.gold ? C.gold : C.cyan, r3(base * a), 5);
      ctx.restore();
      out.push({ key: k, kind: s2.kind, gold: !!s2.gold, x: sx, y: sy, w: TILE + 4, h: TILE + 4, alpha: r3(base * a) });
    }
    last.brackets = out;
  }

  /* ── T1 绘制（事件层：黑场 + 房间括号 + 层号/格数；只画，不参与任何更新） ── */
  function drawEvent(ctx, player) {
    var C = pal();
    if (!C || !ctx) return;
    var sf = surveyFrame();
    var scene = (Game.Core.Main && Game.Core.Main._scene) || 'explore';
    var hidden = !!(Game.Modal && typeof Game.Modal.isOpen === 'function' && Game.Modal.isOpen());
    if (!sf || scene !== 'explore' || hidden) {
      /* 规格 §6.1：切到战斗/弹窗时立即取消事件，不延迟任何结算 */
      if (survey && (scene !== 'explore' || hidden)) survey = null;
      last.survey = null;
      return;
    }
    var R = Game.Core.Render;
    var W = R ? R.cssW : 960, H = R ? R.cssH : 540;
    var cam = (R && typeof R._cam === 'function') ? R._cam() : { x: 0, y: 0 };
    last.survey = sf;
    ctx.save();
    /* 0–80 压入 / 360–520 退去：黑场只覆盖画面，不接管输入 */
    /* 0–80 压入 / 360–520 退去：黑场只覆盖地图区（y≥43），
     * 顶栏 0–28 与读数带 28–42 不被压暗——一句话：黑场不碰 HUD，只压地图。 */
    if (sf.black > 0) {
      ctx.fillStyle = '#06060c';
      ctx.globalAlpha = sf.black;
      ctx.fillRect(0, HUD_SAFE_H, W, Math.max(0, H - HUD_SAFE_H));
    }
    /* 房间四角括号（最多 6 个，臂长 6px，青色 0.55） */
    if (sf.roomAlpha > 0 && survey && survey.rooms.length) {
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 1;
      for (var i = 0; i < survey.rooms.length; i++) {
        var rm = survey.rooms[i];
        var x = rm.x * TILE - cam.x, y = rm.y * TILE - cam.y;
        var w = rm.w * TILE, h = rm.h * TILE;
        if (x + w < -20 || y + h < -20 || x > W + 20 || y > H + 20) continue;
        bracket(ctx, x + 2, y + 2, w - 4, h - 4, C.cyan, r3(0.55 * sf.roomAlpha), 6);
      }
    }
    /* 屏幕中心：F3 / 33 × 23 · 已测绘 + 上下两条 180×1px 线 */
    if (sf.textAlpha > 0) {
      ctx.globalAlpha = sf.textAlpha;
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 1;
      var lx = Math.round(W / 2 - 90) + 0.5;
      ctx.beginPath();
      ctx.moveTo(lx, Math.round(H / 2) - 22.5); ctx.lineTo(lx + 179, Math.round(H / 2) - 22.5);
      ctx.moveTo(lx, Math.round(H / 2) + 26.5); ctx.lineTo(lx + 179, Math.round(H / 2) + 26.5);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = '13px monospace';
      ctx.fillStyle = C.gold;
      ctx.fillText(sf.title, Math.round(W / 2), Math.round(H / 2) - 4);
      ctx.font = '11px monospace';
      ctx.fillStyle = C.cyan;
      ctx.fillText(sf.sub, Math.round(W / 2), Math.round(H / 2) + 16);
    }
    ctx.restore();
  }

  /* ── H1 + H2：14px 读数带（顶栏下沿 y=28–42；不动顶栏任何既有坐标） ── */
  function drawHudBand(ctx, W) {
    var C = pal();
    if (!C || !ctx) return null;
    var narrow = W < 520, tiny = W < 420;
    var font = '11px monospace';
    ctx.save();
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    /* 基线 + 刻度（只在 cw≥520 画） */
    ctx.strokeStyle = 'rgba(127,209,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 28.5); ctx.lineTo(W, 28.5); ctx.stroke();
    if (!narrow) {
      ctx.strokeStyle = 'rgba(127,209,255,0.10)';
      ctx.beginPath();
      for (var tk = 48; tk < W; tk += 48) {
        var tx = Math.round(tk) + 0.5;
        ctx.moveTo(tx, 28); ctx.lineTo(tx, 31);
      }
      ctx.stroke();
    }
    var P = Game.Data.Player || {};
    var hl = (Game.hud && Game.hud.last) || {};
    var m = { W: W, narrow: narrow, tiny: tiny, left: null, mid: null, right: null, y: 28 };
    function mw(s) { return ctx.measureText(String(s)).width; }
    function plate(x, w) {
      ctx.fillStyle = 'rgba(6,6,12,0.55)';
      ctx.fillRect(Math.round(x) - 4, 29, Math.round(w) + 8, 13);
    }
    /* 左簇：LV 灰 + 等级金 + 10 段经验条 + exp/expNext 青 */
    var lv = (typeof hl.level === 'number') ? hl.level : P.level;
    var exp = (typeof hl.exp === 'number') ? hl.exp : P.exp;
    var expNext = (typeof hl.expNext === 'number') ? hl.expNext : null;
    if (typeof lv === 'number' && typeof exp === 'number' && typeof expNext === 'number') {
      var lvS = String(lv), expS = exp + '/' + expNext;
      var lvLabelX = 8;
      var lvValX = lvLabelX + mw('LV') + 3;
      var barW = tiny ? 32 : 44;
      var barX = lvValX + mw(lvS) + 6;
      var expX = barX + barW + 6;
      var endX = expX + mw(expS);
      plate(8, endX - 8);
      ctx.fillStyle = C.label; ctx.fillText('LV', lvLabelX, 39);
      ctx.fillStyle = C.gold; ctx.fillText(lvS, lvValX, 39);
      var seg = prim('segBar');
      var ratio = expNext > 0 ? clamp01(exp / expNext) : 0;
      if (seg) seg(ctx, barX, 34, barW, 4, ratio, C.cyan, 10);
      ctx.fillStyle = C.cyan; ctx.fillText(expS, expX, 39);
      m.left = { x: 8, w: Math.round(endX - 8), text: 'LV' + lvS + ' ' + expS, bar: { x: barX, y: 34, w: barW, h: 4, seg: 10, ratio: r3(ratio) } };
    }
    /* 中簇：ATK（唯一口径 = Player.atk，与战斗伤害公式同源；D-114 去掉了"有效攻击/刀"两种写法），
     * 以 W/2 为锚点居中。
     * D-118：窄档（320/390，此时 tiny）右对齐补 ATK——这三档的右侧没有突破簇，
     * 左簇右缘 ~110px，右对齐不会与 LV/经验挤在一起；420–519 的窄档仍居中，
     * 因为那时右簇有"突破"，右对齐会撞上去。 */
    var atk = (typeof P.atk === 'number') ? P.atk : null;
    if (typeof atk === 'number' && (!narrow || tiny)) {
      var parts = [{ s: 'ATK ', c: C.label }, { s: String(atk), c: C.cyan }];
      var total = 0, i;
      for (i = 0; i < parts.length; i++) total += mw(parts[i].s);
      var mx = (narrow && tiny) ? Math.round(W - 8 - total) : Math.round(W / 2 - total / 2);
      /* 兜底：右对齐若会压到左簇，就退回居中（320/390 实测余量 >150px，不会触发） */
      if (narrow && tiny && m.left && mx < m.left.x + m.left.w + 6) {
        mx = Math.round((m.left.x + m.left.w + (W - 8)) / 2 - total / 2);
      }
      plate(mx, total);
      var cur = mx;
      for (i = 0; i < parts.length; i++) {
        ctx.fillStyle = parts[i].c;
        ctx.fillText(parts[i].s, cur, 39);
        cur += mw(parts[i].s);
      }
      m.mid = { x: mx, w: Math.round(total), text: parts.map(function (q) { return q.s; }).join(''),
        align: (narrow && tiny) ? 'right' : 'center', bottom: 42 };
    }
    /* 右簇：突破 + 三态（与第 4 页共用 Sys.breakthrough()） */
    var brk = (typeof Game.Sys.breakthrough === 'function') ? Game.Sys.breakthrough() : null;
    if (brk && !tiny) {
      var rTxt, kind = brk.kind;
      if (kind === 'done') rTxt = '突破 已突破';
      else if (kind === 'ready') rTxt = '突破 就绪';
      else rTxt = '突破 还差 ' + (typeof brk.remain === 'number' ? brk.remain : 0);
      var rw = mw(rTxt);
      var rx = W - 8 - rw;
      plate(rx, rw);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.label; ctx.fillText('突破', rx, 39);
      var valX = rx + mw('突破 ') + 1;
      ctx.fillStyle = C.gold;
      ctx.fillText(rTxt.slice(3), valX, 39);
      var notch = { x: Math.round(rx) - 9, y: 32, w: 2, h: 6 };
      if (kind === 'done') {
        ctx.fillStyle = C.gold;
        ctx.fillRect(Math.round(rx) - 11, 35, 6, 2);
        notch = { x: Math.round(rx) - 11, y: 35, w: 6, h: 2 };
      } else if (kind === 'ready') {
        var br = 0.7 + 0.3 * (0.5 - 0.5 * Math.cos(now() / 1200 * Math.PI * 2));
        ctx.globalAlpha = r3(br);
        ctx.fillStyle = C.gold;
        ctx.fillRect(notch.x, notch.y, notch.w, notch.h);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = C.goldDim;
        ctx.fillRect(notch.x, notch.y, notch.w, notch.h);
      }
      m.right = { x: Math.round(rx), w: Math.round(rw), text: rTxt, kind: kind, notch: notch };
    }
    ctx.restore();
    last.hud = m;
    return m;
  }

  Game.Sys = {
    /* 只读能力探测：Modal 未加载（极简验证页）时整层静默跳过，不补假数据 */
    ready: function () { return !!pal(); },
    breakthrough: function () {
      var f = prim('breakthrough');
      return f ? f() : null;
    },
    C: function () { return pal(); },
    box: function () { var f = prim('box'); if (f) f.apply(null, arguments); },
    edge: function () { var f = prim('edge'); if (f) f.apply(null, arguments); },
    txt: function () { var f = prim('txt'); if (f) return f.apply(null, arguments); },
    bar: function () { var f = prim('bar'); if (f) return f.apply(null, arguments); },
    segBar: function () { var f = prim('segBar'); if (f) return f.apply(null, arguments); },

    /* 时钟与状态（验证页冻结/复位用） */
    _setClock: function (ms) { injected = (typeof ms === 'number') ? ms : null; },
    _reset: function () {
      injected = null; survey = null; targets = {};
      last = { brackets: [], hud: null, survey: null };
    },
    _peek: function () { return { clock: now(), brackets: last.brackets.slice(), hud: last.hud, survey: last.survey }; },
    HUD_SAFE_H: HUD_SAFE_H,

    /* T1 */
    armSurvey: armSurvey,
    _armSurvey: armSurvey,
    _surveyFrame: surveyFrame,
    _targets: function (player) { return collectTargets(player || Game.Data.Player); },

    /* 绘制钩子（由 render.js / main.js 调用；全部纯绘制） */
    drawMarkers: drawMarkers,
    drawEvent: drawEvent,
    drawHudBand: drawHudBand
  };
})();
