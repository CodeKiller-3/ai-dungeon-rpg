/* js/core/render.js — Canvas 渲染
 * 接口：init / drawMap / drawPlayer / drawHUD / drawBattle（见 PLAN.md §4.4）
 * M2：新增战斗画面渲染
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Core = Game.Core || {};

  var TILE = 24; /* 瓦片像素尺寸 */
  var cam = { x: 0, y: 0 };

  /* D-12：静态图层离屏缓存。
   * 地板/墙/楼梯/细节/装饰/陷阱/记忆覆盖/主题 tint 都是"只在换步、换层、resize 时变化"
   * 的内容，原实现每帧按格重画（实测 859 次 drawImage + 865 次 fillRect/帧，占帧 58%）。
   * 这里把这块一次性画进"屏空间、设备像素"的离屏画布，每帧只做 1 次 1:1 blit；
   * 因为缓存与主画布同一像素网格、同一 dpr×scale 变换，blit 结果与直绘逐像素一致。
   * 失效条件：镜头移动 / 换层或换图 / 视口或 DPR 变化 / FOV 或装饰变化（main.js 调 invalidateStatic）。 */
  var staticCache = {
    canvas: null, ctx: null, valid: false,
    grid: null, floor: 0, camX: 0, camY: 0,
    dpr: 0, scale: 0, cvW: 0, cvH: 0
  };

  /* 自适应缩放（2026-11）：设计基准 960×540，等比缩放系数 scale∈[1,2]，按 0.25 步进取整。
   * 逻辑视口 = 窗口 CSS 尺寸 / scale；所有绘制与命中判定仍用逻辑坐标（像素风 TILE=24 不变），
   * 因此窗口变大时画面整体放大、字体/面板同步放大，且不拉伸（横纵同一系数）。
   * 为什么不 letterbox：320×568 竖屏下固定逻辑分辨率会产生大面积黑边、弹窗放不下；
   * 等比放大 + 逻辑视口随窗口比例更符合"320–2560 都能用"的目标。 */
  var BASE_W = 960, BASE_H = 540;
  var MIN_SCALE = 1, MAX_SCALE = 2, SCALE_STEP = 0.25;

  /* M8-5：排行榜用时格式（秒 → “分秒”，如 205 → 3分25秒） */
  function fmtRankTime(sec) {
    var s = Math.round(Number(sec));
    if (!isFinite(s) || s < 0) s = 0;
    if (s < 60) return s + '秒';
    return Math.floor(s / 60) + '分' + (s % 60) + '秒';
  }

  /* P1-1：地板变体名——坐标 + 楼层哈希（同一格同一层恒定，不依赖 Math.random，避免逐帧闪烁） */
  function floorVariantName(x, y, floor) {
    var f = (typeof floor === 'number' && floor > 0) ? floor : 1;
    var h = (x * 7 + y * 13 + f * 3) % 8;
    if (h < 0) h += 8;
    return 'floor_' + (h + 1);
  }

  /* P1-3：通用动画帧序号——按真实时间取模（fps 帧/秒），同一调用窗口内结果稳定。
   * key 为序列名（字符串哈希作固定相位偏移，不同序列错相，同序列同刻同帧）。
   * Render._animNow 可注入时钟函数（验证页冻结动画帧用），默认 performance.now。 */
  function animIndex(key, fps) {
    var now;
    var R = (typeof Game !== 'undefined' && Game.Core) ? Game.Core.Render : null;
    if (R && typeof R._animNow === 'function') now = R._animNow();
    else now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var step = (typeof fps === 'number' && fps > 0) ? Math.round(1000 / fps) : 250;
    var off = 0;
    if (typeof key === 'string' && key) {
      for (var i = 0; i < key.length; i++) off += key.charCodeAt(i);
    }
    return (Math.floor(now / step) + off) % 4;
  }

  /* P1-3：按高度适配绘制（保持贴图宽高比）——cx=目标中心 x，bottom=目标底部 y，targetH=目标高。
   * 返回绘制宽度；naturalWidth 读取失败（未加载完成等异常）时按 1:1 回退。 */
  function drawSpriteByHeight(ctx, img, cx, bottom, targetH) {
    var nw = img && (img.naturalWidth || 0);
    var nh = img && (img.naturalHeight || 0);
    if (nw <= 0 || nh <= 0) { nw = targetH; nh = targetH; }
    var w = Math.max(2, Math.round(nw * targetH / nh));
    ctx.drawImage(img, cx - Math.floor(w / 2), bottom - targetH, w, targetH);
    return w;
  }

  /* D-16：战斗血条（敌方/我方同款）——带数值标签，文字 11px（不低于 HUD 最小字号） */
  function battleBar(ctx, cx, y, ratio, color, bgColor, label) {
    var W = (Game.Core && Game.Core.Render && Game.Core.Render.cssW) || 960;
    var w = Math.min(340, Math.max(200, W - 200));
    var x = Math.round(cx - w / 2);
    var h = 20;
    var r = Math.max(0, Math.min(1, ratio || 0));
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, w, h);
    if (r > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(x + 1, y + 1, Math.round((w - 2) * r), h - 2);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(label, cx, y + h / 2 + 1);
    ctx.restore();
  }

  /* D-16：回合与出手段提示——把"玩家段 → 怪物段"的时间轴画出来（纯 state 驱动） */
  function battleSegments(ctx, cx, y, round, phase) {
    var w = 320, h = 26;
    var x = Math.round(cx - w / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    var monsterActing = (phase === 'monster');
    /* 段 1：玩家出手 */
    ctx.fillStyle = monsterActing ? 'rgba(255,255,255,0.04)' : 'rgba(120,200,255,0.20)';
    ctx.fillRect(x + 96, y + 3, 104, h - 6);
    /* 段 2：怪物反击 */
    ctx.fillStyle = monsterActing ? 'rgba(255,140,120,0.22)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(x + 204, y + 3, 112, h - 6);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#ffcf6e';
    ctx.fillText('第 ' + round + ' 回合', x + 48, y + h / 2 + 1);
    ctx.fillStyle = monsterActing ? '#8d8f9e' : '#bfe6ff';
    ctx.fillText('① 你出手', x + 148, y + h / 2 + 1);
    ctx.fillStyle = monsterActing ? '#ffb1a1' : '#8d8f9e';
    ctx.fillText('② 怪物反击', x + 260, y + h / 2 + 1);
    ctx.restore();
  }

  /* D-16：状态 chips（狂暴/护盾/防御）——随战斗变化的中段信息 */
  function battleChips(ctx, cx, y, state) {
    var list = [];
    if (state.enraged) list.push({ t: '⚡狂暴', c: '#ff7b6b' });
    if (state.shieldValue > 0) list.push({ t: '护盾 ' + state.shieldValue, c: '#7dffb0' });
    if (state.defending) list.push({ t: '防御中', c: '#9bbbf4' });
    if (!list.length) return;
    ctx.save();
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var gap = 8, padX = 10, h = 20;
    var total = 0, i;
    for (i = 0; i < list.length; i++) {
      list[i].w = Math.round(ctx.measureText(list[i].t).width) + padX * 2;
      total += list[i].w + (i ? gap : 0);
    }
    var x = Math.round(cx - total / 2);
    for (i = 0; i < list.length; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x, y, list[i].w, h);
      ctx.strokeStyle = list[i].c;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, list[i].w - 1, h - 1);
      ctx.fillStyle = list[i].c;
      ctx.fillText(list[i].t, x + list[i].w / 2, y + h / 2 + 1);
      x += list[i].w + gap;
    }
    ctx.restore();
  }

  /* P2-1：怪物视觉映射集中表——id → { idle, run } 帧组名（10 种怪物全覆盖）。
   * 未登记的 id 由调用方回退 monster_chort（现状）；imp 只作 bat 的视觉帧组，不占怪物 id。 */
  var MONSTER_ANIM = {
    slime: { idle: 'tiny_slug', run: 'tiny_slug' },
    bat: { idle: 'imp_idle', run: 'imp_run' },
    skeleton: { idle: 'skelet_idle', run: 'skelet_run' },
    dragon: { idle: 'big_demon_idle', run: 'big_demon_run' },
    goblin: { idle: 'goblin_idle', run: 'goblin_run' },
    tiny_zombie: { idle: 'tiny_zombie_idle', run: 'tiny_zombie_run' },
    orc_warrior: { idle: 'orc_warrior_idle', run: 'orc_warrior_run' },
    orc_shaman: { idle: 'orc_shaman_idle', run: 'orc_shaman_run' },
    wogol: { idle: 'wogol_idle', run: 'wogol_run' },
    ogre: { idle: 'ogre_idle', run: 'ogre_run' },
    /* P2-3：imp 独立登场 + F4/F5 主题怪（big_zombie/necromancer/angel 单态：idle=run） */
    imp: { idle: 'imp_idle', run: 'imp_run' },
    big_zombie: { idle: 'big_zombie_idle', run: 'big_zombie_idle' },
    necromancer: { idle: 'necromancer', run: 'necromancer' },
    masked_orc: { idle: 'masked_orc_idle', run: 'masked_orc_run' },
    pumpkin_dude: { idle: 'pumpkin_dude_idle', run: 'pumpkin_dude_run' },
    angel: { idle: 'angel_idle', run: 'angel_idle' },
    /* P2-4：层 Boss 复用既有大图帧组（素材零新增） */
    ogre_boss: { idle: 'ogre_idle', run: 'ogre_run' },
    zombie_king: { idle: 'big_zombie_idle', run: 'big_zombie_idle' }
  };

  /* P2-1：按 id + 状态取动画帧；未登记 id / 素材未就绪 / 帧缺失一律返回 null（调用方回退） */
  function monsterFrame(id, chasing) {
    var set = MONSTER_ANIM[id];
    if (!set) return null;
    var S = Game.Core && Game.Core.Sprites;
    if (!S || typeof S.getFrame !== 'function') return null;
    var name = chasing ? set.run : set.idle;
    return S.getFrame(name, animIndex(name, 4));
  }

  /* D-20：引导页按键表——画在页面上的内容与验证页比对共用这一份声明。
   * label 是键名（玩家看到的字），act 是验证页据此回放真实按键后比对的行为标识，
   * codes 是该动作实际接收的 KeyboardEvent.code（与 input.js / main.js 的映射一一对应）。
   * 探索表对应 main.js `_updateExplore`，战斗表对应 `_updateBattle`；
   * 两侧字幕（Esc/Enter）由弹窗与引导确认各自处理，故单列在探索表末行。 */
  var KEYMAP = {
    explore: [
      { label: '↑↓←→ / WASD', act: 'move', name: '移动', line: 0,
        codes: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'] },
      { label: 'B', act: 'inventory', name: '背包', line: 0, codes: ['KeyB'] },
      { label: 'E', act: 'shop', name: '商店', line: 0, codes: ['KeyE'] },
      { label: 'M', act: 'quests', name: '任务', line: 0, codes: ['KeyM'] },
      { label: 'T', act: 'npc', name: '对话', line: 1, codes: ['KeyT'] },
      { label: 'L', act: 'learner', name: 'AI 演示', line: 1, codes: ['KeyL'] },
      { label: 'Q', act: 'settings', name: '设置', line: 1, codes: ['KeyQ'] },
      { label: 'K', act: 'mute', name: '静音', line: 1, codes: ['KeyK'] },
      { label: 'H', act: 'guide', name: '重看引导', line: 1, codes: ['KeyH'] },
      { label: 'Esc', act: 'closePanel', name: '关闭面板', line: 2, codes: ['Escape'] },
      { label: 'Enter', act: 'confirm', name: '确认', line: 2, codes: ['Enter', 'NumpadEnter'] }
    ],
    battle: [
      { label: '1', act: 'attack', name: '攻击', line: 0, codes: ['Digit1', 'Numpad1'] },
      { label: '2', act: 'defend', name: '防御', line: 0, codes: ['Digit2', 'Numpad2'] },
      { label: '3', act: 'run', name: '逃跑', line: 0, codes: ['Digit3', 'Numpad3'] },
      { label: '4', act: 'skill:fireball', name: '火球', line: 0, codes: ['Digit4', 'Numpad4'] },
      { label: '5', act: 'skill:dash', name: '冲刺', line: 1, codes: ['Digit5', 'Numpad5'] },
      { label: '6', act: 'skill:shield', name: '护盾', line: 1, codes: ['Digit6', 'Numpad6'] },
      { label: '7', act: 'item', name: '用药', line: 1, codes: ['Digit7', 'Numpad7'] },
      { label: 'F', act: 'fx', name: '战斗特效：关 / 低 / 高', line: 1, codes: ['KeyF'] }
    ]
  };

  /* D-20：按行拼一行键位说明（同 line 的项用 · 连接），避免手写文案与映射漂移 */
  function keyLine(scope, line) {
    var out = [];
    var rows = KEYMAP[scope];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].line === line) out.push(rows[i].label + ' ' + rows[i].name);
    }
    return out.join(' · ');
  }

  /* D-20：引导页正文——三块：探索/面板、战斗、机制须知。
   * 机制须知只写代码里确实存在的条目（F 三档已并入战斗键行）。
   * D-25：补一条「怎么装备」——文案逐字对齐背包面板的真实提示（↑↓ 选择 / Enter 使用/装备）
   * 与行尾数值格式（攻击+N / 防御+N，见 modal.js itemDesc）；不写任何"起手有武器"之类当前不成立的话。 */
  function guideRows() {
    return [
      { head: true, text: '探索 · 面板' },
      { text: keyLine('explore', 0) },
      { text: keyLine('explore', 1) },
      { text: keyLine('explore', 2) },
      { head: true, text: '战斗（踩到怪物即进入）' },
      { text: keyLine('battle', 0) },
      { text: keyLine('battle', 1) },
      { head: true, text: '你需要知道的事' },
      { text: '陷阱：踩中才现形——地刺扣血并流血，毒气让你中毒' },
      { text: '强化：装备最多 +5，用强化卷轴在战斗外提升' },
      { text: '装备：捡到或买到武器/护甲后，按 B 打开背包，↑↓ 选择、Enter 使用/装备，行尾显示 攻击+N / 防御+N' },
      { text: 'Boss 半血狂暴：攻防提升，还可能追加技能' },
      { text: '逃跑：成功退一格且怪物留场；失败立刻被反击' },
      { text: '自动存档：换层、开箱、战斗结束时' }
    ];
  }

  Game.Core.Render = {
    _canvas: null,
    _ctx: null,
    KEYMAP: KEYMAP,           /* D-20：按键表（引导页与验证页共用） */
    guideRows: guideRows,     /* D-20：引导页正文（验证页据此做"文案有/代码有"比对） */
    guideLines: function () { /* D-20：正文纯文本，便于机器比对 */
      var rows = guideRows(), out = [];
      for (var i = 0; i < rows.length; i++) out.push(rows[i].text);
      return out;
    },
    TILE: TILE,  /* M9-2：暴露瓦片尺寸供 Lighting 等模块复用 */
    MONSTER_ANIM: MONSTER_ANIM,  /* P2-1：怪物 id → {idle,run} 帧组（验证/调试可读，运行时只读） */
    /* M9-5：DPR 高清适配——逻辑坐标统一用 CSS 像素，物理像素 = CSS * dpr */
    dpr: 1,
    scale: 1,      /* 自适应缩放系数：逻辑像素 → CSS 像素 */
    cssPxW: 0,     /* 画布实际 CSS 尺寸（窗口尺寸） */
    cssPxH: 0,
    cssW: 0,       /* 逻辑视口尺寸（绘制/命中坐标空间 = cssPx / scale） */
    cssH: 0,
    _animNow: null,  /* P1-3：可注入时钟函数（验证页冻结动画帧）；null=用 performance.now */

    init: function (canvas) {
      this._canvas = canvas;
      this._ctx = canvas.getContext('2d');
      this.resize();
    },

    /* M9-5 + 自适应：按 devicePixelRatio 设置画布物理像素，并按 scale 把逻辑坐标映射到 CSS 像素。
     * dprOverride：验证页可注入固定 dpr 值断言，正常运行时留空读 window.devicePixelRatio
     * 说明：resize 需在窗口 resize / 浏览器缩放 / 横竖屏切换时重复调用（main.js 已监听） */
    resize: function (dprOverride) {
      var cv = this._canvas;
      if (!cv) return;
      var raw = (typeof dprOverride === 'number' && dprOverride > 0) ? dprOverride : (window.devicePixelRatio || 1);
      var dpr = Math.min(raw, 2);
      var pxW = Math.max(window.innerWidth || 0, 1);
      var pxH = Math.max(window.innerHeight || 0, 1);
      var scale = this._computeScale(pxW, pxH);
      this.dpr = dpr;
      this.scale = scale;
      this.cssPxW = pxW;
      this.cssPxH = pxH;
      /* 逻辑视口：保留小数，保证 client→logical 映射精确（不因取整产生点击偏移） */
      this.cssW = pxW / scale;
      this.cssH = pxH / scale;
      try {
        cv.width = Math.round(pxW * dpr);
        cv.height = Math.round(pxH * dpr);
        cv.style.width = pxW + 'px';
        cv.style.height = pxH + 'px';
      } catch (e) { /* 降级：极端环境下保持默认 */ }
      /* DOM 覆盖层（NPC 对话框）跟随同一缩放系数，避免大屏下相对画布过小 */
      try {
        if (document && document.documentElement && document.documentElement.style) {
          document.documentElement.style.setProperty('--ui-scale', String(scale));
        }
      } catch (e) { /* 降级 */ }
      this._applyDpr();
      /* D-12：视口/DPR 变化 → 静态缓存尺寸与缩放都不再匹配，作废 */
      staticCache.valid = false;
    },

    /* 等比缩放系数：以 960×540 为设计基准，取横纵可容纳比例中较小值（避免任一方向超出），
     * 限制在 [1,2] 并按 0.25 步进取整；竖屏小窗口保持 1，不做反向缩小，保证字号可读。 */
    _computeScale: function (pxW, pxH) {
      var rawScale = Math.min(pxW / BASE_W, pxH / BASE_H);
      var s = Math.round(rawScale / SCALE_STEP) * SCALE_STEP;
      if (s < MIN_SCALE) s = MIN_SCALE;
      if (s > MAX_SCALE) s = MAX_SCALE;
      return s;
    },

    /* 每帧绘制前重置变换矩阵：物理像素 = 逻辑像素 × dpr × scale */
    _applyDpr: function () {
      var ctx = this._ctx;
      if (!ctx) return;
      try { ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0); } catch (e) { /* 降级 */ }
      /* 像素风：非整数倍放大时关闭图像平滑，避免精灵发糊（文字由矢量路径绘制，不受影响） */
      try { if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false; } catch (e) { /* 降级 */ }
    },

    /* 自适应：把浏览器 client 坐标（相对画布）换算为逻辑坐标，供鼠标/触屏命中使用。
     * 画布 CSS 尺寸 = 窗口 CSS 尺寸，逻辑视口 = cssPx/scale，故比例系数为 cssW / rect.width。 */
    toLogical: function (clientX, clientY) {
      var cv = this._canvas;
      if (!cv || typeof cv.getBoundingClientRect !== 'function') return { x: clientX, y: clientY };
      var r = cv.getBoundingClientRect();
      var sx = (r.width > 0) ? (this.cssW / r.width) : 1;
      var sy = (r.height > 0) ? (this.cssH / r.height) : 1;
      return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
    },

    /* M9-5：是否窄窗口（<520px），HUD/底部提示用紧凑版 */
    _isNarrow: function () { return this.cssW < 520; },

    /* M9-2：返回当前相机偏移（供 Lighting 等模块计算屏幕坐标） */
    _getCam: function () { return cam; },

    /* 计算镜头：地图比屏幕小则居中（负偏移），否则跟随玩家并夹在边界内。
     * 自适应缩放后大窗口逻辑视口可能大于地图，居中可避免地图贴左上角、大片空背景。 */
    _updateCam: function (grid, player) {
      var W = this.cssW, H = this.cssH;
      var w = grid[0].length * TILE;
      var h = grid.length * TILE;
      cam.x = (w <= W) ? -(W - w) / 2
        : Math.min(Math.max(player.x * TILE - W / 2 + TILE / 2, 0), w - W);
      cam.y = (h <= H) ? -(H - h) / 2
        : Math.min(Math.max(player.y * TILE - H / 2 + TILE / 2, 0), h - H);
    },

    /* S3-2：每帧渲染末尾叠加常驻 HUD（hud.js 缺失/未就绪时静默跳过，不影响绘制） */
    _drawHud: function () {
      try {
        if (Game.hud && typeof Game.hud.draw === 'function') Game.hud.draw();
      } catch (e) { /* 降级：HUD 异常不影响主画面 */ }
    },

    /* S3-3：每帧末尾绘制游戏内弹窗（遮罩 + 居中面板）；modal 未打开时为 no-op */
    _drawModal: function () {
      try {
        if (Game.Modal && Game.Modal.isOpen && Game.Modal.isOpen() && typeof Game.Modal.draw === 'function') {
          Game.Modal.draw();
        }
      } catch (e) { /* 降级：弹窗异常不影响主画面 */ }
    },

    /* P1-1：素材是否就绪（加载器缺失/未完成时统一回退色块） */
    _hasSprites: function () {
      return !!(Game.Core.Sprites && typeof Game.Core.Sprites.isReady === 'function' && Game.Core.Sprites.isReady());
    },

    /* P1-1：墙格判断；地图外视为墙，保证边界墙贴图连续 */
    _isWall: function (grid, x, y) {
      if (!grid || !grid[y] || x < 0 || x >= grid[y].length) return true;
      return grid[y][x] === 0;
    },

    /* P1-1：墙贴图选择——墙下方是地板 → 顶行 wall_top_*；否则按左右相邻墙选 wall_left/mid/right。
     * edge/outer 系列为本卡可选增强，未接入；保底"墙身 + 顶行"两套即可显著改善观感。 */
    _wallSprite: function (grid, x, y) {
      if (!this._hasSprites()) return null;
      var S = Game.Core.Sprites;
      if (!this._isWall(grid, x, y + 1)) {
        var leftTop = this._isWall(grid, x - 1, y) && !this._isWall(grid, x - 1, y + 1);
        var rightTop = this._isWall(grid, x + 1, y) && !this._isWall(grid, x + 1, y + 1);
        var topName = (!leftTop && rightTop) ? 'wall_top_left'
          : (leftTop && !rightTop) ? 'wall_top_right'
          : 'wall_top_mid';
        return S.get(topName);
      }
      var leftWall = this._isWall(grid, x - 1, y);
      var rightWall = this._isWall(grid, x + 1, y);
      var bodyName = !leftWall ? 'wall_left' : (!rightWall ? 'wall_right' : 'wall_mid');
      return S.get(bodyName);
    },

    /* M9-1：tile 细节绘制——素材就绪用贴图，否则程序化色块兜底
     * type: grass(草丛绿块) / puddle(水洼蓝块) / bones(碎骨白点) / moss(苔藓绿块)
     * P1-1：onWall=true 且 type=moss 时改用 wall_goo 贴图；grass/puddle 等无真贴图保持兜底 */
    _drawDetail: function (ctx, type, px, py, onWall) {
      var sp = null;
      if (this._hasSprites()) {
        sp = (type === 'moss' && onWall) ? Game.Core.Sprites.get('wall_goo') : Game.Core.Sprites.get(type);
      }
      if (sp) { ctx.drawImage(sp, px, py, TILE - 1, TILE - 1); return; }
      if (type === 'grass') {
        ctx.fillStyle = 'rgba(58,125,44,0.55)';
        ctx.fillRect(px + 4, py + 14, 4, 6);
        ctx.fillRect(px + 12, py + 10, 3, 5);
        ctx.fillRect(px + 17, py + 16, 4, 5);
      } else if (type === 'puddle') {
        ctx.fillStyle = 'rgba(74,123,208,0.6)';
        ctx.fillRect(px + 5, py + 12, TILE - 11, 6);
        ctx.fillStyle = 'rgba(150,190,255,0.4)';
        ctx.fillRect(px + 7, py + 13, 4, 2);
      } else if (type === 'bones') {
        ctx.fillStyle = 'rgba(207,210,214,0.85)';
        ctx.fillRect(px + 8, py + 10, 2, 2);
        ctx.fillRect(px + 14, py + 14, 2, 2);
        ctx.fillRect(px + 10, py + 17, 6, 2);
      } else if (type === 'moss') {
        ctx.fillStyle = 'rgba(79,122,63,0.6)';
        ctx.fillRect(px + 3, py + 3, 5, 4);
        ctx.fillRect(px + 14, py + 16, 6, 4);
      }
    },

    /* M9-1：装饰物绘制——素材就绪用贴图，否则程序化矩形+轮廓兜底
     * id: chest(宝箱黄框) / barrel(木桶棕框) / torch(火把橙焰) / vine(藤蔓绿条) */
    _drawDecor: function (ctx, id, px, py) {
      /* S-05：密室宝箱——先铺一层金色光晕（有贴图时也保留，远看就能认出"这里有厚赏"） */
      if (id === 'room_chest') {
        ctx.fillStyle = 'rgba(255,207,110,0.20)';
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2 + 3, 0, Math.PI * 2);
        ctx.fill();
      }
      var sp = this._hasSprites() ? Game.Core.Sprites.get(id) : null;
      /* P1-1：chest/crate/skull/wall_goo 有同名贴图则直接绘制；
       * barrel/torch/vine 无同名文件（get 返回 null）→ 继续走下方程序化兜底 */
      if (sp) { ctx.drawImage(sp, px + 1, py + 1, TILE - 2, TILE - 2); return; }
      if (id === 'room_chest') {
        ctx.fillStyle = '#5a3a18';
        ctx.fillRect(px + 2, py + 6, TILE - 4, TILE - 8);
        ctx.fillStyle = '#a8722e';
        ctx.fillRect(px + 3, py + 7, TILE - 6, (TILE - 10) / 2);
        ctx.strokeStyle = '#ffd24a';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 2, py + 6, TILE - 4, TILE - 8);
        ctx.fillStyle = '#ffd24a';
        ctx.fillRect(px + TILE / 2 - 2, py + TILE / 2 - 1, 4, 6);
        return;
      }
      if (id === 'chest') {
        ctx.fillStyle = '#8b5a2b';
        ctx.fillRect(px + 4, py + 8, TILE - 9, TILE - 12);
        ctx.strokeStyle = '#ffcf6e';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 4, py + 8, TILE - 9, TILE - 12);
        ctx.fillStyle = '#ffcf6e';
        ctx.fillRect(px + TILE / 2 - 2, py + TILE / 2, 3, 4);
      } else if (id === 'barrel') {
        ctx.fillStyle = '#7a4a28';
        ctx.fillRect(px + 6, py + 6, TILE - 13, TILE - 10);
        ctx.strokeStyle = '#4a2c18';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 6, py + 6, TILE - 13, TILE - 10);
        ctx.strokeStyle = '#9a6a3a';
        ctx.beginPath();
        ctx.moveTo(px + 6, py + TILE / 2);
        ctx.lineTo(px + TILE - 7, py + TILE / 2);
        ctx.stroke();
      } else if (id === 'torch') {
        ctx.fillStyle = '#5a3a1a';
        ctx.fillRect(px + TILE / 2 - 1, py + 12, 3, TILE - 16);
        /* 火苗三角 */
        ctx.fillStyle = '#ff8c1a';
        ctx.beginPath();
        ctx.moveTo(px + TILE / 2 + 0.5, py + 4);
        ctx.lineTo(px + TILE / 2 - 4, py + 13);
        ctx.lineTo(px + TILE / 2 + 5, py + 13);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffd24a';
        ctx.beginPath();
        ctx.moveTo(px + TILE / 2 + 0.5, py + 7);
        ctx.lineTo(px + TILE / 2 - 2, py + 12);
        ctx.lineTo(px + TILE / 2 + 3, py + 12);
        ctx.closePath();
        ctx.fill();
      } else if (id === 'vine') {
        ctx.fillStyle = 'rgba(79,122,63,0.85)';
        ctx.fillRect(px + 4, py + 2, 3, TILE - 6);
        ctx.fillRect(px + 14, py + 6, 3, TILE - 10);
        ctx.fillRect(px + 9, py + 10, 3, TILE - 14);
      }
    },

    /* S-04：已触发的陷阱——地刺画三根红尖刺，毒气画绿色雾团（触发后永久留在该格） */
    _drawTrap: function (ctx, id, px, py) {
      if (id === 'gas') {
        ctx.fillStyle = 'rgba(132,204,22,0.35)';
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2 - 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(163,230,53,0.65)';
        ctx.beginPath();
        ctx.arc(px + TILE / 2 - 3, py + TILE / 2 + 1, 3, 0, Math.PI * 2);
        ctx.arc(px + TILE / 2 + 4, py + TILE / 2 - 2, 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.fillStyle = '#b5b5c8';
      var i;
      for (i = 0; i < 3; i++) {
        var bx = px + 5 + i * 6;
        ctx.beginPath();
        ctx.moveTo(bx, py + TILE - 5);
        ctx.lineTo(bx + 3, py + 9);
        ctx.lineTo(bx + 6, py + TILE - 5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(160,20,20,0.55)';
      ctx.fillRect(px + 4, py + TILE - 7, TILE - 9, 2);
    },

    drawMap: function (grid, player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx || !grid) return;
      this._applyDpr(); /* M9-5：每帧重置 DPR 变换 */
      var W = this.cssW, H = this.cssH;
      this._updateCam(grid, player);
      /* P1-1：地板变体带楼层因子（同一格跨层可变化，同层内恒定） */
      var pf = (player && typeof player.floor === 'number' && player.floor > 0) ? player.floor : 1;
      /* S3-1 FOV：动态层（敌人/巡逻怪）也要按可见性裁剪 */
      var fovOn = !!(Game.fov && Game.fov.isVisible);
      /* D-12：静态层走离屏缓存（命中则 1 次 blit；失效则重建一次）。
       * _staticBypass 仅供验证页做"缓存 vs 直绘"逐像素比对。 */
      if (this._staticBypass) {
        this._drawSceneStatic(ctx, grid, pf, W, H);
      } else {
        if (!this._staticValidFor(grid, pf, cv)) this._rebuildStatic(grid, pf, W, H);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
        ctx.drawImage(staticCache.canvas, 0, 0);
        ctx.restore();
      }
      /* 敌人标记（M2/M7.5）：埋伏怪——chort 精灵（素材就绪时）+ 半透明红底 */
      var es = Game.Systems.Map.getEnemies();
      for (var i = 0; i < es.length; i++) {
        if (fovOn && !Game.fov.isVisible(es[i].x, es[i].y)) continue; /* S3-1：迷雾外不透视 */
        var epx = es[i].x * TILE - cam.x + 2;
        var epy = es[i].y * TILE - cam.y + 2;
        if (epx > -20 && epy > -20 && epx < W + 20 && epy < H + 20) {
          var eimg = null;
          if (this._hasSprites()) {
            /* P2-1：查 MONSTER_ANIM 表取 idle 帧；未知 id / 帧缺失回退 chort */
            eimg = monsterFrame(es[i].monsterId, false);
            if (!eimg) eimg = Game.Core.Sprites.get('monster_chort');
          }
          if (eimg) {
            ctx.fillStyle = 'rgba(234,102,104,0.22)';
            ctx.fillRect(epx - 2, epy - 2, TILE, TILE);
            /* P1-3：大图（big_demon 32×36）按高度适配 TILE 格，常规 16×16 帧铺满格 */
            if ((eimg.naturalWidth || 0) > 26) {
              drawSpriteByHeight(ctx, eimg, epx - 1 + TILE / 2, epy - 1 + TILE - 1, TILE - 3);
            } else {
              ctx.drawImage(eimg, epx - 1, epy - 1, TILE - 2, TILE - 2);
            }
          } else {
            ctx.fillStyle = '#ea6668';
            ctx.beginPath();
            ctx.arc(epx + TILE / 2 - 3, epy + TILE / 2 - 3, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      /* 巡逻怪（M5/M7.5）：状态机可视化——待机=chort 追击=chort_run+红底+! */
      var ps = (Game.Systems.AI && Game.Systems.AI.getPatrols) ? Game.Systems.AI.getPatrols() : [];
      for (var j = 0; j < ps.length; j++) {
        if (fovOn && !Game.fov.isVisible(ps[j].x, ps[j].y)) continue; /* S3-1：迷雾外不透视 */
        /* M9-3：巡逻怪取插值渲染位置 */
        var prp = (Game.Motion && Game.Motion.getRenderPos) ? Game.Motion.getRenderPos('patrol_' + j) : null;
        var prx = prp ? prp.x : ps[j].x;
        var pry = prp ? prp.y : ps[j].y;
        var ppx = prx * TILE - cam.x + 2;
        var ppy = pry * TILE - cam.y + 2;
        if (ppx > -20 && ppy > -20 && ppx < W + 20 && ppy < H + 20) {
          var chasing = ps[j].state === 'chase';
          var pimg = null;
          if (this._hasSprites()) {
            /* P2-1：查 MONSTER_ANIM 表按状态取 idle/run 帧；未知 id / 帧缺失回退 chort */
            pimg = monsterFrame(ps[j].monsterId, chasing);
            if (!pimg) pimg = Game.Core.Sprites.get(chasing ? 'monster_chort_run' : 'monster_chort');
          }
          if (pimg) {
            if (chasing) {
              ctx.fillStyle = 'rgba(234,102,104,0.25)';
              ctx.fillRect(ppx - 2, ppy - 2, TILE, TILE);
            }
            /* P1-3：大图（big_demon 32×36）按高度适配 TILE 格，常规帧铺满 */
            if ((pimg.naturalWidth || 0) > 26) {
              drawSpriteByHeight(ctx, pimg, ppx - 1 + TILE / 2, ppy - 1 + TILE - 1, TILE - 3);
            } else {
              ctx.drawImage(pimg, ppx - 1, ppy - 1, TILE - 2, TILE - 2);
            }
            if (chasing) {
              ctx.fillStyle = '#fff';
              ctx.font = '9px monospace';
              ctx.fillText('!', ppx + TILE / 2 - 4, ppy - 3);
            }
          } else {
            ctx.fillStyle = chasing ? '#ea6668' : '#9e9e9e';
            ctx.fillRect(ppx, ppy, TILE - 4, TILE - 4);
            if (chasing) {
              ctx.fillStyle = '#fff';
              ctx.font = '9px monospace';
              ctx.fillText('!', ppx + TILE / 2 - 4, ppy + 12);
            }
          }
        }
      }
      /* M9-2：光影层（火把光晕 + FOV 软边 + 暗角），在迷雾之后、HUD 之前 */
      try { if (Game.Lighting && typeof Game.Lighting.draw === 'function') Game.Lighting.draw(); } catch (e) { /* 降级：照明异常不影响主画面 */ }
      /* M9-3：粒子特效层（探索场景命中/死亡粒子），叠在光影之上、HUD 之下 */
      try { if (Game.Particles && typeof Game.Particles.draw === 'function') Game.Particles.draw(); } catch (e) { /* 降级 */ }
      this._drawHud(); /* S3-2 */
    },

    /* D-12：验证页专用——true 时跳过离屏缓存，逐格直绘（"缓存 vs 直绘"像素比对用） */
    _staticBypass: false,
    _staticRebuilds: 0,

    /* D-14：只读镜头偏移（验证页做未探索格"无缝"像素断言用；不参与绘制决策） */
    _cam: function () { return { x: cam.x, y: cam.y }; },

    /* D-12：静态层失效（FOV/装饰/陷阱/换层变化时由 main.js 调用） */
    invalidateStatic: function () {
      staticCache.valid = false;
    },

    /* D-12：缓存是否可复用——镜头、图层、视口、DPR/缩放任一变化即失效 */
    _staticValidFor: function (grid, pf, cv) {
      var s = staticCache;
      return !!(s.valid && s.canvas && s.grid === grid && s.floor === pf &&
        s.camX === cam.x && s.camY === cam.y &&
        s.dpr === this.dpr && s.scale === this.scale &&
        s.cvW === cv.width && s.cvH === cv.height);
    },

    /* D-12：重建静态层——画到与主画布同尺寸、同变换的离屏 canvas（= 原逐格绘制的像素结果） */
    _rebuildStatic: function (grid, pf, W, H) {
      var cv = this._canvas;
      var s = staticCache;
      if (!s.canvas) {
        s.canvas = document.createElement('canvas');
        s.ctx = s.canvas.getContext('2d');
      }
      if (s.canvas.width !== cv.width || s.canvas.height !== cv.height) {
        s.canvas.width = cv.width;
        s.canvas.height = cv.height;
      }
      var c = s.ctx;
      c.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0);
      if ('imageSmoothingEnabled' in c) c.imageSmoothingEnabled = false;
      this._drawSceneStatic(c, grid, pf, W, H);
      s.grid = grid; s.floor = pf; s.camX = cam.x; s.camY = cam.y;
      s.dpr = this.dpr; s.scale = this.scale;
      s.cvW = cv.width; s.cvH = cv.height;
      s.valid = true;
      this._staticRebuilds++;
    },

    /* D-12：静态场景层——原 drawMap 逐格部分原样迁入；直绘与离屏缓存共用这一份代码，
     * 保证"缓存命中"与"直绘"像素一致。ctx 为目标上下文（主画布或缓存画布）。 */
    _drawSceneStatic: function (ctx, grid, pf, W, H) {
      ctx.fillStyle = '#14142a';
      ctx.fillRect(0, 0, W, H);
      /* S3-1 FOV：可见=正常绘制；记忆格=较暗覆盖；从未点亮=近黑不透露地形 */
      var fovOn = !!(Game.fov && Game.fov.isVisible);
      for (var y = 0; y < grid.length; y++) {
        for (var x = 0; x < grid[0].length; x++) {
          var t = grid[y][x];
          var px = x * TILE - cam.x;
          var py = y * TILE - cam.y;
          if (px + TILE < 0 || py + TILE < 0 || px > W || py > H) continue;
          if (fovOn && !Game.fov.isExplored(x, y) && !Game.fov.isVisible(x, y)) {
            /* D-14：未探索格整格填满（原先 TILE-1 留 1px 缝，露出底色形成满屏网格，
             * 第一眼像"资源没加载完"）。只改绘制尺寸，不改地图数据与 FOV 判定。 */
            ctx.fillStyle = '#07070f';
            ctx.fillRect(px, py, TILE, TILE);
            continue;
          }
          if (t === 0) {
            /* P1-1：墙贴图（顶行 wall_top_* / 墙身 wall_left|mid|right）；素材缺失回退砖纹色块 */
            var wsp = this._wallSprite(grid, x, y);
            if (wsp) {
              ctx.drawImage(wsp, px, py, TILE - 1, TILE - 1);
            } else {
              /* 墙：砖纹 */
              ctx.fillStyle = '#3a2e5c';
              ctx.fillRect(px, py, TILE - 1, TILE - 1);
              ctx.fillStyle = 'rgba(0,0,0,0.28)';
              ctx.fillRect(px, py + TILE / 2 - 1, TILE - 1, 2);
              ctx.fillRect(px + (x % 2) * 8, py, 1, TILE - 1);
            }
          } else if (t === 1) {
            /* P1-1：地板贴图 floor_1~8 按坐标哈希选变体；素材缺失回退稳定噪点色块 */
            var fsp = this._hasSprites() ? Game.Core.Sprites.get(floorVariantName(x, y, pf)) : null;
            if (fsp) {
              ctx.drawImage(fsp, px, py, TILE - 1, TILE - 1);
            } else {
              /* 地板：稳定噪点 */
              ctx.fillStyle = '#2b2b4a';
              ctx.fillRect(px, py, TILE - 1, TILE - 1);
              ctx.fillStyle = 'rgba(255,255,255,0.07)';
              var seed = (x * 7 + y * 13) % 4;
              if (seed === 0) ctx.fillRect(px + 6, py + 6, 2, 2);
              else if (seed === 1) ctx.fillRect(px + 14, py + 3, 2, 2);
              else if (seed === 2) ctx.fillRect(px + 4, py + 12, 2, 2);
            }
          } else if (t === 2) {
            /* P1-1：下行楼梯贴图；缺失回退紫台色块 */
            var stDown = this._hasSprites() ? Game.Core.Sprites.get('floor_stairs') : null;
            if (stDown) {
              ctx.drawImage(stDown, px, py, TILE - 1, TILE - 1);
            } else {
              /* 楼梯下：紫台 */
              ctx.fillStyle = '#b06ce0';
              ctx.fillRect(px, py, TILE - 1, TILE - 1);
              ctx.fillStyle = 'rgba(255,255,255,0.25)';
              ctx.fillRect(px, py + TILE - 6, TILE - 1, 2);
              ctx.fillRect(px, py + TILE - 12, TILE - 1, 2);
            }
          } else {
            /* P1-1：上行梯贴图；缺失回退绿台色块 */
            var stUp = this._hasSprites() ? Game.Core.Sprites.get('floor_ladder') : null;
            if (stUp) {
              ctx.drawImage(stUp, px, py, TILE - 1, TILE - 1);
            } else {
              /* 楼梯上：绿台 */
              ctx.fillStyle = '#52c41a';
              ctx.fillRect(px, py, TILE - 1, TILE - 1);
              ctx.fillStyle = 'rgba(255,255,255,0.3)';
              ctx.fillRect(px, py + TILE - 6, TILE - 1, 2);
            }
          }
          /* M9-1：细节层与装饰层——仅当前可见格绘制（FOV 外不画，与怪物隐藏规则一致） */
          if (!fovOn || Game.fov.isVisible(x, y)) {
            var det = Game.Systems.Map.getDetail(x, y);
            if (det) this._drawDetail(ctx, det, px, py, t === 0);
            var dec = Game.Systems.Map.getDecor(x, y);
            if (dec) this._drawDecor(ctx, dec, px, py);
            /* S-04：已触发的陷阱显现在该格（未触发的不可见，避免剧透）；
             * 验证页可能用轻量 Map stub（无 getTrap），缺失时跳过 */
            var tr = (Game.Systems.Map && typeof Game.Systems.Map.getTrap === 'function')
              ? Game.Systems.Map.getTrap(x, y) : null;
            if (tr && tr.seen) this._drawTrap(ctx, tr.id, px, py);
          }
          /* S3-1 FOV：已点亮但当前不可见 → 较暗覆盖（记忆效果）；D-14：整格覆盖，与未探索格一致不留缝 */
          if (fovOn && !Game.fov.isVisible(x, y)) {
            ctx.fillStyle = 'rgba(4,4,12,0.55)';
            ctx.fillRect(px, py, TILE, TILE);
          }
        }
      }
      /* P2-3：本层主题色调——场景层（地板/墙/细节/装饰）之后、怪物/玩家之前叠加全屏 tint。
       * save/restore 包裹，fillStyle 不外泄到后续怪物/HUD 绘制；themes 缺失时跳过 */
      var themes = Game.Data.MAPS && Game.Data.MAPS.themes;
      if (themes && themes.length) {
        var theme = themes[(pf - 1) % themes.length];
        if (theme && theme.tint) {
          ctx.save();
          ctx.fillStyle = theme.tint;
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
      }
    },

    drawPlayer: function (player) {
      var ctx = this._ctx;
      if (!ctx) return;
      /* M9-3：取插值渲染位置；未登记移动时降级用逻辑坐标。
       * P1-3：t<1（插值未完成）视为移动中 → run 帧；已到终点/未登记 → idle 帧 */
      var rp = (Game.Motion && Game.Motion.getRenderPos) ? Game.Motion.getRenderPos('player') : null;
      var moving = !!(rp && rp.t < 1);
      var rx = rp ? rp.x : player.x;
      var ry = rp ? rp.y : player.y;
      var px = rx * TILE - cam.x;
      var py = ry * TILE - cam.y;
      /* P1-3：骑士三态帧动画（16×28 按高度适配 TILE 格，底部贴格底、水平居中）；
       * 帧缺失回退 kni 单图（player.png），再缺失回退像素小人色块 */
      var kimg = null;
      if (this._hasSprites() && typeof Game.Core.Sprites.getFrame === 'function') {
        kimg = Game.Core.Sprites.getFrame(moving ? 'knight_m_run' : 'knight_m_idle',
          animIndex(moving ? 'knight_m_run' : 'knight_m_idle', 4));
      }
      if (kimg) {
        /* 高=TILE-2≈21px，宽=round(16×21/28)=12px，水平居中、底部贴格底 */
        drawSpriteByHeight(ctx, kimg, px + TILE / 2, py + TILE - 1, TILE - 2);
        return;
      }
      /* M7.5：素材就绪时使用 kni-dungeon 骑士精灵，否则回退像素小人色块 */
      var sp = Game.Core.Sprites && Game.Core.Sprites.isReady() ? Game.Core.Sprites.get('player') : null;
      if (sp) {
        ctx.drawImage(sp, px + 2, py + 2, TILE - 4, TILE - 4);
        return;
      }
      /* 像素小勇者：头 + 身体 + 眼睛 + 剑 */
      ctx.fillStyle = '#e8c39e';
      ctx.fillRect(px + 7, py + 3, TILE - 14, 7);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(px + 9, py + 5, 2, 2);
      ctx.fillRect(px + 13, py + 5, 2, 2);
      ctx.fillStyle = '#ffcf6e';
      ctx.fillRect(px + 5, py + 10, TILE - 10, TILE - 13);
      ctx.fillStyle = '#9bbbf4';
      ctx.fillRect(px + 8, py + 13, TILE - 16, 3);
      ctx.fillStyle = '#cfcfcf';
      ctx.fillRect(px + 15, py + 8, 2, TILE - 8);
      ctx.fillStyle = '#e1b98f';
      ctx.fillRect(px + 14, py + 8, 2, 2);
    },

    drawHUD: function (stats) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx) return;
      this._applyDpr(); /* M9-5 */
      var H = this.cssH;
      var narrow = this._isNarrow();
      /* S3-2：顶部信息栏（HP/MP/金币/楼层/击杀）改由 Game.hud 统一绘制，全场景常驻；
         本函数保留接口与底部操作提示，FPS/攻防信息下移到底部一行，不再与 HUD 条带重叠 */
      ctx.fillStyle = '#9bbbf4';
      ctx.font = (narrow ? '10px' : '12px') + ' monospace';
      var hint = narrow
        ? ('FPS=' + (stats ? stats.fps : 0) + ' | 方向键移动 | 踩怪开战 | H 重看引导')
        : ('FPS=' + (stats ? stats.fps : 0) +
          (stats ? ' | 攻击:' + stats.atk + ' 防御:' + stats.def : '') +
          ' | 方向键/WASD 移动 | 红点=怪物(踩到开战) | 紫梯下 / 绿梯上 | H 重看引导');
      ctx.fillText(hint, 10, H - 10);
      this._drawHud(); /* S3-2 */
      this._drawModal(); /* S3-3：弹窗叠在最上层（仅探索场景路径，弹窗仅从此打开） */
    },

    /* M9-3：计算攻击动作帧偏移（前摇后拉→出手前冲→恢复），纯视觉不阻塞结算
     * actionAt: 动作起始时间戳；duration: 总时长 ms；forward: 出手方向 (+1/-1) */
    _attackOffset: function (actionAt, duration, forward) {
      if (!actionAt) return 0;
      var elapsed = performance.now() - actionAt;
      var t = Math.min(elapsed / duration, 1);
      if (t >= 1) return 0;
      if (t < 0.3) return -forward * 8 * (t / 0.3);           /* 前摇：后拉 */
      if (t < 0.5) return forward * 14 * ((t - 0.3) / 0.2);   /* 出手：前冲 */
      return forward * 14 * (1 - (t - 0.5) / 0.5);            /* 恢复：回位 */
    },

    /* 战斗画面（M2）：敌人 + 玩家 + 战斗日志 + 指令
     * M9-3：怪物死亡消散（渐隐+上浮+缩小）、攻击前摇帧、粒子特效
     * D-16 重排（消除中段约 240px 空白）：双血条（带数值）/ 回合与段提示 / 伤害分级 /
     *   中段信息带（上次行动 + 战报 + 状态）全部由 state 驱动，不引入逐帧动画，保持可复算与省性能。
     * 版式（逻辑像素，1024×640 基准）：
     *   22  HUD 下沿            | 90~180  敌方精灵（Boss 67.5~180）
     *   202 敌方名字            | 212~232 敌方血条
     *   244~272 回合提示        | 300 上次行动（伤害分级）| 326/344/362 战报 | 376~396 状态
     *   414~434 我方血条        | 450~540 我方精灵      | 562 我方属性 | 610 指令
     * 文字最小 11px（HUD 现有最小 9px，这里取更高一档，避免"读不出的次级文字"）。 */
    drawBattle: function (state) {
      var ctx = this._ctx;
      if (!ctx || !state) return;
      this._applyDpr(); /* M9-5 */
      var W = this.cssW, H = this.cssH;
      var Fx = Game.Fx;
      /* D-16：动作/特效统一取 Fx 时钟（顿帧期间不前进），Fx 缺失时退回真实时钟 */
      var now = (Fx && typeof Fx.clockNow === 'function') ? Fx.clockNow() : performance.now();
      var monster = state.monster || {};
      var p = Game.Data.Player || {};
      var dying = !!state.dying;
      var dieProg = dying ? Math.min((now - state.dyingAt) / (state.dyingMs || 700), 1) : 0;
      var CX = W / 2;

      ctx.fillStyle = '#0f0f1f';
      ctx.fillRect(0, 0, W, H);

      /* ===== 敌方 ===== */
      var ex = CX - 45;
      var ey = 90;
      /* M9-3：怪物攻击前摇帧偏移（向前=向下）；D-16：叠加受击挤退 */
      var mAtkOff = this._attackOffset(state.monsterActionAt, 320, 1);
      var mKnock = (Fx && typeof Fx.knockOffset === 'function') ? Fx.knockOffset('monster') : 0;
      ey += mAtkOff + mKnock;
      var boss = monster.id === 'dragon';
      /* P2-4：Boss 判定读 MONSTERS[id].boss */
      var isBoss = !!(Game.Data.MONSTERS && Game.Data.MONSTERS[monster.id] &&
        Game.Data.MONSTERS[monster.id].boss);
      var bossScale = isBoss ? 1.25 : 1;
      var shake = (Fx && typeof Fx.shakeOffset === 'function') ? Fx.shakeOffset() : { x: 0, y: 0 };
      var sp2 = null;
      if (Game.Core.Sprites && Game.Core.Sprites.isReady()) {
        sp2 = monsterFrame(monster.id, false);
        if (!sp2) sp2 = Game.Core.Sprites.get(boss ? 'boss_demon' : 'monster_chort');
      }
      ctx.save();
      if (shake.x || shake.y) ctx.translate(shake.x, shake.y); /* D-16：震屏只作用于战场精灵，不动文字与 HUD */
      var mW = 90;
      if (dying) {
        /* M9-3：死亡消散——渐隐 + 上浮 + 缩小 */
        ctx.globalAlpha = 1 - dieProg;
        var mScale = 1 - dieProg * 0.5;
        var mSize = 90 * mScale;
        var mDrawX = ex + (90 - mSize) / 2;
        var mDrawY = ey - dieProg * 30 + (90 - mSize) / 2;
        if (sp2) {
          var dmSize = mSize * bossScale;
          mW = drawSpriteByHeight(ctx, sp2, mDrawX + mSize / 2, mDrawY + mSize, dmSize);
        } else {
          ctx.fillStyle = monster.color || '#888';
          ctx.fillRect(mDrawX, mDrawY, mSize, mSize);
        }
      } else {
        if (sp2) {
          mW = drawSpriteByHeight(ctx, sp2, ex + 45, ey + 90, 90 * bossScale);
        } else {
          ctx.fillStyle = monster.color || '#888';
          ctx.fillRect(ex, ey, 90, 90);
          mW = 90;
        }
      }
      /* D-16：命中局部闪白（≤120ms，单次命中只闪一次；Fx 关档时无） */
      if (!dying && Fx && typeof Fx.flashOf === 'function') {
        var fl = Fx.flashOf('monster');
        if (fl && fl.alpha > 0.01) {
          ctx.fillStyle = 'rgba(255,255,255,' + fl.alpha.toFixed(3) + ')';
          ctx.fillRect(CX - mW / 2, ey + 90 - 90 * bossScale, mW, 90 * bossScale);
        }
      }
      ctx.restore();

      if (!dying) {
        /* D-16：敌方名字（Boss 保留【BOSS】前缀，供 P2-4 断言） */
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px monospace';
        ctx.fillText((isBoss ? '【BOSS】' : '') + (monster.name || '?'), CX, 202);
        ctx.restore();
        /* D-16：敌方血条（带数值） */
        var mobHp = (typeof monster.hp === 'number') ? Math.max(monster.hp, 0) : 0;
        var mobMax = (typeof monster.maxHp === 'number' && monster.maxHp > 0) ? monster.maxHp : Math.max(mobHp, 1);
        battleBar(ctx, CX, 212, mobHp / mobMax, '#e24a4a', '#3a1218',
          'HP ' + mobHp + ' / ' + mobMax + (state.enraged ? '  ⚡狂暴' : ''));
      }

      /* ===== 中段信息带（原 240px 空白） ===== */
      var phase = state.phase || 'idle';
      var roundNo = state.roundNo || ((state.turn | 0) + 1);
      battleSegments(ctx, CX, 244, roundNo, phase);
      /* 上次行动结果——伤害分级：普通白字 16px，高伤橙字 18px 并带【高伤】标记（无暴击系统） */
      var la = state.lastAction;
      if (la && typeof la.dmg === 'number') {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = (la.heavy ? 'bold 18px monospace' : 'bold 16px monospace');
        ctx.fillStyle = la.heavy ? '#ffb347' : '#e8e8e8';
        var actTxt = la.by === 'player'
          ? ('你对 ' + (la.name || '') + ' 造成 ' + la.dmg + ' 伤害')
          : ((la.name || '') + ' 反击，造成 ' + la.dmg + ' 伤害');
        ctx.fillText((la.heavy ? '【高伤】' : '') + actTxt, CX, 300);
        ctx.restore();
      } else {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '15px monospace';
        ctx.fillStyle = '#7f8399';
        ctx.fillText('选择行动：攻击 / 防御 / 逃跑 / 技能 / 用药', CX, 300);
        ctx.restore();
      }
      /* 战报（最近 3 行） */
      var log = state.log || [];
      var lstart = Math.max(log.length - 3, 0);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '12px monospace';
      for (var li = 0; li < log.length - lstart; li++) {
        ctx.fillStyle = (li === log.length - lstart - 1) ? '#9fe08f' : '#6fae6a';
        ctx.fillText(log[lstart + li], CX, 326 + li * 18);
      }
      ctx.restore();
      /* 状态（随战斗变化：狂暴 / 护盾 / 防御） */
      battleChips(ctx, CX, 378, state);

      /* ===== 我方 ===== */
      var pKnock = (Fx && typeof Fx.knockOffset === 'function') ? Fx.knockOffset('player') : 0;
      var pHp = (typeof p.hp === 'number') ? Math.max(p.hp, 0) : 0;
      var pMax = (typeof p.maxHp === 'number' && p.maxHp > 0) ? p.maxHp : Math.max(pHp, 1);
      battleBar(ctx, CX, 414, pHp / pMax, '#4ade80', '#132a1c', 'HP ' + pHp + ' / ' + pMax);

      var px = CX - 45;
      var py = H - 190 + pKnock;
      /* M9-3：玩家攻击前摇帧偏移（向前=向上） */
      var pAtkOff = this._attackOffset(state.playerActionAt, 320, -1);
      py += pAtkOff;
      /* P1-3：玩家侧骑士帧动画——攻击动作期间切 knight_m_hit */
      var psp = null;
      if (Game.Core.Sprites && Game.Core.Sprites.isReady() && typeof Game.Core.Sprites.getFrame === 'function') {
        var pActing = !!(state.playerActionAt && (now - state.playerActionAt) < 320);
        psp = Game.Core.Sprites.getFrame(pActing ? 'knight_m_hit' : 'knight_m_idle',
          animIndex(pActing ? 'knight_m_hit' : 'knight_m_idle', 4));
      }
      if (!psp && Game.Core.Sprites && Game.Core.Sprites.isReady()) psp = Game.Core.Sprites.get('player');
      ctx.save();
      if (shake.x || shake.y) ctx.translate(shake.x, shake.y);
      if (psp) {
        drawSpriteByHeight(ctx, psp, px + 45, py + 90, 90);
      } else {
        ctx.fillStyle = '#ffcf6e';
        ctx.fillRect(px, py, 90, 90);
      }
      if (Fx && typeof Fx.flashOf === 'function') {
        var fp = Fx.flashOf('player');
        if (fp && fp.alpha > 0.01) {
          ctx.fillStyle = 'rgba(255,90,90,' + fp.alpha.toFixed(3) + ')';
          ctx.fillRect(px, py, 90, 90);
        }
      }
      ctx.restore();
      /* D-16：程序化斩击弧（零素材，1~2 段 arc） */
      if (Fx && typeof Fx.drawSlashes === 'function') Fx.drawSlashes(ctx);

      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px monospace';
      var statTxt = '勇者  HP:' + pHp + '/' + pMax;
      if (typeof p.atk === 'number') statTxt += '  ATK:' + p.atk;
      if (typeof p.def === 'number') statTxt += '  DEF:' + p.def;
      if (typeof p.mp === 'number' && typeof p.maxMp === 'number') statTxt += '  MP:' + p.mp + '/' + p.maxMp;
      ctx.fillText(statTxt, CX, 562);
      ctx.restore();

      /* 指令提示（消散期间隐藏） */
      if (!dying) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#9bbbf4';
        ctx.font = '13px monospace';
        ctx.fillText('1 攻击   2 防御   3 逃跑   4 火球   5 冲刺   6 护盾   7 用药   F 特效', CX, H - 30);
        ctx.restore();
      }
      /* S3-4：战斗视觉反馈（伤害飘字），绘制于战斗内容之上、HUD 之下 */
      try { if (Game.Feedback && typeof Game.Feedback.draw === 'function') Game.Feedback.draw(); } catch (e) { /* 降级 */ }
      /* M9-3：粒子特效（命中火花/死亡灵魂碎片），叠在反馈层之上 */
      try { if (Game.Particles && typeof Game.Particles.draw === 'function') Game.Particles.draw(); } catch (e) { /* 降级 */ }
      this._drawHud(); /* S3-2 */
    },

    /* 通用 UI 面板背景 */
    _drawPanel: function (title, gold) {
      var ctx = this._ctx;
      var W = this.cssW, H = this.cssH;
      this._applyDpr(); /* M9-5 */
      ctx.fillStyle = '#0f0f1f';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffcf6e';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(title, 30, 44);
      ctx.fillStyle = '#8f8';
      ctx.font = '14px monospace';
      ctx.fillText('金币: ' + gold, W - 180, 44);
    },

    /* 背包 UI（M3） */
    drawInventory: function (list, sel, player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx) return;
      this._drawPanel('背包 (B)', player.gold);
      if (!list || list.length === 0) {
        ctx.fillStyle = '#9bbbf4';
        ctx.font = '15px monospace';
        ctx.fillText('（空）', 30, 100);
      } else {
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          var item = Game.Data.ITEMS[e.id];
          var y = 90 + i * 30;
          ctx.fillStyle = (i === sel) ? '#ffcf6e' : '#cfcfcf';
          ctx.font = '14px monospace';
          var desc = item.type === 'consumable' ? '恢复HP+' + item.effect.hp
            : (item.type === 'weapon' ? '攻击+' + item.effect.atk : '防御+' + item.effect.def);
          ctx.fillText((i === sel ? '> ' : '  ') + item.name + ' x' + e.count + '   ' + desc, 30, y);
        }
      }
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '13px monospace';
      ctx.fillText('↑↓ 选择   Enter 使用/装备   I/Esc 返回', 30, this.cssH - 30);
      this._drawHud(); /* S3-2 */
    },

    /* 商店 UI（M3） */
    drawShop: function (list, sel, mode, player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx) return;
      this._drawPanel('商店 (E)', player.gold);
      ctx.fillStyle = mode === 'buy' ? '#52c41a' : '#f4b393';
      ctx.font = '14px monospace';
      ctx.fillText('模式: ' + (mode === 'buy' ? '购买' : '出售') + '   Tab 切换', 30, 72);
      if (!list || list.length === 0) {
        ctx.fillStyle = '#9bbbf4';
        ctx.font = '15px monospace';
        ctx.fillText('（无可' + (mode === 'buy' ? '购买' : '出售') + '物品）', 30, 110);
      } else {
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          var item = Game.Data.ITEMS[e.id];
          var y = 100 + i * 30;
          ctx.fillStyle = (i === sel) ? '#ffcf6e' : '#cfcfcf';
          ctx.font = '14px monospace';
          var price = mode === 'buy' ? item.price + ' 金币' : item.sell + ' 金币';
          var desc = item.type === 'consumable' ? '恢复HP+' + item.effect.hp
            : (item.type === 'weapon' ? '攻击+' + item.effect.atk : '防御+' + item.effect.def);
          ctx.fillText((i === sel ? '> ' : '  ') + item.name + '   ' + desc + '   ' + price,
            30, y);
        }
      }
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '13px monospace';
      ctx.fillText('↑↓ 选择   Enter ' + (mode === 'buy' ? '购买' : '出售') + '   Tab 切换   Esc 返回', 30, this.cssH - 30);
      this._drawHud(); /* S3-2 */
    },

    /* 任务面板（M4） */
    drawQuests: function (active, player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx) return;
      this._drawPanel('任务 (M)', player.gold);
      if (!active || active.length === 0) {
        ctx.fillStyle = '#52c41a';
        ctx.font = '15px monospace';
        ctx.fillText('全部任务已完成', 30, 100);
      } else {
        for (var i = 0; i < active.length; i++) {
          var a = active[i];
          var q = a.q;
          var y = 100 + i * 40;
          ctx.fillStyle = '#cfcfcf';
          ctx.font = '14px monospace';
          ctx.fillText(q.desc, 30, y);
          ctx.fillStyle = '#ffcf6e';
          ctx.font = '13px monospace';
          ctx.fillText('进度 ' + Math.min(a.progress, q.count) + ' / ' + q.count +
            '   奖励: +' + q.reward.gold + '金币 +' + q.reward.exp + '经验', 30, y + 22);
        }
      }
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '13px monospace';
      ctx.fillText('Esc 返回探索', 30, this.cssH - 30);
      this._drawHud(); /* S3-2 */
    },

    /* 通关画面（M4；M8-5：下方展示本地排行榜最近 10 条，行格式与既有面板一致） */
    drawVictory: function (player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx) return;
      this._applyDpr(); /* M9-5 */
      var W = this.cssW, H = this.cssH;
      ctx.fillStyle = '#0f0f1f';
      ctx.fillRect(0, 0, W, H);

      /* M8-5：读榜单（模块缺失/存储禁用时为空数组，照常绘制通关信息） */
      var list = [];
      try {
        var L = Game.Systems && Game.Systems.Leaderboard;
        if (L && typeof L.get === 'function') list = L.get() || [];
      } catch (e) { list = []; }
      var rows = Math.min(list.length, 10);

      /* 垂直居中布局：标题区 + 榜单区；窗口过矮时压缩行高，避免溢出 */
      var topH = 132;
      var gap = 24;
      var rowH = 22;
      var listH = rows > 0 ? (gap + rows * rowH) : 0;
      var maxListH = Math.max(0, H - topH - 64);
      if (listH > maxListH && rows > 0) {
        rowH = Math.max(14, Math.floor((maxListH - gap) / rows));
        /* 极矮窗口：即便压到最小行高仍放不下时，减少可见行数（保证不溢出底部） */
        if (gap + rows * rowH > maxListH) {
          rows = Math.max(0, Math.floor((maxListH - gap) / rowH));
        }
        listH = rows > 0 ? (gap + rows * rowH) : 0;
      }
      var blockH = topH + listH + 48;
      var y0 = Math.max((H - blockH) / 2, 12);

      /* 修复 P2：按实际文本宽度居中并在超宽时缩字号，替换原先 W/2-80/-160/-180 的硬编码偏移 */
      var pad = 16;
      function fitFont(str, size, bold) {
        ctx.font = (bold ? 'bold ' : '') + size + 'px monospace';
        var maxW = Math.max(W - pad * 2, 40);
        var w = ctx.measureText(str).width;
        if (w > maxW) {
          size = Math.max(8, Math.floor(size * maxW / w));
          ctx.font = (bold ? 'bold ' : '') + size + 'px monospace';
          w = ctx.measureText(str).width;
        }
        return w;
      }
      function centerText(str, y, color, size, bold) {
        var w = fitFont(str, size, bold);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.fillText(str, Math.max((W - w) / 2, pad), y);
      }

      centerText('通 关 !', y0 + 34, '#ffcf6e', 34, true);
      centerText('勇者击败了地牢巨龙，冒险结束', y0 + 66, '#cfcfcf', 16, false);
      centerText('最终金币: ' + player.gold + '   经验: ' + player.exp + '   等级: ' + player.level,
        y0 + 94, '#8f8', 15, false);

      /* M8-5：本地排行榜（新→旧：#1 为最新一条） */
      if (rows > 0) {
        centerText('本地排行榜', y0 + topH, '#ffcf6e', 15, true);
        var rowY = y0 + topH + gap;
        for (var i = 0; i < rows; i++) {
          var e = list[i] || {};
          var line = '#' + (i + 1) + '  ' + fmtRankTime(e.timeSec) +
            '  金币' + (typeof e.gold === 'number' ? e.gold : 0) +
            '  等级' + (typeof e.level === 'number' ? e.level : 0) +
            '  ' + (e.date || '');
          var w = fitFont(line, 13, false);
          ctx.fillStyle = (i === 0) ? '#ffcf6e' : '#cfcfcf';
          ctx.textAlign = 'left';
          ctx.fillText(line, Math.max((W - w) / 2, pad), rowY + i * rowH);
        }
      }

      centerText('按 R 重新开始', y0 + blockH - 22, '#9bbbf4', 14, false);
      this._drawHud(); /* S3-2 */
    },

    /* 强化学习演示场景（M7）：Q-learning 寻宝鼠 */
    drawLearner: function (stats, grid) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx || !grid || !stats) return;
      this._applyDpr(); /* M9-5 */
      var W = this.cssW, H = this.cssH;
      ctx.fillStyle = '#0f0f1f';
      ctx.fillRect(0, 0, W, H);
      var T = 24;
      var ox = Math.max((W - grid[0].length * T) / 2, 10);
      var oy = 64;
      for (var y = 0; y < grid.length; y++) {
        for (var x = 0; x < grid[0].length; x++) {
          var px = ox + x * T;
          var py = oy + y * T;
          if (grid[y][x] === 0) {
            ctx.fillStyle = '#3a2e5c';
            ctx.fillRect(px, py, T - 1, T - 1);
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.fillRect(px, py + T / 2 - 1, T - 1, 2);
          } else {
            ctx.fillStyle = '#2b2b4a';
            ctx.fillRect(px, py, T - 1, T - 1);
          }
        }
      }
      /* 金币（目标） */
      ctx.fillStyle = '#ffcf6e';
      ctx.fillRect(ox + stats.target.x * T + 6, oy + stats.target.y * T + 6, T - 12, T - 12);
      /* 寻宝鼠（智能体） */
      ctx.fillStyle = '#ff8c42';
      ctx.fillRect(ox + stats.agent.x * T + 4, oy + stats.agent.y * T + 4, T - 8, T - 8);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(ox + stats.agent.x * T + 8, oy + stats.agent.y * T + 8, 2, 2);
      ctx.fillRect(ox + stats.agent.x * T + 14, oy + stats.agent.y * T + 8, 2, 2);
      /* HUD */
      ctx.fillStyle = '#ffcf6e';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('Q-learning 寻宝鼠演示（AI 学习）', 24, 34);
      ctx.fillStyle = '#8f8';
      ctx.font = '15px monospace';
      ctx.fillText('训练轮次: ' + stats.episode +
        '   成功率: ' + stats.successRate + '%   (成功 ' + stats.successes + ')',
        24, 56);
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '13px monospace';
      ctx.fillText('ε-贪心 ε=' + stats.epsilon + '（探索/利用权衡）| 橙色=鼠 黄色=金币 目标=学会自己走到金币',
        24, H - 46);
      /* 历史成功率条（最近 20 轮） */
      var bars = stats.history.slice(-20);
      var bw = Math.min(14, (W - 60) / 20 - 2);
      for (var i = 0; i < bars.length; i++) {
        var hgt = Math.max(2, Math.round(bars[i].rate * 0.5));
        ctx.fillStyle = '#52c41a';
        ctx.fillRect(24 + i * (bw + 2), H - 32 - hgt, bw, hgt);
      }
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px monospace';
      ctx.fillText('成功率走势（近20轮）', 24, H - 14);
      this._drawHud(); /* S3-2 */
    },

    /* M9-5：首次引导覆盖层——半透明遮罩 + 目标/去向说明 + 按键说明。
     * D-14：改为 Enter 或点击确认按钮关闭（不再任意键）；补目标与去向；可经 H 重看。
     * 按键文案与 M9-4 设置面板同源（方向键/WASD、B/S/M/T/L、K/Q、Esc），
     * 战斗按键取现有实现（1/2/3 攻防逃、4/5/6 火球/冲刺/护盾、7 用药、F 特效），不杜撰。
     * D-20：整块按键与机制文案改由 KEYMAP / guideRows 生成，与实际映射同源。 */
    drawGuide: function () {
      var ctx = this._ctx;
      if (!ctx) return;
      this._applyDpr();
      var W = this.cssW, H = this.cssH;

      ctx.fillStyle = 'rgba(8,8,16,0.92)';
      ctx.fillRect(0, 0, W, H);

      var cx = W / 2;
      ctx.textAlign = 'center';

      ctx.fillStyle = '#ffcf6e';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('地牢：我独自升级', cx, Math.max(78, H * 0.13));

      /* D-14：补上"目标是什么"与"该往哪走"——原引导只讲按键，玩家不知道该干什么 */
      ctx.fillStyle = '#ffb86b';
      ctx.font = 'bold 15px monospace';
      ctx.fillText('你的目标：往地牢更深处走，第 5 层击败地牢巨龙', cx, Math.max(112, H * 0.13 + 34));
      ctx.fillStyle = '#8fe3a0';
      ctx.font = '14px monospace';
      ctx.fillText('往哪走：踩紫色下行梯下一层，绿色上行梯回上一层', cx, Math.max(136, H * 0.13 + 58));

      /* D-20：操作说明 + 机制须知（数据来自 KEYMAP / guideRows，见 render.js 顶部） */
      var rows = this._guideLayout();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].head) {
          ctx.fillStyle = '#ffb86b';
          ctx.font = 'bold 14px monospace';
        } else {
          ctx.fillStyle = '#9bbbf4';
          ctx.font = '13px monospace';
        }
        ctx.fillText(rows[i].text, cx, rows[i].y);
      }

      /* D-14：明确的确认按钮（Enter 或点击此按钮；不再是"任意键"） */
      var btn = this._guideRect();
      ctx.fillStyle = 'rgba(255,207,110,0.16)';
      ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
      ctx.strokeStyle = '#ffcf6e';
      ctx.lineWidth = 2;
      ctx.strokeRect(btn.x + 1, btn.y + 1, btn.w - 2, btn.h - 2);
      ctx.fillStyle = '#ffcf6e';
      ctx.font = 'bold 15px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText('按 Enter 开始冒险', cx, btn.y + btn.h / 2);
      ctx.textBaseline = 'alphabetic';

      ctx.fillStyle = '#7f8fa8';
      ctx.font = '12px monospace';
      ctx.fillText('（也可点击上方按钮；游戏中随时按 H 重看本页）', cx, btn.y + btn.h + 26);

      ctx.textAlign = 'left';
    },

    /* D-20：引导页正文排版参数（正文行数随按键表变化，按钮位置必须跟着算，不能写死） */
    _guideMetrics: function () {
      var H = this.cssH || 640;
      return { startY: Math.max(168, H * 0.13 + 78), lineH: (H < 600 ? 18 : 22) };
    },

    /* D-20：逐行算坐标（分组标题前多留 6px），绘制与按钮定位共用这一份 */
    _guideLayout: function () {
      var mt = this._guideMetrics();
      var rows = guideRows(), out = [], y = mt.startY;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].head && i > 0) y += 6;
        out.push({ text: rows[i].text, head: !!rows[i].head, y: y });
        y += mt.lineH;
      }
      return out;
    },

    /* D-14：引导页确认按钮的命中矩形（绘制与点击判定共用，避免两处坐标漂移）
     * D-20：y 由正文行数算出，新增键位/机制条目时按钮自动下移，不再依赖魔数 */
    _guideRect: function () {
      var W = this.cssW || 1024;
      var w = Math.min(300, W - 80);
      var h = 34;
      var lay = this._guideLayout();
      var last = lay.length ? lay[lay.length - 1].y : this._guideMetrics().startY;
      return { x: Math.round((W - w) / 2), y: Math.round(last + this._guideMetrics().lineH + 18), w: w, h: h };
    }
  };
})();
