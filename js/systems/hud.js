/* js/systems/hud.js — 顶部常驻 HUD（任务卡 S3-2，参考 Shattered Pixel Dungeon 顶部信息栏）
 * 接口契约（docs/tasks/S3-2-hud.md，必须实现）：
 *   Game.hud.update(stats)  刷新数据并重绘（stats: { hp, hpMax, mp, mpMax, gold, floor, kills, killTarget }）
 *   Game.hud.last           最近一次 update 收到的 stats 快照（验证页断言用）
 *   Game.hud.draw()         画布顶部条带绘制（render.js 每帧渲染末尾调用）
 *   Game.hud.show() / hide() 显示/隐藏（默认显示）
 * 数据来源：
 *   - hp/gold/floor：main.js 每帧由 Game.Data.Player 汇总后经 update 传入
 *   - mp：当前项目尚无 MP 属性（Player Schema 无此字段），默认 0/0，显示 MP 0/0
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

  function drawText(ctx, x, str, color) {
    ctx.fillStyle = color;
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, 15);
    return x + ctx.measureText(str).width + 14;
  }

  Game.hud = {
    last: null,

    update: function (stats) {
      stats = stats || {};
      last = {
        hp: field(stats.hp),
        hpMax: field(stats.hpMax),
        mp: field(stats.mp, 0),
        mpMax: field(stats.mpMax, 0),
        gold: field(stats.gold),
        floor: field(stats.floor),
        kills: field(stats.kills, kills),
        killTarget: field(stats.killTarget, killTarget)
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
      var s = last || {};

      /* 底板 + 底边分隔线 */
      ctx.fillStyle = 'rgba(8,8,16,0.92)';
      ctx.fillRect(0, 0, cv.width, BAR_H);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, BAR_H - 1, cv.width, 1);

      var x = 8;
      x = drawBar(ctx, x, 'HP', s.hp, s.hpMax, '#4ade80', '#22131a', 74);
      x = drawBar(ctx, x, 'MP', s.mp, s.mpMax, '#60a5fa', '#131d33', 56);
      x = drawText(ctx, x, '金币 ' + fmt(s.gold), '#ffcf6e');
      x = drawText(ctx, x, '第 ' + fmt(s.floor) + '/' + fmt(floorTotal()) + ' 层', '#cfcfcf');
      drawText(ctx, x, '击杀 ' + fmt(s.kills) + '/' + fmt(s.killTarget), '#f472b6');
    },

    show: function () { visible = true; },
    hide: function () { visible = false; }
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
