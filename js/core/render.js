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

  Game.Core.Render = {
    _canvas: null,
    _ctx: null,

    init: function (canvas) {
      this._canvas = canvas;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this._ctx = canvas.getContext('2d');
    },

    /* 计算镜头：地图比屏幕小则居中，否则跟随玩家 */
    _updateCam: function (grid, player) {
      var cv = this._canvas;
      var w = grid[0].length * TILE;
      var h = grid.length * TILE;
      cam.x = Math.min(Math.max(player.x * TILE - cv.width / 2 + TILE / 2, 0), Math.max(w - cv.width, 0));
      cam.y = Math.min(Math.max(player.y * TILE - cv.height / 2 + TILE / 2, 0), Math.max(h - cv.height, 0));
    },

    drawMap: function (grid, player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx || !grid) return;
      this._updateCam(grid, player);
      ctx.fillStyle = '#14142a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      for (var y = 0; y < grid.length; y++) {
        for (var x = 0; x < grid[0].length; x++) {
          var t = grid[y][x];
          var px = x * TILE - cam.x;
          var py = y * TILE - cam.y;
          if (px + TILE < 0 || py + TILE < 0 || px > cv.width || py > cv.height) continue;
          if (t === 0) ctx.fillStyle = '#3a2e5c';
          else if (t === 1) ctx.fillStyle = '#2b2b4a';
          else if (t === 2) ctx.fillStyle = '#b06ce0';
          else ctx.fillStyle = '#52c41a';
          ctx.fillRect(px, py, TILE - 1, TILE - 1);
        }
      }
      /* 敌人标记（M2）：在敌人格上画红点 */
      var es = Game.Systems.Map.getEnemies();
      for (var i = 0; i < es.length; i++) {
        var epx = es[i].x * TILE - cam.x + TILE / 2 - 3;
        var epy = es[i].y * TILE - cam.y + TILE / 2 - 3;
        if (epx > -10 && epy > -10 && epx < cv.width + 10 && epy < cv.height + 10) {
          ctx.fillStyle = '#ea6668';
          ctx.beginPath();
          ctx.arc(epx, epy, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },

    drawPlayer: function (player) {
      var ctx = this._ctx;
      if (!ctx) return;
      var px = player.x * TILE - cam.x;
      var py = player.y * TILE - cam.y;
      ctx.fillStyle = '#ffcf6e';
      ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
      ctx.fillStyle = '#fff';
      ctx.fillRect(px + 6, py + 6, 4, 4);
    },

    drawHUD: function (stats) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx) return;
      ctx.fillStyle = 'rgba(20,20,42,0.72)';
      ctx.fillRect(0, 0, cv.width, 30);
      ctx.fillStyle = '#8f8';
      ctx.font = '13px monospace';
      ctx.fillText('FPS=' + (stats ? stats.fps : 0) +
        ' | 楼层:' + stats.floor + '/' + Game.Data.MAPS.floors +
        ' | HP:' + stats.hp + '/' + stats.maxHp +
        ' | 金币:' + stats.gold +
        ' | 攻击:' + stats.atk + ' 防御:' + stats.def,
        10, 20);
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '12px monospace';
      ctx.fillText('方向键/WASD 移动 | 红点=怪物(踩到开战) | 紫梯下 / 绿梯上', 10, cv.height - 10);
    },

    /* 战斗画面（M2）：敌人 + 玩家 + 战斗日志 + 指令 */
    drawBattle: function (state) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx || !state) return;
      ctx.fillStyle = '#0f0f1f';
      ctx.fillRect(0, 0, cv.width, cv.height);

      /* 敌人方块 */
      var ex = cv.width / 2 - 45;
      var ey = 90;
      ctx.fillStyle = state.monster.color;
      ctx.fillRect(ex, ey, 90, 90);
      ctx.fillStyle = '#fff';
      ctx.font = '15px monospace';
      ctx.fillText(state.monster.name + '  HP:' + state.monster.hp + '/' + state.monster.maxHp,
        cv.width / 2 - 140, ey + 120);

      /* 玩家方块 */
      var p = Game.Data.Player;
      var px = cv.width / 2 - 45;
      var py = cv.height - 190;
      ctx.fillStyle = '#ffcf6e';
      ctx.fillRect(px, py, 90, 90);
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.fillText('勇者  HP:' + p.hp + '/' + p.maxHp + '  ATK:' + p.atk + '  DEF:' + p.def,
        cv.width / 2 - 150, py + 120);

      /* 战斗日志（最近 4 行） */
      ctx.fillStyle = '#8f8';
      ctx.font = '13px monospace';
      var start = Math.max(state.log.length - 4, 0);
      for (var i = 0; i < state.log.length - start; i++) {
        ctx.fillText(state.log[start + i], 30, cv.height - 130 + i * 18);
      }

      /* 指令提示 */
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '14px monospace';
      ctx.fillText('1 攻击   2 防御   3 逃跑', cv.width / 2 - 100, cv.height - 30);
    },

    /* 通用 UI 面板背景 */
    _drawPanel: function (title, gold) {
      var ctx = this._ctx;
      var cv = this._canvas;
      ctx.fillStyle = '#0f0f1f';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#ffcf6e';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(title, 30, 44);
      ctx.fillStyle = '#8f8';
      ctx.font = '14px monospace';
      ctx.fillText('金币: ' + gold, cv.width - 180, 44);
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
      ctx.fillText('↑↓ 选择   Enter 使用/装备   I/Esc 返回', 30, cv.height - 30);
    },

    /* 商店 UI（M3） */
    drawShop: function (list, sel, mode, player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx) return;
      this._drawPanel('商店 (S)', player.gold);
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
      ctx.fillText('↑↓ 选择   Enter ' + (mode === 'buy' ? '购买' : '出售') + '   Tab 切换   Esc 返回', 30, cv.height - 30);
    }
  };
})();
