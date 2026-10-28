/* js/core/main.js — 游戏主循环与场景调度（启动入口，必须最后加载）
 * 接口：init / start / switchScene / loop（见 PLAN.md §4.4）
 * M2：探索遇敌 → 战斗场景（回合制：1攻击 2防御 3逃跑）→ 结算回探索
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Core = Game.Core || {};

  /* 玩家运行时对象（PLAN.md §7.1 Player Schema） */
  var player = {
    x: 1, y: 1, floor: 1,
    hp: 100, maxHp: 100,
    atk: 10, def: 5,
    gold: 0, exp: 0, level: 1,
    inventory: {}, equipment: { weapon: null, armor: null }
  };
  Game.Data.Player = player;

  function resetPlayer() {
    player.hp = player.maxHp;
    var s = Game.Systems.Map.getSpawn();
    player.x = s.x;
    player.y = s.y;
    player.floor = Game.Systems.Map.getFloor();
  }

  function onBattleEnd(evt) {
    if (evt.result === 'lose') {
      /* 失败：半血复活在入口 */
      player.hp = Math.max(Math.floor(player.maxHp / 2), 1);
      var s = Game.Systems.Map.getSpawn();
      player.x = s.x;
      player.y = s.y;
      player.floor = Game.Systems.Map.getFloor();
    }
    Game.Core.Main.switchScene('explore');
  }

  Game.Core.Main = {
    _scene: 'boot',
    _fps: 0,
    _frames: 0,
    _lastT: 0,

    init: function () {
      var canvas = document.getElementById('game');
      Game.Core.Render.init(canvas);
      Game.Core.Input.bind();
      Game.Core.EventBus.on('battle:end', onBattleEnd);
      this._lastT = performance.now();
      this._scene = 'explore';
      Game.Systems.Map.generate();
      resetPlayer();
    },

    start: function () {
      var self = this;
      requestAnimationFrame(function loop(ts) {
        self.loop(ts);
        requestAnimationFrame(loop);
      });
    },

    switchScene: function (name) {
      this._scene = name;
      Game.Core.EventBus.emit('game:sceneChanged', { scene: name });
    },

    /* 探索场景：读输入 → 移动 → 碰撞 → 楼梯换层 → 遇敌触发战斗 */
    _updateExplore: function () {
      var k = Game.Core.Input.getState();
      var d = Game.Core.Input.direction(k);
      if (d.dx !== 0 || d.dy !== 0) {
        var nx = player.x + d.dx;
        var ny = player.y + d.dy;
        if (Game.Systems.Map.isWalkable(nx, ny)) {
          player.x = nx;
          player.y = ny;
          var t = Game.Systems.Map.tileAt(nx, ny);
          if (t === 2) {
            Game.Systems.Map.changeFloor(1);
            player.floor = Game.Systems.Map.getFloor();
            resetPlayer();
          } else if (t === 3) {
            Game.Systems.Map.changeFloor(-1);
            player.floor = Game.Systems.Map.getFloor();
            resetPlayer();
          } else {
            /* 踩到敌人 → 进入战斗 */
            var e = Game.Systems.Map.enemyAt(nx, ny);
            if (e) {
              Game.Systems.Battle.start(e.monsterId);
              this.switchScene('battle');
            }
          }
        }
      }
    },

    /* 战斗场景：键盘 1/2/3 指令 */
    _updateBattle: function () {
      var k = Game.Core.Input.getState();
      if (k['Digit1'] || k['Numpad1']) { delete k['Digit1']; delete k['Numpad1']; Game.Systems.Battle.playerAction('attack'); }
      else if (k['Digit2'] || k['Numpad2']) { delete k['Digit2']; delete k['Numpad2']; Game.Systems.Battle.playerAction('defend'); }
      else if (k['Digit3'] || k['Numpad3']) { delete k['Digit3']; delete k['Numpad3']; Game.Systems.Battle.playerAction('run'); }
    },

    loop: function (ts) {
      this._frames++;
      if (ts - this._lastT >= 1000) {
        this._fps = Math.round((this._frames * 1000) / (ts - this._lastT));
        this._frames = 0;
        this._lastT = ts;
      }
      if (this._scene === 'explore') {
        this._updateExplore();
        var grid = Game.Systems.Map.getGrid();
        Game.Core.Render.drawMap(grid, player);
        Game.Core.Render.drawPlayer(player);
        Game.Core.Render.drawHUD({
          fps: this._fps, floor: player.floor,
          hp: player.hp, maxHp: player.maxHp,
          gold: player.gold, atk: player.atk, def: player.def
        });
      } else if (this._scene === 'battle') {
        this._updateBattle();
        Game.Core.Render.drawBattle(Game.Systems.Battle.getState());
      }
    }
  };

  /* script 位于 body 末尾，DOM 已就绪，直接启动 */
  Game.Core.Main.init();
  Game.Core.Main.start();
})();
