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
    mp: 50, maxMp: 50, /* M8-1：技能 MP（旧存档缺失时由 save.js 补默认） */
    atk: 10, def: 5,
    gold: 0, exp: 0, level: 1,
    inventory: {}, equipment: { weapon: null, armor: null },
    quests: {}
  };
  Game.Data.Player = player;

  /* UI 状态（背包/商店/任务） */
  var ui = { list: [], sel: 0, shopMode: 'buy' };

  /* M9-5：本局开始时间戳（死亡结算"用时"；重新开始时重置） */
  var runStart = performance.now();

  /* 修复 P1：移动节流。原实现每帧移动 1 格（60fps ≈ 60 格/秒），既难操控也违背 roguelike 手感。
   * 取 120ms/步（≈8.3 格/秒）：接近传统 roguelike 长按移动的节奏，且与 140ms 移动插值同量级。
   * 玩家与 AI 共用同一个"步"：每步只 tick 一次 AI（AI 内部 4 步一追击），
   * 保持原有"怪物约比玩家慢 4 倍"的相对关系，不改变战斗数值。 */
  var MOVE_INTERVAL = 120;
  var lastStepAt = -1e9; /* 首帧立即可走 */

  /* 修复：启动/读档期间禁止 floorChanged 自动写档。
   * 原流程 init 中 Map.generate() 先于 Save.load() 触发 map:floorChanged → Save.save()，
   * 会用默认新档覆盖磁盘旧档，导致读档永远读不到进度。 */
  var booting = true;

  /* M9-5：首次引导覆盖层（localStorage 键 aiDungeon_guided） */
  var GUIDE_KEY = 'aiDungeon_guided';
  function needsGuide() {
    try { return localStorage.getItem(GUIDE_KEY) === null; } catch (e) { return true; } /* 存储禁用→每局显示（降级） */
  }
  function markGuided() {
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) { /* 存储禁用降级 */ }
  }
  function dismissGuide() {
    var M = Game.Core.Main;
    if (!M || !M._guideVisible) return;
    M._guideVisible = false;
    markGuided();
    window.removeEventListener('keydown', dismissGuide);
    window.removeEventListener('click', dismissGuide);
    if (Game.Core && Game.Core.Input && typeof Game.Core.Input.clear === 'function') {
      Game.Core.Input.clear();
    }
  }

  /* 修复 P1：换层/重置只负责落点与特效清理，不再无条件回满 HP/MP。
   * 回满只发生在：新局（init 默认值）、重新开始（restart 显式赋值）、升级（battle.js）。
   * 这样上下楼无法刷血，血瓶/商店/升级回血仍是主要恢复手段。
   * 注：读档由 Save.load 覆盖 hp/mp，不受此处影响。 */
  function resetPlayer() {
    var s = Game.Systems.Map.getSpawn();
    player.x = s.x;
    player.y = s.y;
    player.floor = Game.Systems.Map.getFloor();
    /* M9-3：换层/重置时清空移动插值与粒子，避免旧层残留 */
    if (Game.Motion && typeof Game.Motion.clear === 'function') Game.Motion.clear();
    if (Game.Particles && typeof Game.Particles.clear === 'function') Game.Particles.clear();
  }

  function onFloorChanged() {
    if (booting) return; /* 启动/读档期间不写档（含 Save.load 内部换层） */
    Game.Systems.Save.save();
  }

  /* S3-1 FOV：以玩家为中心重算视野（墙阻挡视线），点亮新格由 fov.js 广播 map:fovChanged */
  function refreshFov() {
    if (!Game.fov || !Game.fov.update) return;
    Game.fov.update(player.x, player.y, Game.fov.RADIUS || 5, function (x, y) {
      return Game.Systems.Map.tileAt(x, y) === 0;
    });
  }

  /* S3-2 HUD：汇总顶部信息栏数据。M8-1：MP 传真实 mp/maxMp（替换遗留 0/0 占位）；
     M8-6：等级 + 经验进度传给 HUD（expNext 按 60×level 公式）；
     kills/killTarget 由 hud.js 自行统计（battle:end 胜场 + map:floorChanged 重置），故不在此传 */
  function syncHud() {
    if (!Game.hud || !Game.hud.update) return;
    Game.hud.update({
      hp: player.hp, hpMax: player.maxHp,
      mp: player.mp, mpMax: player.maxMp,
      gold: player.gold,
      floor: player.floor,
      level: player.level,
      exp: player.exp,
      expNext: (Game.Systems.Battle && typeof Game.Systems.Battle.expToNext === 'function')
        ? Game.Systems.Battle.expToNext(player.level) : 60 * player.level
    });
  }

  function onQuestComplete(evt) {
    Game.Core.EventBus.emit('audio:play', { sfx: 'quest' });
    Game.Core.EventBus.emit('ui:notice', { msg: '任务完成：+金币' + evt.reward.gold + ' +经验' + evt.reward.exp });
  }

  function onBattleEnd(evt) {
    if (evt.result === 'win') {
      Game.Systems.Quest.progress('kill', evt.monsterId);
      if (Game.Systems.Quest.isDone('main_clear_dragon')) {
        /* M8-5：通关写本地排行榜（须在切 victory 前调用；scene 已为 victory 时幂等跳过） */
        Game.Core.Main.submitRank();
        /* 修复 P1：通关也写档，避免玩家在结算页关闭页面后丢失本局战绩 */
        Game.Systems.Save.save();
        Game.Core.EventBus.emit('audio:play', { sfx: 'victory' });
        Game.Core.Main.switchScene('victory');
        return;
      }
    } else if (evt.result === 'lose') {
      /* M9-5：玩家死亡 → 结算弹窗（升级自原来的半血复活） */
      Game.Systems.Save.clear(); /* 死亡清档，重新开始走新档 */
      /* 修复 P2：图鉴随存档一起清空，避免"磁盘已删、内存仍留、下次保存又写回"的不一致 */
      if (Game.Systems.Bestiary && typeof Game.Systems.Bestiary.reset === 'function') {
        Game.Systems.Bestiary.reset();
      }
      Game.Core.Main.openGameOver();
      return;
    }
    Game.Systems.Save.save();
    Game.Core.Main.switchScene('explore');
  }

  /* M5：巡逻怪贴脸 → 触发战斗 */
  function onAiEncounter(evt) {
    Game.Systems.Battle.start(evt.monsterId);
    Game.Core.Main.switchScene('battle');
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
    _guideVisible: false,  /* M9-5：首次引导覆盖层是否显示 */

    init: function () {
      var canvas = document.getElementById('game');
      Game.Core.Render.init(canvas);
      Game.Core.Input.bind();
      Game.Core.EventBus.on('battle:end', onBattleEnd);
      Game.Core.EventBus.on('map:floorChanged', onFloorChanged);
      Game.Core.EventBus.on('quest:complete', onQuestComplete);
      Game.Core.EventBus.on('ai:encounter', onAiEncounter);
      Game.Systems.NPC.bind();
      Game.Systems.Audio.init();
      Game.Systems.Audio.bind();
      if (Game.Core.Sprites) Game.Core.Sprites.load();
      this._lastT = performance.now();
      runStart = performance.now(); /* M9-5：计时起点 */
      this.switchScene('explore');  /* M9-4：启动探索 BGM */
      Game.Systems.Map.generate();
      Game.Systems.Quest.init();
      resetPlayer();
      /* 读档：有存档则恢复进度 */
      var loaded = Game.Systems.Save.load();
      booting = false; /* 启动/读档完成，恢复 floorChanged 自动写档 */
      refreshFov(); /* S3-1：初始视野（含读档后落点） */
      syncHud();    /* S3-2：初始顶部 HUD 数据 */
      Game.Core.EventBus.emit('ui:notice', {
        msg: loaded ? '已读取存档（楼层 ' + loaded.floor + '）' : '新冒险开始！'
      });
      /* M9-5：首次引导 + resize 监听（静默降级） */
      this._guideVisible = needsGuide();
      if (this._guideVisible) {
        window.addEventListener('keydown', dismissGuide);
        window.addEventListener('click', dismissGuide);
      }
      /* 自适应缩放：窗口 resize / 浏览器缩放 / 横竖屏切换 / 移动端视口变化都重新计算
       * （resize 覆盖桌面缩放与横竖屏；orientationchange 兜底老浏览器；visualViewport 覆盖移动端地址栏收起） */
      var onViewportChange = function () {
        try { Game.Core.Render.resize(); } catch (e) { /* 降级 */ }
      };
      window.addEventListener('resize', onViewportChange);
      window.addEventListener('orientationchange', onViewportChange);
      try {
        if (window.visualViewport && window.visualViewport.addEventListener) {
          window.visualViewport.addEventListener('resize', onViewportChange);
        }
      } catch (e) { /* 降级：不支持 visualViewport 时仅依赖 resize */ }
    },

    start: function () {
      var self = this;
      requestAnimationFrame(function loop(ts) {
        self.loop(ts);
        requestAnimationFrame(loop);
      });
    },

    /* M9-5：本局用时（ms），供死亡结算战绩 */
    getElapsedMs: function () {
      return performance.now() - runStart;
    },

    /* M8-5：通关写本地排行榜——entry 全部取自现有状态（不新增数值系统）
     * 幂等：scene 已为 victory 视为本局已写，不再重复提交（单局一条） */
    submitRank: function () {
      if (this._scene === 'victory') return null;
      var L = Game.Systems && Game.Systems.Leaderboard;
      if (!L || typeof L.submit !== 'function') return null;
      var entry = {
        timeSec: Math.round(this.getElapsedMs() / 1000),
        gold: player.gold,
        level: player.level,
        floor: player.floor,
        date: new Date().toLocaleDateString('zh-CN')
      };
      try {
        return L.submit(entry);
      } catch (e) { return null; }
    },

    /* M9-5：死亡结算——打开 gameover 弹窗（战绩来自 Player/HUD） */
    openGameOver: function () {
      var stats = {
        floor: player.floor,
        gold: player.gold,
        kills: (Game.hud && typeof Game.hud.getKills === 'function') ? Game.hud.getKills() : 0,
        elapsedMs: this.getElapsedMs()
      };
      if (Game.Modal) {
        Game.Modal.open('gameover', stats);
      }
      /* 切回探索场景（弹窗悬停其上，_updateExplore 因弹窗打开而暂停） */
      this.switchScene('explore');
    },

    /* M9-5：重新开始（既有 reset 逻辑；通关 R 键与死亡结算按钮共用） */
    restart: function () {
      runStart = performance.now();
      /* 重置玩家为新档 */
      player.hp = 100; player.maxHp = 100;
      player.mp = 50; player.maxMp = 50; /* M8-1：新档 MP 满 */
      player.atk = 10; player.def = 5;
      player.gold = 0; player.exp = 0; player.level = 1;
      player.inventory = {}; player.equipment = { weapon: null, armor: null };
      player.quests = {};
      if (Game.Systems && Game.Systems.Quest) Game.Systems.Quest.init();
      if (Game.Systems && Game.Systems.Save) Game.Systems.Save.clear();
      /* 修复 P2：新局图鉴从空开始，与已清空的存档保持一致 */
      if (Game.Systems && Game.Systems.Bestiary && typeof Game.Systems.Bestiary.reset === 'function') {
        Game.Systems.Bestiary.reset();
      }
      lastStepAt = -1e9; /* 修复 P1：重开后立即响应移动 */
      try {
        if (Game.Systems && Game.Systems.Map) {
          Game.Systems.Map.setFloor(1);
          resetPlayer();
        }
      } catch (e) { /* Map 缺失时仅重置 Player（验证页场景） */ }
      refreshFov(); /* S3-1：重新开始后刷新视野 */
      if (Game.Modal) Game.Modal.close();
      this.switchScene('explore');
    },

    /* M9-5：首次引导（验证页断言用） */
    needsGuide: needsGuide,
    markGuided: markGuided,

    switchScene: function (name) {
      this._scene = name;
      Game.Core.EventBus.emit('game:sceneChanged', { scene: name });
      /* M9-4：场景切换时自动切换 BGM（弹窗/子场景不切，且同场景不重启避免断音） */
      var A = Game.Systems && Game.Systems.Audio;
      if (A) {
        var cur = A.getBgmScene();
        if (name === 'explore' && cur !== 'explore') A.bgmPlay('explore');
        else if (name === 'battle' && cur !== 'battle') A.bgmPlay('battle');
        else if (name === 'victory' && cur !== 'victory') A.bgmPlay('victory');
        /* 其他场景（inventory/shop/quests/npc/learner）保持当前 BGM 不变 */
      }
    },

    /* 探索场景。now 为帧时间戳（ms），loop 传入；验证页可传合成时间做确定性测试 */
    _updateExplore: function (now) {
      /* M9-5：首次引导覆盖层显示时暂停游戏输入（dismissGuide 监听任意键关闭） */
      if (this._guideVisible) return;
      /* S3-3：弹窗打开时暂停地图移动输入（弹窗自行处理 Esc/↑↓/Enter/点击） */
      if (Game.Modal && Game.Modal.isOpen()) return;
      var k = Game.Core.Input.getState();
      if (k['KeyB']) { delete k['KeyB']; Game.Modal.open('inventory'); return; }
      /* 修复：S 是 WASD 的“向下移动”，不能再同时作为商店热键（否则按 S 会弹出商店面板）。
       * 商店改用 E 打开；S 保留给移动，其余按键语义不变。 */
      if (k['KeyE']) { delete k['KeyE']; Game.Modal.open('shop'); return; }
      if (k['KeyM']) { delete k['KeyM']; Game.Modal.open('quests'); return; }
      if (k['KeyT']) { delete k['KeyT']; Game.Systems.NPC.open(); this._scene = 'npc'; return; }
      if (k['KeyL']) { delete k['KeyL']; Game.Systems.Learner.init(Game.Systems.Map.getGrid()); this._scene = 'learner'; return; }
      /* M9-4：Q 打开设置弹窗；K 一键静音（不 return，允许同时移动） */
      if (k['KeyQ']) { delete k['KeyQ']; Game.Modal.open('settings'); return; }
      if (k['KeyK']) { delete k['KeyK']; Game.Systems.Audio.setMuted(!Game.Systems.Audio.isMuted()); }
      /* 修复 P1：定步长（120ms）处理 AI 与移动；动作键仍即时响应 */
      var tNow = (typeof now === 'number') ? now : performance.now();
      if (tNow - lastStepAt < MOVE_INTERVAL) return;
      lastStepAt = tNow;
      /* M5：怪物 AI 先行（感知/追击），再处理玩家移动 */
      Game.Systems.AI.tick(player);
      var d = Game.Core.Input.direction(k);
      if (d.dx !== 0 || d.dy !== 0) {
        var nx = player.x + d.dx;
        var ny = player.y + d.dy;
        if (Game.Systems.Map.isWalkable(nx, ny)) {
          var fromX = player.x, fromY = player.y;
          player.x = nx;
          player.y = ny;
          /* M9-3：登记移动插值（逻辑坐标已更新，渲染层取视觉位置） */
          if (Game.Motion && typeof Game.Motion.setStep === 'function') {
            Game.Motion.setStep('player', fromX, fromY, nx, ny, 140);
          }
          Game.Core.EventBus.emit('audio:play', { sfx: 'move' });
          var t = Game.Systems.Map.tileAt(nx, ny);
          if (t === 2) {
            /* 修复：最深层踩下行梯不再静默重生成当前层（changeFloor 边界返回 null） */
            if (Game.Systems.Map.changeFloor(1)) {
              player.floor = Game.Systems.Map.getFloor();
              resetPlayer();
            }
          } else if (t === 3) {
            /* 修复：第 1 层踩上行梯不再静默重生成当前层 */
            if (Game.Systems.Map.changeFloor(-1)) {
              player.floor = Game.Systems.Map.getFloor();
              resetPlayer();
            }
          } else {
            var e = Game.Systems.Map.enemyAt(nx, ny);
            if (e) {
              Game.Systems.Battle.start(e.monsterId);
              this.switchScene('battle');
            } else {
              /* M9-1：站上宝箱自动拾取（不阻挡移动，拾取后 decor 置空） */
              var dec = Game.Systems.Map.getDecor(nx, ny);
              if (dec === 'chest') Game.Systems.Map.takeDecor(nx, ny);
            }
          }
          refreshFov(); /* S3-1：移动/换层后刷新视野 */
        }
      }
    },

    /* 战斗场景 */
    _updateBattle: function () {
      var k = Game.Core.Input.getState();
      if (k['Digit1'] || k['Numpad1']) { delete k['Digit1']; delete k['Numpad1']; Game.Systems.Battle.playerAction('attack'); }
      else if (k['Digit2'] || k['Numpad2']) { delete k['Digit2']; delete k['Numpad2']; Game.Systems.Battle.playerAction('defend'); }
      else if (k['Digit3'] || k['Numpad3']) { delete k['Digit3']; delete k['Numpad3']; Game.Systems.Battle.playerAction('run'); }
      /* M8-1：数字键 4/5/6 释放技能（探索场景无动作，不占用原有按键） */
      else if (k['Digit4'] || k['Numpad4']) { delete k['Digit4']; delete k['Numpad4']; Game.Systems.Battle.playerAction('skill:fireball'); }
      else if (k['Digit5'] || k['Numpad5']) { delete k['Digit5']; delete k['Numpad5']; Game.Systems.Battle.playerAction('skill:dash'); }
      else if (k['Digit6'] || k['Numpad6']) { delete k['Digit6']; delete k['Numpad6']; Game.Systems.Battle.playerAction('skill:shield'); }
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

    /* NPC 对话场景（M5）：Esc 离开 */
    _updateNpc: function () {
      var k = Game.Core.Input.getState();
      if (k['KeyT'] || k['Escape']) {
        delete k['KeyT']; delete k['Escape'];
        Game.Systems.NPC.close();
        this.switchScene('explore');
      }
    },

    /* 强化学习演示场景（M7）：Esc 返回，每帧训练 8 步 */
    _updateLearner: function () {
      var k = Game.Core.Input.getState();
      if (k['Escape']) {
        delete k['Escape'];
        Game.Systems.Learner.stop();
        this.switchScene('explore');
      }
      Game.Systems.Learner.tick(8);
    },

    /* 通关画面 */
    _updateVictory: function () {
      var k = Game.Core.Input.getState();
      if (k['KeyR']) {
        delete k['KeyR'];
        this.restart(); /* M9-5：复用统一 reset 逻辑 */
      }
    },

    loop: function (ts) {
      this._frames++;
      if (ts - this._lastT >= 1000) {
        this._fps = Math.round((this._frames * 1000) / (ts - this._lastT));
        this._frames = 0;
        this._lastT = ts;
      }
      /* S3-4：帧间 dt（ms），供反馈层推进生命周期；首帧 dt 记 0 */
      var dt = this._lastFrame ? (ts - this._lastFrame) : 0;
      this._lastFrame = ts;
      if (Game.Feedback && typeof Game.Feedback.update === 'function') Game.Feedback.update(dt);
      /* M9-3：推进移动插值、粒子生命、战斗死亡消散计时 */
      if (Game.Motion && typeof Game.Motion.update === 'function') Game.Motion.update(dt);
      if (Game.Particles && typeof Game.Particles.update === 'function') Game.Particles.update(dt);
      if (Game.Systems && Game.Systems.Battle && typeof Game.Systems.Battle.tick === 'function') Game.Systems.Battle.tick();
      syncHud(); /* S3-2：每帧同步 HUD（HP/金币/楼层随战斗结算、拾取、换层实时变化） */
      var scene = this._scene;
      if (scene === 'explore') {
        this._updateExplore(ts);
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
      } else if (scene === 'npc') {
        /* NPC 对话：画面静止（怪不追击、玩家不动），DOM 面板交互 */
        var ngrid = Game.Systems.Map.getGrid();
        Game.Core.Render.drawMap(ngrid, player);
        Game.Core.Render.drawPlayer(player);
        this._updateNpc();
      } else if (scene === 'learner') {
        this._updateLearner();
        Game.Core.Render.drawLearner(Game.Systems.Learner.getStats(), Game.Systems.Map.getGrid());
      } else if (scene === 'victory') {
        this._updateVictory();
        Game.Core.Render.drawVictory(player);
      }
      /* M9-5：首次引导覆盖层（悬停最顶层，任意键/点击关闭） */
      if (this._guideVisible) {
        try { Game.Core.Render.drawGuide(); } catch (e) { /* 降级 */ }
      }
    }
  };

  /* script 位于 body 末尾，DOM 已就绪，直接启动（测试页可设 __AI_DUNGEON_NO_AUTOSTART__ 跳过） */
  if (!window.__AI_DUNGEON_NO_AUTOSTART__) {
    Game.Core.Main.init();
    Game.Core.Main.start();
  }
})();
