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
  /* D-100：统一鼠标热区——每次顶层绘制前清空，绘制时登记当前可见的可点矩形；
   * 命中一律用逻辑坐标（toLogical），hover 只在 id 变化时写一次 canvas.style.cursor。 */
  var HOT = [];
  var HOVER_ID = null;

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

  /* D-106：主菜单场景是纯静态画面（无逐帧动画），按 W/H/DPR 缓存到离屏画布，
   * 每帧只做一次 1:1 blit；把菜单单帧调用从 ~480 压到 ~120。
   * 素材未就绪时用兜底色块直绘且不写缓存，全部到齐后 key 变化自动重绘。 */
  var menuSceneCache = { cv: null, ctx: null, key: '' };

  /* D-128：子页「介质」落位动效状态（100ms 一次性，不循环）。
   * 主菜单四页共用一套介质；验证页可用 R._menuNoAnim=true 直接取落位后的稳定帧，
   * 或用 R._animNow 注入时钟验证「静止两帧同哈希」。 */
  var menuEnter = { page: '', at: 0 };

  /* D-128：玩法说明宽档五层竖井的静态缓存。
   * 旧实现每帧按 24×24 逐格画 338 次 drawImage（960×540 实测单帧 602 次调用），
   * 远超静态 UI 的 214 上限；竖井是纯静态图形，按 D-106 同款「素材就绪后烘焙、每帧 1 次 blit」处理。
   * 只烘焙岩壁/地面/暗缝等图形，F1–F5 刻度与 BOSS 文字仍每帧直绘（验证页关文字层时缓存不受影响）。 */
  var shaftCache = { cv: null, ctx: null, key: '' };

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

  /* P1-1：地板变体名——坐标 + 楼层哈希（同一格同一层恒定，不依赖 Math.random，避免逐帧闪烁）
   * D-79：F1 用 legacy 名（已重画为 24×24），F2~F5 用 t{n}_floor_* 主题名 */
  function floorVariantName(x, y, floor) {
    var f = (typeof floor === 'number' && floor > 0) ? floor : 1;
    var h = (x * 7 + y * 13 + f * 3) % 8;
    if (h < 0) h += 8;
    return (f === 1 ? 'floor_' : 't' + f + '_floor_') + (h + 1);
  }

  /* D-79：房间类型（纯渲染分类，不写任何地图数据）
   * open  = 5×5 内 ≥18 格可走（房间）
   * hall  = 12~17 格（大厅/宽走廊）
   * corridor = 其余（窄走廊）
   * secret / boss 由地图只读接口与楼梯位置给出 */
  function roomKind(grid, x, y, secret, bossNear) {
    if (secret) return 'secret';
    if (bossNear) return 'boss';
    var n = 0;
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        var yy = y + dy, xx = x + dx;
        if (!grid[yy] || grid[yy][xx] === undefined || grid[yy][xx] === 0) continue;
        n++;
      }
    }
    if (n >= 21) return 'room';
    if (n <= 6) return 'corridor';
    return 'hall';
  }

  var ROOM_TINT = {
    room: 'rgba(255,238,205,0.045)',
    hall: null,
    corridor: 'rgba(0,0,0,0.10)',
    secret: 'rgba(120,255,180,0.05)',
    boss: 'rgba(255,60,40,0.065)'
  };

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

  /* D-104：战斗精灵整数倍硬线——落屏高 = 素材原生高 × 整数（普通怪/Boss/玩家一律 2×）。
   * 旧口径固定 90px，骑士 24×42 → 2.143×、兽人 24×35 → 2.571×，像素被非整数采样拉糊；
   * 现在不再用"绝对高度 90"反推倍率，而是由原生高正推目标高，宽 = round(原生宽 × 2) 恰为整数倍。
   * 素材缺失（naturalHeight=0）才退回旧兜底高度，该分支是纯色方块，不属于精灵缩放口径。 */
  var BATTLE_SPRITE_MUL = 2;
  function battleSpriteH(img, fallback) {
    var nh = img && (img.naturalHeight || 0);
    return (nh > 0) ? nh * BATTLE_SPRITE_MUL : (fallback || 108);
  }
  /* D-105：濒死缩小也必须走整数档（旧 1−prog×0.5 → 1.5× 等中间倍率会把像素插值糊）。
   * 前 50% 保持 2×，后 50% 跳到 1×；透明度仍连续衰减，跳档被渐隐掩住，不需要额外闪烁。
   * 纯函数，验证页直接采样 0..1 断言返回值恒为整数。 */
  var DYING_SWITCH = 0.5;
  function battleDyingMul(prog) {
    var p = (typeof prog === 'number' && isFinite(prog)) ? prog : 0;
    return (p < DYING_SWITCH) ? 2 : 1;
  }

  /* 美学整改 A1：命中闪白按精灵 alpha 裁剪。
   * 旧实现用 90×90 的 fillRect 直接盖在战斗精灵上，史莱姆这种 90 格里只占 40 格的
   * 剪影会被整块方片罩住——命中瞬间主体消失。这里改为：把精灵画进离屏画布 →
   * source-atop 填色（只吃到不透明像素）→ 按原位置/原尺寸贴回。
   * 离屏按 dpr×scale 的设备像素分辨率合成，贴回时 1:1 落在同像素网格上，不引入额外插值。
   * 素材缺失（naturalWidth=0）返回 false，调用方保留纯色兜底。 */
  var tintCv = null, tintCtx = null;
  function tintSprite(ctx, img, cx, bottom, targetH, color, alpha) {
    if (!ctx || !img || !(alpha > 0.01)) return false;
    var nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
    if (nw <= 0 || nh <= 0) return false;
    var w = Math.max(2, Math.round(nw * targetH / nh));
    var R = Game.Core && Game.Core.Render;
    var k = ((R && R.dpr) || 1) * ((R && R.scale) || 1);
    var ow = Math.max(1, Math.round(w * k)), oh = Math.max(1, Math.round(targetH * k));
    if (!tintCv) { tintCv = document.createElement('canvas'); tintCtx = tintCv.getContext('2d'); }
    if (!tintCtx) return false;
    if (tintCv.width !== ow || tintCv.height !== oh) { tintCv.width = ow; tintCv.height = oh; }
    tintCtx.setTransform(1, 0, 0, 1, 0, 0);
    tintCtx.clearRect(0, 0, ow, oh);
    tintCtx.imageSmoothingEnabled = false;
    tintCtx.drawImage(img, 0, 0, ow, oh);
    tintCtx.globalCompositeOperation = 'source-atop';
    tintCtx.globalAlpha = Math.min(1, alpha);
    tintCtx.fillStyle = color;
    tintCtx.fillRect(0, 0, ow, oh);
    tintCtx.globalAlpha = 1;
    tintCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tintCv, cx - Math.floor(w / 2), bottom - targetH, w, targetH);
    return true;
  }

  /* D-101：受击闪白的统一来源——Feedback 是唯一账本（谁被打、闪多久），
   * 像素仍由这里的 tintSprite 按精灵轮廓着色；没有 Feedback 的底层页面回退到 Fx 既有闪白。 */
  function battleFlashOf(who) {
    var Fb = Game.Feedback;
    if (Fb && typeof Fb.flashOf === 'function') {
      var f = Fb.flashOf(who);
      if (f) return f;
    }
    var Fx = Game.Fx;
    return (Fx && typeof Fx.flashOf === 'function') ? Fx.flashOf(who) : null;
  }

  /* D-35：地图层尺寸口径——素材原生像素高 × (TILE/16)，脚底锚定格底。
   * 旧实现把玩家/怪物/装饰一律压进一格（玩家 21px、大图 21px、常规帧 22px），
   * 比例完全失真：史莱姆实测 17.9px，反而比独眼酋长 15.2px 还高。
   * 现在按素材自身比例缩放（16px 素材 → 1.5 格 = 36px/16 = 1.5×），
   * 战场层（drawBattle）仍用 drawSpriteByHeight 的绝对高度口径，112.5px 基线不受影响。 */
  /* D-79：素材原生基准（24 基为 24×24 主题地块/装饰，16 基为怪物/道具/UI）。
   * 未注入 Sprites.baseOf 时按 16 兼容旧行为。 */
  function baseOfName(name) {
    var S = Game.Core && Game.Core.Sprites;
    if (S && typeof S.baseOf === 'function') return S.baseOf(name || '');
    return 16;
  }
  /* D-80：帧图在加载时由 Sprites 打上 __base，实体绘制路径直接读它，
   * 避免每次绘制再按文件名猜基准（getFrame 只返回图像、拿不到名字）。 */
  function imgBase(img) {
    return (img && img.__base === 24) ? 24 : 16;
  }
  function unitBox(img, cx, bottom, base) {
    var nw = img && (img.naturalWidth || 0);
    var nh = img && (img.naturalHeight || 0);
    if (nw <= 0 || nh <= 0) return null;
    var b = (base === 24) ? 24 : 16;
    var h = Math.max(2, Math.round(nh * TILE / b));
    var w = Math.max(2, Math.round(nw * h / nh));
    return { x: Math.round(cx - w / 2), y: Math.round(bottom - h), w: w, h: h };
  }

  function drawSpriteByUnit(ctx, img, cx, bottom, base) {
    var b = unitBox(img, cx, bottom, base);
    if (!b) return null;
    ctx.drawImage(img, b.x, b.y, b.w, b.h);
    return b;
  }

  /* D-80：只读口径出口——验证页按真实绘制公式取"落屏尺寸"，避免各页各写一套公式。 */
  function unitBoxOf(img) { return unitBox(img, 0, 100, imgBase(img)); }

  /* D-80 裁定 B：图标一律按素材原生尺寸 1:1 绘制，禁止任何缩放。
   * 背包/商店行、HUD 都走这里；返回实际绘制尺寸，验证页据此断言
   * "绘制尺寸 == 原生尺寸"（任何非整数缩放必须判负）。 */
  function drawIcon(ctx, img, x, y) {
    if (!ctx || !img) return null;
    var w = img.naturalWidth || 24, h = img.naturalHeight || 24;
    ctx.drawImage(img, x, y, w, h);
    return { x: x, y: y, w: w, h: h };
  }

  /* D-35：地面投影——站在地面上的角色/怪物/装饰统一补一层柔和椭圆影，解决"贴图浮着"。
   * 颜色与主题无关（固定中性黑），不参与主题 tint；只做一次椭圆填充，零新素材。
   * inside=true 用于烘焙进静态层的装饰：投影必须留在本格内，否则越过格底会被下一行地板覆盖。 */
  function groundShadow(ctx, cx, bottom, w, inside) {
    var rx = Math.max(3, Math.round((w || TILE) * 0.42));
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, bottom - (inside ? 1.5 : 0.5), rx, inside ? 2 : 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* D-89：接触阴影——角色/怪物脚下一小块贴地暗面，五层统一。
   * 与 D-35 的地图投影分开：战场版更宽更扁（rx≈屏宽的 38%），且始终画在"脚下地面线"上，
   * 精灵被击退/上浮时阴影不跟着走，读起来才是"人在地面上"而不是贴纸。 */
  function contactShadow(ctx, cx, groundY, w, alpha) {
    var rx = Math.max(8, Math.round((w || 90) * 0.58));
    var ry = Math.max(3, Math.round(rx * 0.13));
    /* D-103 清账：只设 fillStyle，不再 save/restore（每帧两侧各一次，省 2×2 次） */
    /* 外圈一点点环境反光：纯黑地面（站台带）上也能看出"这里有一块地面" */
    ctx.fillStyle = 'rgba(210,215,255,0.055)';
    ctx.beginPath();
    ctx.ellipse(cx, groundY + 1, Math.round(rx * 1.22), Math.max(3, Math.round(ry * 1.5)), 0, 0, Math.PI * 2);
    ctx.fill();
    /* 贴地暗面：借精灵压住地面的那一小块 */
    ctx.fillStyle = 'rgba(0,0,0,' + (typeof alpha === 'number' ? alpha : 0.62) + ')';
    ctx.beginPath();
    ctx.ellipse(cx, groundY, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
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

  /* D-102：旧 battleSegments（静态两段提示）由 battlePipeline 取代（带进度、横竖共用） */

  /* ── D-102 S1：身份卡 / 行动管线 / 战报 的共用绘制 ─────────────────────
   * 规格 §5.1 / §7.2 / §8.2：横置与纵置共用同一套字号、行高与三段顺序，
   * 只有卡片的落点不同（横置在头顶、纵置在左侧）。所有坐标由调用方给出。 */
  var CARD_H = 52;
  var CHIP_H = 14;
  var FONT_STACK = 'monospace';

  /* D-103：逐元素绘制记账钩子。验证页在脚本加载前装 window.__DCMARK 时，
   * 每到一个元素边界就把"归属标签"推给它；未装时是一次 null 判断，零绘制开销。
   * 计数口径仍是"触达 ctx 的方法调用次数"，标签只负责把同一帧的调用分桶，
   * 不改变任何绘制顺序、坐标或数值。 */
  var DC_MARK = (typeof window !== 'undefined' && typeof window.__DCMARK === 'function')
    ? window.__DCMARK : null;
  function dcMark(label) { if (DC_MARK) DC_MARK(label); }

  /* D-103 S2：指令格配色与禁用态的唯一来源。验证页按同一组常量算对比度，
   * 避免"页面算一套、渲染用另一套"的口径漂移。 */
  var CMD_STYLE = {
    barBg: 'rgba(8,8,16,0.92)',
    barLine: '#2a2a44',
    cellBg: 'rgba(255,255,255,0.05)',
    keyText: '#dfe9ff',
    label: '#eef2ff',
    sub: '#9fb0d8',
    hoverFill: 'rgba(255,207,110,0.12)',
    hoverStroke: '#ffcf6e',
    gfxAlpha: 0.45,     /* §6.5：图形（格底/描边/键位）alpha */
    textAlpha: 0.75     /* §6.5：禁用文字 alpha；0.72 在白色底最坏档只有 4.52，留余量取 0.75 */
  };

  function cardFit(ctx, text, maxW) {
    var s = String(text == null ? '' : text);
    if (ctx.measureText(s).width <= maxW) return s;
    var cut = s;
    while (cut.length > 1 && ctx.measureText(cut + '…').width > maxW) cut = cut.slice(0, -1);
    return cut + '…';
  }

  /* D-102：状态 chip 的归属——玩家卡只放玩家状态，敌人卡只放敌人状态。
   * 防御 chip 不直接读 state.defending（怪物段 100ms 后就被清），而是读
   * defendRound === roundNo：整个回合可见，下一次行动起拍才退场。
   * D-109 N2：每枚 chip 必须带真实数字，不再出现无信息占位符。
   * full = 宽档写法（"护盾8"），short = 窄档写法（"盾8"），两者都含数字；
   * 防御的数字 1 = 本回合剩余回合数（与 defendRound 同源，不引入新数值）。 */
  function cardChips(who, state) {
    var out = [];
    if (!state) return out;
    if (who === 'player') {
      /* 防御/护盾优先：空间不足时先被折叠的应是后面的持续状态 */
      if (state.defending || (state.defendRound > 0 && state.defendRound === state.roundNo)) {
        out.push({ full: '防御1', short: '防1', c: '#9bbbf4' });
      }
      if (state.shieldValue > 0) {
        out.push({ full: '护盾' + state.shieldValue, short: '盾' + state.shieldValue, c: '#7dffb0' });
      }
      var S = Game.Systems && Game.Systems.Status;
      if (S && typeof S.list === 'function') {
        var arr = S.list();
        for (var i = 0; i < arr.length; i++) {
          var nm = String(arr[i].name || '状态');
          var tn = (typeof arr[i].turns === 'number') ? arr[i].turns : 0;
          out.push({ full: nm + tn, short: nm.charAt(nm.length - 1) + tn, c: arr[i].color || '#ef4444' });
        }
      }
    } else {
      if (state.enraged) {
        var eatk = (typeof state.enrageAtk === 'number') ? state.enrageAtk : 0;
        out.push({ full: '狂暴' + eatk, short: '暴' + eatk, c: '#ff7b6b' });
      }
      var B = Game.Systems && Game.Systems.Battle;
      var dd = (B && typeof B.dragonDread === 'function') ? B.dragonDread() : null;
      if (dd && dd.tier > 0) out.push({ full: '龙威' + dd.tier, short: '威' + dd.tier, c: '#ffcf6e' });
    }
    return out;
  }

  /* 渲染 chip（D-109 N2）：按可用宽度自动选写法，绝不出现 "＋n" 这类无数字占位。
   * 候选顺序：宽档带色块 → 宽档去色块 → 窄档去色块 → 窄档紧凑间距；
   * 每种写法先试 3 枚，装不下再减到 1 枚，并把隐藏数量写成 "+N"（N 一定是数字）。
   * chip 宽度由文本实测宽度反推，因此文本永远落在自己的 chip 内。 */
  function drawCardChips(ctx, x0, y, maxW, list) {
    if (!list || !list.length) return [];
    dcMark('chip');
    ctx.font = '11px ' + FONT_STACK;
    var PAD_FULL = 20, PAD_BARE = 12;
    function tw(t) { return Math.round(ctx.measureText(t).width); }
    function wFull(t) { return PAD_FULL + tw(t); }
    function wBare(t) { return PAD_BARE + tw(t); }
    function sum(ws, gap) {
      var s = 0;
      for (var i = 0; i < ws.length; i++) s += ws[i] + (i ? gap : 0);
      return s;
    }
    var STYLES = [
      { bare: false, short: false, gap: 4 },
      { bare: true, short: false, gap: 4 },
      { bare: true, short: true, gap: 4 },
      { bare: true, short: true, gap: 2 }
    ];
    var plan = null, style = null;
    var maxC = Math.min(3, list.length);
    /* D-109 N2：先保"能看见几枚"，再选写法——早期版本先选写法会把
     * "防御1 + 护盾8"折叠成 "防御1 +1"，护盾反被藏掉。 */
    for (var k = maxC; k >= 1 && !plan; k--) {
      for (var si = 0; si < STYLES.length && !plan; si++) {
        style = STYLES[si];
        var labels = [];
        for (var li = 0; li < list.length; li++) labels.push(style.short ? list[li].short : list[li].full);
        var shown = [];
        for (var j = 0; j < k; j++) shown.push({ t: labels[j], c: list[j].c });
        if (k < list.length) shown.push({ t: '+' + (list.length - k), c: '#8a8aa0' });
        var ws = [], tot = 0;
        for (var m = 0; m < shown.length; m++) {
          ws.push(style.bare ? wBare(shown[m].t) : wFull(shown[m].t));
          tot += ws[m] + (m ? style.gap : 0);
        }
        if (tot <= maxW) { plan = { shown: shown, ws: ws }; break; }
      }
    }
    if (!plan) {
      /* 兜底：单枚窄档（maxW ≥ 94 的正常卡永远不会走到这里） */
      var one = [{ t: list[0].short, c: list[0].c }];
      if (list.length > 1) one.push({ t: '+' + (list.length - 1), c: '#8a8aa0' });
      var w1 = [];
      for (var q = 0; q < one.length; q++) w1.push(wBare(one[q].t));
      plan = { shown: one, ws: w1 };
      style = { bare: true, gap: 2 };
    }
    var out = [], x = x0;
    for (var i2 = 0; i2 < plan.shown.length; i2++) {
      var ch = plan.shown[i2], cw = plan.ws[i2];
      /* D-102 预算：chip 底色就是卡底，不再单独铺一层（省 3 次/帧），只留描边 + 色块 + 文字 */
      ctx.strokeStyle = ch.c;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, CHIP_H - 1);
      var tx = x + 5;
      if (!style.bare) {
        ctx.fillStyle = ch.c;
        ctx.fillRect(x + 4, y + 3, 8, 8);
        tx = x + 15;
      }
      ctx.fillStyle = ch.c;
      ctx.fillText(ch.t, tx, y + CHIP_H / 2 + 1);
      out.push({ text: ch.t, x: x, y: y, w: cw, h: CHIP_H });
      x += cw + style.gap;
    }
    return out;
  }

  /* D-102：三段式身份卡（替换 hNamePlate 的两段式铭牌）
   * L1 名字 7–19 / L2 HP 条 20–29（数值叠在条内右端）/ L3 chip 33–47。
   * HP 条与数值是三段卡的一部分，不再在战场别处单画一条大血条（G15）。 */
  function battleCard(ctx, cx, topY, w, spec) {
    var h = CARD_H;
    var x = Math.round(cx - w / 2);
    var top = Math.round(topY);
    /* D-103 清账：不再 save/restore（每卡省 2 次），样式在末尾显式复位；
     * HP 条描边与条底/填充重复表达同一条边界，删掉描边省 1 次（卡底已提供对比）。 */
    dcMark('card.bg');
    ctx.fillStyle = 'rgba(8,8,16,0.78)';
    ctx.fillRect(x, top, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
    if (spec.enraged) {
      ctx.fillStyle = '#ff9a4a';
      ctx.fillRect(x + 1, top + 1, 3, h - 2);
    }
    /* L1 名字：超宽省略，不缩字号 */
    var textW = w - 18;
    dcMark('card.text');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px ' + FONT_STACK;
    ctx.fillStyle = spec.enraged ? '#ffb37a' : '#e8ecff';
    ctx.fillText(cardFit(ctx, spec.name, textW), x + 9, top + 13);
    /* L2 HP 条 + 数值（数值带 1px 黑描边，压在条内右端） */
    var bx = x + 8, bw = w - 16, by = top + 20, bh = 9;
    dcMark('card.hp');
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(bx, by, bw, bh);
    var r = (spec.hpMax > 0) ? Math.max(0, Math.min(1, spec.hp / spec.hpMax)) : 0;
    if (r > 0) {
      ctx.fillStyle = spec.hpColor;
      ctx.fillRect(bx, by, Math.round(bw * r), bh);
    }
    var hpText = spec.hp + '/' + spec.hpMax;
    ctx.textAlign = 'right';
    ctx.font = '11px ' + FONT_STACK;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 3;
    ctx.strokeText(hpText, bx + bw - 4, by + bh / 2 + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(hpText, bx + bw - 4, by + bh / 2 + 1);
    /* L3 状态 chip */
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    var chips = drawCardChips(ctx, x + 9, top + 33, w - 18, spec.chips || []);
    /* 显式复位被本函数改过的状态（替代 save/restore） */
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return {
      x: x, y: top, w: w, h: h,
      barX: bx, barY: by, barW: bw, barH: bh,
      l1: { x: x + 9, y: top + 7, w: textW, h: 12 },
      l2: { x: bx, y: by, w: bw, h: bh },
      l3: { x: x + 9, y: top + 33, w: textW, h: CHIP_H },
      chips: chips, name: spec.name, hp: spec.hp, hpMax: spec.hpMax
    };
  }

  /* D-102：两节点行动管线（规格 §7.2）。320×26：回合号 0–96 / 节点① 96–200 / 节点② 204–316。
   * 进度只读 turnRec + Fx 时钟，不推进任何时钟；timeRec 缺失时退化为静态框。 */
  function battlePipeline(ctx, cx, y, state, nowMs) {
    dcMark('pipeline');
    var w = 320, h = 26;
    var x = Math.round(cx - w / 2), top = Math.round(y);
    var phase = (state && state.phase) || 'idle';
    var roundNo = (state && state.roundNo) || ((state && state.turn | 0) + 1);
    var B = Game.Systems && Game.Systems.Battle;
    var tl = (B && typeof B.getTimeline === 'function') ? B.getTimeline() : null;
    var rec = tl && tl.rec;
    var seg1 = (tl && tl.plan && tl.plan.seg1) ? tl.plan.seg1 : 100;
    var total = (tl && tl.plan && tl.plan.total) ? tl.plan.total : 180;
    function clamp01(v) { return (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.min(1, v)) : 0; }
    var p1 = 0, p2 = 0;
    if (rec) {
      p1 = (phase === 'player') ? clamp01((nowMs - rec.playerAt) / seg1) : (phase === 'monster' || phase === 'idle') ? 1 : 0;
      p2 = (phase === 'monster') ? clamp01((nowMs - rec.monsterAt) / Math.max(1, total - seg1)) : (phase === 'idle' && rec.monsterAt) ? 1 : 0;
    }
    var n1 = { x: x + 96, y: top + 2, w: 104, h: h - 4 };
    var n2 = { x: x + 204, y: top + 2, w: 112, h: h - 4 };
    var s1 = (phase === 'player') ? 'act' : (p1 >= 1 && rec ? 'done' : 'idle');
    var s2 = (phase === 'monster') ? 'mon' : (p2 >= 1 && rec ? 'done' : 'idle');
    ctx.fillStyle = 'rgba(8,8,16,0.72)';
    ctx.fillRect(x, top, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = 'bold 13px ' + FONT_STACK;
    ctx.fillStyle = '#ffcf6e';
    ctx.fillText('第 ' + roundNo + ' 回合', x + 8, top + 14);
    ctx.fillStyle = s1 === 'act' ? 'rgba(120,200,255,0.20)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(n1.x, n1.y, n1.w, n1.h);
    ctx.fillStyle = s2 === 'mon' ? 'rgba(255,140,120,0.22)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(n2.x, n2.y, n2.w, n2.h);
    ctx.textAlign = 'center';
    ctx.font = '13px ' + FONT_STACK;
    ctx.fillStyle = s1 === 'act' ? '#bfe6ff' : (s1 === 'done' ? '#6b7280' : '#8d8f9e');
    ctx.fillText('① 你出手', n1.x + n1.w / 2, n1.y + n1.h / 2 + 1);
    ctx.fillStyle = s2 === 'mon' ? '#ffb1a1' : (s2 === 'done' ? '#6b7280' : '#8d8f9e');
    ctx.fillText('② 怪物反击', n2.x + n2.w / 2, n2.y + n2.h / 2 + 1);
    ctx.fillStyle = 'rgba(120,200,255,0.85)';
    if (p1 > 0) ctx.fillRect(n1.x, n1.y + n1.h - 2, Math.round(n1.w * p1), 2);
    ctx.fillStyle = 'rgba(255,140,120,0.85)';
    if (p2 > 0) ctx.fillRect(n2.x, n2.y + n2.h - 2, Math.round(n2.w * p2), 2);
    /* D-103 清账：省掉 save/restore，显式复位本函数改过的排版状态 */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return { x: x, y: top, w: w, h: h, roundText: '第 ' + roundNo + ' 回合', nodes: [n1, n2], progress: [p1, p2] };
  }

  /* D-102：龙威播报行——终局机制必须看得见（横置以前完全不画日志）。
   * 只读 Battle.dragonDread()，不再写第二份分段常量。 */
  function dreadBroadcast() {
    var B = Game.Systems && Game.Systems.Battle;
    var dd = (B && typeof B.dragonDread === 'function') ? B.dragonDread() : null;
    if (!dd || dd.tier <= 0) return null;
    return '龙威 第 ' + dd.tier + ' 段 · 攻击 +' + dd.bonus;
  }

  /* 战报行（自上而下）：龙威播报固定在第一行，其后是从新到旧截取的最近日志。
   * 返回最多 max 行；max=1 时横置取“龙威优先，否则最新一条”。 */
  function battleLogLines(state, max) {
    var out = [];
    var br = dreadBroadcast();
    if (br) out.push(br);
    var log = (state && state.log) || [];
    var picked = [];
    for (var i = log.length - 1; i >= 0 && picked.length < Math.max(0, max - out.length); i--) {
      var s = String(log[i] == null ? '' : log[i]);
      if (br && s.indexOf('系统：龙威') === 0) continue;
      picked.unshift(s);
    }
    return out.concat(picked);
  }

  /* D-102：每帧状态 chip（旧版只画在纵置中段）。保留函数名给旧验证页调用，
   * 现在按归属分流到两侧身份卡。 */
  function battleChips(ctx, cx, y, state) {
    var list = cardChips('player', state);
    if (!list.length) return [];
    return drawCardChips(ctx, Math.round(cx - 60), Math.round(y), 120, list);
  }

  /* 第三拨 D-88：战斗背景——五层各自的"空间语义"，不再共用一套骨架。
   * 旧实现（美学整改 A2）五层只是同一套「上砖带 0~192 / 中暗带 192~432 / 下砖带 432~H」
   * 换底色，敌方站台又是全场最亮的一块，F2 棕甲融土黄、F3 红鳞融红、F5 暗红融暗紫。
   * 现在每一层由四件事共同定义，任意两层不能只换颜色：
   *   1) 地平线高度（站台前沿）：176 / 168 / 184 / 164 / 192，五层互不相同；
   *   2) 地标剪影：石厅拱门 / 营地木栅栏+帐篷 / 裂谷崖壁+熔岩裂口 / 墓穴立柱+棺台 / 王座前厅尖拱+王座；
   *   3) 光源位置：火把 / 篝火 / 熔岩 / 冷烛 / 火盆，一律只落中下带两侧，绝不进敌方站台带；
   *   4) 地面材质：湿石板 / 踩实泥地 / 冷却黑曜石 / 霜石阶 / 黑曜石金脉，压暗量与色温各不相同。
   * 硬约束（verify_d88 A 段逐像素裁决）：
   *   - 背景最亮像素必须在中下带（y≥192）的两侧（x<0.30W 或 x>0.70W），
   *     敌方站台带（y<192）最亮像素的亮度必须比它低 60 以上——怪站在更暗更冷的地面上；
   *   - 五层像素签名两两不同；
   *   - 仍然是离屏一次构建 + 每帧 1 次 blit，不新增每帧 drawImage，不碰任何数值与战斗时钟。 */
  var BATTLE_SCENE = [
    { key: 'stonehall', label: 'F1 石厅', horizon: 176 },
    { key: 'camp', label: 'F2 兽人营地', horizon: 168 },
    { key: 'rift', label: 'F3 熔岩裂谷', horizon: 184 },
    { key: 'crypt', label: 'F4 冰霜墓穴', horizon: 164 },
    { key: 'throne', label: 'F5 深渊王座前厅', horizon: 192 }
  ];
  var bgCache = { cv: null, ctx: null, floor: 0, W: 0, H: 0, k: 0, tile: -1 };

  /* ── 背景绘制小工具（全部逻辑坐标、整数落点）────────────────── */
  function bgRect(c, x, y, w, h, col) {
    c.fillStyle = col;
    c.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }
  function bgPoly(c, pts, col) {
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    c.fill();
  }
  function bgLine(c, x1, y1, x2, y2, col, w) {
    c.strokeStyle = col;
    c.lineWidth = w || 1;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }
  function bgRgba(rgb, a) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (Math.round(a * 100) / 100) + ')';
  }
  function bgGlow(c, x, y, r, rgb, a) {
    var g = c.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    g.addColorStop(0, bgRgba(rgb, a));
    g.addColorStop(0.45, bgRgba(rgb, a * 0.45));
    g.addColorStop(1, bgRgba(rgb, 0));
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function bgTiles(c, f, y0, rows, cols, tint) {
    var S = Game.Core.Sprites;
    for (var ty = 0; ty < rows; ty++) {
      for (var tx = 0; tx < cols; tx++) {
        var t = S.get(floorVariantName(tx, Math.round(y0 / TILE) + ty, f));
        if (t) c.drawImage(t, tx * TILE, y0 + ty * TILE, TILE, TILE);
      }
    }
    if (tint) bgRect(c, 0, y0, cols * TILE, rows * TILE, tint);
  }
  /* 多层火焰（外焰三瓣/内焰/焰心/火星），纯色多边形——像素风不引入渐变噪声 */
  function bgFlame(c, x, y, s, warm) {    var o = warm === false
      ? { out: '#ff5a3a', mid: '#ff9a6a', core: '#ffd6b0' }
      : { out: '#ff7a1e', mid: '#ffb347', core: '#ffd98a' };
    bgGlow(c, x, y - 26 * s, 92 * s, warm === false ? [255, 90, 60] : [255, 150, 60], 0.30);
    bgPoly(c, [[x, y - 54 * s], [x + 13 * s, y - 14 * s], [x + 4 * s, y], [x - 16 * s, y - 9 * s]], o.out);
    bgPoly(c, [[x, y - 44 * s], [x + 18 * s, y - 11 * s], [x + 6 * s, y]], o.out);
    bgPoly(c, [[x, y - 40 * s], [x - 12 * s, y - 9 * s], [x - 3 * s, y]], o.out);
    bgPoly(c, [[x, y - 34 * s], [x + 9 * s, y - 9 * s], [x, y - 2 * s], [x - 9 * s, y - 9 * s]], o.mid);
    bgPoly(c, [[x, y - 22 * s], [x + 5 * s, y - 8 * s], [x, y - 2 * s], [x - 5 * s, y - 8 * s]], o.core);
    for (var i = 0; i < 4; i++) {
      bgRect(c, x + (((i * 7) % 11) - 5) * s, y - (34 + i * 8) * s, 2 * s, 2 * s, o.core);
    }
  }
  /* D-89：构件落地——地面接触暗面 + 一层比地砖略亮的石座。
   * 用于所有立地火把/篝火/火盆：先有 shadow，再画座，最后才是杆与焰。
   * 这是"贴纸"与"房间里的东西"的分界：构件底部必须有一块属于地面的暗面。 */
  function bgContact(c, x, groundY, rx, ry) {
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.beginPath();
    c.ellipse(x, groundY, Math.max(4, rx), Math.max(2, ry), 0, 0, Math.PI * 2);
    c.fill();
  }

  /* D-94 P7.6：立地构件的落地处理（画在构件之后）。
   * 四件事一起做，缺一件都会读回"剪纸"：
   *   1) 底缘 12px 垂直压暗——深色不再直接切在亮地上；
   *   2) 接地影——椭圆落在构件两侧的地面上，左重右轻，避免贴纸式对称；
   *   3) 底缘断口——两三块 2–4px 暗块把整条直线打断；
   *   4) 落到地面的暗斑——越过底缘，底边不再是一条笔直的硬边。
   * 只作用于构件自身宽度，不铺满全宽，避免把地板压暗。 */
  function hPropFoot(c, cx, baseY, w, dark) {
    var half = Math.max(6, Math.round(w / 2));
    var x0 = Math.round(cx - half), ww = half * 2;
    var d = (typeof dark === 'number') ? dark : 0.55;
    var gd = c.createLinearGradient(0, baseY - 12, 0, baseY);
    gd.addColorStop(0, 'rgba(0,0,0,0)');
    gd.addColorStop(1, 'rgba(0,0,0,' + d + ')');
    c.fillStyle = gd;
    c.fillRect(x0, baseY - 12, ww, 12);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.beginPath();
    c.ellipse(cx + Math.round(ww * 0.10), baseY + 2, Math.round(ww * 0.60), 4, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(0,0,0,' + Math.min(0.7, d + 0.12) + ')';
    c.fillRect(x0 + Math.round(ww * 0.10), baseY - 3, Math.round(ww * 0.20), 3);
    c.fillRect(x0 + Math.round(ww * 0.56), baseY - 2, Math.round(ww * 0.24), 2);
    /* 越过底缘、落到地面上的两小块暗斑：底边不能再是一条笔直的硬边 */
    c.fillStyle = 'rgba(0,0,0,' + Math.min(0.6, d + 0.02) + ')';
    c.fillRect(x0 + Math.round(ww * 0.14), baseY, Math.round(ww * 0.13), 3);
    c.fillRect(x0 + Math.round(ww * 0.58), baseY, Math.round(ww * 0.17), 2);
  }

  /* F1 石厅：错缝石砌后墙 + 居中拱门（敌人站在黑洞前）+ 两侧壁挂火把 + 湿石板地面 */
  function bgStoneHall(c, W, H, sc, cols, canTile) {
    var CX = W / 2, hor = sc.horizon;
    var bw = 48, bh = 22;
    for (var y = 0, row = 0; y < hor; y += bh, row++) {
      var off = (row % 2) ? -bw / 2 : 0;
      for (var x = off; x < W + bw; x += bw) {
        var k = (Math.floor(x / bw) + row * 2) % 3;
        if (k < 0) k += 3;
        bgRect(c, x + 1, y + 1, bw - 2, bh - 2, k === 0 ? '#141422' : (k === 1 ? '#111119' : '#171726'));
      }
    }
    /* 拱门：外圈石线 + 纯黑洞（怪物的剪影落在洞里，最暗处就在脚后） */
    var ri = Math.max(56, Math.min(96, W * 0.10));
    var springY = hor - 64;
    c.strokeStyle = '#232333';
    c.lineWidth = 14;
    c.beginPath();
    c.arc(CX, springY, ri + 7, Math.PI, 0);
    c.stroke();
    bgRect(c, CX - ri - 14, springY, 14, hor - springY, '#232333');
    bgRect(c, CX + ri, springY, 14, hor - springY, '#232333');
    bgRect(c, CX - 12, springY - ri - 12, 24, 20, '#2a2a3d');
    c.fillStyle = '#04040a';
    c.beginPath();
    c.moveTo(CX - ri, hor);
    c.lineTo(CX - ri, springY);
    c.arc(CX, springY, ri, Math.PI, 0);
    c.lineTo(CX + ri, hor);
    c.closePath();
    c.fill();
    /* 站台：一行湿石板，压到最暗（脚下不许比任何光源亮） */
    if (canTile) bgTiles(c, 1, hor, Math.ceil((192 - hor) / TILE), cols, 'rgba(4,5,13,0.78)');
    else bgRect(c, 0, hor, W, 192 - hor, '#0a0a12');
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.beginPath();
    c.ellipse(CX, hor + 10, ri * 0.92, 9, 0, 0, Math.PI * 2);
    c.fill();
    /* 中带：舞台暗部 + 两侧石壁收边 */
    bgRect(c, 0, 192, W, 240, '#08080f');
    bgRect(c, 0, 192, Math.max(20, W * 0.05), 240, '#0b0b13');
    bgRect(c, W - Math.max(20, W * 0.05), 192, Math.max(20, W * 0.05), 240, '#0b0b13');
    /* D-89：先铺下带地面，再画立地火把——杆与石座必须压在地面上，不能被地面覆盖 */
    if (canTile) bgTiles(c, 1, 432, Math.ceil((H - 432) / TILE), cols, 'rgba(6,8,18,0.70)');
    else bgRect(c, 0, 432, W, H - 432, '#07070e');
    /* 立地火把：光源仍只在中带两侧；杆从壁架一路落到地面 432，脚下一块石座 + 接触暗面 */
    var tx = [Math.round(W * 0.16), Math.round(W * 0.84)];
    for (var ti = 0; ti < tx.length; ti++) {
      var px = tx[ti];
      bgContact(c, px, 432, 22, 6);
      bgRect(c, px - 16, 422, 32, 10, '#16141d');
      bgRect(c, px - 13, 424, 26, 6, '#1f1d28');
      bgRect(c, px - 13, 304, 26, 9, '#2a2119');
      bgRect(c, px - 6, 313, 12, 7, '#241a12');
      bgRect(c, px - 2, 320, 4, 104, '#241a12');
      bgRect(c, px - 8, 360, 16, 5, '#2c2118');
      bgRect(c, px + 1, 324, 1, 96, 'rgba(255,200,140,0.18)');
      bgFlame(c, px, 306, 1, true);
    }
    /* 下带：湿石板 + 火把在地上的两摊暖反光（在 432 以下，不碰站台） */
    for (var ri2 = 0; ri2 < tx.length; ri2++) {
      c.fillStyle = 'rgba(255,160,80,0.07)';
      c.beginPath();
      c.ellipse(tx[ri2], 446, 52, 10, 0, 0, Math.PI * 2);
      c.fill();
    }
    bgRect(c, 0, hor - 5, W, 5, '#191928');
  }

  /* F2 营地：尖头木栅栏 + 右上帐篷布 + 左侧篝火 + 右后木箱，地面是踩实的冷泥地 */
  function bgOrcCamp(c, W, H, sc, cols, canTile) {
    var hor = sc.horizon;
    bgRect(c, 0, hor - 62, W, 3, '#241a11');
    var step = Math.max(16, Math.round(20));
    for (var x = -6, i = 0; x < W + step; x += step, i++) {
      var hgt = 94 + ((i * 53) % 4) * 10;
      var top = hor - hgt;
      bgRect(c, x, top + 10, 14, hgt - 10, (i % 2) ? '#221a12' : '#1a130d');
      bgPoly(c, [[x, top + 12], [x + 7, top], [x + 14, top + 12]], (i % 2) ? '#2a2016' : '#211a11');
      bgRect(c, x + 2, top + 12, 2, hgt - 14, 'rgba(255,220,170,0.035)');
    }
    /* 帐篷布：右上斜挂一整片 + 左上一角 */
    bgPoly(c, [[W, 0], [W, 104], [W - 176, 0]], '#2f2116');
    bgPoly(c, [[W, 0], [W, 58], [W - 96, 0]], '#3a2a1b');
    bgPoly(c, [[0, 0], [92, 0], [0, 78]], '#291d14');
    /* 站台：踩实的泥地（冷、暗），只留极淡的草屑纹理 */
    bgRect(c, 0, hor, W, 192 - hor, '#14110c');
    for (var sx = 10; sx < W; sx += 52) bgRect(c, sx, hor + 9, 20, 2, 'rgba(70,58,38,0.26)');
    bgRect(c, 0, 192, W, 240, '#0a0806');
    /* D-89：先铺下带泥地，再放木箱与篝火——所有立地物件都站在 432 的地面上 */
    if (canTile) bgTiles(c, 2, 432, Math.ceil((H - 432) / TILE), cols, 'rgba(10,8,6,0.74)');
    else bgRect(c, 0, 432, W, H - 432, '#080705');
    for (var gx = 26; gx < W; gx += 74) {
      bgLine(c, gx, H - 14, gx + 5, H - 22, '#232a1a', 2);
      bgLine(c, gx + 5, H - 22, gx + 9, H - 14, '#232a1a', 2);
    }
    /* 右后木箱堆：箱底落到 432，脚下有暗面（旧版箱底悬在 392） */
    var bx = W - Math.max(78, W * 0.09);
    bgContact(c, bx + 32, 432, 40, 6);
    bgRect(c, bx, 376, 64, 56, '#221910');
    bgRect(c, bx + 3, 379, 58, 50, '#2a2014');
    bgRect(c, bx + 3, 400, 58, 3, '#150f09');
    bgRect(c, bx + 30, 379, 3, 50, '#150f09');
    /* 篝火：全场最亮，落在左侧地面（y=476，旧版悬在中带 372）；石圈 + 交叉木柴 + 余烬 */
    var fx = Math.round(W * 0.16), fy = 476;
    bgGlow(c, fx, fy - 8, 118, [255, 140, 50], 0.24);
    for (var si = 0; si < 7; si++) {
      var ang = Math.PI * 2 * si / 7;
      bgRect(c, fx + Math.cos(ang) * 24 - 5, fy + Math.sin(ang) * 8 - 4, 11, 7, si % 2 ? '#22201c' : '#2b2822');
    }
    bgRect(c, fx - 22, fy - 5, 44, 5, '#2a1c10');
    bgRect(c, fx - 16, fy - 9, 32, 4, '#241a10');
    bgRect(c, fx - 20, fy + 1, 8, 3, '#3a2412');
    bgRect(c, fx + 12, fy + 1, 8, 3, '#3a2412');
    bgFlame(c, fx, fy - 4, 1.05, true);
    /* 篝火在地面上的暖反光 */
    c.fillStyle = 'rgba(255,150,60,0.06)';
    c.beginPath();
    c.ellipse(fx, fy + 12, 60, 11, 0, 0, Math.PI * 2);
    c.fill();
    /* D-89：接触暗面画在反光之上，才压得住篝火的光 */
    bgContact(c, fx, fy + 6, 34, 8);
    bgRect(c, 0, hor - 4, W, 4, '#1c160e');
  }

  /* F3 熔岩裂谷：裂口是"地面裂缝"——横向岩浆带只在中带左右两侧的底部，
   * 站台带（敌人脚下）保持冷却黑曜石，一点红也不给。
   * D-89：两池熔岩原比红色沃古尔更亮（峰值 200、亮部 337px），背景压了主体一头。
   * 现在压暗 + 收窄：岩壳变宽、熔岩带变薄、亮心只留断续 2px，光晕 0.22→0.12；
   * 峰值降到 ~180 且亮部面积压到 20px 以内（< 沃古尔自身的 170+ 亮部）。 */
  function bgLavaSeam(c, x0, x1, y) {
    var w = Math.max(40, x1 - x0);
    bgGlow(c, (x0 + x1) / 2, y, Math.max(60, w * 0.60), [255, 120, 40], 0.12);
    /* 上下岩缘（比旧版更厚，压住熔岩的面积） */
    bgPoly(c, [[x0, y - 16], [x1, y - 8], [x1, y - 1], [x0, y - 9]], '#171219');
    bgPoly(c, [[x0, y + 9], [x1, y + 16], [x1, y + 3], [x0, y + 2]], '#171219');
    /* 熔岩带：锯齿边缘（暗橙，不再是高亮橙） */
    bgPoly(c, [
      [x0, y + 5], [x0 + w * 0.20, y - 3], [x0 + w * 0.42, y + 3], [x0 + w * 0.63, y - 4],
      [x0 + w * 0.82, y + 4], [x1, y - 1], [x1, y + 7], [x0 + w * 0.70, y + 9],
      [x0 + w * 0.40, y + 5], [x0, y + 8]
    ], '#8e3c16');
    /* 暗红过渡 */
    bgPoly(c, [
      [x0 + w * 0.08, y + 4], [x0 + w * 0.34, y + 1], [x0 + w * 0.60, y + 4],
      [x0 + w * 0.88, y + 4], [x0 + w * 0.66, y + 7], [x0 + w * 0.30, y + 5]
    ], '#c2551d');
    /* 亮心：只留两段断续 2px（A1 需要 y≥192 有一个 ≥170 的像素，但不允许成片） */
    bgPoly(c, [[x0 + w * 0.20, y + 3], [x0 + w * 0.30, y + 2], [x0 + w * 0.24, y + 4]], '#ffc060');
    bgPoly(c, [[x0 + w * 0.66, y + 3], [x0 + w * 0.76, y + 2], [x0 + w * 0.70, y + 4]], '#ffc060');
    /* 飞出的余烬（压暗，不构成亮部） */
    for (var i = 0; i < 3; i++) {
      bgRect(c, x0 + w * (0.18 + i * 0.24), y - 9 - (i % 2) * 4, 2, 2, '#b8641f');
    }
  }
  /* D-94 P7.6：完整的熔岩池（只在横置 F3 用）。
   * 与 bgLavaSeam 的"细缝"不同：池形有外轮廓、有由内向外衰减的热光、有落在周围地板上的反光，
   * 白热核心在池心而不是画框边缘；池体左右各留 ≥2%W 边距，不会被画面切掉。
   * cx/cy = 池心，hw/hh = 半宽/半高（像素）。 */
  function bgLavaPool(c, cx, cy, hw, hh) {
    var i, a;
    /* 1) 落在周围地板上的热反光（先画，池沿压在上面） */
    c.fillStyle = 'rgba(255,120,50,0.10)';
    c.beginPath();
    c.ellipse(cx, cy + Math.round(hh * 0.55), Math.round(hw * 1.32), Math.round(hh * 1.45), 0, 0, Math.PI * 2);
    c.fill();
    /* 2) 由内向外衰减的热光：大圈橙 + 小圈暖黄 */
    bgGlow(c, cx, cy, Math.round(hw * 1.60), [255, 130, 50], 0.30);
    bgGlow(c, cx, cy, Math.round(hw * 0.78), [255, 198, 108], 0.24);
    /* 3) 岩壳：不规则外轮廓（比池体大 6–8px），把池从地板上"挖"出来 */
    var rim = [], rimR = [1.00, 0.90, 1.06, 0.93, 0.88, 1.04, 0.91, 1.07, 0.94, 1.02, 0.89, 1.05];
    for (i = 0; i < 12; i++) {
      a = Math.PI * 2 * i / 12;
      rim.push([cx + Math.cos(a) * (hw + 7) * rimR[i], cy + Math.sin(a) * (hh + 6) * rimR[i]]);
    }
    bgPoly(c, rim, '#171118');
    /* 4) 池体：不规则轮廓 + 径向渐变（白热核心 → 橙 → 暗红） */
    var pool = [], poolR = [1.00, 0.94, 1.03, 0.91, 0.97, 1.02, 0.90, 1.04, 0.95, 1.00, 0.92, 1.01];
    for (i = 0; i < 12; i++) {
      a = Math.PI * 2 * i / 12;
      pool.push([cx + Math.cos(a) * hw * poolR[i], cy + Math.sin(a) * hh * poolR[i]]);
    }
    c.save();
    c.beginPath();
    c.moveTo(pool[0][0], pool[0][1]);
    for (i = 1; i < pool.length; i++) c.lineTo(pool[i][0], pool[i][1]);
    c.closePath();
    c.clip();
    var lg = c.createRadialGradient(cx, cy, 1, cx, cy, Math.max(10, hw * 0.92));
    lg.addColorStop(0, '#fff6dc');
    lg.addColorStop(0.16, '#ffd27a');
    lg.addColorStop(0.42, '#ff8a2e');
    lg.addColorStop(0.74, '#b83a12');
    lg.addColorStop(1, '#4a1608');
    c.fillStyle = lg;
    c.fillRect(cx - hw - 8, cy - hh - 8, hw * 2 + 16, hh * 2 + 16);
    c.restore();
    /* 5) 白热核心：池心 10×4，不贴画框 */
    bgRect(c, Math.round(cx - 5), Math.round(cy - 2), 10, 4, '#fff6e2');
    bgRect(c, Math.round(cx - 2), Math.round(cy - 1), 4, 2, '#ffffff');
    /* 6) 火星：收在池心上方 ±0.32hw 内，不飞到 x>0.12W 的光源极值区之外 */
    for (i = 0; i < 4; i++) {
      bgRect(c, Math.round(cx - hw * 0.34 + i * hw * 0.22),
        Math.round(cy - hh - 9 - (i % 2) * 5), 2, 2, '#ffcf7a');
    }
  }
  function bgLavaRift(c, W, H, sc, cols, canTile) {
    var hor = sc.horizon, CX = W / 2;
    var lx = Math.round(W * 0.34), rx = Math.round(W * 0.66);
    bgPoly(c, [[0, 0], [lx, 0], [lx - Math.round(W * 0.06), hor - 34], [lx - Math.round(W * 0.01), hor], [0, hor]], '#100d13');
    bgPoly(c, [[W, 0], [rx, 0], [rx + Math.round(W * 0.06), hor - 34], [rx + Math.round(W * 0.01), hor], [W, hor]], '#100d13');
    bgLine(c, lx - Math.round(W * 0.06), hor - 34, lx - Math.round(W * 0.01), hor, 'rgba(96,86,124,0.30)', 2);
    bgLine(c, rx + Math.round(W * 0.06), hor - 34, rx + Math.round(W * 0.01), hor, 'rgba(96,86,124,0.30)', 2);
    /* 两侧崖壁上的竖向断层（暗） */
    for (var i = 0; i < 4; i++) {
      var yy = 24 + i * 34;
      bgLine(c, 6, yy, lx - Math.round(W * 0.09), yy + 18, 'rgba(0,0,0,0.55)', 3);
      bgLine(c, W - 6, yy + 8, rx + Math.round(W * 0.09), yy + 26, 'rgba(0,0,0,0.55)', 3);
    }
    /* 站台：冷却黑曜石（冷、无红） */
    bgRect(c, 0, hor, W, 192 - hor, '#0b0a0f');
    for (var ci = 20; ci < W; ci += 64) bgLine(c, ci, hor + 3, ci + 12, 190, 'rgba(70,80,110,0.16)', 1);
    bgRect(c, 0, 192, W, 240, '#07060a');
    /* 熔岩裂口：中带左右两侧的底部横向裂缝（离玩家血条两端留足距离） */
    bgLavaSeam(c, 0, Math.round(W * 0.16), 414);
    bgLavaSeam(c, W - Math.round(W * 0.16), W, 414);
    /* 飘灰（确定性点阵） */
    for (var ai = 0; ai < 26; ai++) {
      var ax = (ai * 137 + 40) % Math.max(1, W);
      var ay = 200 + (ai * 73) % 220;
      bgRect(c, ax, ay, 2, 2, 'rgba(180,140,120,0.10)');
    }
    /* 下带：玄武岩地砖 + 底缘余烬线 */
    if (canTile) bgTiles(c, 3, 432, Math.ceil((H - 432) / TILE), cols, 'rgba(9,10,18,0.82)');
    else bgRect(c, 0, 432, W, H - 432, '#07070c');
    bgLine(c, 0, H - 3, Math.round(W * 0.18), H - 3, 'rgba(255,110,40,0.45)', 2);
    bgLine(c, W - Math.round(W * 0.18), H - 3, W, H - 3, 'rgba(255,110,40,0.45)', 2);
    bgRect(c, 0, hor - 5, W, 5, '#141119');
  }

  /* F4 冰霜墓穴：冰石后墙 + 两侧立柱 + 居中棺台 + 冷白烛火（烛火只落在下带两侧） */
  function bgFrostCrypt(c, W, H, sc, cols, canTile) {
    var hor = sc.horizon, CX = W / 2;
    var bw = 56, bh = 26;
    for (var y = 0, row = 0; y < hor; y += bh, row++) {
      var off = (row % 2) ? -bw / 2 : 0;
      for (var x = off; x < W + bw; x += bw) {
        var k = (Math.floor(x / bw) + row) % 2;
        bgRect(c, x + 1, y + 1, bw - 2, bh - 2, (k < 0 ? k + 2 : k) ? '#101d26' : '#0d1820');
      }
    }
    /* 三个尖拱壁龛（暗） */
    for (var ni = -1; ni <= 1; ni++) {
      var nx = CX + ni * Math.min(220, W * 0.22);
      bgPoly(c, [[nx - 34, hor - 22], [nx - 34, 66], [nx, 38], [nx + 34, 66], [nx + 34, hor - 22]], '#060e14');
      bgLine(c, nx - 34, hor - 22, nx - 34, 66, 'rgba(90,130,150,0.22)', 2);
      bgLine(c, nx - 34, 66, nx, 38, 'rgba(90,130,150,0.22)', 2);
      bgLine(c, nx, 38, nx + 34, 66, 'rgba(90,130,150,0.22)', 2);
      bgLine(c, nx + 34, 66, nx + 34, hor - 22, 'rgba(90,130,150,0.22)', 2);
    }
    /* 立柱：冷灰石，棱线略亮但远低于任何光源；柱脚有落地暗面 */
    var pillars = [Math.round(W * 0.18), Math.round(W * 0.82)];
    for (var pi = 0; pi < pillars.length; pi++) {
      var px = pillars[pi];
      bgContact(c, px, hor + 18, 34, 6);
      bgRect(c, px - 22, 54, 44, hor - 54 + 20, '#1c2b36');
      bgRect(c, px - 22, 54, 5, hor - 54 + 20, '#2b4050');
      bgRect(c, px - 28, 48, 56, 12, '#243744');
      bgRect(c, px - 28, hor + 8, 56, 10, '#22323d');
    }
    /* 站台：石阶 + 居中棺台（低矮、暗） */
    bgRect(c, 0, hor, W, 192 - hor, '#0d1720');
    bgRect(c, 0, hor, W, 8, '#16242e');
    bgRect(c, 0, hor + 8, W, 3, '#1c2c37');
    bgRect(c, CX - 150, hor - 18, 300, 20, '#1b2a35');
    bgRect(c, CX - 150, hor - 18, 300, 4, '#2b3f4d');
    bgRect(c, CX - 128, hor - 12, 256, 3, '#0e1a22');
    bgRect(c, CX - 96, hor - 6, 192, 3, '#0e1a22');
    bgRect(c, 0, 192, W, 240, '#070d12');
    /* 霜雾：只贴中带下缘，压得很低 */
    c.fillStyle = 'rgba(140,200,230,0.045)';
    c.beginPath();
    c.ellipse(W * 0.22, 408, W * 0.24, 22, 0, 0, Math.PI * 2);
    c.ellipse(W * 0.78, 412, W * 0.24, 20, 0, 0, Math.PI * 2);
    c.fill();
    /* 冷白烛台：下带两侧，是全场最亮（画在地砖之后，否则会被下带覆盖） */
    var cx2 = [Math.round(W * 0.14), Math.round(W * 0.86)];
    var cy2 = Math.min(H - 44, 470);
    /* 下带：霜石地砖 + 冰裂纹 */
    if (canTile) bgTiles(c, 4, 432, Math.ceil((H - 432) / TILE), cols, 'rgba(10,24,36,0.80)');
    else bgRect(c, 0, 432, W, H - 432, '#060d14');
    for (var ci = 0; ci < cx2.length; ci++) {
      bgRect(c, cx2[ci] - 2, cy2, 4, 34, '#26343e');
      bgRect(c, cx2[ci] - 9, cy2 + 32, 18, 5, '#2e3f4b');
      bgRect(c, cx2[ci] - 7, cy2 - 2, 14, 4, '#33454f');
      bgGlow(c, cx2[ci], cy2 - 8, 74, [190, 235, 255], 0.38);
      bgPoly(c, [[cx2[ci], cy2 - 24], [cx2[ci] + 6, cy2 - 4], [cx2[ci] - 6, cy2 - 4]], '#bfe8ff');
      bgPoly(c, [[cx2[ci], cy2 - 15], [cx2[ci] + 3, cy2 - 4], [cx2[ci] - 3, cy2 - 4]], '#f2ffff');
      bgRect(c, cx2[ci] - 1, cy2 - 12, 3, 4, '#ffffff');
      /* D-89：接触暗面压在烛光之后，烛台脚下才有"落地"的暗面 */
      bgContact(c, cx2[ci], cy2 + 36, 15, 5);
    }
    for (var ci2 = 0; ci2 < 7; ci2++) {
      var sx = (ci2 * 151 + 60) % Math.max(1, W);
      bgLine(c, sx, 452 + (ci2 % 3) * 26, sx + 34, 470 + (ci2 % 3) * 26, 'rgba(120,180,210,0.18)', 1);
    }
    /* 顶部冰凌：暗青、低透明，不构成亮点 */
    for (var ii = 0; ii < 9; ii++) {
      var ix = (ii * 149 + 30) % Math.max(1, W);
      var ih = 10 + (ii * 7) % 16;
      bgPoly(c, [[ix, 0], [ix + 6, 0], [ix + 3, ih]], 'rgba(150,210,235,0.28)');
    }
  }

  /* F5 深渊王座前厅：双尖拱 + 居中王座与台阶 + 两侧火盆（最亮）+ 黑曜石金脉地面 */
  function bgGothicArch(c, cx, baseY, w, h, rim, fill, deep) {
    var top = baseY - h;
    var pts = [[cx - w / 2, baseY], [cx - w / 2, top + 28], [cx, top], [cx + w / 2, top + 28], [cx + w / 2, baseY]];
    var fs = fill;
    /* D-94 P7.6：deep 给出"龛底返光"色——洞口不再是一整块纯黑，下半段渐亮到龛内地面，
     * 上段保持暗，读成"有深度的门洞/壁龛"而不是贴在墙上的黑片。 */
    if (deep) {
      var dg = c.createLinearGradient(0, top, 0, baseY);
      dg.addColorStop(0, fill);
      dg.addColorStop(0.60, fill);
      dg.addColorStop(1, deep);
      fs = dg;
    }
    bgPoly(c, pts, fs);
    bgLine(c, cx - w / 2, baseY, cx - w / 2, top + 28, rim, 2);
    bgLine(c, cx - w / 2, top + 28, cx, top, rim, 2);
    bgLine(c, cx, top, cx + w / 2, top + 28, rim, 2);
    bgLine(c, cx + w / 2, top + 28, cx + w / 2, baseY, rim, 2);
    /* 龛内：一道"后墙脚线" + 10px 龛内地面 + 两侧内缘返光——
     * 有地面、有墙角，才读成"可以走进去的门洞/壁龛"，而不是贴在墙上的一块黑。 */
    if (deep) {
      bgRect(c, cx - w / 2 + 2, Math.round(baseY - h * 0.40), w - 4, 1, 'rgba(190,196,235,0.05)');
      bgRect(c, cx - w / 2 + 2, baseY - 10, w - 4, 10, deep);
      bgRect(c, cx - w / 2 + 2, baseY - 10, w - 4, 1, 'rgba(210,214,240,0.10)');
      bgRect(c, cx - w / 2 + 2, baseY - 10, 1, 10, 'rgba(190,196,235,0.08)');
      bgRect(c, cx + w / 2 - 3, baseY - 10, 1, 10, 'rgba(190,196,235,0.08)');
    }
  }
  function bgThroneHall(c, W, H, sc, cols, canTile) {
    var hor = sc.horizon, CX = W / 2;
    bgGothicArch(c, CX - Math.min(240, W * 0.24), hor, 120, 168, '#2a1938', '#120c1a');
    bgGothicArch(c, CX + Math.min(240, W * 0.24), hor, 120, 168, '#2a1938', '#120c1a');
    /* 王座：高背 + 双尖塔，尖塔高过龙翼——主体挡住椅面时"王座厅"仍读得出 */
    bgRect(c, CX - 40, 18, 80, 150, '#170e22');
    bgPoly(c, [[CX - 40, 18], [CX - 58, 18], [CX - 40, 54]], '#211430');
    bgPoly(c, [[CX + 40, 18], [CX + 58, 18], [CX + 40, 54]], '#211430');
    bgPoly(c, [[CX - 40, 18], [CX, 2], [CX + 40, 18]], '#24163a');
    bgRect(c, CX - 40, 18, 4, 150, '#3a2448');
    bgRect(c, CX + 36, 18, 4, 150, '#3a2448');
    bgRect(c, CX - 30, 22, 60, 4, '#4b2f5e');
    bgRect(c, CX - 48, 128, 96, 14, '#221530');
    bgRect(c, CX - 56, 142, 112, 26, '#160e20');
    bgRect(c, CX - 18, 40, 36, 8, '#3a2448');
    /* 两侧垂落的暗红旗帜，把王座框在中间 */
    var banX = [CX - Math.min(300, Math.round(W * 0.30)), CX + Math.min(300, Math.round(W * 0.30))];
    for (var bi2 = 0; bi2 < banX.length; bi2++) {
      var bx2 = banX[bi2];
      bgRect(c, bx2 - 14, 26, 28, 100, '#2a0f16');
      bgPoly(c, [[bx2 - 14, 126], [bx2 + 14, 126], [bx2, 146]], '#2a0f16');
      bgRect(c, bx2 - 12, 26, 2, 96, '#57212c');
      bgRect(c, bx2 + 10, 26, 2, 96, '#57212c');
      bgPoly(c, [[bx2, 54], [bx2 + 7, 64], [bx2, 74], [bx2 - 7, 64]], '#6b2a36');
    }
    /* 王座台座前沿（站台带内，暗金线是站台上唯一的高光，仍远低于火盆） */
    bgRect(c, CX - 130, 168, 260, 24, '#140d1c');
    bgRect(c, CX - 130, 168, 260, 3, '#2a1938');
    bgRect(c, CX - 150, 184, 300, 8, '#0f0a16');
    /* 站台：黑曜石，horizon 192 时只剩脚下一条暗沿 */
    bgRect(c, 0, hor, W, 192 - hor, '#0a0710');
    bgRect(c, 0, 192, W, 240, '#080510');
    /* 王座台阶：只在中带上半、中心 ±170，止于 236（不压 y240 的信息带） */
    for (var st = 0; st < 3; st++) {
      var sw = 340 - st * 56;
      bgRect(c, CX - sw / 2, 192 + st * 15, sw, 15, st % 2 ? '#140e1c' : '#181020');
      bgRect(c, CX - sw / 2, 192 + st * 15, sw, 3, '#2a1a38');
    }
    /* 中带两侧黑曜石柱 */
    bgRect(c, 0, 192, Math.max(28, W * 0.045), 240, '#0c0714');
    bgRect(c, W - Math.max(28, W * 0.045), 192, Math.max(28, W * 0.045), 240, '#0c0714');
    bgLine(c, Math.max(28, W * 0.045), 192, Math.max(28, W * 0.045), 432, 'rgba(90,60,120,0.22)', 2);
    bgLine(c, W - Math.max(28, W * 0.045), 192, W - Math.max(28, W * 0.045), 432, 'rgba(90,60,120,0.22)', 2);
    /* D-89：先铺下带地面，再画火盆——杆必须落到 432 的地面上 */
    if (canTile) bgTiles(c, 5, 432, Math.ceil((H - 432) / TILE), cols, 'rgba(14,8,24,0.78)');
    else bgRect(c, 0, 432, W, H - 432, '#09050f');
    for (var gi = 0; gi < 8; gi++) {
      var gx = (gi * 173 + 40) % Math.max(1, W);
      bgLine(c, gx, 440 + (gi % 2) * 30, gx + 58, 452 + (gi % 2) * 30, 'rgba(120,90,46,0.35)', 1);
    }
    /* 两侧立地火盆：冷红，全场最亮；杆从 330 落到 432，脚下石座 + 暗面 */
    var bs = [Math.round(W * 0.16), Math.round(W * 0.84)];
    for (var bi = 0; bi < bs.length; bi++) {
      var bx = bs[bi];
      bgContact(c, bx, 432, 24, 6);
      bgRect(c, bx - 18, 422, 36, 10, '#140f1c');
      bgRect(c, bx - 14, 424, 28, 6, '#1c1626');
      bgRect(c, bx - 2, 330, 4, 94, '#241a2c');
      bgRect(c, bx + 1, 332, 1, 88, 'rgba(220,160,120,0.16)');
      bgRect(c, bx - 15, 322, 30, 9, '#2a1f33');
      bgFlame(c, bx, 318, 1.1, false);
    }
    bgRect(c, 0, hor - 4, W, 4, '#2a1938');
  }

  var BG_PAINTERS = [bgStoneHall, bgOrcCamp, bgLavaRift, bgFrostCrypt, bgThroneHall];

  /* ── D-94：战斗布局双轨（纵置 = 现行玩家路径 / 横置 = 站位与朝向门试装） ────────
   * 设计网格以 BASE_W/H = 960×540 为基准，全部用比例式：
   *   玩家 x=0.24W、敌人 x=0.76W、双方同一地平线 y=0.766H。
   * 1024×640（1280×800 窗口 scale=1.25 的逻辑视口）由同一比例式得出 246/778/490；
   * 960×540 得 230/730/414 —— 两档都不写死，断言按各自实数取。
   * D-94 P7：默认改成 'horizontal'（横置上线），'vertical' 保留为完整回退路径。
   * 竖屏仍按设计卡 §6.8 回退：W≥720 且 W/H≥1.20 才走横置，320/480 竖屏继续纵置，
   * 否则 320 宽七格指令条会被挤成 36px 一格。'auto' 与 'horizontal' 同一口径。
   * 验证页一律显式 `_setBattleLayout('vertical'|'horizontal')`，不靠默认值。 */
  var BATTLE_LAYOUT = 'horizontal';
  var HORIZONTAL_MIN_W = 720;
  var HORIZONTAL_MIN_RATIO = 1.20;

  function resolveBattleLayout(W, H) {
    if (BATTLE_LAYOUT === 'vertical') return 'vertical';
    var w = (typeof W === 'number' && W > 0) ? W : BASE_W;
    var h = (typeof H === 'number' && H > 0) ? H : BASE_H;
    return (w >= HORIZONTAL_MIN_W && w / h >= HORIZONTAL_MIN_RATIO) ? 'horizontal' : 'vertical';
  }

  /* 横置几何：只由 W/H 比例推出（960×540 → 230/730/414；1024×640 → 246/778/490） */
  function horizontalBattleGeo(W, H) {
    var w = (typeof W === 'number' && W > 0) ? W : BASE_W;
    var h = (typeof H === 'number' && H > 0) ? H : BASE_H;
    return {
      W: w, H: h,
      groundY: Math.round(h * 0.766),
      playerCx: Math.round(w * 0.24),
      enemyCx: Math.round(w * 0.76)
    };
  }

  /* D-102：纵置几何纯函数（渲染 / Battle 锚点回退 / 验证页共用同一份比例式） */
  function verticalBattleGeo(W, H) {
    var w = (typeof W === 'number' && W > 0) ? W : BASE_W;
    var h = (typeof H === 'number' && H > 0) ? H : BASE_H;
    var barH = verticalBarH(w);
    var pg = Math.min(h - barH - 8, Math.round(h * 0.72));
    return { W: w, H: h, barH: barH, playerGround: pg, playerCardTop: pg - 60,
      playerTop: pg - 90, enemyGround: Math.round(h * 0.30), enemyCardTop: 46,
      enemyTopMin: 46 + CARD_H + 8 };
  }

  /* D-109 N1：纵置安全带的输入不再只有"敌人精灵"——管线、战报、属性行、
   * 玩家精灵、敌人精灵（以及仍在画面上的身份卡/指令条）全部参与求并集，
   * 结果卡只能落在并集之外的空白区间里。纯几何，不含卡片尺寸。 */
  function verticalFreeIntervals(W, H, box) {
    var cardW = Math.max(160, Math.min(252, W - 24));
    var cx0 = Math.round((W - cardW) / 2), cx1 = cx0 + cardW;
    function xOverlap(r) {
      var rx = (typeof r.x === 'number') ? r.x : 0;
      var rw = (typeof r.w === 'number') ? r.w : W;
      return rx < cx1 && cx0 < rx + rw;
    }
    var obs = [];
    function add(r) {
      if (!r || !(r.h > 0)) return;
      if (!xOverlap(r)) return;
      obs.push({ y: r.y, b: r.y + r.h });
    }
    add(box.hudBand);
    add(box.monsterPlate);
    add(box.monster);
    add(box.pipeline);
    add(box.log);
    add(box.stat);
    add(box.playerPlate);
    add(box.player);
    if (box.commandBarDrawn !== false) add(box.commandBar);
    obs.sort(function (a, b) { return a.y - b.y; });
    var free = [], cur = 0;
    for (var i = 0; i < obs.length; i++) {
      if (obs[i].y > cur) free.push({ top: cur, bottom: Math.min(H, obs[i].y) });
      if (obs[i].b > cur) cur = obs[i].b;
    }
    if (cur < H) free.push({ top: cur, bottom: H });
    return free.filter(function (f) { return f.bottom - f.top >= 24; });
  }

  /* D-102：战斗「安全带」的唯一来源——Juice 结果卡与验证页都读这里。
   * 横置：身份卡下沿 +6 到地面战报上沿 −6（结果卡不压卡、不压战报、不压指令条）。
   * 纵置：传入本帧实际绘制框时，返回"信息元素并集之外"的空白区间表（free），
   *       top/bottom 仍给出其中最大的一段，供只读 top/bottom 的旧调用方使用；
   *       没有实拍框（纯函数直调）时沿用旧的几何口径，保证 d78/d101 的判据不变。 */
  function battleSafeBand(W, H, layout, box) {
    var lay = layout || resolveBattleLayout(W, H);
    if (lay === 'horizontal') {
      var g = horizontalBattleGeo(W, H);
      var plateTop = Math.min(g.groundY - 90, g.groundY - 144) - 14 - CARD_H;
      return { top: plateTop + CARD_H + 6, bottom: g.groundY + 2 - 6 };
    }
    if (box && box.W === W && box.H === H && box.layout === 'vertical' &&
        box.pipeline && box.log && box.player && box.monster) {
      var free = verticalFreeIntervals(W, H, box);
      if (free.length) {
        var best = free[0];
        for (var fi = 1; fi < free.length; fi++) {
          if (free[fi].bottom - free[fi].top > best.bottom - best.top) best = free[fi];
        }
        return { top: best.top, bottom: best.bottom, free: free };
      }
    }
    var vg2 = verticalBattleGeo(W, H);
    var pg = vg2.playerGround;
    /* 敌方精灵可能是 144 高的龙：竖置下它的脚底最坏到 250（eyBase 160 + 90），
     * 安全带从这条最坏脚底再 +8 起，结果卡就不会压到任何体型的敌人。 */
    var eBottom = Math.max(Math.round(H * 0.30), 250);
    return { top: eBottom + 8, bottom: pg - 60 - 6, free: [] };
  }

  /* ── D-94 P2：横置五层背景（与纵置 painter 并存；纵置 painter 一行不改）────────
   * 纵置五景都以 CX 为轴：拱门/王座/棺台正对敌人，读作"一个敌人站在房间深处"。
   * 横置的中心是两个人的决斗空场，原地标会落在两人之间——既挡特效，又把画面读成
   * "一张背景前面站了两个人"。因此五层按横置重新构图，四条硬规则：
   *   1) 中央不留单点物件：只留空走道 / 远处尽头的暗 / 两侧对称构件；
   *   2) 左右各有重量且不镜像：左帐篷·右木栅、左双柱·右王座……两边都落在地上；
   *   3) 光源仍在两侧：x≤0.12W 或 x≥0.88W、火心 y≥0.594H，最亮不在两人之间；
   *   4) 后墙交界 backWallY 按比例（1024×640 → 420/410/400/430/415），
   *      脚底恒为 0.766H（490/414）；地标避开精灵包围盒（1024 → 201–291 / 706–850）。
   */
  var HORIZONTAL_SCENE = [
    { key: 'stonehall', label: 'F1 石厅', backWall: 0.656 },
    { key: 'camp', label: 'F2 兽人营地', backWall: 0.641 },
    { key: 'rift', label: 'F3 熔岩裂谷', backWall: 0.625 },
    { key: 'crypt', label: 'F4 冰霜墓穴', backWall: 0.672 },
    { key: 'throne', label: 'F5 深渊王座前厅', backWall: 0.648 }
  ];

  function hSceneGeom(W, H, sc) {
    return {
      W: W, H: H,
      bwY: Math.round(H * ((sc && sc.backWall) || 0.65)),
      G: Math.round(H * 0.766)
    };
  }
  /* 中央压暗：没有边缘的径向暗，只给纵深，不构成物件 */
  function hCenterDark(c, W, bwY, cx, rx, a) {
    var cy = bwY - Math.round(bwY * 0.18);
    var g = c.createRadialGradient(cx, cy, W * 0.01, cx, cy, Math.max(40, rx));
    g.addColorStop(0, 'rgba(0,0,0,' + a + ')');
    g.addColorStop(0.65, 'rgba(0,0,0,' + (Math.round(a * 45) / 100) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, bwY);
  }
  function hFloorTiles(c, W, H, bwY, f, cols, canTile, tint, fallback) {
    if (canTile) bgTiles(c, f, bwY, Math.ceil((H - bwY) / TILE), cols, tint);
    else bgRect(c, 0, bwY, W, H - bwY, fallback || '#07070c');
  }
  /* D-94 P7.5：后墙压暗——探索层已定的关系（地板是最亮可走面）在战斗背景沿用。
   * 只压 y<bwY 的后墙与贴墙构件；火把/熔岩/地板都画在这之后，光源与可走面不受影响。
   * 不是把墙压成纯黑：各层 a 按砖面实测亮度取，压后砖面仍看得见砌缝。 */
  function hWallDim(c, W, bwY, a) {
    if (!(a > 0)) return;
    c.fillStyle = 'rgba(0,0,0,' + a + ')';
    c.fillRect(0, 0, W, bwY);
  }
  /* D-111：横置后墙的砌块层。底色先铺砖缝色，再逐块盖砖面；砖面按 3 档色阶 +
   * 逐块确定性偏移取色，让 100×150 的样本里同时有砖缝（暗）与砖面（亮）。
   * 只做"一块砖一个实心矩形"，不引入逐像素噪声；全部发生在离屏构建期，
   * 每帧仍然只有一次背景 blit（调用账不变）。 */
  /* D-111：砖面照度向两侧回落（舞台中央是亮的，转角沉入暗部）。只在砖面上叠加，
   * 拱门/火把/熔岩随后绘制，峰值不受影响；左右各 30% 才起效，中央砖面不被压。 */
  function hWallFalloff(c, W, bwY, a) {
    if (!(a > 0)) return;
    var lg = c.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, 'rgba(0,0,0,' + a + ')');
    lg.addColorStop(0.30, 'rgba(0,0,0,0)');
    lg.addColorStop(0.70, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,' + a + ')');
    c.fillStyle = lg;
    c.fillRect(0, 0, W, bwY);
  }
  function hBrickWall(c, x0, y0, w, hgt, bw, bh, tones, mortar, seed) {
    bgRect(c, x0, y0, w, hgt, mortar);
    var rowN = 0;
    for (var y = y0; y < y0 + hgt; y += bh, rowN++) {
      var off = (rowN % 2) ? -Math.round(bw / 2) : 0;
      var colN = 0;
      for (var x = x0 + off; x < x0 + w; x += bw, colN++) {
        var k = (colN * 3 + rowN * 5 + seed) % tones.length;
        if (k < 0) k += tones.length;
        var ww = Math.min(bw - 2, x0 + w - x - 1);
        var hh = Math.min(bh - 2, y0 + hgt - y - 1);
        if (ww > 0 && hh > 0) bgRect(c, x + 1, y + 1, ww, hh, tones[k]);
      }
    }
  }

  /* F1 石厅：错缝石墙 + 左窄拱/右宽拱（两侧构件）+ 中央只留远端暗 + 湿石板 */
  function hbgStoneHall(c, W, H, sc, cols, canTile) {
    var g = hSceneGeom(W, H, sc), bwY = g.bwY, G = g.G;
    var bw = Math.max(40, Math.round(W * 0.047)), bh = Math.max(18, Math.round(H * 0.034));
    /* D-111：砖面本身要读得出是墙。底色改为砖缝色，砖面用 3 档色阶 + 逐块偏移；
     * 只改砖面，不动拱门/火把/边缘构件，峰值由它们决定、保持不变。 */
    hBrickWall(c, 0, 0, W, bwY, bw, bh,
      ['#121217', '#14141a', '#17171e'], '#0a0a10', 1);
    hWallFalloff(c, W, bwY, 0.23);
    hCenterDark(c, W, bwY, W * 0.5, W * 0.34, 0.18);
    /* 侧拱：左窄右宽，不做镜像 */
    var lx = Math.round(W * 0.155), rx = Math.round(W * 0.885);
    /* P7.6：拱龛加宽压矮（68×269 像石碑），现在宽高比≈1:2.4，读成能走进去的门洞 */
    bgGothicArch(c, lx, bwY, Math.round(W * 0.085), Math.round(H * 0.36), '#232333', '#07070d', '#15151f');
    bgGothicArch(c, rx, bwY, Math.round(W * 0.105), Math.round(H * 0.34), '#232333', '#07070d', '#15151f');
    /* 拱脚石座：构件落到地面上 */
    for (var fi = 0; fi < 2; fi++) {
      var px2 = fi ? rx : lx;
      bgContact(c, px2, bwY + 8, 26, 5);
      bgRect(c, px2 - 22, bwY - 12, 44, 20, '#171722');
      bgRect(c, px2 - 22, bwY - 12, 44, 3, '#242435');
    }
    /* P7.5：墙压 0.28、地板洗到 ≈37（改前 0.72 黑洗 → 20.5，比墙的砖面还暗）
     * D-104：0.28 → 0.08，后墙均值 11.4 → 目标 ≥14（仍是五层里最低照度的大面）。 */
    hWallDim(c, W, bwY, 0.08);
    hFloorTiles(c, W, H, bwY, 1, cols, canTile, 'rgba(22,24,26,0.60)', '#08080f');
    bgRect(c, 0, bwY - 5, W, 5, '#191928');
    /* P7.6：两座拱龛落地——底缘压暗 + 接地影 + 断口（底边不再是一条直线切在亮地上） */
    hPropFoot(c, lx, bwY, Math.round(W * 0.085) + 10, 0.50);
    hPropFoot(c, rx, bwY, Math.round(W * 0.105) + 10, 0.50);
    /* 壁挂火把：两侧极值；火心在下带（y≥0.594H） */
    var tx = [Math.round(W * 0.09), Math.round(W * 0.91)];
    var ty = bwY - Math.round(H * 0.018);
    for (var ti = 0; ti < tx.length; ti++) {
      var px = tx[ti];
      bgRect(c, px - 3, ty - Math.round(H * 0.055), 6, Math.round(H * 0.055), '#241a12');
      bgRect(c, px - 10, ty - 2, 20, 5, '#2a2119');
      bgFlame(c, px, ty, 0.9, true);
      c.fillStyle = 'rgba(255,160,80,0.055)';
      c.beginPath();
      c.ellipse(px, G + Math.round(H * 0.05), Math.round(W * 0.055), Math.round(H * 0.014), 0, 0, Math.PI * 2);
      c.fill();
    }
    /* 湿地反光：只在两侧，中央空场保持暗 */
    c.fillStyle = 'rgba(190,210,255,0.03)';
    c.beginPath();
    c.ellipse(W * 0.21, G + H * 0.045, W * 0.12, H * 0.011, 0, 0, Math.PI * 2);
    c.ellipse(W * 0.79, G + H * 0.045, W * 0.12, H * 0.011, 0, 0, Math.PI * 2);
    c.fill();
    bgRect(c, 0, G + 2, W, Math.max(3, Math.round(H * 0.010)), 'rgba(0,0,0,0.20)');
  }

  /* F2 营地：夜岩后墙 + 左帐篷/右木栅与木箱（不镜像）+ 中央空出的营道 + 踩实泥地 */
  function hbgOrcCamp(c, W, H, sc, cols, canTile) {
    var g = hSceneGeom(W, H, sc), bwY = g.bwY, G = g.G;
    /* D-111：岩壁改成粗砌块（72×40），砖缝暗、块面三档；只改后墙，不动帐篷/栅栏/木箱。 */
    hBrickWall(c, 0, 0, W, bwY, Math.max(48, Math.round(W * 0.07)), Math.max(26, Math.round(H * 0.062)),
      ['#15120b', '#18150c', '#1a180d'], '#080604', 2);
    hWallFalloff(c, W, bwY, 0.26);
    for (var i = 0; i < 22; i++) {
      var wx = (i * 157 + 33) % Math.max(1, W);
      var wy = 14 + (i * 61) % Math.max(24, bwY - 70);
      bgLine(c, wx, wy, wx + Math.round(W * 0.04), wy + Math.round(H * 0.02), 'rgba(62,50,36,0.15)', 2);
    }
    hCenterDark(c, W, bwY, W * 0.5, W * 0.30, 0.14);
    /* 左：帐篷（三角帐面 + 脊线 + 门洞），底边落在地面交界 */
    var tw = Math.round(W * 0.14), apexX = Math.round(tw * 0.55), apexY = Math.round(H * 0.26);
    bgPoly(c, [[0, bwY - 4], [apexX, apexY], [tw, bwY - 4]], '#332518');
    bgPoly(c, [[0, bwY - 4], [apexX, apexY], [Math.round(tw * 0.42), bwY - 4]], '#3f2e1e');
    bgLine(c, apexX, apexY, 0, bwY - 8, 'rgba(96,74,48,0.32)', 2);
    bgLine(c, apexX, apexY, tw, bwY - 8, 'rgba(20,14,9,0.55)', 2);
    bgPoly(c, [[Math.round(tw * 0.40), bwY - 4], [Math.round(tw * 0.62), bwY - 4],
      [Math.round(tw * 0.52), Math.round(H * 0.46)]], '#100b06');
    bgRect(c, 0, bwY - 6, tw, 4, 'rgba(0,0,0,0.35)');
    bgContact(c, Math.round(tw * 0.5), bwY + 6, Math.round(tw * 0.5), 5);
    /* 右：木栅栏（后墙前，横梁把木桩连成一段栅栏） */
    var px0 = Math.round(W * 0.86);
    for (var x2 = px0, j = 0; x2 < W + 18; x2 += 18, j++) {
      var hgt = Math.round(H * (0.19 + (j % 3) * 0.022));
      var top2 = bwY - hgt;
      bgRect(c, x2, top2 + 9, 13, hgt - 9, (j % 2) ? '#2b2116' : '#211911');
      bgPoly(c, [[x2, top2 + 11], [x2 + 6, top2], [x2 + 13, top2 + 11]], (j % 2) ? '#332719' : '#281f14');
    }
    bgRect(c, px0, bwY - Math.round(H * 0.10), W - px0, 4, '#31261a');
    bgContact(c, Math.round(W * 0.93), bwY + 8, Math.round(W * 0.06), 5);
    /* P7.5：营地后墙本就极暗（实测 8.4），只补 0.10 压一层；地板洗到 ≈37 */
    hWallDim(c, W, bwY, 0.10);
    hFloorTiles(c, W, H, bwY, 2, cols, canTile, 'rgba(3,2,2,0.60)', '#080705');
    /* 木箱必须画在地砖之后，否则会被地面覆盖（D-89 同一坑） */
    var bx = Math.round(W * 0.905);
    bgContact(c, bx, G - 2, 42, 6);
    bgRect(c, bx - 34, G - 56, 68, 56, '#2a1f13');
    bgRect(c, bx - 31, G - 53, 62, 50, '#352718');
    bgRect(c, bx - 31, G - 53, 62, 2, '#43321f');
    bgRect(c, bx - 31, G - 30, 62, 3, '#191108');
    bgRect(c, bx - 2, G - 53, 3, 50, '#191108');
    /* P7.6：帐篷 / 木栅 / 木箱落地——底缘压暗 + 接地影 + 断口 */
    hPropFoot(c, Math.round(tw * 0.5), bwY, tw, 0.50);
    hPropFoot(c, Math.round(W * 0.93), bwY, Math.round(W * 0.13), 0.46);
    hPropFoot(c, bx, G, 68, 0.52);
    /* 车辙：地面材质，不是物件 */
    bgLine(c, 0, G + Math.round(H * 0.055), W, G + Math.round(H * 0.058), 'rgba(84,70,46,0.16)', 2);
    bgLine(c, 0, G + Math.round(H * 0.085), W, G + Math.round(H * 0.088), 'rgba(84,70,46,0.12)', 2);
    /* 篝火：全场最亮，左侧极值 */
    var fx = Math.round(W * 0.075), fy = Math.round(H * 0.73);
    bgGlow(c, fx, fy - 8, Math.round(H * 0.185), [255, 140, 50], 0.24);
    for (var si = 0; si < 7; si++) {
      var ang = Math.PI * 2 * si / 7;
      bgRect(c, fx + Math.cos(ang) * 24 - 5, fy + Math.sin(ang) * 8 - 4, 11, 7, si % 2 ? '#22201c' : '#2b2822');
    }
    bgRect(c, fx - 22, fy - 5, 44, 5, '#2a1c10');
    bgRect(c, fx - 16, fy - 9, 32, 4, '#241a10');
    bgFlame(c, fx, fy - 4, 1.05, true);
    c.fillStyle = 'rgba(255,150,60,0.06)';
    c.beginPath();
    c.ellipse(fx, fy + 12, Math.round(W * 0.06), Math.round(H * 0.017), 0, 0, Math.PI * 2);
    c.fill();
    bgContact(c, fx, fy + 6, 34, 8);
    bgRect(c, 0, bwY - 4, W, 4, '#1c160e');
    bgRect(c, 0, G + 2, W, Math.max(3, Math.round(H * 0.010)), 'rgba(0,0,0,0.20)');
  }

  /* F3 裂谷：左右崖壁 + 中央向远处收窄的黑缝 + 两侧地面熔岩 + 冷却黑曜石 */
  function hbgLavaRift(c, W, H, sc, cols, canTile) {
    var g = hSceneGeom(W, H, sc), bwY = g.bwY, G = g.G;
    var y1 = bwY - Math.round(H * 0.06);
    /* 崖壁内缘：折线而不是直线——直线会读成"门框"，折线才读成岩壁 */
    var lEdge = [[Math.round(W * 0.295), 0], [Math.round(W * 0.325), Math.round(bwY * 0.30)],
      [Math.round(W * 0.335), Math.round(bwY * 0.55)], [Math.round(W * 0.322), y1],
      [Math.round(W * 0.300), bwY]];
    var rEdge = [[Math.round(W * 0.705), 0], [Math.round(W * 0.675), Math.round(bwY * 0.28)],
      [Math.round(W * 0.665), Math.round(bwY * 0.52)], [Math.round(W * 0.678), y1],
      [Math.round(W * 0.700), bwY]];
    /* D-104：后墙/崖壁底色抬到 #15121b（≈20）与 #181521（≈23），
     * 中央远缝仍由黑渐变压住，空间层次不是"整块提亮"。 */
    /* D-111：两侧崖壁改成砌块层（砖缝 14、块面 23/26/29），中央黑缝随后覆盖中段，
     * 崖壁读成"石砌的一堵墙"而不是两块平涂多边形。 */
    hBrickWall(c, 0, 0, W, bwY, Math.max(44, Math.round(W * 0.062)), Math.max(24, Math.round(H * 0.056)),
      ['#191521', '#1c1826', '#1f1b2b'], '#100e16', 3);
    bgLine(c, lEdge[0][0], lEdge[0][1], lEdge[1][0], lEdge[1][1], 'rgba(96,86,124,0.18)', 2);
    bgLine(c, lEdge[3][0], lEdge[3][1], lEdge[4][0], lEdge[4][1], 'rgba(96,86,124,0.18)', 2);
    bgLine(c, rEdge[0][0], rEdge[0][1], rEdge[1][0], rEdge[1][1], 'rgba(96,86,124,0.18)', 2);
    bgLine(c, rEdge[3][0], rEdge[3][1], rEdge[4][0], rEdge[4][1], 'rgba(96,86,124,0.18)', 2);
    /* 中央黑缝：无门框、无拱，只是岩壁之间越远越黑的空隙 */
    var cg = c.createLinearGradient(0, 0, 0, bwY);
    cg.addColorStop(0, 'rgba(0,0,0,0.88)');
    cg.addColorStop(1, 'rgba(0,0,0,0.52)');
    c.fillStyle = cg;
    c.beginPath();
    var gap = lEdge.concat(rEdge.slice().reverse());
    c.moveTo(gap[0][0], gap[0][1]);
    for (var gpi = 1; gpi < gap.length; gpi++) c.lineTo(gap[gpi][0], gap[gpi][1]);
    c.closePath();
    c.fill();
    /* D-94 P7.5：中央不再有任何单点物件——原来的「远处崖壁剪影 + 顶部岩檐」在横置下
     * 读成一座从顶压到地面的黑岩体，把两个人挤到画面两边。现在中央只留空走道 +
     * 越远越暗的缝（纵深交给明度差），重量全部移到两侧崖壁。 */
    for (var li = 0; li < 5; li++) {
      var ly = Math.round(bwY * (0.16 + li * 0.155));
      bgLine(c, 0, ly, Math.round(W * 0.20), ly + Math.round(H * 0.016), 'rgba(86,78,110,0.10)', 3);
      bgLine(c, W, ly + Math.round(H * 0.008), Math.round(W * 0.80),
        ly + Math.round(H * 0.024), 'rgba(86,78,110,0.10)', 3);
    }
    bgRect(c, 0, bwY - 4, W, 4, '#141119');
    hWallDim(c, W, bwY, 0.16);
    /* P7.5：地板洗到 ≈37 并降对比（改前 0.80 黑洗 → 21，暖棕砖纹又亮又密压过角色） */
    hFloorTiles(c, W, H, bwY, 3, cols, canTile, 'rgba(28,16,10,0.60)', '#07070c');
    /* 两侧崖脚压地线：画在地板之后才不会被地砖盖住，崖壁才读成"落在地上" */
    bgRect(c, 0, bwY, Math.round(W * 0.18), 3, 'rgba(0,0,0,0.35)');
    bgRect(c, W - Math.round(W * 0.18), bwY, Math.round(W * 0.18), 3, 'rgba(0,0,0,0.35)');
    /* P7.6：两池熔岩移到前景（地面线之下），池体完整、不被画框切、也不撞两侧构件 */
    for (var ai = 0; ai < 22; ai++) {
      var ax = (ai * 137 + 40) % Math.max(1, W);
      var ay = Math.round(H * 0.32) + (ai * 73) % Math.round(H * 0.34);
      bgRect(c, ax, ay, 2, 2, 'rgba(180,140,120,0.09)');
    }
    /* 左：玄武岩柱；右：塌了半边的拱（不同物件，都落地） */
    var lx = Math.round(W * 0.165), rx = Math.round(W * 0.875);
    var colTop = Math.round(H * 0.30);
    bgContact(c, lx, bwY + 8, 30, 5);
    bgRect(c, lx - 18, colTop, 36, bwY - colTop + 10, '#1a1620');
    bgRect(c, lx - 18, colTop, 5, bwY - colTop + 10, '#241f2b');
    bgRect(c, lx - 24, colTop - Math.round(H * 0.018), 48, Math.round(H * 0.018), '#211c28');
    bgContact(c, rx, bwY + 8, 34, 5);
    bgGothicArch(c, rx, bwY + 6, 84, Math.round(H * 0.26), 'rgba(74,64,92,0.40)', '#0b0910', '#19131b');
    /* P7.6：柱/拱落地——底缘压暗 + 接地影 + 断口，不再把深色底边直接切在亮地上 */
    hPropFoot(c, lx, bwY + 10, 48, 0.52);
    hPropFoot(c, rx, bwY + 6, 90, 0.46);
    bgRect(c, 0, G + 2, W, Math.max(3, Math.round(H * 0.010)), 'rgba(0,0,0,0.22)');
    /* P7.6：熔岩池是这一层的主热源——有池形、有由内向外衰减的热光、有落在周围地板的反光；
     * 白热核心在池心（0.09W / 0.91W），池体左右各留 ≈2.4%W 边距，不会被画面切掉，
     * 池心也落在"光源极值区 x≤0.12W / ≥0.88W"内（P2 亮度分区断言）。 */
    var phw = Math.round(W * 0.066);
    var phh = Math.max(14, Math.round(H * 0.032));
    bgLavaPool(c, Math.round(W * 0.09), Math.round(H * 0.806), phw, phh);
    bgLavaPool(c, W - Math.round(W * 0.09), Math.round(H * 0.806), phw, phh);
  }

  /* F4 墓穴：冰石后墙 + 左双柱/右单粗柱与倾斜棺盖 + 中央空墓道 + 霜石阶 */
  function hbgFrostCrypt(c, W, H, sc, cols, canTile) {
    var g = hSceneGeom(W, H, sc), bwY = g.bwY, G = g.G;
    var bw = Math.max(44, Math.round(W * 0.055)), bh = Math.max(20, Math.round(H * 0.040));
    /* D-111：冰石砖面改成 3 档色阶 + 砖缝暗底，砖缝与砖面在样本里能分开。 */
    hBrickWall(c, 0, 0, W, bwY, bw, bh,
      ['#101a22', '#121c25', '#14202a'], '#080c11', 4);
    hWallFalloff(c, W, bwY, 0.22);
    hCenterDark(c, W, bwY, W * 0.5, W * 0.32, 0.16);
    /* 左侧两根细柱 / 右侧一根粗柱：不镜像 */
    var pil = [Math.round(W * 0.115), Math.round(W * 0.325), Math.round(W * 0.90)];
    for (var pi = 0; pi < pil.length; pi++) {
      var px = pil[pi], pw = (pi === 2) ? 52 : 34;
      var ptop = (pi === 2) ? Math.round(H * 0.16) : Math.round(H * 0.22);
      bgContact(c, px, bwY + 10, Math.round(pw * 0.8), 5);
      bgRect(c, px - pw / 2, ptop, pw, bwY - ptop + 10, '#1c2b36');
      bgRect(c, px - pw / 2, ptop, 5, bwY - ptop + 10, '#2b4050');
      bgRect(c, px - pw / 2 - 6, ptop - 10, pw + 12, 11, '#243744');
      bgRect(c, px - pw / 2 - 6, bwY, pw + 12, 10, '#22323d');
    }
    /* P7.5：冰石后墙砖面实测 19.6（五层最高），压 0.30；地板洗到 ≈39
     * D-104：0.30 → 0.28，只把后墙从临界值 14.0 抬到 14.4，避免断言在浮点边界抖动。 */
    hWallDim(c, W, bwY, 0.24);
    hFloorTiles(c, W, H, bwY, 4, cols, canTile, 'rgba(12,18,24,0.60)', '#060d14');
    bgRect(c, 0, bwY - 5, W, 5, '#16242e');
    /* P7.6：右：倾斜棺盖——必须画在地砖之后（与 F2 木箱同一个坑），否则整个棺盖被地板吞掉 */
    var sx = Math.round(W * 0.885);
    bgContact(c, sx, G - 2, 44, 6);
    bgPoly(c, [[sx - 38, G], [sx - 30, G - 54], [sx + 34, G - 62], [sx + 40, G]], '#1b2a35');
    bgPoly(c, [[sx - 32, G - 6], [sx - 26, G - 48], [sx + 30, G - 55], [sx + 34, G - 6]], '#22323d');
    bgLine(c, sx - 22, G - 44, sx + 26, G - 50, 'rgba(120,180,210,0.20)', 1);
    hPropFoot(c, sx, G, 78, 0.50);
    /* 三根柱子的可见底边在 bwY（以下被地砖盖住），补落地处理 */
    hPropFoot(c, Math.round(W * 0.115), bwY, 40, 0.46);
    hPropFoot(c, Math.round(W * 0.325), bwY, 40, 0.46);
    hPropFoot(c, Math.round(W * 0.90), bwY, 58, 0.46);
    /* 霜雾：只贴两侧地面，中央空场不铺 */
    c.fillStyle = 'rgba(140,200,230,0.04)';
    c.beginPath();
    c.ellipse(W * 0.20, G + H * 0.03, W * 0.16, H * 0.028, 0, 0, Math.PI * 2);
    c.ellipse(W * 0.80, G + H * 0.03, W * 0.16, H * 0.028, 0, 0, Math.PI * 2);
    c.fill();
    /* 冷白烛台：两侧极值，全场最亮 */
    var cx2 = [Math.round(W * 0.065), Math.round(W * 0.945)];
    var cy2 = Math.round(H * 0.735);
    for (var ci = 0; ci < cx2.length; ci++) {
      bgRect(c, cx2[ci] - 2, cy2, 4, Math.round(H * 0.052), '#26343e');
      bgRect(c, cx2[ci] - 9, cy2 + Math.round(H * 0.048), 18, 5, '#2e3f4b');
      bgRect(c, cx2[ci] - 7, cy2 - 2, 14, 4, '#33454f');
      bgGlow(c, cx2[ci], cy2 - 8, Math.round(H * 0.13), [190, 235, 255], 0.46);
      bgPoly(c, [[cx2[ci], cy2 - Math.round(H * 0.04)], [cx2[ci] + 6, cy2 - 4], [cx2[ci] - 6, cy2 - 4]], '#bfe8ff');
      bgPoly(c, [[cx2[ci], cy2 - Math.round(H * 0.026)], [cx2[ci] + 3, cy2 - 4], [cx2[ci] - 3, cy2 - 4]], '#f2ffff');
      bgRect(c, cx2[ci] - 1, cy2 - Math.round(H * 0.02), 3, 4, '#ffffff');
      c.fillStyle = 'rgba(180,225,255,0.06)';
      c.beginPath();
      c.ellipse(cx2[ci], cy2 + Math.round(H * 0.055), Math.round(W * 0.05), Math.round(H * 0.013), 0, 0, Math.PI * 2);
      c.fill();
      bgContact(c, cx2[ci], cy2 + Math.round(H * 0.052), 15, 5);
    }
    for (var ic = 0; ic < 6; ic++) {
      var ix = (ic * 151 + 60) % Math.max(1, W);
      bgLine(c, ix, G + (ic % 3) * Math.round(H * 0.02), ix + 30,
        G + ((ic % 3) + 1) * Math.round(H * 0.02), 'rgba(120,180,210,0.14)', 1);
    }
    bgRect(c, 0, G + 2, W, Math.max(3, Math.round(H * 0.010)), 'rgba(0,0,0,0.22)');
  }

  /* F5 王座前厅：黑曜石金脉后墙 + 左拱与垂旗/右王座（不就中）+ 中央空走道 */
  function hbgThroneHall(c, W, H, sc, cols, canTile) {
    var g = hSceneGeom(W, H, sc), bwY = g.bwY, G = g.G;
    /* D-104：黑曜石后墙底色 #0a0710（≈8）抬到 #131019（≈18），
     * 压 0.10 后实测 ≈15；金脉与光源峰值不动。 */
    /* D-111：黑曜石墙改成砌块（砖缝 13、块面 26/29/32），金脉仍画在砖面之上。 */
    hBrickWall(c, 0, 0, W, bwY, Math.max(46, Math.round(W * 0.064)), Math.max(24, Math.round(H * 0.058)),
      ['#18141d', '#1a1721', '#1e1926'], '#0c0a10', 5);
    hWallFalloff(c, W, bwY, 0.30);
    for (var gi = 0; gi < 12; gi++) {
      var gx = (gi * 173 + 40) % Math.max(1, W);
      var gy0 = Math.round(H * 0.10) + (gi % 3) * Math.round(H * 0.07);
      bgLine(c, gx, gy0, gx + Math.round(W * 0.05), gy0 + Math.round(H * 0.05), 'rgba(126,94,48,0.22)', 1);
    }
    for (var vi = 0; vi < 5; vi++) {
      var vx = Math.round(W * (0.06 + vi * 0.22));
      bgLine(c, vx, 0, vx + Math.round(W * 0.012), bwY, 'rgba(126,94,48,0.13)', 1);
    }
    hCenterDark(c, W, bwY, W * 0.5, W * 0.30, 0.46);
    /* 中央：空走道（地毯），尽头压暗；王座与台阶不占中线 */
    var cw = Math.round(W * 0.16);
    bgRect(c, Math.round(W * 0.5 - cw / 2), bwY, cw, H - bwY, '#150d16');
    bgRect(c, Math.round(W * 0.5 - cw / 2), bwY, 1, H - bwY, 'rgba(150,110,60,0.16)');
    bgRect(c, Math.round(W * 0.5 + cw / 2), bwY, 1, H - bwY, 'rgba(150,110,60,0.16)');
    /* 左：侧拱 + 两面垂旗 */
    var lx = Math.round(W * 0.155);
    bgGothicArch(c, lx, bwY, Math.round(W * 0.066), Math.round(H * 0.36), '#2a1938', '#0d0812', '#17101c');
    var ban = [Math.round(W * 0.105), lx];
    for (var bi2 = 0; bi2 < ban.length; bi2++) {
      var bx2 = ban[bi2];
      bgRect(c, bx2 - 13, Math.round(H * 0.06), 26, Math.round(H * 0.15), '#2a0f16');
      bgPoly(c, [[bx2 - 13, Math.round(H * 0.21)], [bx2 + 13, Math.round(H * 0.21)], [bx2, Math.round(H * 0.235)]], '#2a0f16');
      bgRect(c, bx2 - 11, Math.round(H * 0.06), 2, Math.round(H * 0.145), '#57212c');
      bgRect(c, bx2 + 9, Math.round(H * 0.06), 2, Math.round(H * 0.145), '#57212c');
    }
    /* 右：王座（后墙前，居中偏右）+ 两级台座（落到地面）——P7.6 起画在地砖之后 */
    var tx = Math.round(W * 0.925), tb = Math.round(H * 0.69);
    var hw2 = Math.round(W * 0.046);
    var bH = Math.round(H * 0.15), spH = Math.round(H * 0.05);
    /* P7.5：黑曜石后墙压 0.10（本就 8.1）；地板洗到 ≈36 并降纹理对比
     * D-104：保持 0.10，只抬底色，后墙从 7.5 抬到 ≈15。 */
    hWallDim(c, W, bwY, 0.10);
    hFloorTiles(c, W, H, bwY, 5, cols, canTile, 'rgba(32,22,28,0.60)', '#09050f');
    for (var fi = 0; fi < 8; fi++) {
      var fgx = (fi * 173 + 40) % Math.max(1, W);
      bgLine(c, fgx, G + Math.round(H * 0.02) + (fi % 2) * Math.round(H * 0.03),
        fgx + 58, G + Math.round(H * 0.035) + (fi % 2) * Math.round(H * 0.03), 'rgba(120,90,46,0.30)', 1);
    }
    /* 后墙脚线属于墙，必须先于王座/火盆，否则会横切过立地构件 */
    bgRect(c, 0, bwY - 4, W, 4, '#2a1938');
    /* P7.6：王座整块改画在地砖之后——台座落在地面上，不再被地板切掉半截 */
    bgContact(c, tx, tb + 10, hw2 + 8, 6);
    bgRect(c, tx - hw2 - 6, tb - Math.round(H * 0.012), (hw2 + 6) * 2, Math.round(H * 0.022), '#150d1e');
    bgRect(c, tx - hw2 - 6, tb - Math.round(H * 0.012), (hw2 + 6) * 2, 2, '#33203f');
    bgRect(c, tx - hw2, tb - Math.round(H * 0.026), hw2 * 2, Math.round(H * 0.014), '#180f22');
    bgRect(c, tx - hw2, tb - Math.round(H * 0.026), hw2 * 2, 2, '#3a2448');
    bgRect(c, tx - hw2 + 8, tb - bH, hw2 * 2 - 16, bH - Math.round(H * 0.02), '#1a1026');
    bgRect(c, tx - hw2 + 8, tb - bH, 3, bH - Math.round(H * 0.02), '#6b4a2a');
    bgRect(c, tx + hw2 - 11, tb - bH, 3, bH - Math.round(H * 0.02), '#6b4a2a');
    bgRect(c, tx - hw2 + 8, tb - bH, hw2 * 2 - 16, 3, '#6b4a2a');
    bgPoly(c, [[tx - hw2 + 8, tb - bH], [tx - hw2 - 8, tb - bH], [tx - hw2 + 8, tb - bH - spH]], '#241533');
    bgPoly(c, [[tx + hw2 - 8, tb - bH], [tx + hw2 + 8, tb - bH], [tx + hw2 - 8, tb - bH - spH]], '#241533');
    bgPoly(c, [[tx - hw2 + 8, tb - bH], [tx, tb - bH - Math.round(H * 0.035)], [tx + hw2 - 8, tb - bH]], '#2a1a3c');
    /* 红座垫 + 扶手：王座的身份符号 */
    bgRect(c, tx - hw2 + 12, tb - Math.round(H * 0.062), hw2 * 2 - 24, Math.round(H * 0.024), '#5e232e');
    bgRect(c, tx - hw2 + 12, tb - Math.round(H * 0.062), hw2 * 2 - 24, 2, '#7d3140');
    bgRect(c, tx - hw2 + 10, tb - Math.round(H * 0.092), 6, Math.round(H * 0.034), '#3a2448');
    bgRect(c, tx + hw2 - 16, tb - Math.round(H * 0.092), 6, Math.round(H * 0.034), '#3a2448');
    /* 火盆落在王座前的暖反光：把右侧光源与王座绑成一件事 */
    c.fillStyle = 'rgba(255,140,60,0.05)';
    c.beginPath();
    c.ellipse(tx, tb + 2, hw2 + 16, Math.round(H * 0.02), 0, 0, Math.PI * 2);
    c.fill();
    /* P7.6：王座与左侧拱龛落地——底缘压暗 + 接地影 + 断口 */
    hPropFoot(c, tx, tb, (hw2 + 6) * 2, 0.50);
    hPropFoot(c, lx, bwY, Math.round(W * 0.066) + 8, 0.48);
    /* 两侧火盆：短座火碗，火心在下带、x 在极值侧 */
    var bs = [Math.round(W * 0.075), Math.round(W * 0.885)];
    for (var bi = 0; bi < bs.length; bi++) {
      var bx = bs[bi], by = Math.round(H * 0.76);
      bgContact(c, bx, by, 22, 6);
      bgRect(c, bx - 16, by - 8, 32, 8, '#140f1c');
      bgRect(c, bx - 2, by - Math.round(H * 0.09), 4, Math.round(H * 0.082), '#241a2c');
      bgRect(c, bx + 1, by - Math.round(H * 0.088), 1, Math.round(H * 0.078), 'rgba(220,160,120,0.16)');
      bgRect(c, bx - 13, by - Math.round(H * 0.098), 26, 8, '#2a1f33');
      bgFlame(c, bx, by - Math.round(H * 0.102), 0.62, false);
      hPropFoot(c, bx, by, 32, 0.50);
    }
    bgRect(c, 0, G + 2, W, Math.max(3, Math.round(H * 0.010)), 'rgba(0,0,0,0.22)');
  }

  var H_BG_PAINTERS = [hbgStoneHall, hbgOrcCamp, hbgLavaRift, hbgFrostCrypt, hbgThroneHall];

  /* D-94 P2：横置接触阴影——贴地扁椭圆 + 1px 压地线。
   * 纵置 contactShadow 按精灵宽度取 rx（龙 83px），读头像"站在黑圆台上"；
   * 横置改按脚掌取 rx（≤46），只做"压住地面"，让四人共用同一条基线读得出来。 */
  function hContactShadow(ctx, cx, groundY, footW, alpha) {
    var rx = Math.max(16, Math.min(46, Math.round((footW || 90) * 0.30)));
    var ry = Math.max(2, Math.round(rx * 0.11));
    /* D-103 清账：只设 fillStyle，不再 save/restore */
    ctx.fillStyle = 'rgba(0,0,0,' + (typeof alpha === 'number' ? alpha : 0.55) + ')';
    ctx.beginPath();
    ctx.ellipse(cx, groundY - 1, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.round(cx - rx), groundY, Math.round(rx * 2), 1);
  }

  /* D-94 P4：7 格指令条（只显示、不接管输入；键盘 1–7 仍是唯一输入）。
   * 数值不抄第二份：技能名/MP 从 Game.Data.SKILLS 读，冷却从 Game.Skills.getCooldown 读。
   * D-102 S1：横/纵共用同一份格子外观与 4+3 紧凑档规则；条内分 header/cells/footer 三段，
   * MP/HP 读数与「1–7 或点击」不再去顶栏找。 */
  var H_CMDS = [
    { key: 1, cmd: 'attack', label: '攻击', sub: function () { return '无消耗'; } },
    { key: 2, cmd: 'defend', label: '防御', sub: function () { return '无消耗'; } },
    { key: 3, cmd: 'run', label: '逃跑', sub: function () { return '—'; } },
    { key: 4, cmd: 'skill:fireball', label: '火球', skill: 'fireball' },
    { key: 5, cmd: 'skill:dash', label: '冲刺', skill: 'dash' },
    { key: 6, cmd: 'skill:shield', label: '护盾', skill: 'shield' },
    /* D-103：鼠标点击与键盘 1–7 必须落到同一个命令名——此前这里是 'potion'，
     * 而 Battle.playerAction 只认 'item'，点第 7 格会走空一支分支。 */
    { key: 7, cmd: 'item', label: '用药', sub: function (st) { return '×' + ((st && st.potionsLeft) | 0); } }
  ];
  /* D-108 S4：七格指令图标——只从既有素材取（ITEM_ICONS 同源的 24×24 武器/道具图），
   * 一格一个、每格 1 次 drawImage。语义严格对应，宁缺毋滥：
   *   普攻=直剑、防御=板甲、逃跑=骑士奔跑帧、火球=红法杖、冲刺=长矛、护盾=法袍、用药=红药瓶。
   * 没有"盾牌"素材，护盾用防具里最接近"法术护体"的法袍，而不是拿武器凑数。
   * 绘制尺寸 = 素材原生尺寸（1:1，禁止放大到格高、禁止非整数倍），见 drawCommandCell。 */
  var CMD_ICONS = {
    attack: 'weapon_regular_sword',
    defend: 'icon_armor_plate',
    run: 'knight_m_run_anim_f0',
    'skill:fireball': 'weapon_red_magic_staff',
    'skill:dash': 'weapon_spear',
    'skill:shield': 'icon_armor_robe',
    item: 'flask_red'
  };

  /* D-97：指令格状态（技能 MP/CD 或静态副标签）——横置/纵置共用一份判定，不抄第二份。
   * D-103：把 MP 代价从 HUD 挪到按钮上（§1.2/§6.3），并给出禁用原因词（§6.5）：
   * 可用 → `MP n`；MP 不足 → `MP 不足`；冷却中 → `CD n`。 */
  function commandCellInfo(c0, state) {
    var sub = '', disabled = false, cost = 0, reason = '';
    if (c0.skill && Game.Data.SKILLS && Game.Data.SKILLS[c0.skill]) {
      var sk = Game.Data.SKILLS[c0.skill];
      var mp = (Game.Data.Player && typeof Game.Data.Player.mp === 'number') ? Game.Data.Player.mp : 0;
      var cdLeft = (Game.Skills && typeof Game.Skills.getCooldown === 'function')
        ? Game.Skills.getCooldown(c0.skill) : 0;
      cost = sk.mpCost;
      if (cdLeft > 0) {
        sub = 'CD ' + cdLeft;
        disabled = true;
        reason = 'CD ' + cdLeft;
      } else if (mp < sk.mpCost) {
        sub = 'MP 不足';
        disabled = true;
        reason = 'MP 不足';
      } else {
        sub = 'MP ' + sk.mpCost;
      }
    } else {
      sub = c0.sub ? c0.sub(state) : '';
    }
    return { sub: sub, disabled: disabled, cost: cost, reason: reason };
  }
  /* D-102：条高——横置按 §4.1 clamp(0.178H, 88, 140)；纵置单行 96 / 4+3 两行 150。
   * 4+3 的判据与 §6.2 一致：单行格宽 floor((W−100)/7) < 70 → W < 590。 */
  function commandBarH(W, H) {
    return Math.max(88, Math.min(140, Math.round(H * 0.178)));
  }
  function verticalBarH(W) { return (W < 590) ? 150 : 96; }

  function buildCommandBar(W, H, state, layout) {
    var compact = (layout !== 'horizontal') && W < 590;
    var barH = (layout === 'horizontal') ? commandBarH(W, H) : verticalBarH(W);
    var y0 = H - barH;
    var m = compact ? 9 : 26;
    var gap = compact ? 6 : 8;
    var cellH = compact ? 52 : 64;
    var cw = compact ? Math.floor((W - m * 2 - gap * 3) / 4)
      : Math.floor((W - m * 2 - gap * 6) / 7);
    var cells = [];
    for (var i = 0; i < H_CMDS.length; i++) {
      var c0 = H_CMDS[i];
      var ci = commandCellInfo(c0, state);
      var r = compact ? (i < 4 ? 0 : 1) : 0;
      var n = compact ? (r === 0 ? 4 : 3) : 7;
      var idx = compact ? (r === 0 ? i : i - 4) : i;
      var rowW = cw * n + gap * (n - 1);
      var rx = Math.round((W - rowW) / 2);
      var cy = compact ? (y0 + 16 + r * (cellH + 6)) : (y0 + 18);
      cells.push({ x: rx + idx * (cw + gap), y: cy, w: cw, h: cellH, key: c0.key, cmd: c0.cmd,
        label: c0.label, sub: ci.sub, disabled: ci.disabled, cost: ci.cost, reason: ci.reason,
        iconName: CMD_ICONS[c0.cmd] || null, icon: null });
    }
    return { x: 0, y: y0, w: W, h: barH, cells: cells, compact: compact,
      headerY: y0 + 14, footerY: y0 + barH - 4, cellH: cellH };
  }
  function hCommandBar(W, H, state) { return buildCommandBar(W, H, state, 'horizontal'); }
  function vCommandBar(W, H, state) { return buildCommandBar(W, H, state, 'vertical'); }

  /* D-103 S2：键盘焦点与鼠标 hover 共用同一个高亮绘制入口（同一套矩形、同一组颜色）。
   * 两者都是"当前格"：FOCUS_ID 由 mousemove 或 1–7 键写入，后写的生效。
   * 只画当前这一格：1 次填充 + 1 次描边，其余格零开销（沿用 D-100 的克制口径）。 */
  var FOCUS_ID = null;
  function drawCellFocus(ctx, cc) {
    dcMark('cell.hover');
    ctx.fillStyle = CMD_STYLE.hoverFill;
    ctx.fillRect(cc.x + 1, cc.y + 1, cc.w - 2, cc.h - 2);
    ctx.strokeStyle = CMD_STYLE.hoverStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(cc.x + 0.5, cc.y + 0.5, cc.w - 1, cc.h - 1);
  }

  function drawCommandCell(ctx, cc, compact) {
    var dis = !!cc.disabled;
    /* 禁用态不是整格变灰（§6.5）：图形 0.45、文字 0.75。
     * 背景随图形一起压暗，文字用 0.75 覆盖在压暗后的格底上——对比度 ≥4.5（verify 里实算）。 */
    ctx.globalAlpha = dis ? CMD_STYLE.gfxAlpha : 1;
    dcMark('cell.bg');
    /* D-109 清账：格底 fill+stroke 合并为 1 次填充（14 → 7）。
     * 边框由 6px 格间距与条底提供对比；焦点格仍有独立描边（cell.hover）。
     * 这笔预算让给 N3 的横置受击白闪（tintSprite 每帧 +5）。 */
    ctx.fillStyle = CMD_STYLE.cellBg;
    ctx.fillRect(cc.x, cc.y, cc.w, cc.h);
    if (FOCUS_ID === 'battle:' + cc.key) {
      drawCellFocus(ctx, cc);
      ctx.globalAlpha = dis ? CMD_STYLE.textAlpha : 1;
    }
    var off = compact ? 0 : Math.max(0, Math.round((cc.h - 64) / 2));
    /* D-108 S4：格内左侧图标位（D-103 删掉键位框时留出的位置）。
     * 原生尺寸 1:1——drawImage 的 w/h 直接取 naturalWidth/naturalHeight，
     * 不做任何缩放（禁止放大到格高、禁止非整数倍）；素材缺图就留空，不画占位块。
     * 图标框存进 cc.icon，验证页据此断言「图标/名称/代价两两不交且在格内」。 */
    cc.icon = null;
    if (cc.iconName) {
      var Sp = Game.Core && Game.Core.Sprites;
      var iconImg = (Sp && typeof Sp.get === 'function') ? Sp.get(cc.iconName) : null;
      var nw = iconImg && iconImg.naturalWidth, nh = iconImg && iconImg.naturalHeight;
      if (nw > 0 && nh > 0) {
        var iconX = cc.x + (compact ? 2 : 4);
        var iconY = cc.y + off + Math.round((cc.h - nh) / 2);
        dcMark('cell.icon');
        ctx.globalAlpha = dis ? CMD_STYLE.gfxAlpha : 1;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(iconImg, iconX, iconY, nw, nh);
        cc.icon = { x: iconX, y: iconY, w: nw, h: nh, name: cc.iconName };
      }
    }
    /* D-103：「键位框」不再画两层（填 + 描边），键位数字直接落在原键位文字的位置上，
     * 一次 fillText 完成；名称/代价的落点与字号完全不变（D-108 的图标只占左侧留白，不动这两行）。 */
    var keyX = cc.x + (compact ? 29 : 34);
    var keyTop = cc.y + off + (compact ? 9 : 11);
    ctx.globalAlpha = dis ? CMD_STYLE.textAlpha : 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    dcMark('cell.key');
    ctx.fillStyle = CMD_STYLE.keyText;
    ctx.font = 'bold 11px ' + FONT_STACK;
    ctx.fillText(String(cc.key), keyX, keyTop);
    dcMark('cell.label');
    ctx.fillStyle = CMD_STYLE.label;
    ctx.font = (compact ? 'bold 12px ' : 'bold 13px ') + FONT_STACK;
    ctx.fillText(cc.label, cc.x + (compact ? 28 : 34), cc.y + off + (compact ? 24 : 30));
    dcMark('cell.sub');
    ctx.fillStyle = CMD_STYLE.sub;
    ctx.font = '11px ' + FONT_STACK;
    ctx.fillText(cc.sub, cc.x + (compact ? 28 : 34), cc.y + off + (compact ? 41 : 48));
    ctx.globalAlpha = 1;
  }

  /* D-102：横/纵共用同一套指令条外观：header（回合 / HP·MP）+ 7 格 + footer。 */
  function hDrawCommandBar(ctx, bar) {
    if (!bar) return;
    var p = Game.Data.Player || {};
    var st = Game.Systems && Game.Systems.Battle;
    var state = (st && typeof st.getState === 'function') ? st.getState() : null;
    var roundNo = (state && state.roundNo) || 1;
    dcMark('bar.frame');
    ctx.fillStyle = CMD_STYLE.barBg;
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.fillStyle = CMD_STYLE.barLine;
    ctx.fillRect(bar.x, bar.y, bar.w, 1);
    ctx.textBaseline = 'alphabetic';
    ctx.font = '11px ' + FONT_STACK;
    ctx.fillStyle = '#8a8aa0';
    ctx.textAlign = 'left';
    ctx.fillText('行动 · 第 ' + roundNo + ' 回合', bar.compact ? 9 : 29, bar.headerY);
    ctx.textAlign = 'right';
    var hp = (typeof p.hp === 'number') ? p.hp : 0, hpm = (p.maxHp > 0) ? p.maxHp : 1;
    var mp = (typeof p.mp === 'number') ? p.mp : 0, mpm = (p.maxMp > 0) ? p.maxMp : 1;
    ctx.fillText('HP ' + hp + '/' + hpm + ' · MP ' + mp + '/' + mpm, bar.w - (bar.compact ? 9 : 29), bar.headerY);
    for (var i = 0; i < bar.cells.length; i++) drawCommandCell(ctx, bar.cells[i], bar.compact);
    dcMark('bar.frame');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5f6578';
    ctx.font = '11px ' + FONT_STACK;
    ctx.fillText('1–7 或点击', bar.w / 2, bar.footerY);
    /* D-103 清账：省掉 save/restore，显式复位排版状态 */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  function vDrawCommandBar(ctx, bar) { hDrawCommandBar(ctx, bar); }



  /* 第三拨 D-88：龙的身份符号——只做「发光眼」这一件（不做口部余火、不做亮色翼膜）。
   * D-89：素材重画为原生 72×72（原 64×54），锚点同步到新头部位（原生坐标）：
   *   idle 双眼 (30..32,25..27)/(41..43,25..27) → 中点 (36,26)；attack 头下移 3px → (36,29)；
   *   hurt 头上抬 1px → (36,25)。落屏 2×（Boss 144px 高）时双眼各 6×5px、间距 20px、光晕 46px，
   *   1× 实显也能在静止帧读到"这里有一双眼睛"；不改剪影、不参与数值与时钟。 */
  var DRAGON_EYES = {
    idle: { x: 36, y: 26 },
    attack: { x: 36, y: 29 },
    hurt: { x: 36, y: 25 }
  };
  function drawDragonEyes(ctx, cx, bottom, h, mode, img) {
    var a = DRAGON_EYES[mode] || DRAGON_EYES.idle;
    var nw = (img && img.naturalWidth) || 72;
    var nh = (img && img.naturalHeight) || 72;
    var w = Math.max(2, Math.round(nw * h / nh));
    var x0 = cx - w / 2, top = bottom - h;
    var ex = x0 + a.x * w / nw;
    var ey = top + a.y * h / nh;
    var gr = Math.max(10, h * 0.16);
    var g = ctx.createRadialGradient(ex, ey, 0, ex, ey, gr);
    g.addColorStop(0, 'rgba(255,196,96,0.58)');
    g.addColorStop(0.45, 'rgba(255,132,40,0.24)');
    g.addColorStop(1, 'rgba(255,110,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ex - gr, ey - gr, gr * 2, gr * 2);
    var ew = Math.max(4, Math.round(h * 0.042));
    var eh = Math.max(3, Math.round(h * 0.035));
    var sep = Math.max(8, Math.round(h * 0.139));
    for (var s = -1; s <= 1; s += 2) {
      var x = Math.round(ex + s * sep / 2 - ew / 2);
      var y = Math.round(ey - eh / 2);
      ctx.fillStyle = '#ff7a16';
      ctx.fillRect(x - 1, y - 1, ew + 2, eh + 2);
      ctx.fillStyle = '#ffd05a';
      ctx.fillRect(x, y, ew, eh);
      ctx.fillStyle = '#fff6d8';
      ctx.fillRect(x + 1, y + 1, 2, 2);
    }
  }

  function drawBattleBackdrop(ctx, W, H, floorNo, layout) {
    var f = (floorNo >= 1 && floorNo <= 5) ? floorNo : 1;
    var R = Game.Core && Game.Core.Render;
    var k = ((R && R.dpr) || 1) * ((R && R.scale) || 1);
    /* D-94 P2：纵置/横置各有一套 painter 与一套场景表，缓存键必须带上布局——
     * 否则同尺寸下先画横置再画纵置会串图（离屏缓存只按层/尺寸分键）。 */
    var lay = (layout === 'horizontal') ? 'h' : 'v';
    var sc = (lay === 'h') ? HORIZONTAL_SCENE[f - 1] : BATTLE_SCENE[f - 1];
    var painter = (lay === 'h') ? H_BG_PAINTERS[f - 1] : BG_PAINTERS[f - 1];
    var canTile = !!(Game.Core.Sprites && typeof Game.Core.Sprites.isReady === 'function' &&
      Game.Core.Sprites.isReady());
    var tileFlag = canTile ? 1 : 0;
    if (!bgCache.cv) {
      bgCache.cv = document.createElement('canvas');
      bgCache.ctx = bgCache.cv.getContext('2d');
    }
    var c = bgCache.ctx;
    if (!c) return;
    if (bgCache.floor !== f || bgCache.W !== W || bgCache.H !== H ||
      bgCache.k !== k || bgCache.tile !== tileFlag || bgCache.layout !== lay) {
      if (typeof window !== 'undefined' && window.__BGN !== undefined) window.__BGN++;
      bgCache.cv.width = Math.max(1, Math.round(W * k));
      bgCache.cv.height = Math.max(1, Math.round(H * k));
      c.setTransform(k, 0, 0, k, 0, 0);
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#07070c';
      c.fillRect(0, 0, W, H);
      var cols = Math.ceil(W / TILE);
      try {
        painter(c, W, H, sc, cols, canTile);
      } catch (e) {
        /* 绘制异常时退回整块底色，不阻断战斗 */
        c.setTransform(k, 0, 0, k, 0, 0);
        c.globalAlpha = 1;
        c.fillStyle = '#07070c';
        c.fillRect(0, 0, W, H);
      }
      /* 四角轻压暗：只压边角，光源在中下带两侧，不被吃掉 */
      var vg = c.createRadialGradient(W / 2, H * 0.52, Math.min(W, H) * 0.36, W / 2, H * 0.52, Math.max(W, H) * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.30)');
      c.fillStyle = vg;
      c.fillRect(0, 0, W, H);
      bgCache.floor = f; bgCache.W = W; bgCache.H = H; bgCache.k = k; bgCache.tile = tileFlag;
      bgCache.layout = lay;
    }
    ctx.drawImage(bgCache.cv, 0, 0, W, H);
  }

  /* P2-1：怪物视觉映射集中表——id → { idle, run } 帧组名（10 种怪物全覆盖）。
   * 未登记的 id 由调用方回退 monster_chort（现状）；imp 只作 bat 的视觉帧组，不占怪物 id。 */
  var MONSTER_ANIM = {
    slime: { idle: 'slime_idle', run: 'slime_run' },
    bat: { idle: 'bat_idle', run: 'bat_run' },
    skeleton: { idle: 'skelet_idle', run: 'skelet_run' },
    dragon: { idle: 'dragon_idle', run: 'dragon_idle', attack: 'dragon_attack', hurt: 'dragon_hurt' },
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
    /* P2-4：层 Boss 复用既有大图帧组（素材零新增）
     * 第二拨：三只 Boss 改为专属剪影三态帧组（idle/attack/hurt），不再复用杂兵放大；
     * run 与 idle 共用（Boss 在战场层不跑动，仅地图层取 idle）。 */
    ogre_boss: { idle: 'ogre_boss_idle', run: 'ogre_boss_idle', attack: 'ogre_boss_attack', hurt: 'ogre_boss_hurt' },
    zombie_king: { idle: 'zombie_king_idle', run: 'zombie_king_idle', attack: 'zombie_king_attack', hurt: 'zombie_king_hurt' }
  };

  /* D-98：战斗侧帧组解析——精英只登记了基怪贴图 id（elite_goblin→goblin），
   * 优先按 sprite 查 MONSTER_ANIM；未登记 sprite 时退回怪物 id；两者都查不到才由
   * 调用方落 chort 兜底（兜底保留，不删）。 */
  function monsterAnimId(monster) {
    if (!monster) return '';
    if (monster.sprite && MONSTER_ANIM[monster.sprite]) return monster.sprite;
    return monster.id;
  }

  /* P2-1：按 id + 状态取动画帧；未登记 id / 素材未就绪 / 帧缺失一律返回 null（调用方回退）。
   * 第二拨：第三参 mode = 'attack' | 'hurt' 时优先取专属态；未登记该态则回退 idle/run。 */
  function monsterFrame(id, chasing, mode) {
    var set = MONSTER_ANIM[id];
    if (!set) return null;
    var S = Game.Core && Game.Core.Sprites;
    if (!S || typeof S.getFrame !== 'function') return null;
    var name = (mode && set[mode]) ? set[mode] : (chasing ? set.run : set.idle);
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
      { label: 'F', act: 'trap', name: '侦测/拆除陷阱', line: 1, codes: ['KeyF'] },
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
      { label: '7', act: 'item', name: '用药', line: 1, codes: ['Digit7', 'Numpad7'] }
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
   * 机制须知只写代码里确实存在的条目（D-78 起特效硬性常开，F 键不再出现在任何键行）。
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

  /* ── D-57 / D-80：角色朝向 ─────────────────────────────────────
   * D-57 时玩家只有 3/4 正面帧（16×28），只能"镜像正面帧 + 两处方向性补丁"
   * （鞋底前冲尘屑、固定世界左侧受光高光）来伪造左右差异。
   * D-80 裁定 A：底帧改为 24×42 真侧面（朝右），朝向由轮廓本身承担
   * （面甲前沿外凸 1px、单侧护肩、前伸的武器手、前后错步）；
   * 左朝向 = 同一帧水平镜像。于是那两处补丁不再需要，已删除——
   * 删掉后左右画面严格互为镜像（verify_d57 C 组按像素验证 realDiff === 0，
   * 另加"素材侧身性"断言保证镜像前素材本身有方向）。 */
  function playerFrameState(player, moving) {
    var facing = (player && player.facing === 'left') ? 'left' : 'right';
    return {
      frame: moving ? 'knight_m_run' : 'knight_m_idle',
      facing: facing,
      flip: facing === 'left'
    };
  }

  function drawPlayerFigure(ctx, cx, bottom, facing, moving, animT) {
    var st = playerFrameState({ facing: facing }, moving);
    var img = null;
    if (Game.Core.Sprites && typeof Game.Core.Sprites.getFrame === 'function') {
      img = Game.Core.Sprites.getFrame(st.frame, typeof animT === 'number' ? animT : 0);
    }
    if (!img) return null;
    var b = unitBox(img, cx, bottom, imgBase(img));
    if (!b) return null;
    ctx.save();
    if (st.flip) {
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.translate(-cx, 0);
    }
    ctx.drawImage(img, b.x, b.y, b.w, b.h);
    ctx.restore();
    return { box: b, frame: st.frame, facing: st.facing, flip: st.flip };
  }

  /* D-113：探索层墙的压暗参数。
   * top/body = 墙顶/墙身叠黑 alpha（旧值 0.40 / 0.45）；edge/edgePx = 墙侧内缘那条暗边；
   * guard = 负例专用（>0 时只压墙体内圈，交界像素保持旧亮度）。
   * 只在静态层构建期使用，不进每帧调用账；改布局会走 invalidateStatic 重建。 */
  var WALL_STYLE = { top: 0.62, body: 0.70, edge: 0.90, edgePx: 3, guard: 0 };

  /* D-115：可交互物统一语法（只加标识，不改地图/碰撞/数值）。
   * 语法 = 类别色 + 格内类别标记；标记只画在已探明格，不铺满整格，也不进 FOV 黑场。
   *   楼梯：青白 #cae6f5 2px 内框 + 方向三角（▼ 下行 / ▲ 上行；同色同类，靠箭头方向区分）
   *   宝箱：沿用既有金色边框（D-115 明确"金边与金币色已够"，不重绘）
   *   陷阱：红 #d44e52 1px 内框（只在 tr.seen 时画）
   *   NPC ：绿 #79b85a 1px 内框（画在人形之前，脚下格）
   * 层级：静态层内（高于墙内缘暗边）→ 实体层（玩家/NPC 精灵覆盖它），不抢人。
   * 颜色全部取自 84 色板。 */
  var INTERACT = {
    stair: { color: '#cae6f5', ink: '#16222e', w: 2, inset: 2.5 },
    trap: { color: '#d44e52', ink: '#16222e', w: 1, inset: 2 },
    npc: { color: '#79b85a', ink: '#16222e', w: 1, inset: 1 },
    on: true
  };

  /* D-116：地图边界之外的"地牢外面"。
   * 选型：只做场外岩框（不做相机重构图）——硬约束禁止缩放，地图占视口比例在改动前后
   * 必须保持不变；能修的是"空白被读成画面没画完"。所以把场外做成有纵深、有岩层结构的
   * 地牢外侧，并用 3px 接触阴影把地图"压"进岩体里。
   * 纪律：场外整体比地图暗（最亮岩层也低于地板均值）；不出现 24px 网格/走廊；不画任何
   * 可走质感；纹理只依赖屏幕坐标哈希，不掷 Math.random；静态缓存随镜头失效，不会停在旧帧。 */
  var OUTER = {
    on: true,
    base: '#08070e',       /* 最远：洞窟深处的黑 */
    far: '#0b0813',        /* 远景岩层 */
    mid: '#120e21',        /* 中景岩层 */
    near: '#191330',       /* 贴地图的岩壁（最近、最亮，仍远低于地板） */
    ink: '#040407',        /* 地图沿口 4px 接触阴影 */
    rim: '#2b2440'         /* 地图边界 1px 沿口线（暗紫，不抢青白楼梯） */
  };

  function hashXY(x, y) {
    var n = (x | 0) * 374761393 + (y | 0) * 668265263;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  }

  /* D-116：场外岩壁 = 不规则石块层（不是条纹、不是 24px 网格）。
   * 石块按 60×34 的抖动网格铺、行列错缝，缝宽 3~5px 露出洞窟黑；
   * 石块色只在 near/mid/far 三档暗紫里取值，最亮 near 也远低于任何地板色，
   * 且色相偏紫、与地板/墙的棕紫拉开，不会被读成可走地面。
   * 纹理烘成 240×240 的无缝贴图（石块跨边时在四周各补一份，接缝不可见）：
   * 静态层每次重建只做 1 次 pattern 填充，不再逐块逐粒重画——镜头每走一步都要重建，
   * 逐块重画实测 9.2ms/次，烘成贴图后回到 1ms 量级。 */
  var outerTex = { cv: null };
  var FADE_LEN = 150, FADE_ALPHA = 0.62, fadeTex = {};

  /* 预烘的"向内收光"条：reverse=true 表示起点不透明、终点透明。
   * 4 条各 150×1 / 1×150，只在第一次用到时生成，之后每次重建只是 4 次 drawImage。 */
  function fadeStrip(key, w, h, reverse) {
    if (fadeTex[key]) return fadeTex[key];
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var c = cv.getContext('2d');
    var g = (w >= h) ? c.createLinearGradient(0, 0, w, 0) : c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,' + (reverse ? FADE_ALPHA : 0) + ')');
    g.addColorStop(1, 'rgba(0,0,0,' + (reverse ? 0 : FADE_ALPHA) + ')');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    fadeTex[key] = cv;
    return cv;
  }

  function outerStone(c, px, py, pw, ph, color, t) {
    c.fillStyle = color;
    var k = 3;
    c.beginPath();
    c.moveTo(px + k, py);
    c.lineTo(px + pw - k, py);
    c.lineTo(px + pw, py + k);
    c.lineTo(px + pw, py + ph - k);
    c.lineTo(px + pw - k, py + ph);
    c.lineTo(px + k, py + ph);
    c.lineTo(px, py + ph - k);
    c.lineTo(px, py + k);
    c.closePath();
    c.fill();
    /* 上沿 1px 受光：石块有厚度，不是平涂色块（约 7 成石块有） */
    if (t > 0.30) {
      c.fillStyle = 'rgba(178,158,220,0.06)';
      c.fillRect(px + k, py, pw - k * 2, 1);
    }
  }

  function buildOuterTile() {
    if (outerTex.cv) return outerTex.cv;
    /* 480 贴图内恰好 12 行 × 6 列（40 / 80 整除、行数为偶），错缝相位在贴图边界一致；
     * 重复周期足够大（1024 宽只铺 2.1 次），肉眼读不出"同一块石头又出现"。 */
    var S = 480;
    var cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var c = cv.getContext('2d');
    c.fillStyle = OUTER.base;
    c.fillRect(0, 0, S, S);
    var rowH = 40, colW = 80, r = 0, y, x, dx, dy;
    for (y = -rowH; y < S + rowH; y += rowH) {
      var off = (r % 2) ? Math.round(colW * 0.5) : 0;
      for (x = -colW; x < S + colW; x += colW) {
        var jx = (hashXY(x, y) - 0.5) * 12;
        var jy = (hashXY(x + 3, y + 9) - 0.5) * 8;
        var pw = Math.round(colW - 9 + hashXY(x + 11, y) * 7);
        var ph = Math.round(rowH - 9 + hashXY(x, y + 13) * 6);
        var px = Math.round(x + off + jx), py = Math.round(y + jy);
        var t = hashXY(px + 41, py + 17);
        var col = t < 0.46 ? OUTER.near : (t < 0.82 ? OUTER.mid : OUTER.far);
        /* 无缝：跨边石块在 ±S 方向各补一份 */
        for (dy = -1; dy <= 1; dy++) {
          for (dx = -1; dx <= 1; dx++) {
            if (px + dx * S + pw < 0 || px + dx * S > S || py + dy * S + ph < 0 || py + dy * S > S) continue;
            outerStone(c, px + dx * S, py + dy * S, pw, ph, col, t);
          }
        }
      }
      r++;
    }
    /* 岩面碎屑与裂隙：2~3px 碎屑 + 1px 裂隙，铺满贴图（不做 24px 对齐） */
    for (var i = 0; i < 420; i++) {
      var gx = Math.floor(hashXY(i * 7 + 1, 3) * S);
      var gy = Math.floor(hashXY(i * 13 + 5, 11) * S);
      var r1 = hashXY(gx, gy);
      c.fillStyle = r1 < 0.5 ? 'rgba(176,156,218,0.10)' : 'rgba(126,108,166,0.055)';
      c.fillRect(gx, gy, 3, 2);
      if (r1 < 0.22) {
        c.fillStyle = 'rgba(0,0,0,0.42)';
        c.fillRect(gx + 1, gy + 2, 2, 2 + ((r1 * 100) | 0) % 5);
      }
    }
    outerTex.cv = cv;
    return cv;
  }

  function drawOuterFrame(ctx, W, H, mx, my, mw, mh) {
    if (!OUTER.on) {
      ctx.fillStyle = '#14142a'; /* D-116 之前：整块平背景（负例回放用） */
      ctx.fillRect(0, 0, W, H);
      return;
    }
    /* 1) 最远层：整屏洞窟黑 */
    ctx.fillStyle = OUTER.base;
    ctx.fillRect(0, 0, W, H);
    /* 2) 岩壁贴图 / 向内收光：全部裁在"地图矩形之外"，地图内部零改动 */
    try {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(mx, my, mw, mh);
      ctx.clip('evenodd');
      var pat = ctx.createPattern(buildOuterTile(), 'repeat');
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, W, H);
      }
      /* 向内收光：按"到地图边的距离"逐侧衰减（不是全屏径向），
       * 地图沿口的岩壁最亮、越往外越沉进黑暗，视觉重心被压回地图。
       * 衰减条是 150px 的预烘贴图（同 FADE_LEN），比每次现算 4 条渐变快得多。 */
      if (my > 0) ctx.drawImage(fadeStrip('vOpaque', 1, FADE_LEN, true), 0, my - FADE_LEN, W, FADE_LEN);
      if (my + mh < H) ctx.drawImage(fadeStrip('vClear', 1, FADE_LEN, false), 0, my + mh, W, FADE_LEN);
      if (mx > 0) ctx.drawImage(fadeStrip('hOpaque', FADE_LEN, 1, true), mx - FADE_LEN, 0, FADE_LEN, H);
      if (mx + mw < W) ctx.drawImage(fadeStrip('hClear', FADE_LEN, 1, false), mx + mw, 0, FADE_LEN, H);
      ctx.restore();
    } catch (e) {
      /* 不支持 evenodd 裁剪的内核：只保留整屏底色，绝不让岩壁越过地图边界 */
    }
    /* 3) 沿口接触阴影：地图像被嵌进岩体里，而不是浮在纹理上 */
    ctx.fillStyle = OUTER.ink;
    ctx.fillRect(mx - 4, my - 4, mw + 8, 4);
    ctx.fillRect(mx - 4, my + mh, mw + 8, 4);
    ctx.fillRect(mx - 4, my, 4, mh);
    ctx.fillRect(mx + mw, my, 4, mh);
    /* 4) 地图沿口 1px 线：把"地图边界"和"岩体"钉成两条可分的结构线 */
    ctx.fillStyle = OUTER.rim;
    ctx.fillRect(mx - 1, my - 1, mw + 2, 1);
    ctx.fillRect(mx - 1, my + mh, mw + 2, 1);
    ctx.fillRect(mx - 1, my, 1, mh);
    ctx.fillRect(mx + mw, my, 1, mh);
  }


  /* D-117：F1 / F2 的"这是哪一层"构图层。
   * 复判归因"配色 40% / 构图 60%"，所以差异必须落在结构上，而不是把颜色调艳：
   *   F1 地牢 = 人工砌筑：48px 大石板的通缝 + 错缝半缝 + 凿痕，全部正交感；
   *   F2 营地 = 兽人踩踏：45° 斜向刮痕 / 木板 / 骨屑 / 贴墙木桩影，没有一条正交长线。
   * 无新素材也成立的原因：石缝/刮痕/木桩影都是 canvas 直线与矩形，靠**梯度方向**
   * 而不是靠色相区分——把画面压到只剩亮度轮廓时，正交网格与斜向乱纹仍然可分。
   * 颜色只做同向加强：F1 冷灰石粉（低饱和，不进色相统计），F2 暖褐土（顺 F2 的
   * 营地 tint）。只加深、只加 1px 低 alpha 受光，地板均值不抬。
   * 纪律：只画 t===1 且当前可见的格；四周留 ≥4px 不碰 D-113 的交界取样带；
   *       楼梯/宝箱/陷阱/NPC/装饰格不画（不进 _ambientAt 的避让口径，纯跳过）。 */
  var LAYER_SIG = {
    on: true,
    f1: { groove: 'rgba(9,11,20,0.42)', bevel: 'rgba(150,168,205,0.07)', chisel: 'rgba(0,0,0,0.24)' },
    f2: { scuff: 'rgba(26,15,7,0.34)', board: 'rgba(44,26,12,0.36)',
      bone: 'rgba(226,206,170,0.10)', stake: 'rgba(20,12,6,0.32)' }
  };

  function sigHash(x, y, k) {
    return hashXY(x * 17 + k * 7 + 11, y * 23 + k * 13 + 5);
  }

  /* F1：画"砌筑石板"在本格内的那一部分。
   * 不用 2×2 房间模块对齐——实测 F1 地图里偶数格起点、四格全地板的模块几乎不存在
   * （走廊多为奇数坐标）。改成绝对坐标的砌筑规则，任何地板格都成立：
   *   横缝：绝对 y = 48k + 7（每两行一条，局部 7px，避开 D-113 的顶部 3px 取样带）
   *   竖缝：每个 48px 砌层内 X = 48k + 7 / 48k + 31 交替 → running bond 错缝
   * 只在本格内落笔，与绘制顺序无关；无长斜线，梯度方向统计是纯正交感。 */
  function drawSigF1(ctx, grid, x, y, px, py) {
    var gy = y * TILE, gx = x * TILE;
    /* 横缝：本格局部 y（48px 一条，只会落在偶数行的 7px 处） */
    var seam = (7 - (gy % 48) + 48) % 48;
    if (seam + 3 <= TILE) {
      ctx.fillStyle = LAYER_SIG.f1.groove;
      ctx.fillRect(px, py + seam, TILE, 3);
      /* 下沿受光 1px：石缝有厚度，不是纯描边 */
      ctx.fillStyle = LAYER_SIG.f1.bevel;
      ctx.fillRect(px, py + seam + 3, TILE, 1);
    }
    /* 竖缝：所属 48px 砌层的错缝相位，局部只会是 7 或 31（31 出格则本格不画） */
    var band = Math.floor(gy / 48);
    var jointOff = (band % 2) ? 31 : 7;
    var jx = (jointOff - (gx % 48) + 48) % 48;
    if (jx + 3 <= TILE) {
      ctx.fillStyle = LAYER_SIG.f1.groove;
      ctx.fillRect(px + jx, py, 3, TILE);
    }
    /* 凿痕：少数格 2×1 的深点，把表面读成被加工过的石材 */
    if (sigHash(x, y, 1) > 0.84) {
      ctx.fillStyle = LAYER_SIG.f1.chisel;
      var qx = px + 9 + ((sigHash(x, y, 5) * 7) | 0);
      var qy = py + 9 + ((sigHash(x + 2, y, 6) * 7) | 0);
      ctx.fillRect(qx, qy, 2, 1);
      ctx.fillRect(qx + 3, qy + 4, 1, 2);
    }
  }

  /* F2：斜向踩踏痕 + 木板 + 骨屑 + 贴墙木桩影。全部 45° 或近 45°，没有正交长线。 */
  function drawSigF2(ctx, grid, x, y, px, py) {
    var h = sigHash(x, y, 2);
    var wallUp = !!(grid[y - 1] && grid[y - 1][x] === 0);
    /* 1) 刮痕：3~5 条 45° 短划，起止都留在 [5,19]，不碰四边 4px */
    var n = 3 + ((h * 97) | 0) % 3;
    ctx.strokeStyle = LAYER_SIG.f2.scuff;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var a = 5 + ((sigHash(x + i * 31, y, 3) * 5) | 0);
      var L = 5 + ((sigHash(x, y + i * 19, 4) * 5) | 0);
      if (a + L > 19) L = 19 - a;
      if (L <= 2) continue;
      var flip = ((sigHash(x + i, y + i * 7, 7) * 1000) | 0) % 2 === 0;
      var sy = 5 + ((sigHash(x - i, y + i, 8) * 5) | 0);
      if (flip) {
        ctx.moveTo(px + a, py + sy); ctx.lineTo(px + a + L, py + sy + L);
      } else {
        ctx.moveTo(px + a, py + sy + L); ctx.lineTo(px + a + L, py + sy);
      }
    }
    ctx.stroke();
    /* 2) 木板：少数格一条 3px 粗的长斜板（营地建材散落） */
    if (h > 0.90) {
      ctx.strokeStyle = LAYER_SIG.f2.board;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px + 6, py + 18);
      ctx.lineTo(px + 19, py + 6);
      ctx.stroke();
    }
    /* 3) 骨屑：极少数格两粒淡骨色短划（不亮过地板高光） */
    if (h > 0.965) {
      ctx.fillStyle = LAYER_SIG.f2.bone;
      ctx.fillRect(px + 7, py + 8, 3, 1);
      ctx.fillRect(px + 12, py + 11, 2, 1);
    }
    /* 4) 贴墙木桩影：墙在正上方时，离墙 4px 起一条 2×8 的深色短柱 */
    if (wallUp && x % 3 === 1) {
      ctx.fillStyle = LAYER_SIG.f2.stake;
      ctx.fillRect(px + 11, py + 4, 2, 8);
    }
  }

  function drawLayerSig(ctx, grid, pf, x, y, px, py) {
    if (!LAYER_SIG.on) return;
    if (pf === 1) drawSigF1(ctx, grid, x, y, px, py);
    else if (pf === 2) drawSigF2(ctx, grid, x, y, px, py);
  }

  /* 类别内框：先 1px 深墨外描边，再压类别色，保证亮地板/暗墙上都有确定边界 */
  function interactBorder(ctx, px, py, s) {
    if (!INTERACT.on || !ctx) return;
    var side = TILE - s.inset * 2;
    if (typeof ctx.save === 'function') ctx.save();
    ctx.lineWidth = s.w + 1;
    ctx.strokeStyle = s.ink;
    ctx.strokeRect(px + s.inset - 0.5, py + s.inset - 0.5, side, side);
    ctx.lineWidth = s.w;
    ctx.strokeStyle = s.color;
    ctx.strokeRect(px + s.inset - 0.5, py + s.inset - 0.5, side, side);
    if (typeof ctx.restore === 'function') ctx.restore();
  }

  /* 楼梯：内框 + 方向三角（三角 10×8，中心对称，箭头朝向即上下行） */
  function drawStairMark(ctx, px, py, down) {
    if (!INTERACT.on) return;
    var s = INTERACT.stair;
    interactBorder(ctx, px, py, s);
    var cx = px + TILE / 2, cy = py + TILE / 2, w = 5, h = 4;
    if (typeof ctx.save === 'function') ctx.save();
    ctx.beginPath();
    if (down) {
      ctx.moveTo(cx - w, cy - h); ctx.lineTo(cx + w, cy - h); ctx.lineTo(cx, cy + h);
    } else {
      ctx.moveTo(cx - w, cy + h); ctx.lineTo(cx + w, cy + h); ctx.lineTo(cx, cy - h);
    }
    ctx.closePath();
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.ink;
    ctx.stroke();
    ctx.fillStyle = s.color;
    ctx.fill();
    if (typeof ctx.restore === 'function') ctx.restore();
  }


  Game.Core.Render = {
    /* D-90：地块尺寸只读入口（系统层按同一 TILE 换算，避免第二份 24） */
    TILE: TILE,
    /* D-57：朝向帧状态与玩家图形绘制（验证页 B/C/F 组复用） */
    playerFrameState: playerFrameState,
    drawPlayerFigure: drawPlayerFigure,
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
    /* D-113：探索墙压暗参数。传对象为设置（只覆盖已知键），返回当前快照；
     * 验证页用旧值 / 负例值回放时仍走同一条 drawMap 绘制路径。 */
    _wallStyle: function (o) {
      if (o && typeof o === 'object') {
        for (var k in o) {
          if (Object.prototype.hasOwnProperty.call(o, k) && WALL_STYLE.hasOwnProperty(k)) {
            WALL_STYLE[k] = o[k];
          }
        }
      }
      var snap = {};
      for (var k2 in WALL_STYLE) if (WALL_STYLE.hasOwnProperty(k2)) snap[k2] = WALL_STYLE[k2];
      return snap;
    },
    /* D-115：可交互物统一语法的只读快照与总开关（验证页做负例回放）。
     * 关闭后楼梯回到 D-113 的原样（只剩贴图），用于证明断言会真红。 */
    _interactStyle: function () {
      return {
        stair: { color: INTERACT.stair.color, w: INTERACT.stair.w, inset: INTERACT.stair.inset },
        trap: { color: INTERACT.trap.color, w: INTERACT.trap.w, inset: INTERACT.trap.inset },
        npc: { color: INTERACT.npc.color, w: INTERACT.npc.w, inset: INTERACT.npc.inset },
        on: INTERACT.on
      };
    },
    _interactMarks: function (on) {
      if (typeof on === 'boolean') {
        INTERACT.on = on;
        staticCache.valid = false; /* 标识变化 → 静态层必须重建，不能停旧图 */
      }
      return INTERACT.on;
    },
    /* D-116：场外岩框的快照 / 设置（传对象只覆盖已知键，同 _wallStyle 口径）与回放开关。
     * 验证页用两处：_outerFrame(false) 回放改动前的平背景；_outerStyle(地板棕) 造
     * "场外长成可走地面"的反例，证明可分性断言会真红。 */
    _outerStyle: function (o) {
      if (o && typeof o === 'object') {
        for (var k in o) {
          if (Object.prototype.hasOwnProperty.call(o, k) && OUTER.hasOwnProperty(k) && k !== 'on') {
            OUTER[k] = o[k];
          }
        }
        outerTex.cv = null; /* 颜色变了 → 烘好的岩壁贴图作废 */
        staticCache.valid = false;
      }
      return { on: OUTER.on, base: OUTER.base, far: OUTER.far, mid: OUTER.mid,
        near: OUTER.near, ink: OUTER.ink, rim: OUTER.rim };
    },
    _outerFrame: function (on) {
      if (typeof on === 'boolean') {
        OUTER.on = on;
        staticCache.valid = false;
      }
      return OUTER.on;
    },
    /* D-117：层辨识构图的总开关（验证页回放"改动前"）。关闭后 F1/F2 只剩贴图与 tint，
     * 与 D-116 末的快照逐像素一致；F3–F5 无论开关都必须完全一致。 */
    _layerSig: function (on) {
      if (typeof on === 'boolean') {
        LAYER_SIG.on = on;
        staticCache.valid = false;
      }
      return LAYER_SIG.on;
    },
    _layerSigStyle: function () {
      return {
        on: LAYER_SIG.on,
        f1: { groove: LAYER_SIG.f1.groove, bevel: LAYER_SIG.f1.bevel, chisel: LAYER_SIG.f1.chisel },
        f2: { scuff: LAYER_SIG.f2.scuff, board: LAYER_SIG.f2.board,
          bone: LAYER_SIG.f2.bone, stake: LAYER_SIG.f2.stake }
      };
    },
    /* 第三拨 D-88：五层背景的空间语义表（只读）与纯背景绘制入口（验证页逐像素裁决用）。
     * 绘制入口只画背景，不画怪/文字/HUD，因此验证页可以把"背景亮度分布"和"战斗内容"分开测。 */
    _battleScene: BATTLE_SCENE,
    /* D-94：战斗布局开关与横置几何（只读；验证页/实拍台与 drawBattle 共用一份公式）。
     * 默认 'vertical'；'auto' 按 §6.8 回退；'horizontal' 仅门帧试装使用。 */
    _setBattleLayout: function (mode) {
      BATTLE_LAYOUT = (mode === 'horizontal' || mode === 'auto') ? mode : 'vertical';
      return BATTLE_LAYOUT;
    },
    _battleLayoutMode: function () { return BATTLE_LAYOUT; },
    _battleLayoutNow: function () {
      return resolveBattleLayout(this.cssW || BASE_W, this.cssH || BASE_H);
    },
    /* D-102：把判据函数本身作为唯一出口——Juice / 验证页按传入 W/H 取布局，不再各写一份比例式 */
    _resolveBattleLayout: function (W, H) { return resolveBattleLayout(W, H); },
    _battleLayoutGeo: function (W, H) { return horizontalBattleGeo(W, H); },
    /* D-102：布局安全带（Juice 结果卡 / 验证页共用；见 battleSafeBand 注释） */
    _battleSafeBand: function (W, H, layout, box) { return battleSafeBand(W, H, layout, box); },
    _verticalBattleGeo: function (W, H) { return verticalBattleGeo(W, H); },
    _cardH: CARD_H,
    /* D-102：字号阶梯唯一来源（规格 §4.3：11/12/13/16/18/20） */
    _fontLadder: [11, 12, 13, 16, 18, 20],
    /* D-102：战斗信息实际用到的字号（全部取自阶梯；HUD 的 9/10px 装饰不在战斗信息口径内） */
    _fonts: { cardName: 13, cardHp: 11, chip: 11, log: 12, pipelineRound: 13,
      pipelineNode: 13, cellName: 13, cellNameCompact: 12, cellCost: 11, barHeader: 11, barFooter: 11 },
    _battleBackdrop: function (c2, W2, H2, floor, layout) { drawBattleBackdrop(c2, W2, H2, floor, layout); },
    _battleSceneH: HORIZONTAL_SCENE,  /* D-94 P2：横置五层场景表（只读，验证页取 backWall 实数） */
    /* 第三拨 D-88：龙眼绘制单元（验证页在纯画布上量"双瞳/间距/是否落在头部"） */
    _drawDragonEyes: drawDragonEyes,
    /* 第二拨：Boss 落屏高度口径（原生高 × 2，整数倍），验证页与 drawBattle 共用同一公式 */
    BOSS_MUL: 2,
    /* D-104：战斗精灵整数倍口径——所有稳定帧的落屏高 == 原生高 × BATTLE_SPRITE_MUL。
     * 验证页据此断言（旧 90/42=2.143、90/35=2.571 必须判负）。 */
    BATTLE_SPRITE_MUL: BATTLE_SPRITE_MUL,
    battleSpriteHeight: battleSpriteH,
    /* D-105：濒死整数档纯函数——验证页采样 0..1，断言返回值只能是 2 或 1。 */
    battleDyingMul: battleDyingMul,
    bossDrawHeight: function (img) {
      var nh = img && (img.naturalHeight || 0);
      return nh > 0 ? nh * 2 : 108;
    },
    /* M9-5：DPR 高清适配——逻辑坐标统一用 CSS 像素，物理像素 = CSS * dpr */
    dpr: 1,
    scale: 1,      /* 自适应缩放系数：逻辑像素 → CSS 像素 */
    cssPxW: 0,     /* 画布实际 CSS 尺寸（窗口尺寸） */
    cssPxH: 0,
    cssW: 0,       /* 逻辑视口尺寸（绘制/命中坐标空间 = cssPx / scale） */
    cssH: 0,
    _animNow: null,  /* P1-3：可注入时钟函数（验证页冻结动画帧）；null=用 performance.now */
    /* D-48：画面缩放设置。'auto' = 原有自适应结果（默认，行为不变）；
     * '1' / '1.25' / '1.5' = 玩家在首屏设置页里显式选择的固定缩放。 */
    _scaleMode: 'auto',
    setScaleMode: function (m) {
      this._scaleMode = (m === '1' || m === '1.25' || m === '1.5') ? m : 'auto';
      if (this._canvas) this.resize();
      return this._scaleMode;
    },
    getScaleMode: function () { return this._scaleMode; },

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
      /* D-48：显式缩放设置优先（'auto' 时走原公式，所有既有页面结果不变） */
      if (this._scaleMode && this._scaleMode !== 'auto') {
        var fixed = parseFloat(this._scaleMode);
        if (isFinite(fixed) && fixed > 0) return Math.min(Math.max(fixed, 0.5), 2);
      }
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

    /* ── D-100：鼠标热区注册表 ─────────────────────────────────────
     * 绘制层只负责"把这一帧真的画出来的可点矩形登记进来"，命中层不再另算一份坐标。
     * 逆序遍历：后画的（弹窗）优先于先画的（地图/菜单）。 */
    _hotReset: function () { HOT.length = 0; },
    _hotAdd: function (id, x, y, w, h) {
      if (!id || !isFinite(x) || !isFinite(y) || !(w > 0) || !(h > 0)) return;
      HOT.push({ id: id, x: x, y: y, w: w, h: h });
    },
    _hotAt: function (x, y) {
      for (var i = HOT.length - 1; i >= 0; i--) {
        var r = HOT[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
      }
      return null;
    },
    _hotList: function () { return HOT.slice(); },
    _hoverId: function () { return HOVER_ID; },
    /* D-103：键盘焦点与鼠标 hover 共用一个状态（FOCUS_ID），绘制只认这一份——
     * 因此"按 1–7"与"鼠标停在该格"画出来的高亮必然逐像素一致（同一函数、同一组颜色）。 */
    _cmdFocus: function () { return FOCUS_ID; },
    _cmdStyle: function () { return CMD_STYLE; },
    _commandFocus: function (cmd) {
      for (var i = 0; i < H_CMDS.length; i++) {
        if (H_CMDS[i].cmd === cmd) {
          FOCUS_ID = 'battle:' + H_CMDS[i].key;
          return H_CMDS[i].key;
        }
      }
      return 0;
    },
    /* 只在热区 id 变化时改 cursor（不每帧写 DOM）；返回是否真的写了 */
    _setHover: function (id) {
      id = id || null;
      FOCUS_ID = id;
      if (id === HOVER_ID) return false;
      HOVER_ID = id;
      var cv = this._canvas;
      if (cv && cv.style) cv.style.cursor = id ? 'pointer' : 'default';
      return true;
    },

    /* D-100：验证/调试只读——当前地图相机偏移（与 _screenToTile 同一口径） */
    _cam: function () { return { x: cam.x, y: cam.y }; },

    /* D-100：逻辑坐标 → 地图格（与 drawMap 的 cam 同一口径）。
     * 返回 null 表示落在可视地图之外。 */
    _screenToTile: function (x, y) {
      var grid = Game.Systems && Game.Systems.Map && typeof Game.Systems.Map.getGrid === 'function'
        ? Game.Systems.Map.getGrid() : null;
      if (!grid || !grid.length) return null;
      var gx = Math.floor((x + cam.x) / TILE);
      var gy = Math.floor((y + cam.y) / TILE);
      if (gy < 0 || gy >= grid.length || gx < 0 || gx >= grid[0].length) return null;
      return { x: gx, y: gy };
    },

    /* D-100：战斗七格指令条的几何——绘制与命中共用这一份（横/纵由同一布局解析决定）。 */
    _battleBarInfo: function (state) {
      var W = this.cssW || 1024, H = this.cssH || 640;
      return (resolveBattleLayout(W, H) === 'horizontal')
        ? hCommandBar(W, H, state) : vCommandBar(W, H, state);
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
     * D-79：返回贴图名（含楼层主题前缀），由调用方按 baseOf 决定绘制尺寸。 */
    _wallSpriteName: function (grid, x, y, floor) {
      var f = (typeof floor === 'number' && floor > 0) ? floor : 1;
      var p = (f === 1) ? '' : ('t' + f + '_');
      if (!this._isWall(grid, x, y + 1)) {
        var leftTop = this._isWall(grid, x - 1, y) && !this._isWall(grid, x - 1, y + 1);
        var rightTop = this._isWall(grid, x + 1, y) && !this._isWall(grid, x + 1, y + 1);
        var topName = (!leftTop && rightTop) ? 'wall_top_left'
          : (leftTop && !rightTop) ? 'wall_top_right'
          : 'wall_top_mid';
        return p + topName;
      }
      var leftWall = this._isWall(grid, x - 1, y);
      var rightWall = this._isWall(grid, x + 1, y);
      return p + (!leftWall ? 'wall_left' : (!rightWall ? 'wall_right' : 'wall_mid'));
    },

    _wallSprite: function (grid, x, y, floor) {
      if (!this._hasSprites()) return null;
      return Game.Core.Sprites.get(this._wallSpriteName(grid, x, y, floor));
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
     * id: chest(宝箱黄框) / barrel(木桶棕框) / torch(火把橙焰) / vine(藤蔓绿条)
     * D-35：① 贴图改走地图尺寸口径（原生高 × TILE/16，脚底锚定格底），不再压进一格；
     *       ② 落地类装饰补地面投影；③ noShadow=true 供"装饰前层"重绘时跳过投影，避免压角色一脚。 */
    _drawDecor: function (ctx, id, px, py, noShadow) {
      /* S-05：密室宝箱——先铺一层金色光晕（有贴图时也保留，远看就能认出"这里有厚赏"） */
      if (id === 'room_chest') {
        ctx.fillStyle = 'rgba(255,207,110,0.20)';
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2 + 3, 0, Math.PI * 2);
        ctx.fill();
      }
      /* D-35：只有"立在地上"的物件补投影；火把/藤蔓是贴在墙面上的竖向物件，给了投影反而更假 */
      if (!noShadow && (id === 'chest' || id === 'room_chest' || id === 'barrel' ||
        id === 'crate' || id === 'skull')) {
        groundShadow(ctx, px + TILE / 2, py + TILE, TILE - 6, true);
      }
      var sp = this._hasSprites() ? Game.Core.Sprites.get(id) : null;
      /* P1-1：chest/crate/skull/wall_goo 有同名贴图则直接绘制；
       * barrel/torch/vine 无同名文件（get 返回 null）→ 继续走下方程序化兜底 */
      if (sp) { drawSpriteByUnit(ctx, sp, px + TILE / 2, py + TILE, baseOfName(id)); return; }
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
      } else if (id === 'gold_pile') {
        /* D-79：金币堆改用重绘后的 coin 贴图（16×16 → 每枚 10×10），三枚叠放；
         * 贴图缺失时回退旧的三圆点画法（保持可玩性，不因素材缺失白屏） */
        var cimg = this._hasSprites() ? Game.Core.Sprites.get('coin') : null;
        if (cimg) {
          var cpos = [[1, 12], [13, 10], [7, 14]];
          for (var ci2 = 0; ci2 < cpos.length; ci2++) {
            ctx.drawImage(cimg, px + cpos[ci2][0], py + cpos[ci2][1], 10, 10);
          }
        } else {
          var coins0 = [[4, 9], [9, 7], [6, 11]];
          for (var ci0 = 0; ci0 < coins0.length; ci0++) {
            ctx.fillStyle = '#d9a021';
            ctx.beginPath();
            ctx.arc(px + coins0[ci0][0], py + coins0[ci0][1], 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffd24a';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      } else if (id === 'potion_stash') {
        /* D-46：补给包——红瓶身 + 白瓶塞，与背包里的血瓶同一视觉语言 */
        ctx.fillStyle = '#7a2020';
        ctx.fillRect(px + 5, py + 6, TILE - 10, TILE - 10);
        ctx.fillStyle = '#e04848';
        ctx.fillRect(px + 6, py + 7, TILE - 12, TILE - 13);
        ctx.fillStyle = '#e8e8e8';
        ctx.fillRect(px + TILE / 2 - 2, py + 4, 4, 3);
      }
    },

    /* S-04：已触发的陷阱——地刺画三根红尖刺，毒气画绿色雾团（触发后永久留在该格） */
    _drawTrap: function (ctx, id, px, py) {
      /* D-115：已发现陷阱的统一类别内框（红 1px），压在符号之下 */
      interactBorder(ctx, px, py, INTERACT.trap);
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

    /* D-35：装饰与角色的前后关系（不引入全局 y 排序，静态层保持原样）。
     * 规则按"脚下行的浮点位置"判定：只有当装饰格行号严格大于角色当前行（ty 可为小数，
     * 玩家/巡逻怪移动插值时为 5.5 这种值）才补画在角色之上——也就是"走进物件那一行时，
     * 物件的边缘先盖住脚"。角色静止站在物件格上时（ty 为整数）物件仍在身后，
     * 不会出现"人被木桶埋掉"。只重画角色周围 ±cols 列、2 行，不整屏重绘；
     * 不改 map.js 的装饰放置规则。 */
    _drawFrontDecor: function (ctx, grid, tx, ty) {
      if (!grid || !Game.Systems || !Game.Systems.Map ||
        typeof Game.Systems.Map.getDecor !== 'function') return;
      var fovOn = !!(Game.fov && Game.fov.isVisible);
      var row0 = Math.floor(ty) + 1;
      for (var yy = row0; yy <= row0 + 1; yy++) {
        for (var xx = tx - 1; xx <= tx + 1; xx++) {
          if (yy < 0 || yy >= grid.length || !grid[yy] || xx < 0 || xx >= grid[yy].length) continue;
          if (fovOn && !Game.fov.isVisible(xx, yy)) continue;
          var dec = Game.Systems.Map.getDecor(xx, yy);
          if (!dec) continue;
          /* noShadow=true：投影已在静态层画过，重绘只补"遮挡"这一层 */
          this._drawDecor(ctx, dec, xx * TILE - cam.x, yy * TILE - cam.y, true);
        }
      }
    },

    drawMap: function (grid, player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx || !grid) return;
      this._hotReset(); /* D-100：本帧热区从场景层开始登记（弹窗随后叠加） */
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
      /* D-114：X3 六格网格残迹已删除（实测只改 0.02–0.03% 像素，不可见），此处不再留绘制钩子。 */
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
            /* D-35：尺寸口径统一走 unitBox（原生高 × TILE/16、脚底锚定格底）。
             * 埋伏标记从"整格 24×24 半透明红膜"改为"贴图自身矩形描边"：旧红膜把同格装饰
             * 一起染红（实测加怪后该格 784/784 设备像素全部变化），现在只描怪物自己的框。 */
            var ecx = es[i].x * TILE - cam.x + TILE / 2;
            var ebt = es[i].y * TILE - cam.y + TILE;
            var ebox = unitBox(eimg, ecx, ebt, imgBase(eimg));
            if (ebox) {
              groundShadow(ctx, ecx, ebt, ebox.w);
              /* D-35：埋伏标记从"整格 24×24 半透明红膜"改为"脚下红色警戒环"。
               * 旧红膜把同格装饰一起染红（实测加怪后该格 784/784 设备像素全部变化），
               * 现在红色只落在怪物脚下的椭圆环上，装饰与地面保持原色。 */
              ctx.save();
              ctx.strokeStyle = 'rgba(234,102,104,0.7)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.ellipse(ecx, ebt - 2, Math.max(6, ebox.w * 0.42), 2, 0, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
              ctx.drawImage(eimg, ebox.x, ebox.y, ebox.w, ebox.h);
              /* D-35：装饰前后关系——走进物件所在行时，物件边缘盖住脚 */
              this._drawFrontDecor(ctx, grid, es[i].x, es[i].y);
            }
          } else {
            ctx.fillStyle = '#ea6668';
            ctx.beginPath();
            ctx.arc(epx + TILE / 2 - 3, epy + TILE / 2 - 3, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      /* D-69：层内精英——复用本层普通怪的贴图（el.sprite 查 MONSTER_ANIM），
       * 只额外加"金色脚下光环 + 头顶★"，不新增素材、不改普通怪/巡逻怪的绘制。 */
      var els = (Game.Systems.Map.getElites) ? Game.Systems.Map.getElites() : [];
      for (var ei = 0; ei < els.length; ei++) {
        if (fovOn && !Game.fov.isVisible(els[ei].x, els[ei].y)) continue;
        var elx = els[ei].x * TILE - cam.x + TILE / 2;
        var ely = els[ei].y * TILE - cam.y + TILE;
        if (elx < -20 || ely < -20 || elx > W + 20 || ely > H + 20) continue;
        var elimg = null;
        if (this._hasSprites()) {
          elimg = monsterFrame(els[ei].sprite, false);
          if (!elimg) elimg = Game.Core.Sprites.get('monster_chort');
        }
        if (elimg) {
          var elbox = unitBox(elimg, elx, ely, imgBase(elimg));
          if (elbox) {
            groundShadow(ctx, elx, ely, elbox.w);
            ctx.save();
            ctx.strokeStyle = 'rgba(255,193,77,0.95)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(elx, ely - 2, Math.max(8, elbox.w * 0.52), 2.5, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            ctx.drawImage(elimg, elbox.x, elbox.y, elbox.w, elbox.h);
            ctx.save();
            ctx.fillStyle = '#ffc14d';
            ctx.font = '9px monospace';
            ctx.fillText('★', elx - 3, elbox.y - 2);
            ctx.restore();
            this._drawFrontDecor(ctx, grid, els[ei].x, els[ei].y);
          }
        } else {
          ctx.fillStyle = '#ffc14d';
          ctx.beginPath();
          ctx.arc(elx - 3, ely - TILE / 2 - 3, 4, 0, Math.PI * 2);
          ctx.fill();
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
            /* D-35：尺寸口径同埋伏怪；追击标记同样由"整格红膜"改为贴图描边，
             * 避免把怪物脚下的装饰整块染红。 */
            var pcx = prx * TILE - cam.x + TILE / 2;
            var pbt = pry * TILE - cam.y + TILE;
            var pbox = unitBox(pimg, pcx, pbt, imgBase(pimg));
            if (pbox) {
              groundShadow(ctx, pcx, pbt, pbox.w);
              if (chasing) {
                ctx.save();
                ctx.strokeStyle = 'rgba(234,102,104,0.7)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.ellipse(pcx, pbt - 2, Math.max(6, pbox.w * 0.42), 2, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
              }
              ctx.drawImage(pimg, pbox.x, pbox.y, pbox.w, pbox.h);
              this._drawFrontDecor(ctx, grid, Math.round(prx), pry);
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
      /* D-47：实体 NPC（程序化像素小人 + 任务标记）。动态层绘制，FOV 裁剪，
       * 不引入新素材；NPC 格本身仍是可通行地板，绘制不改变任何碰撞/寻路。 */
      var nps = (Game.Systems.Map && typeof Game.Systems.Map.getNpcs === 'function')
        ? Game.Systems.Map.getNpcs() : [];
      for (var ni = 0; ni < nps.length; ni++) {
        var no = nps[ni];
        if (fovOn && !Game.fov.isVisible(no.x, no.y)) continue;
        var ncx = no.x * TILE - cam.x + TILE / 2;
        var nbt = no.y * TILE - cam.y + TILE;
        if (ncx < -30 || nbt < -30 || ncx > W + 30 || nbt > H + 30) continue;
        /* D-115：NPC 的绿色类别内框画在脚下格、人形之前（人覆盖框，优先级正确） */
        interactBorder(ctx, no.x * TILE - cam.x, no.y * TILE - cam.y, INTERACT.npc);
        groundShadow(ctx, ncx, nbt, TILE - 8);
        /* 斗篷 + 腰带 + 头 + 提灯：4 个色块足够一眼认出"这里站着一个人" */
        ctx.fillStyle = '#46567f';
        ctx.fillRect(ncx - 5, nbt - 16, 10, 15);
        ctx.fillStyle = '#2a3350';
        ctx.fillRect(ncx - 5, nbt - 5, 10, 3);
        ctx.fillStyle = '#e6c69c';
        ctx.beginPath();
        ctx.arc(ncx, nbt - 19, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffcf6e';
        ctx.fillRect(ncx + 6, nbt - 12, 3, 4);
        /* 任务标记：未接取 / 可交付 = 金色 "!"；进行中不画（避免满屏感叹号） */
        var nst = (Game.Systems.NpcQuest && typeof Game.Systems.NpcQuest.state === 'function')
          ? Game.Systems.NpcQuest.state(no.id) : '';
        if (nst === 'unaccepted' || nst === 'ready') {
          ctx.fillStyle = '#ffcf6e';
          ctx.font = 'bold 10px monospace';
          ctx.fillText('!', ncx - 2, nbt - 26);
        }
        /* 相邻 2 格内显示名字，提示"这里可以按 T" */
        var pd = (player && typeof player.x === 'number')
          ? Math.max(Math.abs(player.x - no.x), Math.abs(player.y - no.y)) : 99;
        if (pd <= 2) {
          var ndef = (Game.Systems.NpcQuest && Game.Systems.NpcQuest.def)
            ? Game.Systems.NpcQuest.def(no.id) : null;
          var nlabel = ndef ? ndef.name : 'NPC';
          ctx.font = '10px monospace';
          var nw = Math.round(ctx.measureText(nlabel).width);
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(ncx - nw / 2 - 3, nbt - 40, nw + 6, 13);
          ctx.fillStyle = '#ffe6b0';
          ctx.fillText(nlabel, ncx - nw / 2, nbt - 30);
          if (pd <= 1) {
            /* D-79：火把光晕/环境色会把亮色文字冲淡（实测光圈核心处对比度仅 ~1.2），
             * 给"按 T"提示加一层深底，保证任何底色下都可读。 */
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(ncx - 7, nbt - 55, 15, 13);
            ctx.fillStyle = '#9bbbf4';
            ctx.fillText('T', ncx - 2, nbt - 46);
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
    /* D-80：按真实绘制公式返回某帧图的落屏 box（{x,y,w,h}），供验证页断言尺寸口径 */
    _unitBoxOf: function (img) { return unitBoxOf(img); },
    drawIcon: drawIcon,

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

    /* D-79：氛围装饰层——纯渲染，不写地图数据、不占格、不参与寻路。
     * 越深密度越高（F1 6% → F5 16%）；避开可交互格（装饰/陷阱/密室门/怪物/NPC/精英）。 */
    _ambientAt: function (grid, x, y, pf) {
      if (!this._hasSprites()) return null;
      if (!grid[y] || grid[y][x] !== 1) return null;
      var M = Game.Systems.Map;
      if (M) {
        if (typeof M.getDecor === 'function' && M.getDecor(x, y)) return null;
        if (typeof M.getTrap === 'function' && M.getTrap(x, y)) return null;
        if (typeof M.isSecretRoomDoor === 'function' && M.isSecretRoomDoor(x, y)) return null;
      }
      var dens = [0, 6, 8, 11, 13, 16][pf] || 6;
      var hv = ((x * 73856093) ^ (y * 19349663) ^ (pf * 83492791)) >>> 0;
      if ((hv % 100) >= dens) return null;
      var i, list;
      if (M && typeof M.getEnemies === 'function') {
        list = M.getEnemies() || [];
        for (i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) return null;
      }
      if (M && typeof M.getNpcs === 'function') {
        list = M.getNpcs() || [];
        for (i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) return null;
      }
      if (M && typeof M.getElites === 'function') {
        list = M.getElites() || [];
        for (i = 0; i < list.length; i++) if (list[i].x === x && list[i].y === y) return null;
      }
      var wallAdj = this._isWall(grid, x - 1, y) || this._isWall(grid, x + 1, y) ||
        this._isWall(grid, x, y - 1) || this._isWall(grid, x, y + 1);
      var types = ['puddle', 'rubble', 'blood', 'mold'];
      if (wallAdj) types = types.concat(['web', 'chain', 'torch']);
      var k = types[(hv >>> 9) % types.length];
      return 't' + pf + '_dc_' + k;
    },

    /* D-79：房间分类（纯函数，供渲染与 verify_d79 共用；只读 grid，不写任何状态） */
    _roomKind: function (grid, x, y, secret, bossNear) {
      return roomKind(grid, x, y, !!secret, !!bossNear);
    },

    /* D-12：静态场景层——原 drawMap 逐格部分原样迁入；直绘与离屏缓存共用这一份代码，
     * 保证"缓存命中"与"直绘"像素一致。ctx 为目标上下文（主画布或缓存画布）。 */
    _drawSceneStatic: function (ctx, grid, pf, W, H) {
      /* D-116：场外岩框。地图矩形由相机偏移决定，静态缓存已把 cam 纳入失效键，
       * 所以框随镜头重建，不会停在旧构图。 */
      drawOuterFrame(ctx, W, H, -cam.x, -cam.y, grid[0].length * TILE, grid.length * TILE);
      /* S3-1 FOV：可见=正常绘制；记忆格=较暗覆盖；从未点亮=近黑不透露地形 */
      var fovOn = !!(Game.fov && Game.fov.isVisible);
      /* D-79：Boss 前室判定——距下行梯 ≤3 格，且下一层确实有 Boss（MAPS.bosses）。
       * 楼梯是静态的，用楼梯而不是 Boss 本人做锚点：Boss 会移动，静态缓存会留下过期色块。 */
      var bossAhead = false;
      var bossList = (Game.Data.MAPS && Game.Data.MAPS.bosses) || [];
      for (var bi = 0; bi < bossList.length; bi++) if (bossList[bi].floor === pf + 1) bossAhead = true;
      var stairPts = [];
      if (bossAhead) {
        for (var sy0 = 0; sy0 < grid.length; sy0++) {
          for (var sx0 = 0; sx0 < grid[0].length; sx0++) {
            if (grid[sy0][sx0] === 2) stairPts.push([sx0, sy0]);
          }
        }
      }
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
            /* P1-1：墙贴图（顶行 wall_top_* / 墙身 wall_left|mid|right）；素材缺失回退砖纹色块
             * D-79：按楼层主题取 t{n}_ 前缀，24×24 原生 1:1 绘制 */
            var wspName = this._wallSpriteName(grid, x, y, pf);
            var wsp = this._hasSprites() ? Game.Core.Sprites.get(wspName) : null;
            if (wsp) {
              ctx.drawImage(wsp, px, py, TILE, TILE);
              /* 美学整改 A3：墙身 ×0.30、墙顶 ×0.38（等效叠黑 0.70 / 0.62）。
               * 原素材五层里有四层的墙顶比地板更亮——最亮的水平面成了不可走的墙。
               * 压暗后地板恒为画面最亮的水平面；只改绘制，不动任何素材文件与地图数据。
               * D-113：旧值 0.45 / 0.40 只够 WCAG 1.16–1.47:1；现在整体压到 WALL_STYLE，
               * 并在**与地板相邻的墙侧内缘**再压一条 edgePx 宽的暗边（地板像素一个不动）。
               * 暗边只出现在交界墙块上，不给每块地砖描边；未探明区不绘制，不会泄露布局。 */
              if (WALL_STYLE.guard > 0) {
                /* 负例专用：只压墙体内圈、交界像素保持旧亮度 */
                ctx.fillStyle = 'rgba(0,0,0,' + (wspName.indexOf('wall_top') >= 0
                  ? WALL_STYLE.top : WALL_STYLE.body) + ')';
                ctx.fillRect(px + WALL_STYLE.guard, py + WALL_STYLE.guard,
                  TILE - WALL_STYLE.guard * 2, TILE - WALL_STYLE.guard * 2);
              } else {
                ctx.fillStyle = (wspName.indexOf('wall_top') >= 0)
                  ? 'rgba(0,0,0,' + WALL_STYLE.top + ')'
                  : 'rgba(0,0,0,' + WALL_STYLE.body + ')';
                ctx.fillRect(px, py, TILE, TILE);
              }
              /* 交界暗边：只画墙侧（E/W/S/N 与地板相邻的边）。
               * 颜色取 84 色板里最暗的一档 #1a1024（F5 暗紫），不引入色板外的纯黑；
               * 只压墙侧 3px，地板像素一个不动。 */
              if (WALL_STYLE.edge > 0) {
                var ep = WALL_STYLE.edgePx;
                ctx.fillStyle = 'rgba(26,16,36,' + WALL_STYLE.edge + ')';
                if (y + 1 < grid.length && grid[y + 1][x] === 1) ctx.fillRect(px, py + TILE - ep, TILE, ep);
                if (y - 1 >= 0 && grid[y - 1][x] === 1) ctx.fillRect(px, py, TILE, ep);
                if (x - 1 >= 0 && grid[y][x - 1] === 1) ctx.fillRect(px, py, ep, TILE);
                if (x + 1 < grid[0].length && grid[y][x + 1] === 1) ctx.fillRect(px + TILE - ep, py, ep, TILE);
              }
            } else {
              /* 墙：砖纹 */
              ctx.fillStyle = '#3a2e5c';
              ctx.fillRect(px, py, TILE - 1, TILE - 1);
              ctx.fillStyle = 'rgba(0,0,0,0.28)';
              ctx.fillRect(px, py + TILE / 2 - 1, TILE - 1, 2);
              ctx.fillRect(px + (x % 2) * 8, py, 1, TILE - 1);
            }
          } else if (t === 1) {
            /* P1-1：地板贴图 floor_1~8 按坐标哈希选变体；素材缺失回退稳定噪点色块
             * D-79：24×24 原生 1:1；按房间类型叠明暗；密门铺门槛；再叠纯装饰层 */
            var fsp = this._hasSprites() ? Game.Core.Sprites.get(floorVariantName(x, y, pf)) : null;
            if (fsp) {
              ctx.drawImage(fsp, px, py, TILE, TILE);
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
            var M9 = Game.Systems.Map;
            var sec = !!(M9 && typeof M9.isSecretRoom === 'function' && M9.isSecretRoom(x, y));
            var bn = false;
            for (var spi = 0; spi < stairPts.length; spi++) {
              if (Math.max(Math.abs(stairPts[spi][0] - x), Math.abs(stairPts[spi][1] - y)) <= 3) { bn = true; break; }
            }
            var kind = roomKind(grid, x, y, sec, bn);
            var sh = ROOM_TINT[kind];
            if (sh) { ctx.fillStyle = sh; ctx.fillRect(px, py, TILE, TILE); }
            /* 密室门洞：24×24 门槛贴图（只有密室门这一种"门"有语义，别的格不当门画） */
            if (M9 && typeof M9.isSecretRoomDoor === 'function' && M9.isSecretRoomDoor(x, y)) {
              var dsp = this._hasSprites() ? Game.Core.Sprites.get((pf === 1 ? 't1' : 't' + pf) + '_door') : null;
              if (dsp) ctx.drawImage(dsp, px, py, TILE, TILE);
            }
            /* D-117：F1/F2 层辨识构图层——只在地板格、只画可见格；F3–F5 零改动 */
            if ((pf === 1 || pf === 2) && (!fovOn || Game.fov.isVisible(x, y))) {
              drawLayerSig(ctx, grid, pf, x, y, px, py);
            }
            /* 纯装饰层：不占格、不阻挡、不参与寻路，只画在可见格 */
            if (!fovOn || Game.fov.isVisible(x, y)) {
              var amb = this._ambientAt(grid, x, y, pf);
              if (amb) {
                var asp = this._hasSprites() ? Game.Core.Sprites.get(amb) : null;
                if (asp) ctx.drawImage(asp, px, py, TILE, TILE);
              }
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
            /* D-115：下行楼梯标识（青白内框 + ▼），压在贴图之上、实体之下 */
            drawStairMark(ctx, px, py, true);
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
            /* D-115：上行楼梯标识（青白内框 + ▲），与下行同色同类，靠箭头方向区分 */
            drawStairMark(ctx, px, py, false);
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
       * 帧缺失回退 kni 单图（player.png），再缺失回退像素小人色块。
       * D-57：按 player.facing 镜像（左朝向水平翻帧），并叠加方向性特征。 */
      var facing = (player && player.facing === 'left') ? 'left' : 'right';
      var kimg = null;
      if (this._hasSprites() && typeof Game.Core.Sprites.getFrame === 'function') {
        kimg = Game.Core.Sprites.getFrame(moving ? 'knight_m_run' : 'knight_m_idle',
          animIndex(moving ? 'knight_m_run' : 'knight_m_idle', 4));
      }
      if (kimg) {
        /* D-35：尺寸口径改为原生高 × TILE/16、脚底锚定格底（16×28 骑士 → 42px，原 21px），
         * 与战场 90px 基准的比例回到同一量级；并补地面投影、处理同格装饰的前后关系。 */
        var pcx = px + TILE / 2;
        var pbt = py + TILE - 1;
        groundShadow(ctx, pcx, pbt, TILE);
        drawPlayerFigure(ctx, pcx, pbt, facing, moving,
          animIndex(moving ? 'knight_m_run' : 'knight_m_idle', 4));
        if (Game.Systems && Game.Systems.Map && typeof Game.Systems.Map.getGrid === 'function') {
          this._drawFrontDecor(ctx, Game.Systems.Map.getGrid(), Math.round(rx), ry);
        }
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
     * actionAt: 动作起始时间戳；duration: 总时长 ms；forward: 出手方向 (+1/-1)；
     * at: 可选时钟（横置用 Fx 注入时钟，纵置不传 → 行为逐像素不变） */
    _attackOffset: function (actionAt, duration, forward, at) {
      if (!actionAt) return 0;
      var elapsed = ((typeof at === 'number') ? at : performance.now()) - actionAt;
      var t = Math.min(elapsed / duration, 1);
      if (t >= 1) return 0;
      if (t < 0.3) return -forward * 8 * (t / 0.3);           /* 前摇：后拉 */
      if (t < 0.5) return forward * 14 * ((t - 0.3) / 0.2);   /* 出手：前冲 */
      return forward * 14 * (1 - (t - 0.5) / 0.5);            /* 恢复：回位 */
    },

    /* D-94：横置站位与朝向（玩家左 / 敌人右 / 同一地平线）。
     * P2 起背景改用横置专属五层 painter（hbg*），中央不再有门/王座/拱门抢占中线；
     * 实体脚底一律落在 g.groundY（0.766H），接触阴影改成贴地扁椭圆 hContactShadow。
     * 玩家用既有骑士侧面帧（原生朝右），不镜像/不旋转：站左边就是朝敌人；
     * 敌人保持正面帧（D-88 龙眼/角饰按当前像素方向验收，镜像会换边）；
     * 落屏高度沿用纵置口径：玩家/杂兵 90、Boss 108（原生×2）、龙 144（原生×2）。
     * 中段信息带 / 指令条 / 结果卡属 P4，本阶段不搬；只保留双方名字、血条与底部指令提示。 */
    _drawBattleHorizontal: function (state) {
      var ctx = this._ctx;
      var W = this.cssW, H = this.cssH;
      var g = horizontalBattleGeo(W, H);
      var Fx = Game.Fx;
      var now = (Fx && typeof Fx.clockNow === 'function') ? Fx.clockNow() : performance.now();
      var monster = state.monster || {};
      var p = Game.Data.Player || {};
      var dying = !!state.dying;
      var dieProg = dying ? Math.min((now - state.dyingAt) / (state.dyingMs || 700), 1) : 0;
      var isBoss = !!(Game.Data.MONSTERS && Game.Data.MONSTERS[monster.id] &&
        Game.Data.MONSTERS[monster.id].boss);
      /* D-101：横置补震屏——与纵置同一个 Fx.shakeOffset、同一份参数，不另创数值 */
      var shake = (Fx && typeof Fx.shakeOffset === 'function') ? Fx.shakeOffset() : { x: 0, y: 0 };

      dcMark('backdrop');
      drawBattleBackdrop(ctx, W, H, (typeof p.floor === 'number' ? p.floor : 1), 'horizontal');

      dcMark('sprite');
      /* 共享地面带：一条 2px 微亮横线钉住"两人同一块地"；接触阴影再压在它上面。
       * 这是站位几何，不是背景重排（横置 painter 里另有各自的墙地交界）。
       * D-103 清账：省掉 save/restore（随后画精灵时会各自重设 fillStyle）。 */
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(Math.round(W * 0.08), g.groundY - 1, Math.round(W * 0.84), 2);

      /* ===== 敌人（右） =====
       * P5：横置攻击轴为横——出手向左（forward=−1），受击沿 +x 弹开。
       * Fx 的 knockOffset 以"纵置方向"记账（怪物 −4、玩家 +7），横置对 x 取反即可，
       * 不新增/不修改任何位移数值。 */
      var mAtkOff = this._attackOffset(state.monsterActionAt, 320, -1, now);
      var mKnock = (Fx && typeof Fx.knockOffset === 'function') ? Fx.knockOffset('monster') : 0;
      var mDrawCx = g.enemyCx + mAtkOff - mKnock;
      var sp2 = null;
      if (Game.Core.Sprites && Game.Core.Sprites.isReady()) {
        var mMode = '';
        if (!dying && Fx && typeof Fx.flashOf === 'function') {
          var mfl = Fx.flashOf('monster');
          if (mfl && mfl.alpha > 0.01) mMode = 'hurt';
        }
        if (!mMode && !dying && state.monsterActionAt && (now - state.monsterActionAt) < 320) mMode = 'attack';
        sp2 = monsterFrame(monsterAnimId(monster), false, mMode);
        if (!sp2) sp2 = Game.Core.Sprites.get(isBoss ? 'boss_demon' : 'monster_chort');
      }
      var mBaseH = battleSpriteH(sp2, isBoss ? 108 : 90);
      var mW = 90, mShadowW = 90;
      if (sp2) {
        var snw = sp2.naturalWidth || 90, snh = sp2.naturalHeight || 90;
        mShadowW = snh > 0 ? Math.round(snw * mBaseH / snh) : 90;
      }
      /* D-105：濒死高度 = 原生 × 整数档（2 或 1），不再用 mBaseH×(1−prog/2) 的中间倍率。 */
      var mH = dying ? Math.round(mBaseH * battleDyingMul(dieProg) / BATTLE_SPRITE_MUL) : mBaseH;
      ctx.save();
      if (shake.x || shake.y) ctx.translate(shake.x, shake.y); /* D-101：震屏只作用于战场精灵 */
      if (dying) ctx.globalAlpha = 1 - dieProg;
      hContactShadow(ctx, g.enemyCx, g.groundY, mShadowW, dying ? 0.55 * (1 - dieProg) : 0.55);
      if (sp2) {
        mW = drawSpriteByHeight(ctx, sp2, mDrawCx, g.groundY, mH);
      } else {
        ctx.fillStyle = monster.color || '#888';
        ctx.fillRect(mDrawCx - 45, g.groundY - mH, 90, mH);
        mW = 90;
      }
      /* D-109 N3：横置怪物受击也刷白——与纵置同一条 Feedback/Fx 账本、同一颜色与 alpha。
       * 以前横置只切 hurt 帧，同一命中在宽屏是灰绿、在竖屏是白色，受击语义随窗口比例改变。
       * tintSprite 按精灵 alpha 着色（轮廓重绘），闪白不吃掉本体剪影。 */
      if (!dying) {
        var mfl2 = battleFlashOf('monster');
        if (mfl2 && mfl2.alpha > 0.01) {
          if (sp2 && !tintSprite(ctx, sp2, mDrawCx, g.groundY, mBaseH, '#ffffff', mfl2.alpha)) {
            ctx.fillStyle = 'rgba(255,255,255,' + mfl2.alpha.toFixed(3) + ')';
            ctx.fillRect(mDrawCx - mW / 2, g.groundY - mBaseH, mW, mBaseH);
          }
        }
      }
      /* D-88：龙眼随横置一起平移，仍是"最暗处的一双亮眼"（画在闪白之后） */
      if (!dying && monster.id === 'dragon' && sp2 && typeof drawDragonEyes === 'function') {
        drawDragonEyes(ctx, mDrawCx, g.groundY, mBaseH, '', sp2);
      }
      ctx.restore();
      var dbg = this._lastBattleBox || (this._lastBattleBox = {});
      dbg.layout = 'horizontal'; dbg.W = W; dbg.H = H;
      dbg.monster = { x: Math.round(mDrawCx - mW / 2), y: g.groundY - mBaseH, w: mW, h: mBaseH,
        baseTop: g.groundY - mBaseH, groundY: g.groundY,
        knockX: Math.round(-mKnock), lungeX: Math.round(mAtkOff), knock: Math.round(-mKnock) };

      /* ===== 玩家（左）：既有侧面帧原生朝右，不镜像 = 朝敌人 =====
       * P5：出手向右（forward=+1），受击沿 −x 弹开（与怪物方向相反）。 */
      var pAtkOff = this._attackOffset(state.playerActionAt, 320, 1, now);
      var pKnock = (Fx && typeof Fx.knockOffset === 'function') ? Fx.knockOffset('player') : 0;
      var pDrawCx = g.playerCx + pAtkOff - pKnock;
      var psp = null;
      if (Game.Core.Sprites && Game.Core.Sprites.isReady() && typeof Game.Core.Sprites.getFrame === 'function') {
        var pActing = !!(state.playerActionAt && (now - state.playerActionAt) < 320);
        psp = Game.Core.Sprites.getFrame(pActing ? 'knight_m_hit' : 'knight_m_idle',
          animIndex(pActing ? 'knight_m_hit' : 'knight_m_idle', 4));
      }
      if (!psp && Game.Core.Sprites && Game.Core.Sprites.isReady()) psp = Game.Core.Sprites.get('player');
      var pBaseH = battleSpriteH(psp, 90);
      var pW = 48, pShadowW = 90;
      if (psp) {
        var pnw = psp.naturalWidth || 90, pnh = psp.naturalHeight || 90;
        pShadowW = pnh > 0 ? Math.round(pnw * pBaseH / pnh) : 90;
      }
      ctx.save();
      if (shake.x || shake.y) ctx.translate(shake.x, shake.y); /* D-101：与怪物同一震屏 */
      hContactShadow(ctx, g.playerCx, g.groundY, pShadowW, 0.55);
      if (psp) {
        pW = drawSpriteByHeight(ctx, psp, pDrawCx, g.groundY, pBaseH);
      } else {
        ctx.fillStyle = '#ffcf6e';
        ctx.fillRect(pDrawCx - 45, g.groundY - pBaseH, 90, pBaseH);
      }
      /* D-101：横置补玩家受击红闪——与纵置同参数（#ff5a5a + 同一 alpha 来源），
       * 仍走 tintSprite 按精灵轮廓着色，不盖方块。 */
      var fp = battleFlashOf('player');
      if (fp && fp.alpha > 0.01) {
        if (psp) {
          tintSprite(ctx, psp, pDrawCx, g.groundY, pBaseH, '#ff5a5a', fp.alpha);
        } else {
          ctx.fillStyle = 'rgba(255,90,90,' + fp.alpha.toFixed(3) + ')';
          ctx.fillRect(pDrawCx - 45, g.groundY - pBaseH, 90, pBaseH);
        }
      }
      ctx.restore();
      dbg.player = { x: Math.round(pDrawCx - pW / 2), y: g.groundY - pBaseH, w: pW, h: pBaseH,
        baseTop: g.groundY - pBaseH, groundY: g.groundY,
        knockX: Math.round(-pKnock), lungeX: Math.round(pAtkOff), knock: Math.round(-pKnock) };

      /* ===== 身份卡（三段式）+ 行动管线 + 地面战报带 =====
       * D-102 S1：卡底仍钉在"最高精灵顶 − 14"，但卡高从 34 变 52（L1 名字 / L2 HP+数值 / L3 chip）。
       * 战报带落在 groundY+2；960×540 是 416–442，指令条 444 起，恰好隔 2px。
       * D-104：卡底改为按双方实际整数倍精灵顶取 min（不再写死 90）。 */
      var plateBottom = Math.min(g.groundY - pBaseH, g.groundY - mBaseH) - 14;
      var plateTop = plateBottom - CARD_H;
      var pHp = (typeof p.hp === 'number') ? Math.max(p.hp, 0) : 0;
      var pMax = (typeof p.maxHp === 'number' && p.maxHp > 0) ? p.maxHp : Math.max(pHp, 1);
      var mobHp = (typeof monster.hp === 'number') ? Math.max(monster.hp, 0) : 0;
      var mobMax = (typeof monster.maxHp === 'number' && monster.maxHp > 0) ? monster.maxHp : Math.max(mobHp, 1);
      function cardW(spriteW) {
        return Math.max(112, Math.min(280, Math.round((spriteW || 90) * 1.5 + 24)));
      }
      if (!dying) {
        dbg.playerPlate = battleCard(ctx, g.playerCx, plateTop, cardW(pW), {
          name: '勇者', hp: pHp, hpMax: pMax, hpColor: '#4ade80',
          chips: cardChips('player', state)
        });
        dbg.monsterPlate = battleCard(ctx, g.enemyCx, plateTop, cardW(mW), {
          name: (isBoss ? '【BOSS】' : '') + (monster.name || '?'),
          hp: mobHp, hpMax: mobMax, hpColor: '#e24a4a',
          enraged: !!state.enraged, chips: cardChips('monster', state)
        });
      }
      dbg.cards = { player: dbg.playerPlate || null, monster: dbg.monsterPlate || null };

      /* 行动管线：HUD 读数带下沿 42 + 4 起（G14：不再贴到 44） */
      dbg.pipeline = battlePipeline(ctx, W / 2, Math.max(46, Math.round(H * 0.082)), state, now);
      dbg.roundBar = { x: dbg.pipeline.x, y: dbg.pipeline.y, w: dbg.pipeline.w, h: dbg.pipeline.h,
        text: dbg.pipeline.roundText };

      /* 地面战报带：第 1 行 = 上次行动；第 2 行 = 龙威播报（优先）或最新一条战报。
       * 横置以前完全没有战报区，龙威三句机制提示玩家一句也看不到（G4/G5/G17）。 */
      var logY = g.groundY + 2, logH = 26;
      var logX = Math.round(W * 0.08), logW = Math.round(W * 0.84);
      var la = state.lastAction;
      var line1 = '';
      if (la && typeof la.dmg === 'number') {
        line1 = (la.by === 'player')
          ? ('你对 ' + (la.name || '') + ' 造成 ' + la.dmg + ' 伤害')
          : ((la.name || '') + ' 反击，造成 ' + la.dmg + ' 伤害');
        if (la.tier === 'crush') line1 = '【碾压】' + line1;
        else if (la.heavy) line1 = '【高伤】' + line1;
      }
      var lb = battleLogLines(state, 1);
      var line2 = lb.length ? lb[lb.length - 1] : '';
      var br = dreadBroadcast();
      dcMark('log');
      ctx.fillStyle = 'rgba(8,8,16,0.62)';
      ctx.fillRect(logX, logY, logW, logH);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(logX, logY, logW, 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 12px ' + FONT_STACK;
      ctx.fillStyle = (la && la.tier === 'crush') ? '#ff6b3d' : ((la && la.heavy) ? '#ffb347' : '#cfcfcf');
      ctx.fillText(cardFit(ctx, line1 || '战报将在交手后出现', logW - 16), logX + 8, logY + 9);
      ctx.font = '12px ' + FONT_STACK;
      ctx.fillStyle = (br && line2 === br) ? '#ffcf6e' : '#9fe08f';
      if (line2) ctx.fillText(cardFit(ctx, line2, logW - 16), logX + 8, logY + 21);
      dbg.log = { x: logX, y: logY, w: logW, h: logH, lines: [line1, line2].filter(Boolean) };
      dbg.battleLog = dbg.log;

      /* 指令条：7 格只显示，不接管输入（键盘 1–7 仍是唯一输入） */
      dbg.commandBar = hCommandBar(W, H, state);
      dbg.hudBand = { x: 0, y: 0, w: W, h: Math.min(42, H) };
      dbg.safeBand = battleSafeBand(W, H, 'horizontal');
      for (var hci = 0; hci < dbg.commandBar.cells.length; hci++) {
        var hcc = dbg.commandBar.cells[hci];
        this._hotAdd('battle:' + hcc.key, hcc.x, hcc.y, hcc.w, hcc.h);
      }

      dcMark('fx.float');
      try { if (Game.Feedback && typeof Game.Feedback.draw === 'function') Game.Feedback.draw(); } catch (e) { /* 降级 */ }
      dcMark('fx.particles');
      try { if (Game.Particles && typeof Game.Particles.draw === 'function') Game.Particles.draw(); } catch (e) { /* 降级 */ }
      /* P5：斩击弧以前只有纵置分支在画，横置从来没画过——补上，弧的朝向由 battle.fxHit 给 */
      dcMark('fx.slash');
      try { if (Fx && typeof Fx.drawSlashes === 'function') Fx.drawSlashes(ctx); } catch (e) { /* 降级 */ }
      /* 指令条压在特效之上（UI 不被粒子穿过） */
      hDrawCommandBar(ctx, dbg.commandBar);
      dcMark('hud');
      this._drawHud();
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
      this._hotReset();  /* D-100 */
      this._applyDpr(); /* M9-5 */
      /* D-109 N1：每帧重置身份卡/属性行登记——消散期间它们不画，
       * 安全带不能把上一帧的残影当作避让对象。 */
      var dbg0 = this._lastBattleBox || (this._lastBattleBox = {});
      dbg0.playerPlate = null; dbg0.monsterPlate = null; dbg0.stat = null;
      dbg0.cards = { player: null, monster: null };
      /* D-94：布局分派。纵置以下代码路径原样保留（默认 'vertical'，横置不改其一行）。 */
      if (resolveBattleLayout(this.cssW, this.cssH) === 'horizontal') {
        this._drawBattleHorizontal(state);
        return;
      }
      var W = this.cssW, H = this.cssH;
      var Fx = Game.Fx;
      /* D-16：动作/特效统一取 Fx 时钟（顿帧期间不前进），Fx 缺失时退回真实时钟 */
      var now = (Fx && typeof Fx.clockNow === 'function') ? Fx.clockNow() : performance.now();
      var monster = state.monster || {};
      var p = Game.Data.Player || {};
      var dying = !!state.dying;
      var dieProg = dying ? Math.min((now - state.dyingAt) / (state.dyingMs || 700), 1) : 0;
      var CX = W / 2;
      /* D-102 S1：纵置改为比例锚点（规格 §4.2），不再写死 244/300/326/378/414/562。
       * 320/390 用 4+3 指令条（barH 150），≥590 单行（96）；敌方脚底 0.30H、我方 0.72H。 */
      var vg = verticalBattleGeo(W, H);
      var playerGround = vg.playerGround;
      var enemyGround = vg.enemyGround;
      var enemyCardTop = vg.enemyCardTop;

      /* 美学整改 A2：战斗背景按层换景（离屏缓存，见 drawBattleBackdrop） */
      dcMark('backdrop');
      drawBattleBackdrop(ctx, W, H, (typeof p.floor === 'number' ? p.floor : 1));

      /* ===== 敌方 ===== */
      dcMark('sprite');
      var ex = CX - 45;
      var ey = 90;
      /* M9-3：怪物攻击前摇帧偏移（向前=向下）；D-16：叠加受击挤退 */
      var mAtkOff = this._attackOffset(state.monsterActionAt, 320, 1, now);
      var mKnock = (Fx && typeof Fx.knockOffset === 'function') ? Fx.knockOffset('monster') : 0;
      ey += mAtkOff + mKnock;
      var boss = monster.id === 'dragon';
      /* P2-4：Boss 判定读 MONSTERS[id].boss */
      var isBoss = !!(Game.Data.MONSTERS && Game.Data.MONSTERS[monster.id] &&
        Game.Data.MONSTERS[monster.id].boss);
      /* 第二拨：Boss 落屏高度 = 素材原生高 × 2（整数倍硬线，24 基素材 → 108px）。
       * 旧口径 90×1.25=112.5px 既非整数倍，又让 Boss 沦为"杂兵放大 1.25 倍"。
       * D-104：普通怪同口径（原生高 × 2），不再固定 90px 反推分数倍。 */
      /* 三态取帧：受击闪白帧优先，其次怪物出手窗口（与 _attackOffset 同 320ms 口径） */
      var mMode = '';
      if (!dying && Fx && typeof Fx.flashOf === 'function') {
        var mfl = Fx.flashOf('monster');
        if (mfl && mfl.alpha > 0.01) mMode = 'hurt';
      }
      if (!mMode && !dying && state.monsterActionAt && (now - state.monsterActionAt) < 320) mMode = 'attack';
      var shake = (Fx && typeof Fx.shakeOffset === 'function') ? Fx.shakeOffset() : { x: 0, y: 0 };
      var sp2 = null;
      if (Game.Core.Sprites && Game.Core.Sprites.isReady()) {
        sp2 = monsterFrame(monsterAnimId(monster), false, mMode);
        if (!sp2) sp2 = Game.Core.Sprites.get(boss ? 'boss_demon' : 'monster_chort');
      }
      var mBaseH = battleSpriteH(sp2, isBoss ? 108 : 90);
      /* D-97 P4：Boss/龙足底随身高下移，保证精灵顶 ≥44（HUD 读数带下沿 42 + 2）。
       * D-102：纵置敌方脚底跟 0.30H 走；大体积怪（龙 144）下移，但精灵顶不得进入敌方身份卡，
       * 因此 eyBase = max(enemyGround−90, 16+mBaseH)（eyBase 是 90 方框底，不是精灵顶）。 */
      var eyBase = Math.max(enemyGround - 90, 16 + mBaseH);
      ey = eyBase + mAtkOff + mKnock;
      ctx.save();
      if (shake.x || shake.y) ctx.translate(shake.x, shake.y); /* D-16：震屏只作用于战场精灵，不动文字与 HUD */
      var mW = 90;
      /* D-89：接触阴影钉在敌方站台线（ey 不加击退/前摇），先画在地面再画精灵 */
      var mShadowW = mW;
      if (sp2) {
        var snw = sp2.naturalWidth || 90, snh = sp2.naturalHeight || 90;
        mShadowW = snh > 0 ? Math.round(snw * mBaseH / snh) : 90;
      }
      contactShadow(ctx, ex + 45, eyBase + 90, mShadowW, dying ? 0.82 * (1 - dieProg) : 0.82);
      if (dying) {
        /* M9-3：死亡消散——渐隐 + 上浮 + 整数档缩小（D-105：2×→1×，无中间倍率）。
         * 脚底钉在"原地 + 上浮量"上，缩小时只从头顶往下收，不做位置跳变。 */
        ctx.globalAlpha = 1 - dieProg;
        var dMul = battleDyingMul(dieProg);
        var dFoot = ey + 90 - dieProg * 30;
        if (sp2) {
          var nhD = sp2.naturalHeight || 0;
          var dmSize = nhD > 0 ? nhD * dMul : 90 * dMul / BATTLE_SPRITE_MUL;
          mW = drawSpriteByHeight(ctx, sp2, ex + 45, dFoot, dmSize);
        } else {
          var fbSize = 90 * dMul / BATTLE_SPRITE_MUL;
          ctx.fillStyle = monster.color || '#888';
          ctx.fillRect(ex + 45 - fbSize / 2, dFoot - fbSize, fbSize, fbSize);
          mW = fbSize;
        }
      } else {
        if (sp2) {
          mW = drawSpriteByHeight(ctx, sp2, ex + 45, ey + 90, mBaseH);
        } else {
          ctx.fillStyle = monster.color || '#888';
          ctx.fillRect(ex, ey, 90, 90);
          mW = 90;
        }
      }
      /* D-16：命中局部闪白（≤120ms，单次命中只闪一次；Fx 关档时无）
       * 美学整改 A1：改为按精灵 alpha 着色，命中瞬间主体轮廓仍在；无素材时才退回整块方片
       * D-101：alpha 改从 Feedback 的 hit/hurt 账本取（Fx 兜底），两套布局同一来源 */
      if (!dying) {
        var fl = battleFlashOf('monster');
        if (fl && fl.alpha > 0.01) {
          if (sp2 && !tintSprite(ctx, sp2, ex + 45, ey + 90, mBaseH, '#ffffff', fl.alpha)) {
            ctx.fillStyle = 'rgba(255,255,255,' + fl.alpha.toFixed(3) + ')';
            ctx.fillRect(CX - mW / 2, ey + 90 - mBaseH, mW, mBaseH);
          }
        }
      }
      /* D-88：龙的身份符号（发光眼）画在闪白之后——受击帧也保留眼睛，剪影身份不丢 */
      if (!dying && monster.id === 'dragon' && sp2 && typeof drawDragonEyes === 'function') {
        drawDragonEyes(ctx, ex + 45, ey + 90, mBaseH, mMode, sp2);
      }
      ctx.restore();
      var dbg = this._lastBattleBox || (this._lastBattleBox = {});
      dbg.layout = 'vertical'; dbg.W = W; dbg.H = H;
      dbg.monster = { x: Math.round(ex + 45 - mW / 2), y: Math.round(ey + 90 - mBaseH), w: mW, h: mBaseH,
        baseTop: Math.round(eyBase + 90 - mBaseH), groundY: eyBase + 90, knock: Math.round(mKnock * 100) / 100 };

      var pHp = (typeof p.hp === 'number') ? Math.max(p.hp, 0) : 0;
      var pMax = (typeof p.maxHp === 'number' && p.maxHp > 0) ? p.maxHp : Math.max(pHp, 1);
      var mobHp = (typeof monster.hp === 'number') ? Math.max(monster.hp, 0) : 0;
      var mobMax = (typeof monster.maxHp === 'number' && monster.maxHp > 0) ? monster.maxHp : Math.max(mobHp, 1);
      function vCardW(spriteW) {
        return Math.max(112, Math.min(280, Math.max(Math.round((spriteW || 90) * 1.5 + 24), 112), W - 16));
      }
      if (!dying) {
        var ew = vCardW(mW);
        dbg.monsterPlate = battleCard(ctx, 8 + ew / 2, enemyCardTop, ew, {
          name: (isBoss ? '【BOSS】' : '') + (monster.name || '?'),
          hp: mobHp, hpMax: mobMax, hpColor: '#e24a4a',
          enraged: !!state.enraged, chips: cardChips('monster', state)
        });
      }

      /* ===== 中段信息带：管线 + 战报（比例锚点，不再写死 244/300/326） ===== */
      var pKnock = (Fx && typeof Fx.knockOffset === 'function') ? Fx.knockOffset('player') : 0;
      var playerCardTop = playerGround - 60;
      var bandTop = eyBase + 90 + 6;
      /* D-102：中段信息带的下沿同时受「我方卡顶」和「我方精灵顶」约束——
       * 320 纵置龙时精灵顶 319，卡片 349，战报若只看卡顶会压到骑士头顶。 */
      var bandBottom = Math.min(playerCardTop, playerGround - 90) - 6;
      var bandH = Math.max(0, bandBottom - bandTop);
      var logMax = (bandH >= 62) ? 2 : 1;
      /* D-109 N1：中段信息带改为顶对齐（原为在带内垂直居中）。
       * 居中会在带底留下 34–92px 的碎片空间，结果卡放不下任何一段；
       * 顶对齐后「战报下沿 → 玩家精灵顶」成为一条连续空白，390/800 档可整卡落入。 */
      var startY = bandTop;
      dbg.pipeline = battlePipeline(ctx, CX, startY, state, now);
      dbg.roundBar = { x: dbg.pipeline.x, y: dbg.pipeline.y, w: dbg.pipeline.w, h: dbg.pipeline.h,
        text: dbg.pipeline.roundText };
      var logY = startY + 32;
      var vLines = battleLogLines(state, logMax);
      if (!vLines.length) vLines = [W < 420 ? '选择行动（1–7）' : '选择行动：攻击 / 防御 / 逃跑 / 技能 / 用药'];
      var vbr = dreadBroadcast();
      dcMark('log');
      /* 战报底：纵置中段会跨过火把/墙面装饰，铺一层 0.42 黑底保证 12px 文本可读 */
      ctx.fillStyle = 'rgba(8,8,16,0.42)';
      ctx.fillRect(7, logY - 4, W - 14, vLines.length * 16 + 8);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '12px ' + FONT_STACK;
      for (var vli = 0; vli < vLines.length; vli++) {
        var isDread = !!vbr && vLines[vli] === vbr;
        ctx.fillStyle = isDread ? '#ffcf6e' : ((vli === vLines.length - 1) ? '#9fe08f' : '#6fae6a');
        ctx.fillText(cardFit(ctx, vLines[vli], W - 16), 8, logY + vli * 16 + 8);
      }
      dbg.log = { x: 8, y: logY, w: W - 16, h: vLines.length * 16 + 4, lines: vLines };
      dbg.battleLog = dbg.log;
      dbg.mid = { top: bandTop, bottom: bandBottom, logs: logMax };

      /* ===== 我方身份卡：左侧贴人（卡右缘 ≤ 精灵左缘 − 8） ===== */
      var px = CX - 45;
      /* P1-3：玩家侧骑士帧动画——攻击动作期间切 knight_m_hit */
      var psp = null;
      if (Game.Core.Sprites && Game.Core.Sprites.isReady() && typeof Game.Core.Sprites.getFrame === 'function') {
        var pActing = !!(state.playerActionAt && (now - state.playerActionAt) < 320);
        psp = Game.Core.Sprites.getFrame(pActing ? 'knight_m_hit' : 'knight_m_idle',
          animIndex(pActing ? 'knight_m_hit' : 'knight_m_idle', 4));
      }
      if (!psp && Game.Core.Sprites && Game.Core.Sprites.isReady()) psp = Game.Core.Sprites.get('player');
      /* D-104：玩家同样是原生 24×42 × 2 = 84（旧 90 → 2.143×）。 */
      var pBaseH = battleSpriteH(psp, 90);
      var py = playerGround - pBaseH + pKnock;
      /* M9-3：玩家攻击前摇帧偏移（向前=向上） */
      var pAtkOff = this._attackOffset(state.playerActionAt, 320, -1, now);
      py += pAtkOff;
      dcMark('sprite');
      ctx.save();
      if (shake.x || shake.y) ctx.translate(shake.x, shake.y);
      var pW = 48;
      /* D-89：玩家接触阴影钉在 H-100 地面线（不随击退/前摇移动）；宽度按精灵实宽取 */
      var pShadowW = 90;
      if (psp) {
        var pnw = psp.naturalWidth || 90, pnh = psp.naturalHeight || 90;
        pShadowW = pnh > 0 ? Math.round(pnw * pBaseH / pnh) : 90;
      }
      contactShadow(ctx, px + 45, playerGround, pShadowW, 0.82);
      if (psp) {
        pW = drawSpriteByHeight(ctx, psp, px + 45, py + pBaseH, pBaseH);
      } else {
        ctx.fillStyle = '#ffcf6e';
        ctx.fillRect(px, py, 90, pBaseH);
      }
      /* 美学整改 A1：受击闪红同样按 alpha 着色，不再用 90×90 方块盖住骑士
       * D-101：alpha 从 Feedback 的 hurt 账本取（Fx 兜底），横置同一来源 */
      var fp = battleFlashOf('player');
      if (fp && fp.alpha > 0.01) {
        if (psp) {
          tintSprite(ctx, psp, px + 45, py + pBaseH, pBaseH, '#ff5a5a', fp.alpha);
        } else {
          ctx.fillStyle = 'rgba(255,90,90,' + fp.alpha.toFixed(3) + ')';
          ctx.fillRect(px, py, pW, pBaseH);
        }
      }
      ctx.restore();
      dbg.player = { x: Math.round(px + 45 - pW / 2), y: Math.round(py), w: pW, h: pBaseH,
        baseTop: playerGround - pBaseH, groundY: playerGround, knock: Math.round(pKnock * 100) / 100 };
      /* D-16：程序化斩击弧（零素材，1~2 段 arc） */
      if (Fx && typeof Fx.drawSlashes === 'function') Fx.drawSlashes(ctx);

      /* ===== 我方身份卡（三段式，左侧贴人；血量数值在卡内） ===== */
      /* 卡右缘必须 ≤ 精灵左缘 − 8；素材未加载时 pW 回退 90，320 宽下自动收窄到 99，
       * 正常情况下（骑士 51 宽）仍是规格下限 112。 */
      var pw = Math.min(vCardW(pW), Math.max(96, Math.floor(CX - pW / 2 - 8 - 8)));
      if (!dying) {
        dbg.playerPlate = battleCard(ctx, 8 + pw / 2, playerCardTop, pw, {
          name: '勇者', hp: pHp, hpMax: pMax, hpColor: '#4ade80',
          chips: cardChips('player', state)
        });
      }
      dbg.cards = { player: dbg.playerPlate || null, monster: dbg.monsterPlate || null };
      dbg.playerBar = dbg.playerPlate
        ? { x: dbg.playerPlate.barX, y: dbg.playerPlate.barY, w: dbg.playerPlate.barW, h: dbg.playerPlate.barH }
        : null;

      /* 属性行：playerGround − 100（精灵顶上方 10px，G19），不再写死 562 */
      var statY = playerGround - 100;
      dcMark('stat');
      dbg.stat = null;
      if (statY > logY + dbg.log.h + 12) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px monospace';
        var statTxt = '勇者  HP:' + pHp + '/' + pMax;
        if (typeof p.atk === 'number') statTxt += '  ATK:' + p.atk;
        if (typeof p.def === 'number') statTxt += '  DEF:' + p.def;
        if (W >= 420 && typeof p.mp === 'number' && typeof p.maxMp === 'number') {
          statTxt += '  MP:' + p.mp + '/' + p.maxMp;
        }
        ctx.fillText(cardFit(ctx, statTxt, W - 16), CX, statY);
        ctx.restore();
        /* D-109 N1：属性行作为结果卡的避让对象登记（12px 文本，上下各 6px） */
        dbg.stat = { x: 8, y: statY - 6, w: W - 16, h: 12 };
      }

      /* D-102：横/纵共用一套七格指令条外观（4+3 紧凑档由 W<590 决定） */
      var cmd = vCommandBar(W, H, state);
      dbg.commandBar = cmd;
      dbg.commandBarDrawn = !dying; /* 消散期间指令条不画，底部空间可用于结果卡 */
      dbg.hudBand = { x: 0, y: 0, w: W, h: Math.min(42, H) };
      dbg.safeBand = battleSafeBand(W, H, 'vertical');
      for (var vci = 0; vci < cmd.cells.length; vci++) {
        var vcc = cmd.cells[vci];
        this._hotAdd('battle:' + vcc.key, vcc.x, vcc.y, vcc.w, vcc.h);
      }
      dbg.bars = { playerY: dbg.playerPlate ? dbg.playerPlate.y : playerGround - 60,
        gapBand: Math.max(10, playerGround - 90 - (dbg.playerPlate ? dbg.playerPlate.y + dbg.playerPlate.h : 0)) };
      /* S3-4：战斗视觉反馈（伤害飘字），绘制于战斗内容之上、HUD 之下 */
      dcMark('fx.float');
      try { if (Game.Feedback && typeof Game.Feedback.draw === 'function') Game.Feedback.draw(); } catch (e) { /* 降级 */ }
      /* M9-3：粒子特效（命中火花/死亡灵魂碎片），叠在反馈层之上 */
      dcMark('fx.particles');
      try { if (Game.Particles && typeof Game.Particles.draw === 'function') Game.Particles.draw(); } catch (e) { /* 降级 */ }
      /* D-97 P2：指令条压在特效之上（与横置同序），消散期间隐藏 */
      if (!dying) vDrawCommandBar(ctx, cmd);
      dcMark('hud');
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

    /* 通关结局画面（M4 → D-52：独立结局页）
     * 数据全部来自 Main._endingSpec()（运行期真实统计 + 可复算评级）。
     * spec 省略时（既有验证页直接 drawVictory(P)）现场向 Main 取同一份数据，保证两条路径一致。 */
    drawVictory: function (player, spec) {
      var ctx = this._ctx;
      if (!ctx) return;
      this._applyDpr();
      var W = this.cssW || 1024, H = this.cssH || 640;
      var st = spec;
      if (!st || !st.lines) {
        var M = Game.Core && Game.Core.Main;
        st = (M && typeof M._endingSpec === 'function')
          ? M._endingSpec()
          : { lines: [], score: null, grade: '—', sel: 0 };
      }

      /* 背景：与主菜单/暂停同一套深色 + 细网格 + 金色装饰线 */
      ctx.fillStyle = '#0b0c14';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(80,90,130,0.16)';
      ctx.lineWidth = 1;
      for (var gx = 0; gx < W; gx += 32) {
        ctx.beginPath(); ctx.moveTo(gx + 0.5, 0); ctx.lineTo(gx + 0.5, H); ctx.stroke();
      }
      for (var gy = 0; gy < H; gy += 32) {
        ctx.beginPath(); ctx.moveTo(0, gy + 0.5); ctx.lineTo(W, gy + 0.5); ctx.stroke();
      }
      ctx.fillStyle = '#ffcf6e';
      ctx.fillRect(W / 2 - 120, 22, 240, 2);
      ctx.fillStyle = '#3a3a55';
      ctx.fillRect(W / 2 - 120, H - 30, 240, 2);

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

      var small = H < 520;
      var y = Math.max(48, H * 0.10);
      centerText('通 关 !', y, '#ffcf6e', small ? 26 : 34, true);
      centerText('勇者击败了地牢巨龙，冒险结束', y + (small ? 24 : 30), '#cfcfcf', small ? 13 : 16, false);
      var gradeStr = '评级 ' + (st.grade || '—');
      if (typeof st.score === 'number') gradeStr += '  ·  ' + st.score + ' 分';
      centerText(gradeStr, y + (small ? 48 : 58), '#9fe3a1', small ? 14 : 16, true);

      /* 统计行：可用高度内均分；字号/行高随窗口收缩，窄屏逐行居中不换行溢出 */
      var btnH = 36, hintH = 26;
      var top = y + (small ? 62 : 84);
      var bottom = btnH + hintH + 20;
      var avail = Math.max(40, H - top - bottom);
      var lines = st.lines || [];
      var lineH = lines.length ? Math.min(26, Math.max(15, Math.floor(avail / lines.length))) : 0;
      var startY = top + Math.max(0, Math.floor((avail - lineH * lines.length) / 2)) + Math.min(16, lineH);
      for (var i = 0; i < lines.length; i++) {
        centerText(lines[i].text, startY + i * lineH, '#cfcfcf', lineH < 20 ? 12 : 14, false);
      }

      /* 本地排行榜（M8-5 保留）：高窗口在按钮上方压缩展示最近 2 条，矮窗口省略不挤占统计区 */
      var lbRows = [];
      if (H >= 520) {
        try {
          var L = Game.Systems && Game.Systems.Leaderboard;
          if (L && typeof L.get === 'function') lbRows = (L.get() || []).slice(0, 2);
        } catch (e) { lbRows = []; }
      }

      /* 双按钮：再来一局 / 回主菜单（键盘 ←→ 选择，Enter 确认） */
      var bw = Math.min(190, (W - 60) / 2), gap = 16;
      var total = bw * 2 + gap;
      var bx = (W - total) / 2, by = H - btnH - hintH;
      for (var lr = 0; lr < lbRows.length; lr++) {
        var le = lbRows[lr] || {};
        centerText('最近通关 #' + (lr + 1) + '  ' + fmtRankTime(le.timeSec) +
          ' · 金币' + (typeof le.gold === 'number' ? le.gold : 0) +
          ' · Lv.' + (typeof le.level === 'number' ? le.level : 0),
          by - 16 - (lbRows.length - 1 - lr) * 15, lr === 0 ? '#ffcf6e' : '#7f8fa8', 11, false);
      }
      var labels = ['再来一局 (Enter)', '回主菜单 (Enter)'];
      for (var b = 0; b < 2; b++) {
        var rx = bx + b * (bw + gap);
        var on = ((st.sel | 0) === b);
        ctx.fillStyle = on ? 'rgba(255,207,110,0.18)' : '#14142a';
        ctx.fillRect(rx, by, bw, btnH);
        ctx.strokeStyle = on ? '#ffcf6e' : '#3a3a55';
        ctx.lineWidth = on ? 2 : 1;
        ctx.strokeRect(rx + 0.5, by + 0.5, bw - 1, btnH - 1);
        var lw = fitFont(labels[b], 14, on);
        ctx.fillStyle = on ? '#ffcf6e' : '#9bbbf4';
        ctx.textAlign = 'left';
        ctx.fillText(labels[b], rx + Math.max(8, (bw - lw) / 2), by + btnH / 2 + 5);
      }
      centerText('←→ 选择 · Enter 确认 · R 再来一局', H - 10, '#7f8fa8', 12, false);
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
     * 战斗按键取现有实现（1/2/3 攻防逃、4/5/6 火球/冲刺/护盾、7 用药），不杜撰。
     * D-78 解绑 F 的战斗特效档位；D-98 起 F 改绑探索侧的「侦测 / 拆除陷阱」。
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
    },

    /* D-91：危险操作配色——主菜单设置页与暂停设置页共用同一套（原来只有暂停页用红）。 */
    _dangerColor: function (on) { return on ? '#ff9b6b' : '#c98a6b'; },

    /* D-91/D-94/D-128：设置行绘制——主菜单与暂停面板共用，杜绝两份样式/两种危险语义。
     * D-128 起菜单版走「机关刻槽」：左 3px 槽 + 行底 1px 刻线 + 右端 78×18 阀值框，
     * 不再整行铺色；opt={style:'menu',x,w} 时生效。暂停面板不传 opt，保持原样式。 */
    _drawSettingsRows: function (rows, sel, W, py, rowH, hotPrefix, opt) {
      var ctx = this._ctx, cx = W / 2;
      var FONT_CN = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
      var FONT_MONO = 'Consolas, "Courier New", monospace';
      var o = opt || {};
      var menu = (o.style === 'menu');
      var pw = menu ? (o.w - 32) : Math.min(460, W - 60);
      var x0 = menu ? (o.x + 16) : (cx - pw / 2);
      var desc = {
        muted: '关闭音乐与音效，不影响存档',
        zoom: '画面整体放大倍数',
        clearSave: '删除本机存档，无法恢复'
      };
      for (var i = 0; i < rows.length; i++) {
        var y = py + i * rowH, on = (i === sel), rr = rows[i];
        var hotId = hotPrefix ? (hotPrefix + ':' + rr.id) : null;
        if (hotId) this._hotAdd(hotId, x0, y, pw, rowH - 8);
        if (menu) {
          /* 左刻槽：选中亮到 0.22，未选中 0.10；危险行恒为红槽 */
          ctx.fillStyle = rr.danger
            ? (on ? '#ff9b6b' : 'rgba(255,155,107,0.55)')
            : (on ? 'rgba(255,207,110,0.22)' : 'rgba(255,207,110,0.10)');
          ctx.fillRect(o.x + 10, y + 8, 3, rowH - 18);
          /* 行底 1px 刻线：把行读成石面上的刻槽，而不是一张选中的卡片 */
          ctx.fillStyle = on ? 'rgba(255,207,110,0.20)' : 'rgba(255,207,110,0.07)';
          ctx.fillRect(x0, y + rowH - 10, pw, 1);
        } else {
          if (!on && hotId && HOVER_ID === hotId) {
            ctx.fillStyle = 'rgba(255,207,110,0.06)';
            ctx.fillRect(cx - pw / 2, y, pw, rowH - 8);
            ctx.strokeStyle = 'rgba(255,207,110,0.55)';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx - pw / 2 + 0.5, y + 0.5, pw - 1, rowH - 9);
          }
          if (on) {
            ctx.fillStyle = 'rgba(255,207,110,0.14)';
            ctx.fillRect(cx - pw / 2, y, pw, rowH - 8);
            ctx.strokeStyle = '#ffcf6e';
            ctx.lineWidth = 2;
            ctx.strokeRect(cx - pw / 2 + 1, y + 1, pw - 2, rowH - 10);
          }
          /* 危险行未选中也给一条暗红左边条，风险在聚焦前就可见 */
          if (rr.id === 'clearSave') {
            ctx.fillStyle = on ? '#ff9b6b' : 'rgba(255,155,107,0.55)';
            ctx.fillRect(cx - pw / 2 + 4, y + 7, 3, rowH - 20);
          }
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = rows[i].danger ? this._dangerColor(on) : (on ? '#ffcf6e' : '#cfcfcf');
        ctx.font = (on ? 'bold ' : '') + '15px ' + FONT_CN;
        ctx.fillText(rr.label, x0 + (menu ? 14 : 18), y + (menu ? 21 : 23));
        /* 值只显示「自动」：与下一行「自适应难度」不再撞词（原始值仍在 main.js，不改） */
        var vshow = (rr.id === 'zoom' && rr.value === '自动（自适应）') ? '自动' : rr.value;
        var vtxt = '‹ ' + vshow + ' ›';
        var kw = menu ? 78 : Math.max(78, Math.min(pw - 170, this._menuTextW(vtxt, 12) + 16));
        var kx = x0 + pw - (menu ? 0 : 18) - kw, kyy = y + (menu ? Math.round((rowH - 8 - 18) / 2) : 14);
        var ds = desc[rr.id];
        if (ds && (!menu || on)) {
          var descW = kx - (x0 + (menu ? 14 : 18)) - 10;
          var dTxt = ds;
          while (dTxt.length > 1 && this._menuTextW(dTxt + '…', 10) > descW) dTxt = dTxt.slice(0, -1);
          if (dTxt !== ds) dTxt += '…';
          ctx.fillStyle = on ? '#b9a273' : '#7f879c';
          ctx.font = '10px ' + FONT_CN;
          ctx.fillText(dTxt, x0 + (menu ? 14 : 18), menu ? y + rowH - 13 : y + 39);
        }
        if (menu) {
          /* 阀值框：全页唯一的矩形焦点；选中时框线换成金色 */
          ctx.fillStyle = '#0d0e16';
          ctx.fillRect(kx, kyy, kw, 18);
          ctx.strokeStyle = on ? '#ffcf6e' : '#3a3340';
          ctx.lineWidth = 1;
          ctx.strokeRect(kx + 0.5, kyy + 0.5, kw - 1, 17);
        }
        ctx.textAlign = 'center';
        ctx.fillStyle = rows[i].danger ? (on ? '#ffb08a' : '#9a6f5e') : (on ? '#ffcf6e' : '#9bbbf4');
        ctx.font = (on ? 'bold ' : '') + '12px ' + FONT_MONO;
        ctx.fillText(vtxt, kx + kw / 2, kyy + 13);
      }
      ctx.textAlign = 'center';
    },

    /* D-91：确认面板——菜单与暂停共用。默认焦点 0 =「取消」；
     * 第 2 项（危险动作）用红色，选中时红框红字，与普通选项明显区分。 */
    _drawConfirmPanel: function (data, sel, W, H, geom) {
      var ctx = this._ctx, cx = W / 2, d = data || {};
      var g = geom || {};
      var FONT_CN = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      if (!g.noTitle) {
        ctx.fillStyle = '#ff9b6b';
        ctx.font = 'bold 22px ' + FONT_CN;
        ctx.fillText(d.title || '', cx, g.titleY || 60);
      }

      /* 说明文字按卡片宽度换行，YaHei 13px，和四个子页同一套正文字体 */
      var lineH = g.lineH || 24;
      var textW = g.textW || Math.min(W - 80, 560);
      var wrapped = [];
      var lines = d.lines || [];
      for (var i = 0; i < lines.length; i++) {
        var ws = this._menuWrapBalanced(lines[i], 13, textW);
        for (var wi = 0; wi < ws.length; wi++) wrapped.push(ws[wi]);
      }
      ctx.fillStyle = '#cfcfcf';
      ctx.font = '13px ' + FONT_CN;
      var ly = g.linesY || Math.max(130, H * 0.3);
      for (var w = 0; w < wrapped.length; w++) ctx.fillText(wrapped[w], cx, ly + w * lineH);

      var opts = d.opts || ['取消', '确认'];
      var bw = g.bw || 180, gap = 24;
      var btnH = g.btnH || 40;
      var total = opts.length * bw + (opts.length - 1) * gap;
      var x0 = cx - total / 2, oy = ly + wrapped.length * lineH + (g.gapY || 34);
      for (var j = 0; j < opts.length; j++) {
        var on = (j === (sel === 1 ? 1 : 0));
        var danger = (j === 1);
        var x = x0 + j * (bw + gap);
        ctx.fillStyle = on ? (danger ? 'rgba(255,120,90,0.18)' : 'rgba(255,207,110,0.16)')
          : (danger ? 'rgba(255,120,90,0.07)' : 'rgba(255,255,255,0.03)');
        ctx.fillRect(x, oy, bw, btnH);
        /* 压石：主菜单版底边压 3px 暗面，读成「放在石桌上的压石」；暂停页保持原样 */
        if (g.style === 'menu') {
          ctx.fillStyle = '#05060a';
          ctx.fillRect(x, oy + btnH - 3, bw, 3);
        }
        ctx.strokeStyle = on ? (danger ? '#ff9b6b' : '#ffcf6e')
          : (danger ? 'rgba(255,155,107,0.45)' : '#3a3a55');
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, oy + 1, bw - 2, btnH - 2);
        ctx.fillStyle = on ? (danger ? '#ffb08a' : '#ffcf6e') : (danger ? '#c98a6b' : '#cfcfcf');
        ctx.font = (on ? 'bold ' : '') + '15px ' + FONT_CN;
        ctx.fillText(opts[j], x + bw / 2, oy + Math.round(btnH * 0.66));
        /* D-100：确认按钮登记热区；hover 只给非当前焦点加一层描边 */
        var chId = g.hotPrefix ? (g.hotPrefix + ':' + j) : null;
        if (chId) {
          this._hotAdd(chId, x, oy, bw, btnH);
          if (!on && HOVER_ID === chId) {
            ctx.strokeStyle = '#ffcf6e';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, oy + 0.5, bw - 1, btnH - 1);
          }
        }
      }
      ctx.fillStyle = '#7f8fa8';
      ctx.font = '11px monospace';
      ctx.fillText('←→ 选择 · Enter 确认 · Esc 取消', cx,
        (typeof g.hintY === 'number') ? g.hintY : H - 16);
    },

    /* D-48：启动首屏（主菜单 / 玩法说明 / 设置 / 关于）。
     * 只画 UI，不启动任何循环——主循环仍由 Main.start() 唯一持有。
     * spec 由 Main._menuSpec() 生成（选项文案、可用状态、设置项、说明正文同源）。 */
    drawMainMenu: function (spec) {
      var ctx = this._ctx;
      if (!ctx) return;
      this._hotReset(); /* D-100 */
      this._applyDpr();
      var W = this.cssW || 1024, H = this.cssH || 640;
      var st = spec || {};

      /* 背景：深色 + 细网格，沿用既有像素风的纯色块，不引外部图片。
       * D-106：root 的场景会整幅覆盖背景（且自带网格），这里不再先画一层被盖住的网格；
       * 子页没有场景层，仍保留网格背景。 */
      var isRoot = !st.page || st.page === 'root';
      if (!isRoot) {
        ctx.fillStyle = '#0b0c14';
        ctx.fillRect(0, 0, W, H);
        /* D-128：网格由「47 条 stroke 路径」改为「47 次 1px fillRect」——像素结果相同
         * （1px 线正好覆盖整数列/行），单帧调用从 188 降到 47，给子页预算腾出空间。 */
        ctx.fillStyle = 'rgba(80,90,130,0.16)';
        for (var gx = 0; gx < W; gx += 32) ctx.fillRect(gx, 0, 1, H);
        for (var gy = 0; gy < H; gy += 32) ctx.fillRect(0, gy, W, 1);
      }
      /* 顶部/底部装饰线只属于首屏构图：root 由场景整幅覆盖（等同不可见），
       * 子页有自己的卡头，因此这里不再另画。 */

      if (st.page === 'help') this._drawMenuHelp(st, W, H);
      else if (st.page === 'settings') this._drawMenuSettings(st, W, H);
      else if (st.page === 'confirmClear' || st.page === 'confirmNew') this._drawMenuConfirm(st, W, H);
      else if (st.page === 'about') this._drawMenuAbout(W, H);
      else this._drawMenuRoot(st, W, H);
    },

    /* ─────────────────────────────────────────────────────────────
     * D-93：首屏「地牢门口静帧」——候选 A 的版式 + 候选 B 的门缝光。
     * 只换绘制入口：main.js 的菜单分支（选中/确认/返回/Esc）一行未动；
     * 楼层与等级在渲染层用只读的 Save.peek() 取，不写任何状态。
     * 宽度三档：W≥900 左右分栏 / 480≤W<900 上场景下菜单 / W<480 紧凑。
     * D-106：另加高度档 compact = H<620（960×540 基线走紧凑版）：右栏内容按
     * rowH 34 + 进度贴栏底排布，mid 缩为 3 行场景且舍去行内详情；宽档栏位随 W 收进视口。
     * 精灵整数倍：地砖·墙砖·门·火把 24→48（2×）、骑士 24×42→48×84（2×）、
     * 锁链·蛛网·龙·酋长 1×；门缝光 2px 为纯绘制。
     * ───────────────────────────────────────────────────────────── */

    /* 首屏布局纯函数：绘制与验证页共用同一份坐标，杜绝"文档一套、绘制一套"。 */
    _menuTextW: function (s, size) {
      var w = 0;
      for (var i = 0; i < (s || '').length; i++) {
        w += (s.charCodeAt(i) > 0x2E80) ? size : (size * 0.6);  /* 全角 / 等宽西文 */
      }
      return Math.round(w);
    },

    /* D-128：子页与首屏共用同一套断点（纯函数）。首屏 _menuLayout 只认这里，
     * 四个子页也不再各写 W<420 / cardW>=840 的第二套档位判定。 */
    _menuTier: function (W, H) {
      return {
        tier: (W >= 900) ? 'wide' : ((W >= 480) ? 'mid' : 'narrow'),
        compact: H < 620
      };
    },

    /* D-128：介质落位系数 0→1（100ms）。st.now 优先（验证页可注入），其次 _animNow，最后真实时钟；
     * 不使用 Math.random。动效只作用在介质本身（2px 整数位移 + 沿口 alpha），不碰正文坐标。 */
    _menuEnterK: function (st) {
      if (this._menuNoAnim === true) return 1;
      var now;
      if (st && typeof st.now === 'number') now = st.now;
      else if (typeof this._animNow === 'function') now = this._animNow();
      else now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      var page = (st && st.page) || 'root';
      /* 时钟回拨（验证页注入常量时钟）时重新起算，避免永久停在未落位状态 */
      if (menuEnter.page !== page || now < menuEnter.at) { menuEnter.page = page; menuEnter.at = now; }
      var k = (now - menuEnter.at) / 100;
      if (!(k > 0)) k = 0;
      if (k > 1) k = 1;
      return k;
    },

    _menuLayout: function (W, H, hasSave, floor, level) {
      var T = 48;                       /* 24×2：地砖/墙砖/双扇门/火把 */
      var mt = this._menuTier(W, H);
      var tier = mt.tier;
      var compact = mt.compact;         /* D-106 高度档：960×540/800×540 等低高度视口 */
      var lay, sc, m, p, rail, hintY;
      if (tier === 'wide') {
        /* D-106 P6：右栏右缘必须 ≤ W−24。900 宽时旧 x=616 会把栏裁掉 76px；
         * 这里让栏位随 W 左移，场景列数按“栏位不压场景”反推（W≥952 才放得下 10 列）。 */
        var cols = (W >= 952) ? 10 : 8;
        var railX = Math.min(616, W - 360 - 24);
        var sy = Math.min(144, Math.max(96, H - 7 * T - 40));
        var railH = compact ? (H - 112 - 16) : Math.min(448, H - 112 - 40);
        rail = { x: railX, y: 112, w: 360, h: railH };
        sc = { x: 64, y: sy, cols: cols, rows: 7, doorCol: cols / 2 - 1 };
        var rowH = compact ? 34 : 42;
        var menuY = Math.max(210, Math.min(238, H - 5 * rowH - 60));
        m = { x: railX + 24, y: menuY, w: 312, rowH: rowH, font: 18, label: 18, note: 12, detail: 11 };
        var pipY = rail.y + railH - (compact ? 44 : 40);
        hintY = m.y + 5 * m.rowH + 20;
        lay = {
          tier: tier, T: T, scene: sc, panel: rail,
          title: { x: railX + 32, smallY: 154, mainY: 186, subY: 208, small: 11, main: 24, sub: 12 },
          rule: { x: railX + 12, y: 128, w: 336 },
          menu: m,
          progress: { x: railX + 32, pipY: pipY, pip: 20, gap: 12,
            /* 真实进度标签比 A 稿的目标标签长，终点符号右对齐到栏内边距（12px），避免与文字重叠 */
            end: { name: 'dragon_idle_anim_f0', x: rail.x + rail.w - 72 - 12,
              y: pipY - 46, k: 1 } }
        };
      } else if (tier === 'mid') {
        /* D-106：低高度时场景缩为 4 行（门 2 + 暗井 1 + 台阶 1），骑士脚底贴场景底边，
         * 把省下的 48px 让给菜单；行内详情在紧凑档舍去（与窄屏同一取舍），字号阶梯不变。 */
        sc = { x: 34, y: compact ? 96 : 104, cols: 9, rows: compact ? 4 : 5, doorCol: 3 };
        var mpipY = compact ? (sc.y + sc.rows * T + 24)
          : Math.max(sc.y + sc.rows * T + 12, H - 328);
        p = { x: 20, y: mpipY + 42, w: W - 40, h: 0 };
        m = { x: p.x + 14, y: p.y + 30, w: p.w - 28, rowH: 38, font: 18, label: 18, note: 12,
          detail: compact ? 0 : 11 };
        var avail = H - m.y - 24 - 18;
        m.rowH = compact ? Math.max(24, Math.min(30, Math.floor(avail / 5)))
          : Math.max(26, Math.min(38, Math.floor(avail / 5)));
        p.h = Math.min(246, H - p.y - 10);
        hintY = compact ? Math.min(m.y + 5 * m.rowH + 20, p.y + p.h - 16)
          : m.y + 5 * m.rowH + 20;
        lay = {
          tier: tier, T: T, scene: sc, panel: p,
          title: { x: 24, smallY: 40, mainY: 68, subY: 90, small: 10, main: 24, sub: 12 },
          rule: { x: 30, y: p.y + 12, w: p.w - 20 },
          menu: m,
          progress: { x: 24, pipY: mpipY, pip: 16, gap: 14,
            /* 中屏放不下 72×72 巨龙（会压到场景底边与面板上沿），按"不放替身图标"处理：只留文字 */
            end: { name: null, x: p.x + p.w - 32 - 12, y: mpipY - 18, k: 1 } }
        };
      } else {
        var rows = (H >= 600) ? 5 : 4;
        sc = { x: 16, y: 88, cols: 6, rows: rows, doorCol: 2 };
        var npipY = sc.y + rows * T + 24;
        p = { x: 12, y: npipY + 44, w: W - 24, h: 0 };
        m = { x: p.x + 12, y: p.y + 24, w: p.w - 24, rowH: 30, font: 14, label: 14, note: 10, detail: 0 };
        var navail = H - m.y - 24 - 18;
        m.rowH = Math.max(22, Math.min(30, Math.floor(navail / 5)));
        p.h = H - p.y - 12;
        hintY = m.y + 5 * m.rowH + 20;
        lay = {
          tier: tier, T: T, scene: sc, panel: p,
          title: { x: 16, smallY: 28, mainY: 52, subY: 72, small: 10, main: 20, sub: 11 },
          rule: { x: p.x + 12, y: p.y + 12, w: p.w - 24 },
          menu: m,
          progress: { x: 16, pipY: npipY, pip: 12, gap: 10,
            /* 窄屏同理：不拿恶魔图标冒充最终 Boss，只留文字 */
            end: { name: null, x: p.x + p.w - 32 - 10, y: npipY + 12 - 36, k: 1 } }
        };
      }
      lay.door = { x: sc.x + sc.doorCol * T, y: sc.y, w: T * 2, h: T * 2 };
      lay.shaft = { x: lay.door.x, y: sc.y + 2 * T, w: T * 2, h: T };
      lay.steps = { x: lay.door.x, y: sc.y + 3 * T, w: T * 2 };
      lay.knight = { x: lay.door.x - 56, bottom: lay.steps.y + 2 * T - 8, w: 48, h: 84 };
      /* D-106 紧凑高度档：场景缩行后（中档 4 行 / 窄屏 4 行），骑士脚底收在场景底边之上，
       * 避免人物与场景外的进度标签互相压住 */
      if (compact && (tier === 'mid' || tier === 'narrow')) {
        lay.knight.bottom = Math.min(lay.knight.bottom, sc.y + sc.rows * T - 6);
      }
      lay.torch = { x: sc.x + (tier === 'narrow' ? 4 : 52), y: sc.y + T - 4, size: 48 };
      lay.chain = { x: sc.x + (tier === 'wide' ? 7 : 3) * T + 8, y: sc.y + T - 8 };
      lay.web = { x: sc.x + T - 12, y: sc.y + T + 4 };
      lay.hint = { x: m.x + 2, y: hintY };
      lay.hasSave = !!hasSave;
      /* 进度标签：有档写真实楼层/等级，无档写目标值；终点符号紧贴标签右缘（不越过面板内边距）。
       * 第 5 层已到头：不再写「→ 第 5 层」（不出现箭头指向自己），到达状态由下方的「已抵达」承担。 */
      var pr = lay.progress;
      var f = (typeof floor === 'number' && floor >= 1) ? floor : 1;
      var lv = (typeof level === 'number' && level >= 1) ? level : 1;
      if (hasSave && f >= 5) pr.label = '第 ' + f + ' 层 · Lv.' + lv;
      else pr.label = hasSave ? ('第 ' + f + ' 层 · Lv.' + lv + ' → 第 5 层') : 'Lv.1 → 第 5 层';
      pr.fontSize = (tier === 'narrow') ? 11 : 12;
      pr.end.x = Math.min(pr.end.x, pr.x + this._menuTextW(pr.label, pr.fontSize) + 10);
      return lay;
    },

    /* 门缝光：核心 2px，落在双扇门中缝上（x = 门中心 − 1，保证 2 像素整格对齐）。 */
    _seamSpec: function (lay) {
      var d = lay.door;
      return { x: d.x + Math.floor(d.w / 2) - 1, y: d.y + 6, w: 2, h: d.h - 12, color: '#ffbf73' };
    },

    /* 进度模型：4 枚石钉 + 第 5 格终点符号；开局填 1 枚，第 5 层点亮终点。 */
    _progressModel: function (floor) {
      var f = (typeof floor === 'number' && floor >= 1) ? Math.floor(floor) : 1;
      return { floor: f, total: 5, filled: Math.max(1, Math.min(4, f)), final: f >= 5 };
    },

    _drawMenuRoot: function (st, W, H) {
      var S = Game.Systems && Game.Systems.Save;
      var raw = (S && typeof S.peek === 'function') ? S.peek() : null;
      var floor = 1, level = 1;
      if (raw) {
        floor = (typeof raw.floor === 'number') ? raw.floor
          : ((raw.pos && typeof raw.pos.floor === 'number') ? raw.pos.floor : 1);
        level = (raw.player && typeof raw.player.level === 'number' && raw.player.level >= 1)
          ? raw.player.level : 1;
      }
      var lay = this._menuLayout(W, H, !!raw, floor, level);
      this._drawMenuScene(lay);
      this._drawMenuPanel(lay, st, floor, level, !!raw);
    },

    /* 静帧：场景底板 / 墙砖地砖 / 双扇门 / 暗井 / 台阶 / 火把 / 骑士 / 门缝光。
     * 验证页用桩 ctx（无 drawImage / 渐变）调用时不画场景，面板与文字仍照常输出。 */
    _drawMenuScene: function (lay) {
      var ctx = this._ctx;
      var W = this.cssW || 1024, H = this.cssH || 640;
      var S = Game.Core.Sprites;
      var ready = !!(S && typeof S.isReady === 'function' && S.isReady());
      var k = (this.dpr || 1) * (this.scale || 1);
      var key = [W, H, k, lay.tier, lay.scene.x, lay.scene.y,
        lay.scene.cols, lay.scene.rows, ready ? 1 : 0].join('|');
      var cv = this._canvas;
      var canBlit = !!(ctx && typeof ctx.save === 'function' && typeof ctx.restore === 'function' &&
        typeof ctx.setTransform === 'function' && typeof ctx.drawImage === 'function');
      if (ready && canBlit && menuSceneCache.cv && menuSceneCache.key === key) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (cv && (cv.width !== menuSceneCache.cv.width || cv.height !== menuSceneCache.cv.height)) {
          ctx.drawImage(menuSceneCache.cv, 0, 0, cv.width, cv.height);
        } else {
          ctx.drawImage(menuSceneCache.cv, 0, 0);
        }
        ctx.restore();
        return;
      }
      if (!ready || !canBlit || typeof document.createElement !== 'function') {
        this._paintMenuScene(ctx, lay, W, H);
        return;
      }
      var ow = Math.max(1, Math.round(W * k)), oh = Math.max(1, Math.round(H * k));
      if (!menuSceneCache.cv) {
        menuSceneCache.cv = document.createElement('canvas');
        menuSceneCache.ctx = menuSceneCache.cv.getContext('2d');
      }
      if (!menuSceneCache.ctx) {
        this._paintMenuScene(ctx, lay, W, H);
        return;
      }
      if (menuSceneCache.cv.width !== ow || menuSceneCache.cv.height !== oh) {
        menuSceneCache.cv.width = ow;
        menuSceneCache.cv.height = oh;
      }
      var oc = menuSceneCache.ctx;
      oc.setTransform(1, 0, 0, 1, 0, 0);
      oc.clearRect(0, 0, ow, oh);
      oc.setTransform(k, 0, 0, k, 0, 0);
      try { if ('imageSmoothingEnabled' in oc) oc.imageSmoothingEnabled = false; } catch (e) { /* 降级 */ }
      this._paintMenuScene(oc, lay, W, H);
      menuSceneCache.key = key;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (cv && (cv.width !== ow || cv.height !== oh)) {
        ctx.drawImage(menuSceneCache.cv, 0, 0, cv.width, cv.height);
      } else {
        ctx.drawImage(menuSceneCache.cv, 0, 0);
      }
      ctx.restore();
    },

    /* 场景本体：完全由 lay + 素材决定，不含时间/输入，可安全烘焙到离屏画布 */
    _paintMenuScene: function (ctx, lay, W, H) {
      var sc = lay.scene, T = lay.T, d = lay.door;
      ctx.fillStyle = '#0a0b12';
      ctx.fillRect(0, 0, W, H);

      var can = typeof ctx.drawImage === 'function' &&
        typeof ctx.createRadialGradient === 'function' &&
        typeof ctx.createLinearGradient === 'function' &&
        typeof ctx.ellipse === 'function' &&
        typeof ctx.arc === 'function' &&
        typeof ctx.save === 'function';
      if (!can) return;

      var S = Game.Core.Sprites;
      function spr(name, x, y, k, alpha, fallback) {
        var im = (S && typeof S.get === 'function') ? S.get(name) : null;
        ctx.globalAlpha = (typeof alpha === 'number') ? alpha : 1;
        if (im && im.naturalWidth) ctx.drawImage(im, x, y, im.naturalWidth * k, im.naturalHeight * k);
        else if (fallback) { ctx.fillStyle = fallback; ctx.fillRect(x, y, 24 * k, 24 * k); }
        ctx.globalAlpha = 1;
      }

      var bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a0b12');
      bg.addColorStop(1, '#05060a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.018)';
      for (var gx = 0; gx < W; gx += 32) ctx.fillRect(gx, 0, 1, H);

      /* 场景外框 */
      ctx.fillStyle = '#030407';
      ctx.fillRect(sc.x - 8, sc.y - 8, sc.cols * T + 16, sc.rows * T + 16);
      ctx.strokeStyle = '#221e2a';
      ctx.lineWidth = 1;
      ctx.strokeRect(sc.x - 7.5, sc.y - 7.5, sc.cols * T + 16, sc.rows * T + 16);

      /* 墙砖 / 地砖：门洞 2 格宽 × 3 格高留空 */
      for (var ty = 0; ty < sc.rows; ty++) {
        for (var tx = 0; tx < sc.cols; tx++) {
          var x = sc.x + tx * T, y = sc.y + ty * T;
          if ((tx === sc.doorCol || tx === sc.doorCol + 1) && ty <= 2) continue;
          if (ty === 0) spr('wall_top_mid', x, y, 2, 1, '#1b1a22');
          else if (ty === 1) spr('wall_mid', x, y, 2, 1, '#17161e');
          else spr(floorVariantName(tx, ty, 1), x, y, 2, 1, '#141318');
        }
      }

      /* 双扇门：t1_door 24×24 → 48×48，2×2 共 4 块 */
      ctx.fillStyle = '#020204';
      ctx.fillRect(d.x - 6, d.y - 6, d.w + 12, d.h + 12);
      ctx.strokeStyle = 'rgba(255,180,100,0.20)';
      ctx.strokeRect(d.x - 5.5, d.y - 5.5, d.w + 11, d.h + 11);
      spr('t1_door', d.x, d.y, 2, 1, '#1a1410');
      spr('t1_door', d.x + T, d.y, 2, 1, '#1a1410');
      spr('t1_door', d.x, d.y + T, 2, 1, '#1a1410');
      spr('t1_door', d.x + T, d.y + T, 2, 1, '#1a1410');
      /* 门矩形压暗 0.40：门读成"更深的洞"，只压门、不压墙（墙砖保持原亮度） */
      ctx.fillStyle = 'rgba(0,0,0,0.40)';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      /* 门格横档压暗：t1_door 的第 10–13 行（2× 后每块 20–27px）原本比门板亮，
       * 不压就会和 2px 竖缝抢"唯一透光处"；压到门板亮度以下，只留竖缝发光。 */
      ctx.fillStyle = 'rgba(0,0,0,0.58)';
      for (var dt = 0; dt < 2; dt++) {
        ctx.fillRect(d.x, d.y + dt * T + 20, d.w, 8);
      }

      /* 暗井：门内一格黑底；两侧只留石缝，不再画暖边（暖边会和竖缝争光源身份） */
      var sh = lay.shaft;
      ctx.fillStyle = 'rgba(0,0,0,0.74)';
      ctx.fillRect(sh.x, sh.y, sh.w, sh.h);
      ctx.fillStyle = 'rgba(72,64,56,0.35)';
      ctx.fillRect(sh.x, sh.y, 1, sh.h);
      ctx.fillRect(sh.x + sh.w - 1, sh.y, 1, sh.h);

      /* 台阶：纯绘制 3 级，逐级左右各收 8px；台面只做一层极浅的明暗差，不画亮线 */
      var stp = lay.steps;
      for (var si = 0; si < 3; si++) {
        var inset = si * 8;
        ctx.fillStyle = (si === 0) ? '#1a1510' : '#17130f';
        ctx.fillRect(stp.x + inset, stp.y + si * 15, stp.w - inset * 2, 13);
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.fillRect(stp.x + inset, stp.y + si * 15 + 13, stp.w - inset * 2, 2);
      }

      /* 墙饰（1× 原生） */
      spr('t1_dc_chain', lay.chain.x, lay.chain.y, 1, 0.75, 'rgba(120,120,140,0.25)');
      spr('t1_dc_web', lay.web.x, lay.web.y, 1, 0.5, 'rgba(160,160,180,0.18)');

      /* 火把：场景内唯一真实光源 */
      spr('t1_dc_torch', lay.torch.x, lay.torch.y, 2, 1, '#3a2a12');
      var lx = lay.torch.x + 24, ly = lay.torch.y + 20;
      var glowR = (lay.tier === 'wide') ? 250 : (lay.tier === 'mid' ? 210 : 150);
      function glow(cx2, cy2, r, rgb, a) {
        var g = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r);
        g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
        g.addColorStop(0.45, 'rgba(' + rgb + ',' + (a * 0.42) + ')');
        g.addColorStop(1, 'rgba(' + rgb + ',0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      glow(lx, ly, glowR, '255,150,62', 0.32);
      glow(lx, ly, Math.round(glowR * 0.48), '255,214,140', 0.24);
      glow(lx, ly - 18, 34, '255,238,190', 0.45);

      /* 柔边光池：径向渐变 + 纵向压扁，外缘衰减到 0；不裁切、不铺矩形 */
      function pool(cx2, cy2, rx, ry, a) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(cx2, cy2);
        ctx.scale(1, ry / rx);
        var pg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        pg.addColorStop(0, 'rgba(255,186,110,' + a + ')');
        pg.addColorStop(0.50, 'rgba(255,172,92,' + (a * 0.42) + ')');
        pg.addColorStop(1, 'rgba(255,172,92,0)');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      /* 骑士 2×（24×42 → 48×84），站在楼梯左侧、面朝楼梯 */
      var kn = lay.knight;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.50)';
      ctx.beginPath();
      ctx.ellipse(kn.x + 24, kn.bottom, 26, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      spr('knight_m_idle_anim_f0', kn.x, kn.bottom - 84, 2, 1, '#3a4a6a');
      /* 受火光的一侧边光（纯绘制） */
      var eg = ctx.createLinearGradient(kn.x, 0, kn.x + 10, 0);
      eg.addColorStop(0, 'rgba(255,190,110,0.10)');
      eg.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(kn.x, kn.bottom - 84, 10, 84);

      /* 门缝光：门槛一层 + 每级台阶一层，逐级变暗；全部柔边，外缘自然衰减到 0。
       * 唯一画得出硬边的 2px 竖缝放在最后，不透明压上。 */
      var seam = this._seamSpec(lay);
      var gateY = d.y + d.h;
      pool(seam.x + 1, gateY + 3, d.w * 0.62, 30, 0.22);
      for (var pi = 0; pi < 3; pi++) {
        var pin = pi * 8;
        pool(stp.x + stp.w / 2, stp.y + pi * 15 + 6,
          Math.max(18, (stp.w - pin * 2) * 0.5), 8, 0.16 - pi * 0.055);
      }
      ctx.fillStyle = seam.color;
      ctx.fillRect(seam.x, seam.y, seam.w, seam.h);
    },

    /* 右侧暗栏 / 窄屏下置菜单：标题、五项菜单、进度条、操作提示 */
    _drawMenuPanel: function (lay, st, floor, level, hasSave) {
      var ctx = this._ctx;
      var p = lay.panel, m = lay.menu, ti = lay.title;
      var FONT_CN = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
      var FONT_MONO = 'Consolas, "Courier New", monospace';

      /* 暗栏用近实色 #07080e：对比度不依赖背后的地板亮度 */
      ctx.fillStyle = '#07080e';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = '#3a3340';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      ctx.fillStyle = 'rgba(255,207,110,0.28)';
      ctx.fillRect(lay.rule.x, lay.rule.y, lay.rule.w, 1);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#8a7a56';
      ctx.font = ti.small + 'px ' + FONT_MONO;
      ctx.fillText('DUNGEON / ENTRANCE', ti.x, ti.smallY);

      ctx.fillStyle = '#ffcf6e';
      ctx.font = 'bold ' + ti.main + 'px ' + FONT_CN;
      ctx.fillText('地牢：我独自升级', ti.x, ti.mainY);

      ctx.fillStyle = '#9aa0b4';
      ctx.font = ti.sub + 'px ' + FONT_CN;
      /* 最终 Boss 是地牢巨龙，文案不随视口变；中/窄屏画不出 72×72 时宁可不画终点图标 */
      ctx.fillText('往地牢更深处走 · 第 5 层击败地牢巨龙', ti.x, ti.subY);

      var items = st.items || [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i], y = m.y + i * m.rowH;
        var on = (i === st.sel);
        var hasD = !!it.detail && m.detail > 0;
        var boxH = m.rowH - 4;
        this._hotAdd('menu:row:' + it.id, m.x, y, m.w, boxH);
        /* D-100：hover 只画当前这一行（选中行已有更强的焦点框） */
        if (!on && HOVER_ID === 'menu:row:' + it.id) {
          ctx.fillStyle = 'rgba(255,207,110,0.06)';
          ctx.fillRect(m.x, y, m.w, boxH);
          ctx.strokeStyle = 'rgba(255,207,110,0.55)';
          ctx.lineWidth = 1;
          ctx.strokeRect(m.x + 0.5, y + 0.5, m.w - 1, boxH - 1);
        }
        if (on) {
          ctx.fillStyle = 'rgba(255,207,110,0.12)';
          ctx.fillRect(m.x, y, m.w, boxH);
          ctx.strokeStyle = 'rgba(255,207,110,0.75)';
          ctx.lineWidth = 1;
          ctx.strokeRect(m.x + 0.5, y + 0.5, m.w - 1, boxH - 1);
          ctx.fillStyle = '#ffcf6e';
          ctx.fillRect(m.x, y, 3, boxH);
        }
        var baseY = hasD ? y + Math.round(m.rowH * 0.5) : y + Math.round(m.rowH * 0.62);
        ctx.textAlign = 'left';
        ctx.fillStyle = (it.enabled === false) ? '#7d8397' : (on ? '#ffcf6e' : '#cfcfcf');
        ctx.font = (on ? 'bold ' : '') + m.label + 'px ' + FONT_CN;
        ctx.fillText((on ? '▶ ' : '  ') + it.label, m.x + 18, baseY);
        if (it.note) {
          ctx.textAlign = 'right';
          ctx.fillStyle = (it.note === '将覆盖现有存档') ? '#c98a6b' : '#838a9e';
          ctx.font = m.note + 'px ' + FONT_MONO;
          ctx.fillText(it.note, m.x + m.w - 16, baseY);
        }
        /* 行内进度详情：窄屏没有行高预算，舍去（真实楼层/等级由进度条承担） */
        if (hasD) {
          ctx.textAlign = 'left';
          ctx.fillStyle = on ? '#d8c79a' : '#9aa0b4';
          ctx.font = m.detail + 'px ' + FONT_MONO;
          ctx.fillText('    ' + it.detail, m.x + 18, y + Math.round(m.rowH * 0.82));
        }
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7f879c';
      ctx.font = m.note + 'px ' + FONT_MONO;
      ctx.fillText('↑↓ 选择 · Enter 确认', lay.hint.x, lay.hint.y);

      this._drawMenuProgress(lay, floor, level, hasSave);
    },

    /* Lv.N → 第 5 层：4 枚石钉 + 第 5 格终点符号（仅宽屏画 72×72 巨龙 1×；中/窄屏只留文字，不拿替身图标） */
    _drawMenuProgress: function (lay, floor, level, hasSave) {
      var ctx = this._ctx;
      var pr = lay.progress, pm = this._progressModel(floor);
      var S = Game.Core.Sprites;
      var FONT_MONO = 'Consolas, "Courier New", monospace';
      var label = pr.label || 'Lv.1 → 第 5 层';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#c9a35e';
      ctx.font = pr.fontSize + 'px ' + FONT_MONO;
      ctx.fillText(label, pr.x, pr.pipY - 8);

      for (var i = 0; i < 4; i++) {
        var x = pr.x + i * (pr.pip + pr.gap);
        var lit = i < pm.filled;
        ctx.fillStyle = lit ? '#ffcf6e' : 'rgba(255,207,110,0.10)';
        ctx.fillRect(x, pr.pipY, pr.pip, pr.pip);
        ctx.strokeStyle = lit ? '#ffcf6e' : '#a88a4e';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, pr.pipY + 0.5, pr.pip - 1, pr.pip - 1);
        if (lit) {
          var inset = Math.max(2, Math.round(pr.pip * 0.2));
          ctx.fillStyle = '#fff0c0';
          ctx.fillRect(x + inset, pr.pipY + inset, pr.pip - inset * 2, pr.pip - inset * 2);
        }
      }
      var im = (S && typeof S.get === 'function') ? S.get(pr.end.name) : null;
      if (im && im.naturalWidth && typeof ctx.drawImage === 'function') {
        ctx.globalAlpha = pm.final ? 1 : 0.9;
        ctx.drawImage(im, pr.end.x, pr.end.y, im.naturalWidth * pr.end.k, im.naturalHeight * pr.end.k);
        ctx.globalAlpha = 1;
      }
      if (pm.final) {
        ctx.fillStyle = '#ffcf6e';
        ctx.font = 'bold 11px ' + FONT_MONO;
        ctx.fillText('已抵达', pr.x, pr.pipY + pr.pip + 12);
      }
      ctx.textAlign = 'left';
    },

    /* D-128：四个子页共用的「介质」——不再是「一张卡」。
     * 底 #0a0b12 / 1px 沿口 #2b2440 / 4px 接触阴影 #040407（只在下、右）/
     * 四角 4×4 石钉 #3a3340 + 1px 左上受光 rgba(178,158,220,0.10)。
     * opt.drop 为落位偏移（整数），opt.alpha 为沿口 alpha（0.6→1）。 */
    _menuMedium: function (x, y, w, h, opt) {
      var ctx = this._ctx, o = opt || {};
      var dy = (typeof o.drop === 'number') ? Math.round(o.drop) : 0;
      var a = (typeof o.alpha === 'number') ? o.alpha : 1;
      var yy = y + dy;
      var i, sx, sy;
      ctx.fillStyle = '#040407';
      ctx.fillRect(x + 4, yy + h, w, 4);
      ctx.fillRect(x + w, yy + 4, 4, h);
      ctx.fillStyle = '#0a0b12';
      ctx.fillRect(x, yy, w, h);
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#2b2440';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, yy + 0.5, w - 1, h - 1);
      ctx.globalAlpha = 1;
      var px = [x + 8, x + w - 12], py = [yy + 8, yy + h - 12];
      for (i = 0; i < 4; i++) {
        sx = px[i % 2]; sy = py[(i / 2) | 0];
        ctx.fillStyle = '#3a3340';
        ctx.fillRect(sx, sy, 4, 4);
        ctx.fillStyle = 'rgba(178,158,220,0.10)';
        ctx.fillRect(sx, sy, 4, 1);
        ctx.fillRect(sx, sy, 1, 4);
      }
      return yy;
    },

    /* D-128：介质页头带（kicker 10 / 标题 22·窄档 20 / 右端 mono 10 / 金色分隔线）。
     * 标题从 x+48 起笔，x+16..40 留给定页的 24×24 实物锚（火把 / 骷髅 / 门徽）。
     * 返回 bodyTop 与标题文本框，绘制与验证页共用同一份坐标。 */
    _menuHeader: function (x, y, w, kicker, title, right, danger, narrow) {
      var ctx = this._ctx;
      var FONT_CN = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
      var FONT_MONO = 'Consolas, "Courier New", monospace';
      var ts = narrow ? 20 : 22;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8a7a56';
      ctx.font = '10px ' + FONT_MONO;
      ctx.fillText(kicker || '', x + 16, y + 18);
      var tw = 0;
      if (title) {
        ctx.fillStyle = danger ? '#ff9b6b' : '#ffcf6e';
        ctx.font = 'bold ' + ts + 'px ' + FONT_CN;
        ctx.fillText(title, x + 48, y + 42);
        tw = this._menuTextW(title, ts);
      }
      if (right) {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#8a7a56';
        ctx.font = '10px ' + FONT_MONO;
        ctx.fillText(right, x + w - 16, y + 18);
        ctx.textAlign = 'left';
      }
      ctx.fillStyle = 'rgba(255,207,110,0.28)';
      ctx.fillRect(x + 16, y + 52, w - 32, 1);
      return {
        x: x, y: y, w: w, bodyTop: y + 66,
        title: { x: x + 48, base: y + 42, size: ts, w: tw, h: ts + 4 },
        anchor: { x: x + 16, y: y + 18, w: 24, h: 24 }
      };
    },

    /* D-128：装饰精灵——缺素材或桩 ctx（无 drawImage）时**不画**，不留色块，
     * 以免把「实物锚是否存在」的验证被兜底方块冒充。 */
    _menuSprite: function (name, x, y, k) {
      var ctx = this._ctx, S = Game.Core.Sprites;
      var im = (S && typeof S.get === 'function') ? S.get(name) : null;
      if (!im || !im.naturalWidth || typeof ctx.drawImage !== 'function') return false;
      var kk = (k === 2) ? 2 : 1;
      ctx.drawImage(im, x, y, im.naturalWidth * kk, im.naturalHeight * kk);
      return true;
    },

    /* 子页四角暗角：让网格退到内容之后，和首屏「场景 + 暗栏」同一光照逻辑 */
    _menuVignette: function (W, H) {
      var ctx = this._ctx;
      /* 验证桩（只实现 fillRect/fillText 的假 ctx）没有渐变 API：暗角是纯装饰，跳过即可，
       * 不影响任何文字判定。 */
      if (!ctx || typeof ctx.createRadialGradient !== 'function') return;
      var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34,
        W / 2, H / 2, Math.max(W, H) * 0.74);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.42)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },

    /* 按估算字宽逐字换行：优先在 · / 空格 / 逗号处断，行首不留收尾标点 */
    _menuWrap: function (text, size, maxW) {
      var s = String(text || '');
      var out = [], cur = '';
      var close = '。，、；：！？）》」』】…';
      /* 只在真正的分隔符处断，不按空格断——“方向键 / WASD 移动；…” 这类行
       * 若在空格处断，会把“WASD”和“移动”拆到两行；空格只作兜底。 */
      var sep = '·，：；、';
      for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (ch === '\n') { out.push(cur); cur = ''; continue; }
        var test = cur + ch;
        if (cur && this._menuTextW(test, size) > maxW) {
          if (close.indexOf(ch) >= 0) { cur = test; continue; }
          var br = -1, q;
          for (q = cur.length - 1; q > 0; q--) {
            if (sep.indexOf(cur.charAt(q)) >= 0) { br = q; break; }
          }
          if (br <= 0) {
            for (q = cur.length - 1; q > 0; q--) {
              if (cur.charAt(q) === ' ') { br = q; break; }
            }
          }
          if (br > 0) {
            var head = cur.slice(0, br + 1), rest = cur.slice(br + 1);
            /* “·”“/”是分隔符号不是标点：断行处直接丢掉，不让它孤零零落在行首或行尾 */
            head = head.replace(/[\s·\/]+$/, '');
            rest = rest.replace(/^[\s·\/]+/, '');
            out.push(head);
            cur = rest + ch;
          } else {
            out.push(cur);
            cur = ch;
          }
        } else cur = test;
      }
      if (cur) out.push(cur);
      return out.length ? out : [''];
    },

    /* 均衡折行（确认页说明、帮助页正文共用）：先按语义片段（·，：；。、）切词，
     * 在“行数最少”的前提下让各行宽度尽量接近；只有某个片段本身超宽时，才把它拆成
     * 单字参与分配。断点规则：收尾标点不落行首、开括号不落行尾、不在 ASCII 词内部断。
     * 结果带缓存（每帧都会调）。 */
    _menuWrapBalanced: function (text, size, maxW) {
      var s = String(text || '');
      if (!s) return [''];
      var key = size + '|' + maxW + '|' + s;
      this.__wrapCache = this.__wrapCache || {};
      if (this.__wrapCache[key]) return this.__wrapCache[key].slice();

      var n = s.length, i, j, k, e;
      var close = '。，、；：！？）》」』】…·';
      var open = '（《「『【';
      var sep = '·，：；。、';
      var ASCII = /[0-9A-Za-z%+.\-:\/]/;
      var pw = [0];
      for (i = 0; i < n; i++) {
        pw.push(pw[i] + ((s.charCodeAt(i) > 0x2E80) ? size : size * 0.6));
      }
      var spanW = function (x, y) {
        while (x < y && s.charAt(x) === ' ') x++;
        while (y > x && s.charAt(y - 1) === ' ') y--;
        return Math.round(pw[y] - pw[x]);
      };
      var canBreakAt = function (pos) {
        if (pos <= 0 || pos >= n) return true;
        var a = s.charAt(pos - 1), b = s.charAt(pos);
        if (close.indexOf(b) >= 0) return false;
        if (open.indexOf(a) >= 0) return false;
        if (ASCII.test(a) && ASCII.test(b)) return false;
        return true;
      };

      /* 语义片段；超宽片段拆成单字 */
      var toks = [], st = 0;
      var pushSeg = function (a, b) {
        if (spanW(a, b) <= maxW) toks.push({ a: a, b: b });
        else for (var q = a; q < b; q++) toks.push({ a: q, b: q + 1 });
      };
      for (i = 0; i < n; i++) {
        if (sep.indexOf(s.charAt(i)) >= 0) { pushSeg(st, i + 1); st = i + 1; }
      }
      if (st < n) pushSeg(st, n);
      if (!toks.length) return [''];

      var runDP = function (tk) {
        var N = tk.length, K = 12, i2, j2, k2, e2;
        if (!N) return null;
        var tw = [], okPos = [];
        for (i2 = 0; i2 < N; i2++) tw.push(spanW(tk[i2].a, tk[i2].b));
        for (e2 = 0; e2 <= N; e2++) okPos.push(e2 === N || canBreakAt(tk[e2].a));
        var dp = [], cut = [];
        for (k2 = 0; k2 <= K; k2++) {
          dp.push(new Array(N + 1));
          cut.push(new Array(N + 1));
          for (e2 = 0; e2 <= N; e2++) { dp[k2][e2] = 1e9; cut[k2][e2] = 0; }
        }
        dp[0][0] = 0;
        for (k2 = 1; k2 <= K; k2++) {
          for (e2 = 1; e2 <= N; e2++) {
            if (!okPos[e2]) continue;
            var sum = 0, best = 1e9, bk = 0;
            for (j2 = e2 - 1; j2 >= 0; j2--) {
              sum += tw[j2];
              if (sum > maxW) break;
              var cand = Math.max(dp[k2 - 1][j2], Math.round(sum));
              if (cand < best) { best = cand; bk = j2; }
            }
            dp[k2][e2] = best;
            cut[k2][e2] = bk;
          }
        }
        for (k2 = 1; k2 <= K; k2++) if (dp[k2][N] <= maxW) break;
        if (k2 > K) return null;
        var res = [], e3 = N;
        for (var k3 = k2; k3 >= 1; k3--) {
          var s3 = cut[k3][e3];
          /* 断行处的「·」是分隔符不是标点：行尾/行首都去掉，不让它悬在行边 */
          res.unshift(s.slice(tk[s3].a, tk[e3 - 1].b)
            .replace(/^[\s·]+/, '').replace(/[\s·]+$/, ''));
          e3 = s3;
        }
        return res;
      };

      var out = runDP(toks);
      /* 末行过短（寡妇行）时，退到逐字分配再比一次：行数不多、末行更长就采用。
       * 逐字分配仍受行首/行尾禁则与“不在 ASCII 词内部断”约束。 */
      if (out && out.length > 1 &&
          this._menuTextW(out[out.length - 1], size) < maxW * 0.5) {
        var ct = [];
        for (i = 0; i < n; i++) ct.push({ a: i, b: i + 1 });
        var alt = runDP(ct);
        if (alt && alt.length <= out.length &&
            this._menuTextW(alt[alt.length - 1], size) > this._menuTextW(out[out.length - 1], size)) {
          out = alt;
        }
      }
      if (!out) out = this._menuWrap(s, size, maxW);
      this.__wrapCache[key] = out;
      return out.slice();
    },

    _drawMenuHelp: function (st, W, H) {
      var ctx = this._ctx;
      var FONT_CN = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
      var FONT_MONO = 'Consolas, "Courier New", monospace';
      this._menuVignette(W, H);

      var tier = this._menuTier(W, H);
      var compact = tier.compact;
      var cardW = Math.min(880, W - 24);
      var cardH = H - 48;
      var cx0 = Math.round((W - cardW) / 2), cy0 = 24;
      var k = this._menuEnterK(st);
      this._menuMedium(cx0, cy0, cardW, cardH, { drop: -2 * (1 - k), alpha: 0.6 + 0.4 * k });

      var narrow = W < 420;
      var hd = this._menuHeader(cx0, cy0, cardW, 'CODEX / CONTROLS', '玩法说明', '01–08', false, narrow);
      /* 紧凑高度档：页头 66→58（标题仍在 y+42，只把正文提上来 8px） */
      var bodyTop = hd.bodyTop - (compact ? 8 : 0), hintY = cy0 + cardH - 14;
      var innerX = cx0 + 18, textX = innerX + 34;
      /* 右半区三种表达：宽档整条竖井 / 紧凑档五枚层徽 / 中窄档不出图（保持单列滚动） */
      var split = cardW >= 840 && !compact;
      var badges = cardW >= 840 && compact;
      var bodySize = narrow ? 12 : 13;
      var lineH = narrow ? 18 : (split ? 19 : 20);
      /* 分栏时文字列 ≤ 420（卡宽 47.7%，≪55%），给右侧纵剖面让出半区 */
      var maxW = (split || badges) ? 420 : cardW - 84;

      /* 介质里的实物：火把（标题左侧 24×24）、右上铁链、左下碎屑 */
      this._menuSprite('t1_dc_torch', cx0 + 16, cy0 + 18, 1);
      this._menuSprite('t1_dc_chain', cx0 + cardW - 40, cy0 + 108, 1);
      this._menuSprite('t1_dc_rubble', cx0 + 8, cy0 + cardH - 32, 1);

      /* 扁平行：节标题 / 正文（按卡宽换行）/ 节间空行；helpScroll 仍是行索引。
       * 分栏时行高收紧（头 28 / 间 10），让 8 组在首屏全部可见、不出现滚动。 */
      var gapH = split ? 8 : lineH;
      var headH = split ? 26 : lineH;
      var rows = [], help = st.help || [];
      for (var i = 0; i < help.length; i++) {
        if (i > 0) rows.push({ kind: 'gap', h: gapH });
        rows.push({ kind: 'head', h: headH, n: ('0' + (i + 1)).slice(-2), text: help[i].title });
        var ls = help[i].lines || [];
        for (var j = 0; j < ls.length; j++) {
          /* 与确认页同一套规则：语义片段整体换行，避免「H 重看引导」「上限 +5。」落成寡妇行 */
          var ws = this._menuWrapBalanced(ls[j], bodySize, maxW);
          for (var kk = 0; kk < ws.length; kk++) rows.push({ kind: 'body', h: lineH, text: ws[kk] });
        }
      }
      var avail = hintY - 20 - bodyTop;
      var totalH = 0, r0;
      for (r0 = 0; r0 < rows.length; r0++) totalH += rows[r0].h;
      /* 滚动上限：从第 s 行起剩余高度必须放得下（按行高累计，不再用“行数×固定行高”） */
      var scrollMax = 0, rest = totalH;
      while (scrollMax < rows.length && rest > avail) { rest -= rows[scrollMax].h; scrollMax++; }
      var scroll = Math.max(0, Math.min(st.helpScroll || 0, scrollMax));

      ctx.save();
      ctx.beginPath();
      ctx.rect(cx0 + 8, bodyTop - 6, cardW - 24, avail + 12);
      ctx.clip();
      var y = bodyTop + 12;
      for (var r = scroll; r < rows.length; r++) {
        var row = rows[r];
        if (y > bodyTop + avail) break;
        if (row.kind === 'head') {
          ctx.textAlign = 'left';
          ctx.fillStyle = '#8a7a56';
          ctx.font = '11px ' + FONT_MONO;
          ctx.fillText(row.n, innerX, y + 14);
          ctx.fillStyle = '#ffb86b';
          ctx.font = 'bold 14px ' + FONT_CN;
          ctx.fillText(row.text, textX, y + 14);
          if (r > 0) {
            ctx.fillStyle = 'rgba(255,207,110,0.10)';
            ctx.fillRect(textX, y - 5, maxW, 1);
          }
        } else if (row.kind === 'body') {
          ctx.textAlign = 'left';
          ctx.fillStyle = '#cfcfcf';
          ctx.font = bodySize + 'px ' + FONT_CN;
          ctx.fillText(row.text, textX, y + 14);
        }
        y += row.h;
      }
      ctx.restore();

      if (scrollMax > 0) {
        var trackX = cx0 + cardW - 7, trackY = bodyTop, trackH = avail;
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(trackX, trackY, 2, trackH);
        var th = Math.max(18, Math.round(trackH * avail / Math.max(1, totalH)));
        var ty = trackY + Math.round((trackH - th) * (scroll / Math.max(1, scrollMax)));
        ctx.fillStyle = 'rgba(255,207,110,0.50)';
        ctx.fillRect(trackX, ty, 2, th);
      }

      if (split) this._drawHelpSection(cx0, cardW, bodyTop, (hintY - 20) - bodyTop);
      else if (badges) this._drawHelpBadges(cx0, cardW, bodyTop, (hintY - 20) - bodyTop);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#7f8fa8';
      ctx.font = '11px ' + FONT_MONO;
      ctx.fillText(scrollMax > 0 ? '↑↓ 滚动 · Esc 返回主菜单' : 'Esc 返回主菜单',
        cx0 + cardW / 2, hintY);
      ctx.textAlign = 'left';
    },

    /* D-128：紧凑高度档（H<620）的竖井替身——五枚 24px 层徽 + 2px 竖线 + 72×72 龙 1×。
     * 龙的素材原生就是 72×72；规格写的 48px 会构成 0.67× 非整数缩放（违反 M8），
     * 因此保留原生 1×，整块高约 226px，仍落在 960×540 的约 392px 可用高内。 */
    _drawHelpBadges: function (cx0, cardW, top, avail) {
      var ctx = this._ctx;
      var FONT_MONO = 'Consolas, "Courier New", monospace';
      var lineX = cx0 + cardW - 18 - 68;
      var bx = lineX - 30, y0 = top + 6;
      ctx.fillStyle = 'rgba(255,207,110,0.16)';
      ctx.fillRect(lineX, y0 + 6, 2, 5 * 30 - 6);
      for (var i = 0; i < 5; i++) {
        var by = y0 + i * 30;
        this._menuSprite(floorVariantName(0, 0, i + 1), bx, by, 1);
        ctx.textAlign = 'left';
        ctx.fillStyle = (i === 4) ? '#ffb86b' : '#8a7a56';
        ctx.font = '11px ' + FONT_MONO;
        ctx.fillText('F' + (i + 1), lineX + 10, by + 17);
      }
      var dy = y0 + 5 * 30 + 4;
      if (dy + 72 > top + avail) dy = Math.max(y0, top + avail - 72);
      this._menuSprite('dragon_idle_anim_f0', lineX - 36, dy, 1);
      ctx.textAlign = 'left';
    },

    /* D-128：竖井几何——绘制、缓存与验证页共用同一份坐标。 */
    _helpShaftGeom: function (cx0, cardW, top, avail) {
      var px = cx0 + 490;
      var pw = cardW - 490 - 18;
      var py = top + 2;
      /* 前四层 84（36 井身 + 48 地面），F5 放大成 144 的 Boss 厅：144 的龙正好落地到顶 */
      var bandHs = [84, 84, 84, 84, 144];
      var floorH = 48, wallW = 24;
      var gutter = 30, contentW = 288;                 /* 6 × 48 = 12 × 24，两种瓦片同宽 */
      var ox = px + gutter + Math.round((pw - gutter - contentW) / 2);
      return { px: px, pw: pw, py: py, bandHs: bandHs, floorH: floorH, wallW: wallW,
        gutter: gutter, contentW: contentW, ox: ox, avail: avail };
    },

    /* D-94/D-128：玩法说明右半区的五层纵剖面。
     * 只用既有 24×24 瓦片（岩壁 1×、地面 2×），不新增素材。
     * D-128：图形部分（岩壁/地面/暗缝/刻度）是纯静态的，烘焙进 shaftCache，每帧只 1 次 blit；
     * F1…F5 与 BOSS 文字仍每帧直绘——验证页关闭文字层时，缓存里不含任何文字像素。 */
    _drawHelpSection: function (cx0, cardW, top, avail) {
      var ctx = this._ctx;
      var g = this._helpShaftGeom(cx0, cardW, top, avail);
      var S = Game.Core.Sprites;
      var ready = !!(S && typeof S.isReady === 'function' && S.isReady());
      var k = (this.dpr || 1) * (this.scale || 1);
      var W = this.cssW || 1024, H = this.cssH || 640;
      var key = [cx0, cardW, top, avail, k, ready ? 1 : 0].join('|');
      var canBlit = !!(ctx && typeof ctx.save === 'function' && typeof ctx.restore === 'function' &&
        typeof ctx.setTransform === 'function' && typeof ctx.drawImage === 'function');
      var baked = false;
      if (ready && canBlit && shaftCache.cv && shaftCache.key === key) {
        baked = true;
      } else if (ready && canBlit && typeof document.createElement === 'function') {
        var ow = Math.max(1, Math.round(W * k)), oh = Math.max(1, Math.round(H * k));
        if (!shaftCache.cv) {
          shaftCache.cv = document.createElement('canvas');
          shaftCache.ctx = shaftCache.cv.getContext('2d');
        }
        if (shaftCache.ctx) {
          if (shaftCache.cv.width !== ow || shaftCache.cv.height !== oh) {
            shaftCache.cv.width = ow; shaftCache.cv.height = oh;
          }
          var oc = shaftCache.ctx;
          oc.setTransform(1, 0, 0, 1, 0, 0);
          oc.clearRect(0, 0, ow, oh);
          oc.setTransform(k, 0, 0, k, 0, 0);
          try { if ('imageSmoothingEnabled' in oc) oc.imageSmoothingEnabled = false; } catch (e) { /* 降级 */ }
          this._paintShaft(oc, g);
          shaftCache.key = key;
          baked = true;
        }
      }
      if (baked) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(shaftCache.cv, 0, 0);
        ctx.restore();
      } else {
        this._paintShaft(ctx, g);
      }

      /* 文字层（每帧直绘）：F 编号 / BOSS 标注 / 底部一行说明 */
      var FONT_CN = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
      var FONT_MONO = 'Consolas, "Courier New", monospace';
      var by = g.py;
      for (var i = 0; i < 5; i++) {
        var fl = i + 1, bandH = g.bandHs[i];
        var fy = by + bandH - g.floorH;
        if (fl === 5) {
          ctx.textAlign = 'right';
          ctx.fillStyle = '#8a7a56';
          ctx.font = '9px ' + FONT_MONO;
          ctx.fillText('BOSS', g.ox + g.contentW - g.wallW - 12, fy - 34);
          ctx.fillStyle = '#ffb86b';
          ctx.font = 'bold 13px ' + FONT_CN;
          ctx.fillText('地牢巨龙', g.ox + g.contentW - g.wallW - 12, fy - 14);
          ctx.textAlign = 'left';
        }
        ctx.textAlign = 'right';
        ctx.fillStyle = (fl === 5) ? '#ffb86b' : '#8a7a56';
        ctx.font = '11px ' + FONT_MONO;
        ctx.fillText('F' + fl, g.px + 20, fy + 11);
        by += bandH;
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7f8798';
      ctx.font = '9px ' + FONT_MONO;
      /* 文案只写画面真能支撑的事实：五层地貌各不相同（亮度并非单调递减） */
      ctx.fillText('F1 → F5 · 五层地貌各不相同',
        g.px + g.gutter + Math.round((g.pw - g.gutter) / 2),
        Math.min(g.py + 480 + 12, g.py + g.avail));
      ctx.textAlign = 'left';
    },

    /* 竖井图形本体（无文字）：可安全烘焙，逐像素与直绘一致。 */
    _paintShaft: function (ctx, g) {
      var spr = function (name, dx, dy, dw, dh, fallback) {
        var im = (Game.Core.Sprites && typeof Game.Core.Sprites.get === 'function')
          ? Game.Core.Sprites.get(name) : null;
        if (im && im.naturalWidth && typeof ctx.drawImage === 'function') {
          ctx.drawImage(im, dx, dy, dw, dh);
          return;
        }
        ctx.fillStyle = fallback;
        ctx.fillRect(dx, dy, dw, dh);
      };

      /* 与文字的分隔：一条竖线，不做外框（避免“卡中卡”） */
      ctx.fillStyle = 'rgba(255,207,110,0.12)';
      ctx.fillRect(g.px - 14, g.py, 1, Math.min(g.avail, 480));

      var tint = ['#3b2c22', '#39402c', '#2c3138', '#3a2430', '#241a1c'];
      var by = g.py;
      for (var i = 0; i < 5; i++) {
        var bandH = g.bandHs[i], fl = i + 1;
        var wallName = (fl === 1) ? 'wall_mid' : 't' + fl + '_wall_mid';
        var rows = Math.ceil(bandH / 24);

        /* 井身：先整幅铺该层岩壁作为“远墙”，压暗后只把左右两列提亮成近墙 */
        for (var br = 0; br < rows; br++) {
          for (var bc = 0; bc < 12; bc++) {
            spr(wallName, g.ox + bc * 24, by + br * 24, 24, 24, tint[i]);
          }
        }
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(g.ox, by, g.contentW, bandH);
        for (var wr = 0; wr < rows; wr++) {
          spr(wallName, g.ox, by + wr * 24, g.wallW, 24, tint[i]);
          spr(wallName, g.ox + g.contentW - g.wallW, by + wr * 24, g.wallW, 24, tint[i]);
        }

        /* 本层地面（ledge）：该层地砖 2×，6 列，贴在层底 */
        var fy = by + bandH - g.floorH;
        for (var fc = 0; fc < 6; fc++) {
          spr(floorVariantName(fc, i, fl), g.ox + fc * 48, fy, 48, g.floorH, tint[i]);
        }
        if (i > 0) {
          ctx.fillStyle = 'rgba(0,0,0,' + (0.03 * i).toFixed(2) + ')';
          ctx.fillRect(g.ox, by, g.contentW, bandH);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(g.ox, fy, g.contentW, 1);

        /* 左竖尺刻度（F 编号由文字层画） */
        ctx.fillStyle = 'rgba(255,207,110,0.30)';
        ctx.fillRect(g.px + 24, fy + 6, 6, 1);
        by += bandH;
      }
      ctx.fillStyle = 'rgba(255,207,110,0.16)';
      ctx.fillRect(g.px + 28, g.py + 8, 1, 472);
    },

    _drawMenuSettings: function (st, W, H) {
      var ctx = this._ctx;
      var FONT_MONO = 'Consolas, "Courier New", monospace';
      this._menuVignette(W, H);

      var rows = st.settings || [];
      var tier = this._menuTier(W, H);
      var narrow = tier.tier === 'narrow';
      /* §4：mid 54 / narrow 50 / compact 46（只减行距，字号阶梯不动） */
      var rowH = tier.compact ? 46 : (narrow ? 50 : 54);
      var cardW = Math.min(560, W - 24);
      var cardH = 66 + rows.length * rowH + 20;
      var x = Math.round((W - cardW) / 2);
      var y = Math.max(8, Math.round((H - cardH) / 2) - 8);
      var k = this._menuEnterK(st);
      this._menuMedium(x, y, cardW, cardH, { drop: -2 * (1 - k), alpha: 0.6 + 0.4 * k });
      var hd = this._menuHeader(x, y, cardW, 'SYSTEM', '设置', null, false, narrow);
      /* 竖向石缝：一条 2px 深缝 + 1px 左侧受光，从页头贯穿到页脚（§17 正交砌缝语言） */
      ctx.fillStyle = '#05060a';
      ctx.fillRect(x + 10, y + 60, 2, cardH - 72);
      ctx.fillStyle = 'rgba(178,158,220,0.08)';
      ctx.fillRect(x + 12, y + 60, 1, cardH - 72);
      this._menuSprite('t1_dc_torch', hd.anchor.x, hd.anchor.y, 1);
      this._menuSprite('t1_dc_rubble', x + 10, y + cardH - 32, 1);

      this._drawSettingsRows(rows, st.settingsSel, W, y + 66, rowH, 'menusettings',
        { style: 'menu', x: x, w: cardW });

      /* 提示放在卡外：卡内再嵌一条提示带，就成了“卡中卡” */
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7f8fa8';
      ctx.font = '11px ' + FONT_MONO;
      ctx.fillText('↑↓ 选择 · ←→ / Enter 切换 · Esc 返回主菜单', x + cardW / 2,
        Math.min(H - 12, y + cardH + 22));
      ctx.textAlign = 'left';
    },

    /* D-51/D-91/D-94：清除存档与新游戏覆盖的二次确认页。
     * 文案与选项由 main.js 的 confirmData() 提供（菜单与暂停同源）；
     * 这里只给菜单版加「裁决卡」外框，标题/按钮仍交给共用面板画，暂停版不受影响。 */
    _drawMenuConfirm: function (st, W, H) {
      var ctx = this._ctx;
      this._menuVignette(W, H);
      var tier = this._menuTier(W, H);
      var narrow = tier.tier === 'narrow';
      var d = st.confirm || {}, lines = d.lines || [];
      var cardW = Math.min(460, W - 40);
      var textW = cardW - 48, lineH = 22;
      var btnH = tier.compact ? 32 : 36;
      var nLines = 0;
      for (var i = 0; i < lines.length; i++) nLines += this._menuWrapBalanced(lines[i], 13, textW).length;
      var cardH = 76 + nLines * lineH + 24 + btnH + 34;
      var x = Math.round((W - cardW) / 2);
      var y = Math.max(8, Math.round((H - cardH) / 2) - 6);
      var k = this._menuEnterK(st);
      this._menuMedium(x, y, cardW, cardH, { drop: -2 * (1 - k), alpha: 0.6 + 0.4 * k });
      this._menuHeader(x, y, cardW, 'CONFIRM / DANGER', d.title || '确认', null, true, narrow);
      /* 封蜡条：3px 危险色，两端各开一个 6×5 的缺口，读成封条而不是进度条 */
      ctx.fillStyle = '#ff9b6b';
      ctx.fillRect(x + 1, y + 1, cardW - 2, 3);
      ctx.fillStyle = '#0a0b12';
      ctx.fillRect(x + 1, y + 1, 6, 5);
      ctx.fillRect(x + cardW - 7, y + 1, 6, 5);
      /* 骨饰：skull 原生 24×24，1× 即满足「≥24×24 实物锚」 */
      this._menuSprite('skull', x + 16, y + 18, 1);
      this._drawConfirmPanel(st.confirm, st.confirmSel, W, H, {
        noTitle: true,
        linesY: y + 76,
        textW: textW,
        lineH: lineH,
        bw: Math.min(170, Math.floor((cardW - 88) / 2)),
        btnH: btnH,
        gapY: 24,
        hintY: y + cardH - 14,
        hotPrefix: 'menuconfirm',
        style: 'menu'
      });
      ctx.textAlign = 'left';
    },

    /* D-51：ESC 暂停面板（与主菜单同一套深色网格 / 金色高亮 / 等宽字体）。
     * 只画 UI，不推进任何状态；真停由 Main.loop 的暂停闸门保证。 */
    drawPause: function (spec) {
      var ctx = this._ctx;
      if (!ctx) return;
      this._hotReset(); /* D-100 */
      this._applyDpr();
      var W = this.cssW || 1024, H = this.cssH || 640;
      var st = spec || {};
      var cx = W / 2;

      ctx.fillStyle = '#0b0c14';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(80,90,130,0.16)';
      ctx.lineWidth = 1;
      for (var gx = 0; gx < W; gx += 32) {
        ctx.beginPath(); ctx.moveTo(gx + 0.5, 0); ctx.lineTo(gx + 0.5, H); ctx.stroke();
      }
      for (var gy = 0; gy < H; gy += 32) {
        ctx.beginPath(); ctx.moveTo(0, gy + 0.5); ctx.lineTo(W, gy + 0.5); ctx.stroke();
      }
      ctx.fillStyle = '#ffcf6e';
      ctx.fillRect(W / 2 - 120, 22, 240, 2);
      ctx.fillStyle = '#3a3a55';
      ctx.fillRect(W / 2 - 120, H - 30, 240, 2);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffcf6e';
      ctx.font = 'bold 28px monospace';
      ctx.fillText('已暂停', cx, Math.max(84, H * 0.16));
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '13px monospace';
      ctx.fillText('当前进度已暂停 · 按 Esc 或选「继续游戏」返回', cx, Math.max(110, H * 0.16) + 26);

      if (st.page === 'settings') {
        var rows = st.settings || [];
        var rowH = 54;
        var py = Math.max(150, H * 0.34 - rows.length * rowH / 2);
        /* D-91：与主菜单设置页共用同一份行绘制（含说明、键帽与危险色），不再各写一套 */
        this._drawSettingsRows(rows, st.settingsSel, W, py, rowH, 'pausesettings');
        ctx.textAlign = 'center';
        ctx.fillStyle = '#7f8fa8';
        ctx.font = '12px monospace';
        ctx.fillText('↑↓ 选择 · ←→ / Enter 切换 · Esc 返回', cx, H - 16);
        return;
      }

      if (st.page === 'confirmAbandon' || st.page === 'confirmClear') {
        /* D-91：与主菜单确认页共用面板；默认焦点「取消」，危险动作红色 */
        this._drawConfirmPanel(st.confirm, st.confirmSel, W, H, {
          titleY: Math.max(160, H * 0.3),
          linesY: Math.max(160, H * 0.3) + 30,
          bw: Math.min(160, Math.floor((W - 88) / 2)),
          gapY: 26,
          hotPrefix: 'pauseconfirm'
        });
        return;
      }

      var items = st.items || [];
      var ipw = Math.min(430, W - 60), itemH = 46;
      var listH = items.length * itemH;
      var py2 = Math.max(170, H * 0.36 - listH / 2);
      for (var k = 0; k < items.length; k++) {
        var iy = py2 + k * itemH, oni = (k === st.sel);
        this._hotAdd('pause:row:' + items[k].id, cx - ipw / 2, iy, ipw, itemH - 8);
        if (!oni && HOVER_ID === 'pause:row:' + items[k].id) {
          ctx.fillStyle = 'rgba(255,207,110,0.06)';
          ctx.fillRect(cx - ipw / 2, iy, ipw, itemH - 8);
          ctx.strokeStyle = 'rgba(255,207,110,0.55)';
          ctx.lineWidth = 1;
          ctx.strokeRect(cx - ipw / 2 + 0.5, iy + 0.5, ipw - 1, itemH - 9);
        }
        if (oni) {
          ctx.fillStyle = 'rgba(255,207,110,0.14)';
          ctx.fillRect(cx - ipw / 2, iy, ipw, itemH - 8);
          ctx.strokeStyle = '#ffcf6e';
          ctx.lineWidth = 2;
          ctx.strokeRect(cx - ipw / 2 + 1, iy + 1, ipw - 2, itemH - 10);
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = oni ? '#ffcf6e' : '#cfcfcf';
        ctx.font = (oni ? 'bold ' : '') + '17px monospace';
        ctx.fillText((oni ? '▶ ' : '  ') + items[k].label, cx - ipw / 2 + 24, iy + 27);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7f8fa8';
      ctx.font = '12px monospace';
      ctx.fillText('↑↓ 选择 · Enter 确认 · Esc 继续游戏', cx, H - 16);
    },


    _drawMenuAbout: function (W, H) {
      var ctx = this._ctx;
      var FONT_CN = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
      var FONT_MONO = 'Consolas, "Courier New", monospace';
      this._menuVignette(W, H);

      var tier = this._menuTier(W, H);
      var narrow = W < 420, compact = tier.compact;
      var keyW = narrow ? 74 : 104;
      var keyGap = 14, padX = 20;

      var table = [
        { k: '←→ / WASD', a: '移动' },
        { k: 'B / E / M', a: '背包 / 商店 / 任务' },
        { k: 'T / Q', a: '对话 / 设置' },
        { k: '1–4 · 7', a: '攻击 / 防御 / 逃跑 / 火球 / 用药' },
        { k: 'Enter', a: '确认 · 装备 · 使用' }
      ];
      /* 卡片宽度跟着内容走：宽屏下不再把一张 640 的空卡摆在中央、内容全挤在左边。
       * 先量未换行时的自然宽度，再定卡宽，最后按卡宽换行。 */
      var natural = 0;
      for (var ni = 0; ni < table.length; ni++) {
        natural = Math.max(natural, keyW + keyGap + this._menuTextW(table[ni].a, 13));
      }
      var NAME = '地牢：我独自升级', SUFFIX = '· 像素地牢 Roguelike';
      natural = Math.max(natural, this._menuTextW(NAME + ' ' + SUFFIX, 20) + 68);
      if (!compact) {
        natural = Math.max(natural, this._menuTextW('零构建 · 零外部依赖 · 双击 index.html 即可游玩', 11) + 60);
      }
      natural = Math.max(natural, this._menuTextW('目标：在第 5 层击败地牢巨龙', 12));
      natural = Math.max(natural, this._menuTextW('存档自动保存在本机浏览器中，可在「设置」里删除', 12));
      var cardW = Math.min(W - 24, Math.max(340, Math.min(560, natural + padX * 2)));
      var actionX = padX + keyW + keyGap;
      var actionW = cardW - actionX - padX;

      var wrapped = [], tableH = 0;
      for (var i = 0; i < table.length; i++) {
        var ws = this._menuWrap(table[i].a, 13, actionW);
        wrapped.push({ k: table[i].k, lines: ws });
        tableH += Math.max(1, ws.length) * 20 + 6;
      }
      var goalLines = this._menuWrap('目标：在第 5 层击败地牢巨龙', 12, cardW - padX * 2);
      /* §4：紧凑高度档隐藏「零构建…」标语与存档说明两行；键帽表 5 行与门徽不动 */
      var saveLines = compact ? [] : this._menuWrap('存档自动保存在本机浏览器中，可在「设置」里删除', 12, cardW - padX * 2);
      var tagLines = compact ? [] : this._menuWrap('零构建 · 零外部依赖 · 双击 index.html 即可游玩', 11,
        cardW - padX * 2 - 60);
      var infoH = (goalLines.length + saveLines.length) * 18;
      /* 窄屏放不下「作品名 · 像素地牢 Roguelike」整串（20px 一行约 396px），
       * 后缀另起一行；宽屏仍是一行整串。 */
      var headExtra = narrow ? 18 : 0;
      var tagN = tagLines.length;
      var tagPart = tagN ? (tagN - 1) * 14 + 18 : 0;
      /* 底部 42：墙脚 24 + 提示基线上移到墙脚上方 6px */
      var cardH = 66 + 72 + headExtra + tagPart + tableH + 14 + infoH + 42;

      var x = Math.round((W - cardW) / 2);
      var y = Math.max(8, Math.round((H - cardH) / 2) - 8);
      var k = this._menuEnterK({ page: 'about' });
      this._menuMedium(x, y, cardW, cardH, { drop: -2 * (1 - k), alpha: 0.6 + 0.4 * k });
      this._menuHeader(x, y, cardW, 'ABOUT / COLOPHON', '关于', null, false, narrow);

      /* 门徽：不再用 24×24 贴图（放到 48 只剩一块褐色，读不出双扇门），
       * 改为与首屏同一套几何的纯绘制：门框 → 门洞 → 双扇 → 横档压暗 → 2px 门缝 → 门槛暖光。
       * 全为整数像素，不涉及任何非整数缩放。 */
      var emblemY = y + 64, ex = x + padX, ey = emblemY;
      ctx.fillStyle = '#241a14';
      ctx.fillRect(ex, ey, 48, 48);
      ctx.fillStyle = '#0c0806';
      ctx.fillRect(ex + 4, ey + 3, 40, 45);
      ctx.fillStyle = '#3d2c20';
      ctx.fillRect(ex + 6, ey + 5, 17, 41);
      ctx.fillStyle = '#372719';
      ctx.fillRect(ex + 25, ey + 5, 17, 41);
      ctx.fillStyle = 'rgba(0,0,0,0.48)';
      ctx.fillRect(ex + 6, ey + 15, 36, 2);
      ctx.fillRect(ex + 6, ey + 27, 36, 2);
      ctx.fillRect(ex + 6, ey + 37, 36, 2);
      ctx.fillStyle = '#ffbf73';
      ctx.fillRect(ex + 23, ey + 6, 2, 38);
      ctx.fillStyle = 'rgba(255,178,96,0.28)';
      ctx.fillRect(ex + 12, ey + 46, 24, 2);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffcf6e';
      ctx.font = 'bold 20px ' + FONT_CN;
      if (narrow) {
        /* 整串 20px 约 396px，窄屏放不下 → 后缀另起一行 */
        ctx.fillText(NAME, x + padX + 60, emblemY + 20);
      } else {
        /* d60：关于页首行必须是「作品名 · 像素地牢 Roguelike」一整串 */
        ctx.fillText(NAME + ' ' + SUFFIX, x + padX + 60, emblemY + 20);
      }
      ctx.fillStyle = '#9aa0b4';
      ctx.font = '11px ' + FONT_CN;
      if (narrow) ctx.fillText(SUFFIX, x + padX + 60, emblemY + 38);
      for (var tg = 0; tg < tagLines.length; tg++) {
        ctx.fillText(tagLines[tg], x + padX + 60, emblemY + 40 + headExtra + tg * 14);
      }

      var divY = emblemY + 58 + headExtra + (tagN ? (tagN - 1) * 14 : 0);
      ctx.fillStyle = 'rgba(255,207,110,0.28)';
      ctx.fillRect(x + padX, divY, cardW - padX * 2, 1);

      var ky = divY + 16;
      for (var r = 0; r < wrapped.length; r++) {
        var row = wrapped[r];
        var rh = Math.max(1, row.lines.length) * 20;
        ctx.fillStyle = '#11121c';
        ctx.fillRect(x + padX, ky, keyW, 20);
        ctx.strokeStyle = '#3a3340';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + padX + 0.5, ky + 0.5, keyW - 1, 19);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#9bbbf4';
        ctx.font = '11px ' + FONT_MONO;
        ctx.fillText(row.k, x + padX + keyW / 2, ky + 14);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#cfcfcf';
        ctx.font = '13px ' + FONT_CN;
        for (var li = 0; li < row.lines.length; li++) {
          ctx.fillText(row.lines[li], x + actionX, ky + 14 + li * 20);
        }
        ky += rh + 6;
      }

      var infoY = ky + 8;
      ctx.fillStyle = '#9aa0b4';
      ctx.font = '12px ' + FONT_CN;
      for (var g = 0; g < goalLines.length; g++) ctx.fillText(goalLines[g], x + padX, infoY + g * 18);
      infoY += goalLines.length * 18;
      ctx.fillStyle = '#7f879c';
      for (var s = 0; s < saveLines.length; s++) ctx.fillText(saveLines[s], x + padX, infoY + s * 18);

      /* 墙脚：铭牌砌进墙里的唯一证据——只铺卡片最底 24px，两枚 24×24 墙砖 */
      var wallY = y + cardH - 24;
      this._menuSprite('wall_mid', x + padX, wallY, 1);
      this._menuSprite('wall_mid', x + padX + 24, wallY, 1);
      this._menuSprite('t1_dc_rubble', x + padX + 52, wallY, 1);
      ctx.fillStyle = '#2b2440';
      ctx.fillRect(x + 1, wallY - 1, cardW - 2, 1);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#7f8fa8';
      ctx.font = '11px ' + FONT_MONO;
      ctx.fillText('Esc 返回主菜单', x + cardW / 2, y + cardH - 30);
      ctx.textAlign = 'left';
    }
  };
})();
