/* js/systems/hud.js — 顶部常驻 HUD（任务卡 S3-2，参考 Shattered Pixel Dungeon 顶部信息栏）
 * 接口契约（docs/tasks/S3-2-hud.md，必须实现）：
 *   Game.hud.update(stats)  刷新数据并重绘（stats: { hp, hpMax, mp, mpMax, gold, floor, kills, killTarget }）
 *   Game.hud.last           最近一次 update 收到的 stats 快照（验证页断言用）
 *   Game.hud.draw()         画布顶部条带绘制（render.js 每帧渲染末尾调用）
 *   Game.hud.show() / hide() 显示/隐藏（默认显示）
 * 数据来源：
 *   - hp/mp/gold/floor：main.js 每帧由 Game.Data.Player 汇总后经 update 传入
 *   - mp：M8-1 起传真实 mp/maxMp（Player Schema 已含 mp 字段，默认 50）
 *   - kills/killTarget：本模块自维护（订阅 battle:end 计胜场；map:floorChanged 重置并按本层怪物数取目标）
 * 事件：不新增频道（无消费方，避免频道膨胀）
 * 降级：stats 字段缺失显示 '--'；Game.Core.Render 未就绪时 draw 静默返回，不抛错
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};

  var BAR_H = 22;              /* 顶部条带高度（任务卡：约 22px，不遮挡地图操作区） */
  var visible = true;
  var last = null;             /* 最近一次 stats 快照 */
  var kills = 0;               /* 本层击杀数（自维护） */
  var killTarget = 0;          /* 本层怪物总数（自维护） */

  /* 本层怪物总数 = 埋伏怪 + 巡逻怪（map.js generate 时两者均已生成） */
  function countFloorMobs() {
    var n = 0;
    try {
      if (Game.Systems && Game.Systems.Map && Game.Systems.Map.getEnemies) {
        n += Game.Systems.Map.getEnemies().length;
      }
      if (Game.Systems && Game.Systems.AI && Game.Systems.AI.getPatrols) {
        n += Game.Systems.AI.getPatrols().length;
      }
    } catch (e) { /* 忽略：降级为 0，显示 -- */ }
    return n;
  }

  function field(v, dflt) {
    return (typeof v === 'number') ? v : (dflt === undefined ? null : dflt);
  }

  function fmt(v) { return (typeof v === 'number') ? String(v) : '--'; }

  /* P1-2：取素材（Sprites 未加载/未就绪/缺失均返回 null，调用方回退程序化绘制） */
  function sprite(name) {
    var S = Game.Core && Game.Core.Sprites;
    return (S && typeof S.get === 'function') ? S.get(name) : null;
  }

  /* P1-2：HP 心形血条。规则（任务卡 P1-2）：
   *   - 每 HEART_HP=20 点一颗心（maxHp 100 → 5 颗；190 → 10 颗）；
   *   - 整颗=ui_heart_full，余量 ≥10 点=ui_heart_half，其余=ui_heart_empty；
   *   - 全尺寸 15×14、间距 2px；窄窗口缩至 11×10 且省略数值；
   *   - 心形序列后仍显示小字 "hp/hpMax"（11px 灰白）；
   *   - 素材缺失 → 回退既有短条；放不下（心多）→ 省略数字 → 仍放不下 → 回退短条。 */
  function drawHearts(ctx, x, hp, hpMax, narrow, maxW) {
    var full = sprite('ui_heart_full');
    var half = sprite('ui_heart_half');
    var empty = sprite('ui_heart_empty');
    if (!full || !half || !empty) {
      return drawBar(ctx, x, 'HP', hp, hpMax, '#4ade80', '#22131a', narrow ? 60 : 74);
    }
    var HEART_HP = 20;
    var hw = narrow ? 11 : 15;
    var hh = narrow ? 10 : 14;
    var gap = 2;
    var barH = narrow ? 18 : BAR_H;
    var hy = Math.floor((barH - hh) / 2);
    var hpMaxN = (typeof hpMax === 'number' && hpMax > 0) ? hpMax : 0;
    var hpV = (typeof hp === 'number') ? Math.max(0, hp) : 0;
    var count = hpMaxN > 0 ? Math.max(1, Math.ceil(hpMaxN / HEART_HP)) : 1;
    var totalW = count * hw + (count - 1) * gap;
    /* 数字宽（窄窗口省略） */
    var numW = 0;
    if (!narrow) {
      ctx.font = '11px monospace';
      numW = ctx.measureText(fmt(hpV) + '/' + fmt(hpMaxN)).width + 6;
    }
    /* 放不下 → 降级：省数字；仍放不下 → 回退短条 */
    if (typeof maxW === 'number' && x + totalW + numW > maxW) {
      if (narrow) return drawBar(ctx, x, 'HP', hp, hpMax, '#4ade80', '#22131a', 60);
      if (x + totalW > maxW) return drawBar(ctx, x, 'HP', hp, hpMax, '#4ade80', '#22131a', 74);
      numW = 0;
    }
    for (var i = 0; i < count; i++) {
      var rem = hpV - i * HEART_HP;
      var img = (rem >= HEART_HP) ? full : ((rem >= HEART_HP / 2) ? half : empty);
      ctx.drawImage(img, x + i * (hw + gap), hy, hw, hh);
    }
    var nx = x + totalW + 2;
    if (numW > 0) {
      ctx.fillStyle = '#c8c8d4';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(fmt(hpV) + '/' + fmt(hpMaxN), nx, 15);
      nx += numW;
    }
    return nx;
  }

  /* P1-2：MP 短条 + flask_blue 图标（14×14）；图标缺失回退纯短条 */
  function drawMpBar(ctx, x, mp, mpMax, narrow) {
    var icon = sprite('flask_blue');
    if (!icon) return drawBar(ctx, x, 'MP', mp, mpMax, '#60a5fa', '#131d33', narrow ? 48 : 56);
    var iw = 14, ih = 14;
    var iy = narrow ? Math.floor((18 - ih) / 2) : 5;
    ctx.drawImage(icon, x, iy, iw, ih);
    return drawBar(ctx, x + iw + 3, 'MP', mp, mpMax, '#60a5fa', '#131d33', narrow ? 48 : 56);
  }

  /* P1-2：金币文字 + coin 图标（9×10）；图标缺失回退纯文字 */
  function drawGold(ctx, x, gold, narrow, maxW) {
    var icon = sprite('coin');
    var label = (narrow ? '金 ' : '金币 ') + fmt(gold);
    if (!icon) return drawText(ctx, x, label, '#ffcf6e', maxW);
    var iw = 9, ih = 10;
    var iy = narrow ? Math.floor((18 - ih) / 2) : 5;
    ctx.font = '11px monospace';
    var textW = ctx.measureText(label).width;
    /* 图标+文字放不下 → 回退纯文字（drawText 自带 maxW 判定） */
    if (typeof maxW === 'number' && x + iw + 3 + textW > maxW) {
      return drawText(ctx, x, label, '#ffcf6e', maxW);
    }
    ctx.drawImage(icon, x, iy, iw, ih);
    return drawText(ctx, x + iw + 3, label, '#ffcf6e', maxW);
  }

  /* 短条：底 + 填充 + 边框 + 居中文字（HP/MP） */
  function drawBar(ctx, x, label, v, vmax, color, bg, w) {
    var y = 6;
    var h = 10;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    var ratio = (typeof v === 'number' && typeof vmax === 'number' && vmax > 0)
      ? Math.max(0, Math.min(1, v / vmax)) : 0;
    if (ratio > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, Math.round(w * ratio), h);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#e8e8f0';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label + ' ' + fmt(v) + '/' + fmt(vmax), x + w / 2, y + h / 2 + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return x + w + 8;
  }

  /* 修复 P1：绘制前先量宽，放不下返回 null（后续字段一并跳过），避免窄屏横向溢出 */
  function drawText(ctx, x, str, color, maxW) {
    ctx.fillStyle = color;
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    var w = ctx.measureText(str).width;
    if (typeof maxW === 'number' && x + w > maxW) return null;
    ctx.fillText(str, x, 15);
    return x + w + 14;
  }

  /* S-04：状态图标行——画在顶栏正下方，仅在有中毒/流血时出现；
   * 单个 chip = 彩色边框 + 状态名 + 剩余回合；放不下则截断，不横向溢出 */
  function drawStatusRow(ctx, list, W, barH) {
    if (!list || !list.length) return;
    var x = 8, y = barH + 3, h = 13;
    ctx.font = '10px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var label = s.name + s.turns;
      var tw = ctx.measureText(label).width;
      var w = tw + 10;
      if (x + w > W - 8) break;
      ctx.fillStyle = 'rgba(6,6,12,0.82)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = s.color || '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = s.color || '#ffffff';
      ctx.fillText(label, x + 5, y + 2);
      x += w + 4;
    }
  }

  /* D-14：低血量判定（HP > 0 且 ≤ 25% 上限）。抽成函数便于验证页断言，不参与数值结算 */
  function lowHpInfo() {
    var s = last || {};
    var hp = s.hp, mx = s.hpMax;
    var active = (typeof hp === 'number' && typeof mx === 'number' && mx > 0 && hp > 0 && hp / mx <= 0.25);
    return { active: active, text: active ? ('血量危急 ' + hp + '/' + mx + '（≤25%）') : '' };
  }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  Game.hud = {
    last: null,
    lowHp: lowHpInfo,

    update: function (stats) {
      stats = stats || {};
      var p = Game.Data && Game.Data.Player;
      var lv = field(stats.level, p ? p.level : null);
      var xp = field(stats.exp, p ? p.exp : null);
      var next = field(stats.expNext, null);
      /* M8-6：expNext 未显式传入时按成长公式补算（Battle 未加载则留空） */
      if (next === null && typeof lv === 'number' && Game.Systems &&
          Game.Systems.Battle && typeof Game.Systems.Battle.expToNext === 'function') {
        next = Game.Systems.Battle.expToNext(lv);
      }
      /* S-04：状态列表优先取入参，其次从 Status.list() 现算（老调用方不传该字段也能显示） */
      var st = null;
      if (stats.status && typeof stats.status.length === 'number') st = stats.status;
      else if (Game.Systems && Game.Systems.Status && typeof Game.Systems.Status.list === 'function') {
        st = Game.Systems.Status.list();
      }
      last = {
        hp: field(stats.hp),
        hpMax: field(stats.hpMax),
        mp: field(stats.mp, 0),
        mpMax: field(stats.mpMax, 0),
        gold: field(stats.gold),
        floor: field(stats.floor),
        kills: field(stats.kills, kills),
        killTarget: field(stats.killTarget, killTarget),
        level: lv,
        exp: xp,
        expNext: next,
        status: st || []
      };
      this.last = last;
      return last;
    },

    draw: function () {
      if (!visible) return;
      var R = Game.Core && Game.Core.Render;
      var ctx = R && R._ctx;
      var cv = R && R._canvas;
      if (!ctx || !cv) return;
      /* M9-5：使用 CSS 宽度（DPR 适配后 cv.width 为物理像素） */
      var W = (R && typeof R.cssW === 'number') ? R.cssW : cv.clientWidth || cv.width;
      var narrow = (R && typeof R._isNarrow === 'function') ? R._isNarrow() : false;
      var barH = narrow ? 18 : BAR_H;
      var s = last || {};

      /* 底板 + 底边分隔线 */
      ctx.fillStyle = 'rgba(8,8,16,0.92)';
      ctx.fillRect(0, 0, W, barH);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, barH - 1, W, 1);

      var x = 8;
      /* P1-2：HP 心形序列（素材缺失/放不下自动回退短条），MP 图标短条，金币图标文字；
       * 修复 P1：任一字段放不下（返回 null）就跳过其后所有字段，保证不越右边界 */
      x = drawHearts(ctx, x, s.hp, s.hpMax, narrow, W - 8);
      if (x !== null) {
        x = drawMpBar(ctx, x, s.mp, s.mpMax, narrow);
        x = drawGold(ctx, x, s.gold, narrow, W - 8);
      }
      /* 修复 P1：窄屏用短标签；任一字段放不下就跳过其后所有字段，保证不越右边界 */
      if (x !== null) {
        x = drawText(ctx, x,
          (narrow ? '层 ' : '第 ') + fmt(s.floor) + '/' + fmt(floorTotal()) + (narrow ? '' : ' 层'),
          '#cfcfcf', W - 8);
      }
      if (x !== null) {
        x = drawText(ctx, x, (narrow ? '杀 ' : '击杀 ') + fmt(s.kills) + '/' + fmt(s.killTarget),
          '#f472b6', W - 8);
      }
      /* M8-6：等级 + 经验进度（Lv.3 60/180）；窄窗口先缩为 Lv.x，仍放不下则省略，不横向溢出 */
      if (x !== null && typeof s.level === 'number') {
        var lvText = 'Lv.' + s.level;
        var xpText = ' ' + fmt(s.exp) + '/' + fmt(s.expNext);
        ctx.font = '11px monospace';
        if (x + ctx.measureText(lvText + xpText).width <= W - 8) {
          drawText(ctx, x, lvText + xpText, '#a78bfa');
        } else if (x + ctx.measureText(lvText).width <= W - 8) {
          drawText(ctx, x, lvText, '#a78bfa');
        }
      }
      /* S-04：状态 chip 行（顶栏下方；无状态时不绘制，不占屏） */
      drawStatusRow(ctx, s.status, W, barH);
      /* D-14：低血量可见警示——HP ≤ 25% 时屏幕内缘红色脉动框 + 右侧文字。
       * 纯展示层，不读写任何数值，也不改战斗公式。 */
      var low = lowHpInfo();
      if (low.active) {
        var H = (R && typeof R.cssH === 'number') ? R.cssH : (cv.clientHeight || 0);
        var pulse = 0.30 + 0.28 * (0.5 + 0.5 * Math.sin(nowMs() / 220));
        ctx.strokeStyle = 'rgba(255,70,70,' + pulse.toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, barH + 1.5, W - 3, Math.max(0, H - barH - 3));
        ctx.fillStyle = 'rgba(6,6,12,0.82)';
        ctx.font = 'bold 11px monospace';
        var tw = ctx.measureText(low.text).width;
        ctx.fillRect(W - 10 - tw - 8, barH + 3, tw + 8, 15);
        ctx.fillStyle = '#ff6b6b';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(low.text, W - 14, barH + 6);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    },

    show: function () { visible = true; },
    hide: function () { visible = false; },

    /* M9-5：暴露击杀统计供死亡结算弹窗使用 */
    getKills: function () { return kills; },
    getKillTarget: function () { return killTarget; }
  };

  function floorTotal() {
    return (Game.Data && Game.Data.MAPS && typeof Game.Data.MAPS.floors === 'number')
      ? Game.Data.MAPS.floors : null;
  }

  /* 本层击杀统计：battle:end 胜场 +1；换层重置并重新取目标数（systems 组后序模块在事件发生时均已就绪） */
  if (Game.Core && Game.Core.EventBus) {
    Game.Core.EventBus.on('battle:end', function (evt) {
      if (evt && evt.result === 'win') kills++;
    });
    Game.Core.EventBus.on('map:floorChanged', function () {
      kills = 0;
      killTarget = countFloorMobs();
    });
  }
})();
