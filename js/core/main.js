/* js/core/main.js — 游戏主循环与场景调度（启动入口，必须最后加载）
 * 接口：init / start / switchScene / loop（见 PLAN.md §4.4）
 * M4：任务系统 / 存档读档 / 通关判定
 * 场景：explore / battle / inventory / shop / quests / victory
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
    inventory: {}, equipment: { weapon: null, armor: null },
    quests: {}
  };
  Game.Data.Player = player;

  /* UI 状态（背包/商店/任务） */
  var ui = { list: [], sel: 0, shopMode: 'buy' };

  function resetPlayer() {
    player.hp = player.maxHp;
    var s = Game.Systems.Map.getSpawn();
    player.x = s.x;
    player.y = s.y;
    player.floor = Game.Systems.Map.getFloor();
  }

  function onFloorChanged() {
    Game.Systems.Save.save();
  }

  function onQuestComplete(evt) {
    Game.Core.EventBus.emit('ui:notice', { msg: '任务完成：+金币' + evt.reward.gold + ' +经验' + evt.reward.exp });
  }

  function onBattleEnd(evt) {
    if (evt.result === 'win') {
      Game.Systems.Quest.progress('kill', evt.monsterId);
      if (Game.Systems.Quest.isDone('main_clear_dragon')) {
        Game.Core.Main.switchScene('victory');
        return;
      }
    } else if (evt.result === 'lose') {
      player.hp = Math.max(Math.floor(player.maxHp / 2), 1);
      var s = Game.Systems.Map.getSpawn();
      player.x = s.x;
      player.y = s.y;
      player.floor = Game.Systems.Map.getFloor();
    }
    Game.Systems.Save.save();
    Game.Core.Main.switchScene('explore');
  }

  function buildInventoryList() {
    ui.list = Game.Systems.Inventory.list();
    ui.sel = 0;
  }

  function buildShopList() {
    if (ui.shopMode === 'buy') {
      ui.list = Game.Systems.Shop.getStock();
    } else {
      ui.list = Game.Systems.Inventory.list();
    }
    ui.sel = 0;
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
      Game.Core.EventBus.on('map:floorChanged', onFloorChanged);
      Game.Core.EventBus.on('quest:complete', onQuestComplete);
      this._lastT = performance.now();
      this._scene = 'explore';
      Game.Systems.Map.generate();
      Game.Systems.Quest.init();
      resetPlayer();
      /* 读档：有存档则恢复进度 */
      var loaded = Game.Systems.Save.load();
      Game.Core.EventBus.emit('ui:notice', {
        msg: loaded ? '已读取存档（楼层 ' + loaded.floor + '）' : '新冒险开始！'
      });
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

    /* 探索场景 */
    _updateExplore: function () {
      var k = Game.Core.Input.getState();
      if (k['KeyB']) { delete k['KeyB']; this._scene = 'inventory'; buildInventoryList(); return; }
      if (k['KeyS']) { delete k['KeyS']; this._scene = 'shop'; ui.shopMode = 'buy'; buildShopList(); return; }
      if (k['KeyM']) { delete k['KeyM']; this._scene = 'quests'; return; }
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
            var e = Game.Systems.Map.enemyAt(nx, ny);
            if (e) {
              Game.Systems.Battle.start(e.monsterId);
              this._scene = 'battle';
            }
          }
        }
      }
    },

    /* 战斗场景 */
    _updateBattle: function () {
      var k = Game.Core.Input.getState();
      if (k['Digit1'] || k['Numpad1']) { delete k['Digit1']; delete k['Numpad1']; Game.Systems.Battle.playerAction('attack'); }
      else if (k['Digit2'] || k['Numpad2']) { delete k['Digit2']; delete k['Numpad2']; Game.Systems.Battle.playerAction('defend'); }
      else if (k['Digit3'] || k['Numpad3']) { delete k['Digit3']; delete k['Numpad3']; Game.Systems.Battle.playerAction('run'); }
    },

    /* 背包场景 */
    _updateInventory: function () {
      var k = Game.Core.Input.getState();
      if (k['ArrowUp'] || k['KeyW']) { delete k['ArrowUp']; delete k['KeyW']; ui.sel = Math.max(ui.sel - 1, 0); return; }
      if (k['ArrowDown'] || k['KeyS']) { delete k['ArrowDown']; delete k['KeyS']; ui.sel = Math.min(ui.sel + 1, ui.list.length - 1); return; }
      if (k['Enter'] || k['NumpadEnter']) {
        delete k['Enter']; delete k['NumpadEnter'];
        if (ui.list.length === 0) return;
        var entry = ui.list[ui.sel];
        var item = Game.Data.ITEMS[entry.id];
        if (item.type === 'consumable') Game.Systems.Inventory.use(entry.id);
        else Game.Systems.Inventory.equip(entry.id);
        buildInventoryList();
        return;
      }
      if (k['KeyI'] || k['Escape']) { delete k['KeyI']; delete k['Escape']; this._scene = 'explore'; return; }
    },

    /* 商店场景 */
    _updateShop: function () {
      var k = Game.Core.Input.getState();
      if (k['ArrowUp'] || k['KeyW']) { delete k['ArrowUp']; delete k['KeyW']; ui.sel = Math.max(ui.sel - 1, 0); return; }
      if (k['ArrowDown'] || k['KeyS']) { delete k['ArrowDown']; delete k['KeyS']; ui.sel = Math.min(ui.sel + 1, ui.list.length - 1); return; }
      if (k['Tab']) {
        delete k['Tab'];
        ui.shopMode = ui.shopMode === 'buy' ? 'sell' : 'buy';
        buildShopList();
        return;
      }
      if (k['Enter'] || k['NumpadEnter']) {
        delete k['Enter']; delete k['NumpadEnter'];
        if (ui.list.length === 0) return;
        var id = ui.list[ui.sel].id;
        var r = ui.shopMode === 'buy' ? Game.Systems.Shop.buy(id) : Game.Systems.Shop.sell(id);
        if (!r.ok) Game.Core.EventBus.emit('ui:notice', { msg: r.msg });
        buildShopList();
        return;
      }
      if (k['Escape']) { delete k['Escape']; this._scene = 'explore'; return; }
    },

    /* 任务面板 */
    _updateQuests: function () {
      var k = Game.Core.Input.getState();
      if (k['KeyM'] || k['Escape']) { delete k['KeyM']; delete k['Escape']; this._scene = 'explore'; return; }
    },

    /* 通关画面 */
    _updateVictory: function () {
      var k = Game.Core.Input.getState();
      if (k['KeyR']) {
        delete k['KeyR'];
        Game.Systems.Save.clear();
        /* 重新开始：重置玩家为新档 */
        player.hp = 100; player.maxHp = 100;
        player.atk = 10; player.def = 5;
        player.gold = 0; player.exp = 0; player.level = 1;
        player.inventory = {}; player.equipment = { weapon: null, armor: null };
        player.quests = {};
        Game.Systems.Quest.init();
        Game.Systems.Map.setFloor(1);
        resetPlayer();
        this._scene = 'explore';
      }
    },

    loop: function (ts) {
      this._frames++;
      if (ts - this._lastT >= 1000) {
        this._fps = Math.round((this._frames * 1000) / (ts - this._lastT));
        this._frames = 0;
        this._lastT = ts;
      }
      var scene = this._scene;
      if (scene === 'explore') {
        this._updateExplore();
        var grid = Game.Systems.Map.getGrid();
        Game.Core.Render.drawMap(grid, player);
        Game.Core.Render.drawPlayer(player);
        Game.Core.Render.drawHUD({
          fps: this._fps, floor: player.floor,
          hp: player.hp, maxHp: player.maxHp,
          gold: player.gold, atk: player.atk, def: player.def
        });
      } else if (scene === 'battle') {
        this._updateBattle();
        Game.Core.Render.drawBattle(Game.Systems.Battle.getState());
      } else if (scene === 'inventory') {
        this._updateInventory();
        Game.Core.Render.drawInventory(ui.list, ui.sel, player);
      } else if (scene === 'shop') {
        this._updateShop();
        Game.Core.Render.drawShop(ui.list, ui.sel, ui.shopMode, player);
      } else if (scene === 'quests') {
        this._updateQuests();
        Game.Core.Render.drawQuests(Game.Systems.Quest.getActive(), player);
      } else if (scene === 'victory') {
        this._updateVictory();
        Game.Core.Render.drawVictory(player);
      }
    }
  };

  /* script 位于 body 末尾，DOM 已就绪，直接启动 */
  Game.Core.Main.init();
  Game.Core.Main.start();
})();
