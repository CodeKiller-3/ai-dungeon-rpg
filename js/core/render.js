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
    TILE: TILE,  /* M9-2：暴露瓦片尺寸供 Lighting 等模块复用 */

    init: function (canvas) {
      this._canvas = canvas;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this._ctx = canvas.getContext('2d');
    },

    /* M9-2：返回当前相机偏移（供 Lighting 等模块计算屏幕坐标） */
    _getCam: function () { return cam; },

    /* 计算镜头：地图比屏幕小则居中，否则跟随玩家 */
    _updateCam: function (grid, player) {
      var cv = this._canvas;
      var w = grid[0].length * TILE;
      var h = grid.length * TILE;
      cam.x = Math.min(Math.max(player.x * TILE - cv.width / 2 + TILE / 2, 0), Math.max(w - cv.width, 0));
      cam.y = Math.min(Math.max(player.y * TILE - cv.height / 2 + TILE / 2, 0), Math.max(h - cv.height, 0));
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

    /* M9-1：tile 细节绘制——素材就绪用贴图，否则程序化色块兜底
     * type: grass(草丛绿块) / puddle(水洼蓝块) / bones(碎骨白点) / moss(苔藓绿块) */
    _drawDetail: function (ctx, type, px, py) {
      var sp = (Game.Core.Sprites && Game.Core.Sprites.isReady()) ? Game.Core.Sprites.get(type) : null;
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
      var sp = (Game.Core.Sprites && Game.Core.Sprites.isReady()) ? Game.Core.Sprites.get(id) : null;
      if (sp) { ctx.drawImage(sp, px + 2, py + 2, TILE - 5, TILE - 5); return; }
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

    drawMap: function (grid, player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx || !grid) return;
      this._updateCam(grid, player);
      ctx.fillStyle = '#14142a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      /* S3-1 FOV：可见=正常绘制；记忆格=较暗覆盖；从未点亮=近黑不透露地形 */
      var fovOn = !!(Game.fov && Game.fov.isVisible);
      for (var y = 0; y < grid.length; y++) {
        for (var x = 0; x < grid[0].length; x++) {
          var t = grid[y][x];
          var px = x * TILE - cam.x;
          var py = y * TILE - cam.y;
          if (px + TILE < 0 || py + TILE < 0 || px > cv.width || py > cv.height) continue;
          if (fovOn && !Game.fov.isExplored(x, y) && !Game.fov.isVisible(x, y)) {
            ctx.fillStyle = '#07070f';
            ctx.fillRect(px, py, TILE - 1, TILE - 1);
            continue;
          }
          if (t === 0) {
            /* 墙：砖纹 */
            ctx.fillStyle = '#3a2e5c';
            ctx.fillRect(px, py, TILE - 1, TILE - 1);
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.fillRect(px, py + TILE / 2 - 1, TILE - 1, 2);
            ctx.fillRect(px + (x % 2) * 8, py, 1, TILE - 1);
          } else if (t === 1) {
            /* 地板：稳定噪点 */
            ctx.fillStyle = '#2b2b4a';
            ctx.fillRect(px, py, TILE - 1, TILE - 1);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            var seed = (x * 7 + y * 13) % 4;
            if (seed === 0) ctx.fillRect(px + 6, py + 6, 2, 2);
            else if (seed === 1) ctx.fillRect(px + 14, py + 3, 2, 2);
            else if (seed === 2) ctx.fillRect(px + 4, py + 12, 2, 2);
          } else if (t === 2) {
            /* 楼梯下：紫台 */
            ctx.fillStyle = '#b06ce0';
            ctx.fillRect(px, py, TILE - 1, TILE - 1);
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(px, py + TILE - 6, TILE - 1, 2);
            ctx.fillRect(px, py + TILE - 12, TILE - 1, 2);
          } else {
            /* 楼梯上：绿台 */
            ctx.fillStyle = '#52c41a';
            ctx.fillRect(px, py, TILE - 1, TILE - 1);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(px, py + TILE - 6, TILE - 1, 2);
          }
          /* M9-1：细节层与装饰层——仅当前可见格绘制（FOV 外不画，与怪物隐藏规则一致） */
          if (!fovOn || Game.fov.isVisible(x, y)) {
            var det = Game.Systems.Map.getDetail(x, y);
            if (det) this._drawDetail(ctx, det, px, py);
            var dec = Game.Systems.Map.getDecor(x, y);
            if (dec) this._drawDecor(ctx, dec, px, py);
          }
          /* S3-1 FOV：已点亮但当前不可见 → 较暗覆盖（记忆效果） */
          if (fovOn && !Game.fov.isVisible(x, y)) {
            ctx.fillStyle = 'rgba(4,4,12,0.55)';
            ctx.fillRect(px, py, TILE - 1, TILE - 1);
          }
        }
      }
      /* 敌人标记（M2/M7.5）：埋伏怪——chort 精灵（素材就绪时）+ 半透明红底 */
      var es = Game.Systems.Map.getEnemies();
      for (var i = 0; i < es.length; i++) {
        if (fovOn && !Game.fov.isVisible(es[i].x, es[i].y)) continue; /* S3-1：迷雾外不透视 */
        var epx = es[i].x * TILE - cam.x + 2;
        var epy = es[i].y * TILE - cam.y + 2;
        if (epx > -20 && epy > -20 && epx < cv.width + 20 && epy < cv.height + 20) {
          var eimg = (Game.Core.Sprites && Game.Core.Sprites.isReady()) ? Game.Core.Sprites.get('monster_chort') : null;
          if (eimg) {
            ctx.fillStyle = 'rgba(234,102,104,0.22)';
            ctx.fillRect(epx - 2, epy - 2, TILE, TILE);
            ctx.drawImage(eimg, epx, epy, TILE - 4, TILE - 4);
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
        if (ppx > -20 && ppy > -20 && ppx < cv.width + 20 && ppy < cv.height + 20) {
          var chasing = ps[j].state === 'chase';
          var pimg = (Game.Core.Sprites && Game.Core.Sprites.isReady())
            ? Game.Core.Sprites.get(chasing ? 'monster_chort_run' : 'monster_chort')
            : null;
          if (pimg) {
            if (chasing) {
              ctx.fillStyle = 'rgba(234,102,104,0.25)';
              ctx.fillRect(ppx - 2, ppy - 2, TILE, TILE);
            }
            ctx.drawImage(pimg, ppx, ppy, TILE - 4, TILE - 4);
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

    drawPlayer: function (player) {
      var ctx = this._ctx;
      if (!ctx) return;
      /* M9-3：取插值渲染位置；未登记移动时降级用逻辑坐标 */
      var rp = (Game.Motion && Game.Motion.getRenderPos) ? Game.Motion.getRenderPos('player') : null;
      var rx = rp ? rp.x : player.x;
      var ry = rp ? rp.y : player.y;
      var px = rx * TILE - cam.x;
      var py = ry * TILE - cam.y;
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
      /* S3-2：顶部信息栏（HP/MP/金币/楼层/击杀）改由 Game.hud 统一绘制，全场景常驻；
         本函数保留接口与底部操作提示，FPS/攻防信息下移到底部一行，不再与 HUD 条带重叠 */
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '12px monospace';
      ctx.fillText('FPS=' + (stats ? stats.fps : 0) +
        (stats ? ' | 攻击:' + stats.atk + ' 防御:' + stats.def : '') +
        ' | 方向键/WASD 移动 | 红点=怪物(踩到开战) | 紫梯下 / 绿梯上', 10, cv.height - 10);
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
     * M9-3：怪物死亡消散（渐隐+上浮+缩小）、攻击前摇帧、粒子特效 */
    drawBattle: function (state) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx || !state) return;
      ctx.fillStyle = '#0f0f1f';
      ctx.fillRect(0, 0, cv.width, cv.height);

      var now = performance.now();
      var dying = !!state.dying;
      var dieProg = dying ? Math.min((now - state.dyingAt) / (state.dyingMs || 700), 1) : 0;

      /* 敌人：素材就绪时用真实精灵（Boss 用大恶魔，其余用小怪） */
      var ex = cv.width / 2 - 45;
      var ey = 90;
      /* M9-3：怪物攻击前摇帧偏移（向前=向下） */
      var mAtkOff = this._attackOffset(state.monsterActionAt, 320, 1);
      ey += mAtkOff;
      var boss = state.monster.id === 'dragon';
      var sp2 = (Game.Core.Sprites && Game.Core.Sprites.isReady())
        ? Game.Core.Sprites.get(boss ? 'boss_demon' : 'monster_chort')
        : null;
      ctx.save();
      if (dying) {
        /* M9-3：死亡消散——渐隐 + 上浮 + 缩小 */
        ctx.globalAlpha = 1 - dieProg;
        var mScale = 1 - dieProg * 0.5;
        var mSize = 90 * mScale;
        var mDrawX = ex + (90 - mSize) / 2;
        var mDrawY = ey - dieProg * 30 + (90 - mSize) / 2;
        if (sp2) {
          ctx.drawImage(sp2, mDrawX, mDrawY, mSize, mSize);
        } else {
          ctx.fillStyle = state.monster.color;
          ctx.fillRect(mDrawX, mDrawY, mSize, mSize);
        }
      } else {
        if (sp2) {
          ctx.drawImage(sp2, ex, ey, 90, 90);
        } else {
          ctx.fillStyle = state.monster.color;
          ctx.fillRect(ex, ey, 90, 90);
        }
      }
      ctx.restore();
      if (!dying) {
        ctx.fillStyle = '#fff';
        ctx.font = '15px monospace';
        ctx.fillText(state.monster.name + '  HP:' + state.monster.hp + '/' + state.monster.maxHp,
          cv.width / 2 - 140, ey + 120);
      }

      /* 玩家：素材就绪时用骑士精灵 */
      var p = Game.Data.Player;
      var px = cv.width / 2 - 45;
      var py = cv.height - 190;
      /* M9-3：玩家攻击前摇帧偏移（向前=向上） */
      var pAtkOff = this._attackOffset(state.playerActionAt, 320, -1);
      py += pAtkOff;
      var psp = (Game.Core.Sprites && Game.Core.Sprites.isReady()) ? Game.Core.Sprites.get('player') : null;
      if (psp) {
        ctx.drawImage(psp, px, py, 90, 90);
      } else {
        ctx.fillStyle = '#ffcf6e';
        ctx.fillRect(px, py, 90, 90);
      }
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

      /* 指令提示（消散期间隐藏） */
      if (!dying) {
        ctx.fillStyle = '#9bbbf4';
        ctx.font = '14px monospace';
        ctx.fillText('1 攻击   2 防御   3 逃跑', cv.width / 2 - 100, cv.height - 30);
      }
      /* S3-4：战斗视觉反馈（伤害飘字/受击闪白红闪），绘制于战斗内容之上、HUD 之下 */
      try { if (Game.Feedback && typeof Game.Feedback.draw === 'function') Game.Feedback.draw(); } catch (e) { /* 降级 */ }
      /* M9-3：粒子特效（命中火花/死亡灵魂碎片），叠在反馈层之上 */
      try { if (Game.Particles && typeof Game.Particles.draw === 'function') Game.Particles.draw(); } catch (e) { /* 降级 */ }
      this._drawHud(); /* S3-2 */
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
      this._drawHud(); /* S3-2 */
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
        ctx.fillText('全部任务已完成！', 30, 100);
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
      ctx.fillText('Esc 返回探索', 30, cv.height - 30);
      this._drawHud(); /* S3-2 */
    },

    /* 通关画面（M4） */
    drawVictory: function (player) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx) return;
      ctx.fillStyle = '#0f0f1f';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#ffcf6e';
      ctx.font = 'bold 34px monospace';
      ctx.fillText('通 关 !', cv.width / 2 - 80, cv.height / 2 - 80);
      ctx.fillStyle = '#cfcfcf';
      ctx.font = '16px monospace';
      ctx.fillText('勇者击败了地牢巨龙，冒险结束', cv.width / 2 - 160, cv.height / 2 - 30);
      ctx.fillStyle = '#8f8';
      ctx.font = '15px monospace';
      ctx.fillText('最终金币: ' + player.gold + '   经验: ' + player.exp + '   等级: ' + player.level,
        cv.width / 2 - 180, cv.height / 2 + 20);
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '14px monospace';
      ctx.fillText('按 R 重新开始', cv.width / 2 - 60, cv.height / 2 + 70);
      this._drawHud(); /* S3-2 */
    },

    /* 强化学习演示场景（M7）：Q-learning 寻宝鼠 */
    drawLearner: function (stats, grid) {
      var ctx = this._ctx;
      var cv = this._canvas;
      if (!ctx || !grid || !stats) return;
      ctx.fillStyle = '#0f0f1f';
      ctx.fillRect(0, 0, cv.width, cv.height);
      var T = 24;
      var ox = Math.max((cv.width - grid[0].length * T) / 2, 10);
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
      ctx.fillText('强化学习演示 · Q-learning 寻宝鼠', 24, 34);
      ctx.fillStyle = '#8f8';
      ctx.font = '15px monospace';
      ctx.fillText('训练轮次: ' + stats.episode +
        '   成功率: ' + stats.successRate + '%   (成功 ' + stats.successes + ')',
        24, 56);
      ctx.fillStyle = '#9bbbf4';
      ctx.font = '13px monospace';
      ctx.fillText('ε-贪心 ε=' + stats.epsilon + '（探索/利用权衡）| 橙色=鼠 黄色=金币 目标=学会自己走到金币',
        24, cv.height - 46);
      /* 历史成功率条（最近 20 轮） */
      var bars = stats.history.slice(-20);
      var bw = Math.min(14, (cv.width - 60) / 20 - 2);
      for (var i = 0; i < bars.length; i++) {
        var hgt = Math.max(2, Math.round(bars[i].rate * 0.5));
        ctx.fillStyle = '#52c41a';
        ctx.fillRect(24 + i * (bw + 2), cv.height - 32 - hgt, bw, hgt);
      }
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px monospace';
      ctx.fillText('成功率走势（近20轮）', 24, cv.height - 14);
      this._drawHud(); /* S3-2 */
    }
  };
})();
