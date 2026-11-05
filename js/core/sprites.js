/* js/core/sprites.js — 像素素材加载器（M7.5 / P1-1 扩展）
 * 素材来源：GitHub 开源仓库 fernandovmp/kni-dungeon（MIT），
 *           其美术素材源自 0x72 的 CC0 像素包（DungeonTileset II / character-pack）
 * 素材列表见 assets/sprites/（逐文件来源声明见 README 组件来源表）
 * 接口：load / isReady / get / getFrame
 * 降级：素材未加载完成或缺失时，渲染层自动回退到色块绘制 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Core = Game.Core || {};

  var IMG = {};
  var READY = false;
  var COUNT = 0;

  /* P1-1：场景素材注册表。现有关键精灵（前 5 项）与 M9-1 装饰名保留，
   * 新增 0x72 DungeonTileset II v1.7 裁剪图（地板 8 变体 / 楼梯 / 墙体体系 / 装饰 / 骷髅动画 / UI）。
   * 未在 assets/ 中存在同名文件的项（barrel/torch/vine/grass/puddle/bones/moss）
   * 依然保留在 NAMES 中，onerror 不入库，渲染层走既有程序化兜底。 */
  var NAMES = ['player', 'monster_chort', 'monster_chort_run', 'boss_demon', 'boss_demon_run',
    /* M9-1：装饰物与 tile 细节素材（CC0，kenney/0x72；缺失则渲染层程序化兜底） */
    'chest', 'barrel', 'torch', 'vine', 'grass', 'puddle', 'bones', 'moss',
    /* P1-1：地板变体与楼梯 */
    'floor_1', 'floor_2', 'floor_3', 'floor_4', 'floor_5', 'floor_6', 'floor_7', 'floor_8',
    'floor_stairs', 'floor_ladder',
    /* P1-1：墙体体系（墙身 3 + 顶行 3 + edge 6 + outer 6） */
    'wall_left', 'wall_mid', 'wall_right',
    'wall_top_left', 'wall_top_mid', 'wall_top_right',
    'wall_edge_left', 'wall_edge_right',
    'wall_edge_top_left', 'wall_edge_top_right',
    'wall_edge_bottom_left', 'wall_edge_bottom_right',
    'wall_outer_top_left', 'wall_outer_top_right',
    'wall_outer_mid_left', 'wall_outer_mid_right',
    'wall_outer_front_left', 'wall_outer_front_right',
    /* P1-1：装饰贴图（barrel/torch/vine/grass/puddle 无真贴图，保留程序化兜底） */
    'crate', 'skull', 'wall_goo',
    /* P1-1：骷髅士兵 idle/run 各 4 帧 */
    'skelet_idle_anim_f0', 'skelet_idle_anim_f1', 'skelet_idle_anim_f2', 'skelet_idle_anim_f3',
    'skelet_run_anim_f0', 'skelet_run_anim_f1', 'skelet_run_anim_f2', 'skelet_run_anim_f3',
    /* P1-1：UI 图标（P1-2 接入 HUD/弹窗） */
    'ui_heart_empty', 'ui_heart_full', 'ui_heart_half',
    'flask_blue', 'flask_green', 'flask_red', 'flask_yellow',
    'coin',
    'button_blue_up', 'button_blue_down', 'button_red_up', 'button_red_down',
    /* P1-2：大药水 + 武器图标（items.js 实际 id 映射用） */
    'flask_big_blue', 'flask_big_green', 'flask_big_red',
    'weapon_rusty_sword', 'weapon_regular_sword', 'weapon_golden_sword',
    'weapon_red_gem_sword', 'weapon_lavish_sword',
    'weapon_axe', 'weapon_bow', 'weapon_spear',
    /* P2-2：物品扩量——追加 18 把武器图标（与 P1-2 已裁 8 把共 26 把全覆盖） */
    'weapon_anime_sword', 'weapon_baton_with_spikes', 'weapon_big_hammer', 'weapon_bow_2',
    'weapon_double_axe', 'weapon_cleaver', 'weapon_duel_sword', 'weapon_green_magic_staff',
    'weapon_hammer', 'weapon_katana', 'weapon_knife', 'weapon_knight_sword',
    'weapon_mace', 'weapon_saw_sword', 'weapon_machete', 'weapon_red_magic_staff',
    'weapon_waraxe', 'weapon_throwing_axe',
    /* P1-3：角色与怪物动画——玩家骑士 16×28 三态、史莱姆 16×16、蝙蝠 imp 16×16、Boss 大恶魔 32×36 */
    'knight_m_idle_anim_f0', 'knight_m_idle_anim_f1', 'knight_m_idle_anim_f2', 'knight_m_idle_anim_f3',
    'knight_m_run_anim_f0', 'knight_m_run_anim_f1', 'knight_m_run_anim_f2', 'knight_m_run_anim_f3',
    'knight_m_hit_anim_f0', 'knight_m_hit_anim_f1', 'knight_m_hit_anim_f2', 'knight_m_hit_anim_f3',
    'tiny_slug_anim_f0', 'tiny_slug_anim_f1', 'tiny_slug_anim_f2', 'tiny_slug_anim_f3',
    'imp_idle_anim_f0', 'imp_idle_anim_f1', 'imp_idle_anim_f2', 'imp_idle_anim_f3',
    'imp_run_anim_f0', 'imp_run_anim_f1', 'imp_run_anim_f2', 'imp_run_anim_f3',
    'big_demon_idle_anim_f0', 'big_demon_idle_anim_f1', 'big_demon_idle_anim_f2', 'big_demon_idle_anim_f3',
    'big_demon_run_anim_f0', 'big_demon_run_anim_f1', 'big_demon_run_anim_f2', 'big_demon_run_anim_f3',
    /* P2-1：怪物扩量——goblin/tiny_zombie/orc_warrior/orc_shaman/wogol 各 idle+run 8 帧、ogre 32×36 双态 8 帧 */
    'goblin_idle_anim_f0', 'goblin_idle_anim_f1', 'goblin_idle_anim_f2', 'goblin_idle_anim_f3',
    'goblin_run_anim_f0', 'goblin_run_anim_f1', 'goblin_run_anim_f2', 'goblin_run_anim_f3',
    'tiny_zombie_idle_anim_f0', 'tiny_zombie_idle_anim_f1', 'tiny_zombie_idle_anim_f2', 'tiny_zombie_idle_anim_f3',
    'tiny_zombie_run_anim_f0', 'tiny_zombie_run_anim_f1', 'tiny_zombie_run_anim_f2', 'tiny_zombie_run_anim_f3',
    'orc_warrior_idle_anim_f0', 'orc_warrior_idle_anim_f1', 'orc_warrior_idle_anim_f2', 'orc_warrior_idle_anim_f3',
    'orc_warrior_run_anim_f0', 'orc_warrior_run_anim_f1', 'orc_warrior_run_anim_f2', 'orc_warrior_run_anim_f3',
    'orc_shaman_idle_anim_f0', 'orc_shaman_idle_anim_f1', 'orc_shaman_idle_anim_f2', 'orc_shaman_idle_anim_f3',
    'orc_shaman_run_anim_f0', 'orc_shaman_run_anim_f1', 'orc_shaman_run_anim_f2', 'orc_shaman_run_anim_f3',
    'wogol_idle_anim_f0', 'wogol_idle_anim_f1', 'wogol_idle_anim_f2', 'wogol_idle_anim_f3',
    'wogol_run_anim_f0', 'wogol_run_anim_f1', 'wogol_run_anim_f2', 'wogol_run_anim_f3',
    'ogre_idle_anim_f0', 'ogre_idle_anim_f1', 'ogre_idle_anim_f2', 'ogre_idle_anim_f3',
    'ogre_run_anim_f0', 'ogre_run_anim_f1', 'ogre_run_anim_f2', 'ogre_run_anim_f3'];

  /* P1-1：帧序列映射——把逻辑名 + 帧序号解析到具体文件。
   * 新增动画只需在此登记一行，getFrame 行为不变。 */
  var FRAME_SETS = {
    skelet_idle: ['skelet_idle_anim_f0', 'skelet_idle_anim_f1', 'skelet_idle_anim_f2', 'skelet_idle_anim_f3'],
    skelet_run: ['skelet_run_anim_f0', 'skelet_run_anim_f1', 'skelet_run_anim_f2', 'skelet_run_anim_f3'],
    /* P1-3：玩家骑士三态 / imp 双态 / 大恶魔双态 / 史莱姆单序列（idle/run 共用） */
    knight_m_idle: ['knight_m_idle_anim_f0', 'knight_m_idle_anim_f1', 'knight_m_idle_anim_f2', 'knight_m_idle_anim_f3'],
    knight_m_run: ['knight_m_run_anim_f0', 'knight_m_run_anim_f1', 'knight_m_run_anim_f2', 'knight_m_run_anim_f3'],
    knight_m_hit: ['knight_m_hit_anim_f0', 'knight_m_hit_anim_f1', 'knight_m_hit_anim_f2', 'knight_m_hit_anim_f3'],
    tiny_slug: ['tiny_slug_anim_f0', 'tiny_slug_anim_f1', 'tiny_slug_anim_f2', 'tiny_slug_anim_f3'],
    imp_idle: ['imp_idle_anim_f0', 'imp_idle_anim_f1', 'imp_idle_anim_f2', 'imp_idle_anim_f3'],
    imp_run: ['imp_run_anim_f0', 'imp_run_anim_f1', 'imp_run_anim_f2', 'imp_run_anim_f3'],
    big_demon_idle: ['big_demon_idle_anim_f0', 'big_demon_idle_anim_f1', 'big_demon_idle_anim_f2', 'big_demon_idle_anim_f3'],
    big_demon_run: ['big_demon_run_anim_f0', 'big_demon_run_anim_f1', 'big_demon_run_anim_f2', 'big_demon_run_anim_f3'],
    /* P2-1：六种新怪 idle/run 各 4 帧 */
    goblin_idle: ['goblin_idle_anim_f0', 'goblin_idle_anim_f1', 'goblin_idle_anim_f2', 'goblin_idle_anim_f3'],
    goblin_run: ['goblin_run_anim_f0', 'goblin_run_anim_f1', 'goblin_run_anim_f2', 'goblin_run_anim_f3'],
    tiny_zombie_idle: ['tiny_zombie_idle_anim_f0', 'tiny_zombie_idle_anim_f1', 'tiny_zombie_idle_anim_f2', 'tiny_zombie_idle_anim_f3'],
    tiny_zombie_run: ['tiny_zombie_run_anim_f0', 'tiny_zombie_run_anim_f1', 'tiny_zombie_run_anim_f2', 'tiny_zombie_run_anim_f3'],
    orc_warrior_idle: ['orc_warrior_idle_anim_f0', 'orc_warrior_idle_anim_f1', 'orc_warrior_idle_anim_f2', 'orc_warrior_idle_anim_f3'],
    orc_warrior_run: ['orc_warrior_run_anim_f0', 'orc_warrior_run_anim_f1', 'orc_warrior_run_anim_f2', 'orc_warrior_run_anim_f3'],
    orc_shaman_idle: ['orc_shaman_idle_anim_f0', 'orc_shaman_idle_anim_f1', 'orc_shaman_idle_anim_f2', 'orc_shaman_idle_anim_f3'],
    orc_shaman_run: ['orc_shaman_run_anim_f0', 'orc_shaman_run_anim_f1', 'orc_shaman_run_anim_f2', 'orc_shaman_run_anim_f3'],
    wogol_idle: ['wogol_idle_anim_f0', 'wogol_idle_anim_f1', 'wogol_idle_anim_f2', 'wogol_idle_anim_f3'],
    wogol_run: ['wogol_run_anim_f0', 'wogol_run_anim_f1', 'wogol_run_anim_f2', 'wogol_run_anim_f3'],
    ogre_idle: ['ogre_idle_anim_f0', 'ogre_idle_anim_f1', 'ogre_idle_anim_f2', 'ogre_idle_anim_f3'],
    ogre_run: ['ogre_run_anim_f0', 'ogre_run_anim_f1', 'ogre_run_anim_f2', 'ogre_run_anim_f3']
  };

  Game.Core.Sprites = {
    /* baseDir：可选。默认 'assets/sprites/'（index.html 位于项目根时使用）；
     * 验证页位于 preflight/ 时传 '../assets/sprites/'，避免为测试修改默认路径。 */
    load: function (baseDir) {
      var self = this;
      var dir = (typeof baseDir === 'string' && baseDir) ? baseDir : 'assets/sprites/';
      NAMES.forEach(function (n) {
        var img = new Image();
        COUNT++;
        img.onload = function () { IMG[n] = img; self._check(); };
        img.onerror = function () { self._check(); };   /* 加载失败不入库，渲染层自动程序化兜底 */
        img.src = dir + n + '.png';
      });
    },
    _check: function () {
      COUNT--;
      if (COUNT <= 0) READY = true;
    },
    isReady: function () { return READY; },
    /* 兼容旧契约：单图查询（未加载/缺失返回 null） */
    get: function (name) { return IMG[name] || null; },
    /* P1-1：帧序列查询。support：
     *   getFrame('skelet_idle', 0..3) / getFrame('skelet_run', 0..3) → 对应帧
     *   getFrame('skelet_idle_anim_f2')  → 显式文件名
     *   getFrame('skelet_idle_anim', i)  → 等价于 skelet_idle
     * idx 循环取模；缺帧返回 null，渲染层回退既有表现。 */
    getFrame: function (name, idx) {
      if (typeof name !== 'string' || !name) return null;
      var i = (typeof idx === 'number' && isFinite(idx)) ? Math.floor(idx) : 0;
      var set = FRAME_SETS[name] || FRAME_SETS[name.replace(/_anim$/, '')];
      if (set && set.length) {
        if (i < 0) i = 0;
        return IMG[set[i % set.length]] || null;
      }
      /* 显式文件名：已注册则直接返回（忽略 idx） */
      if (IMG[name]) return IMG[name];
      /* 约定命名 base_anim_fN 的兜底解析 */
      var direct = IMG[name + '_anim_f' + i];
      return direct || null;
    }
  };
})();
