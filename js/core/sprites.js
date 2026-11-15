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
   * 2026-11-06 自检：移除七个无对应 PNG 的注册项（此前每次启动都会 404，虽被 onerror 兜住但污染控制台）。
   * S-02a：为 barrel/torch/vine 补 16×16 自绘贴图并重新注册（三者由 map.js 的 DECOR 实际使用）；
   *        grass/puddle/bones/moss 无使用方，继续不注册，渲染层 _drawDetail 走程序化兜底。 */
  var NAMES = ['player', 'monster_chort', 'monster_chort_run', 'boss_demon', 'boss_demon_run',
    /* M9-1：装饰物素材（S-02a 补齐 barrel/torch/vine；其余装饰仍由渲染层程序化绘制） */
    'chest', 'barrel', 'torch', 'vine',
    /* S-05：密室宝箱（比普通宝箱更大更亮，自绘 16×16） */
    'room_chest',
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
    /* P1-1：装饰贴图（crate/skull/wall_goo 有 PNG；无文件的装饰由渲染层程序化绘制） */
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
    'ogre_run_anim_f0', 'ogre_run_anim_f1', 'ogre_run_anim_f2', 'ogre_run_anim_f3',
    /* 第二拨：三只 Boss 专属剪影（24 基原生，三态各 4 帧；不再复用杂兵放大）
     * 巨龙 64×54（长颈/长吻/双角/双翼/卷尾/三爪）、独眼酋长 48×54（单眼/獠牙/尖刺肩甲/巨斧）、
     * 僵尸王 48×54（三尖王冠/披风/露肋/权杖）。落屏高度 = 原生高 × 2（整数倍，见 render.js BOSS_MUL）。 */
    'dragon_idle_anim_f0', 'dragon_idle_anim_f1', 'dragon_idle_anim_f2', 'dragon_idle_anim_f3',
    'dragon_attack_anim_f0', 'dragon_attack_anim_f1', 'dragon_attack_anim_f2', 'dragon_attack_anim_f3',
    'dragon_hurt_anim_f0', 'dragon_hurt_anim_f1', 'dragon_hurt_anim_f2', 'dragon_hurt_anim_f3',
    'ogre_boss_idle_anim_f0', 'ogre_boss_idle_anim_f1', 'ogre_boss_idle_anim_f2', 'ogre_boss_idle_anim_f3',
    'ogre_boss_attack_anim_f0', 'ogre_boss_attack_anim_f1', 'ogre_boss_attack_anim_f2', 'ogre_boss_attack_anim_f3',
    'ogre_boss_hurt_anim_f0', 'ogre_boss_hurt_anim_f1', 'ogre_boss_hurt_anim_f2', 'ogre_boss_hurt_anim_f3',
    'zombie_king_idle_anim_f0', 'zombie_king_idle_anim_f1', 'zombie_king_idle_anim_f2', 'zombie_king_idle_anim_f3',
    'zombie_king_attack_anim_f0', 'zombie_king_attack_anim_f1', 'zombie_king_attack_anim_f2', 'zombie_king_attack_anim_f3',
    'zombie_king_hurt_anim_f0', 'zombie_king_hurt_anim_f1', 'zombie_king_hurt_anim_f2', 'zombie_king_hurt_anim_f3',
    /* P2-3：F4/F5 主题怪——big_zombie 32×36 单态 4 帧、necromancer 16×23 单态 4 帧、
     * masked_orc/pumpkin_dude 双态各 8 帧、angel 16×16 单态 4 帧 */
    'big_zombie_idle_anim_f0', 'big_zombie_idle_anim_f1', 'big_zombie_idle_anim_f2', 'big_zombie_idle_anim_f3',
    'necromancer_anim_f0', 'necromancer_anim_f1', 'necromancer_anim_f2', 'necromancer_anim_f3',
    'masked_orc_idle_anim_f0', 'masked_orc_idle_anim_f1', 'masked_orc_idle_anim_f2', 'masked_orc_idle_anim_f3',
    'masked_orc_run_anim_f0', 'masked_orc_run_anim_f1', 'masked_orc_run_anim_f2', 'masked_orc_run_anim_f3',
    'pumpkin_dude_idle_anim_f0', 'pumpkin_dude_idle_anim_f1', 'pumpkin_dude_idle_anim_f2', 'pumpkin_dude_idle_anim_f3',
    'pumpkin_dude_run_anim_f0', 'pumpkin_dude_run_anim_f1', 'pumpkin_dude_run_anim_f2', 'pumpkin_dude_run_anim_f3',
    'angel_idle_anim_f0', 'angel_idle_anim_f1', 'angel_idle_anim_f2', 'angel_idle_anim_f3',
    /* D-30：背包图标补齐——护甲 5 类 + 强化卷轴 4 档（16×16，全部落在既有 60 色内）。
     * 与物品 id 的对应关系不在这里猜，显式表见 js/data/items.js 的 Game.Data.ITEM_ICONS。 */
    'icon_armor_leather', 'icon_armor_chain_mail', 'icon_armor_plate', 'icon_armor_robe', 'icon_armor_scale',
    'icon_scroll_1', 'icon_scroll_2', 'icon_scroll_3', 'icon_scroll_4',
    /* D-79：五层主题地块（24×24 原生 1:1）+ 氛围装饰层（不占格、不参与寻路） */
    't1_dc_blood', 't1_dc_chain', 't1_dc_mold', 't1_dc_puddle', 't1_dc_rubble', 't1_dc_torch', 't1_dc_web', 't1_door',
    't2_dc_blood', 't2_dc_chain', 't2_dc_mold', 't2_dc_puddle', 't2_dc_rubble', 't2_dc_torch', 't2_dc_web', 't2_door',
    't2_floor_1', 't2_floor_2', 't2_floor_3', 't2_floor_4', 't2_floor_5', 't2_floor_6', 't2_floor_7', 't2_floor_8',
    't2_wall_left', 't2_wall_mid', 't2_wall_right', 't2_wall_top_left', 't2_wall_top_mid', 't2_wall_top_right',
    't3_dc_blood', 't3_dc_chain', 't3_dc_mold', 't3_dc_puddle', 't3_dc_rubble', 't3_dc_torch', 't3_dc_web', 't3_door',
    't3_floor_1', 't3_floor_2', 't3_floor_3', 't3_floor_4', 't3_floor_5', 't3_floor_6', 't3_floor_7', 't3_floor_8',
    't3_wall_left', 't3_wall_mid', 't3_wall_right', 't3_wall_top_left', 't3_wall_top_mid', 't3_wall_top_right',
    't4_dc_blood', 't4_dc_chain', 't4_dc_mold', 't4_dc_puddle', 't4_dc_rubble', 't4_dc_torch', 't4_dc_web', 't4_door',
    't4_floor_1', 't4_floor_2', 't4_floor_3', 't4_floor_4', 't4_floor_5', 't4_floor_6', 't4_floor_7', 't4_floor_8',
    't4_wall_left', 't4_wall_mid', 't4_wall_right', 't4_wall_top_left', 't4_wall_top_mid', 't4_wall_top_right',
    't5_dc_blood', 't5_dc_chain', 't5_dc_mold', 't5_dc_puddle', 't5_dc_rubble', 't5_dc_torch', 't5_dc_web', 't5_door',
    't5_floor_1', 't5_floor_2', 't5_floor_3', 't5_floor_4', 't5_floor_5', 't5_floor_6', 't5_floor_7', 't5_floor_8',
    't5_wall_left', 't5_wall_mid', 't5_wall_right', 't5_wall_top_left', 't5_wall_top_mid', 't5_wall_top_right'];

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
    ogre_run: ['ogre_run_anim_f0', 'ogre_run_anim_f1', 'ogre_run_anim_f2', 'ogre_run_anim_f3'],
    /* 第二拨：三只 Boss 专属剪影的三态帧组 */
    dragon_idle: ['dragon_idle_anim_f0', 'dragon_idle_anim_f1', 'dragon_idle_anim_f2', 'dragon_idle_anim_f3'],
    dragon_attack: ['dragon_attack_anim_f0', 'dragon_attack_anim_f1', 'dragon_attack_anim_f2', 'dragon_attack_anim_f3'],
    dragon_hurt: ['dragon_hurt_anim_f0', 'dragon_hurt_anim_f1', 'dragon_hurt_anim_f2', 'dragon_hurt_anim_f3'],
    ogre_boss_idle: ['ogre_boss_idle_anim_f0', 'ogre_boss_idle_anim_f1', 'ogre_boss_idle_anim_f2', 'ogre_boss_idle_anim_f3'],
    ogre_boss_attack: ['ogre_boss_attack_anim_f0', 'ogre_boss_attack_anim_f1', 'ogre_boss_attack_anim_f2', 'ogre_boss_attack_anim_f3'],
    ogre_boss_hurt: ['ogre_boss_hurt_anim_f0', 'ogre_boss_hurt_anim_f1', 'ogre_boss_hurt_anim_f2', 'ogre_boss_hurt_anim_f3'],
    zombie_king_idle: ['zombie_king_idle_anim_f0', 'zombie_king_idle_anim_f1', 'zombie_king_idle_anim_f2', 'zombie_king_idle_anim_f3'],
    zombie_king_attack: ['zombie_king_attack_anim_f0', 'zombie_king_attack_anim_f1', 'zombie_king_attack_anim_f2', 'zombie_king_attack_anim_f3'],
    zombie_king_hurt: ['zombie_king_hurt_anim_f0', 'zombie_king_hurt_anim_f1', 'zombie_king_hurt_anim_f2', 'zombie_king_hurt_anim_f3'],
    /* P2-3：F4/F5 主题怪帧组（big_zombie/necromancer/angel 单态：idle 与 run 共用同一组） */
    big_zombie_idle: ['big_zombie_idle_anim_f0', 'big_zombie_idle_anim_f1', 'big_zombie_idle_anim_f2', 'big_zombie_idle_anim_f3'],
    necromancer: ['necromancer_anim_f0', 'necromancer_anim_f1', 'necromancer_anim_f2', 'necromancer_anim_f3'],
    masked_orc_idle: ['masked_orc_idle_anim_f0', 'masked_orc_idle_anim_f1', 'masked_orc_idle_anim_f2', 'masked_orc_idle_anim_f3'],
    masked_orc_run: ['masked_orc_run_anim_f0', 'masked_orc_run_anim_f1', 'masked_orc_run_anim_f2', 'masked_orc_run_anim_f3'],
    pumpkin_dude_idle: ['pumpkin_dude_idle_anim_f0', 'pumpkin_dude_idle_anim_f1', 'pumpkin_dude_idle_anim_f2', 'pumpkin_dude_idle_anim_f3'],
    pumpkin_dude_run: ['pumpkin_dude_run_anim_f0', 'pumpkin_dude_run_anim_f1', 'pumpkin_dude_run_anim_f2', 'pumpkin_dude_run_anim_f3'],
    angel_idle: ['angel_idle_anim_f0', 'angel_idle_anim_f1', 'angel_idle_anim_f2', 'angel_idle_anim_f3']
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
        img.onload = function () { IMG[n] = img; img.__base = self.baseOf(n); self._check(); };
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
    },
    /* D-79：原生像素基准（16 或 24）。24 基用于 24×24 主题地块与 24 基装饰，
     * 其余（怪物/道具/UI/旧装饰）仍按 16 基；渲染层与验证页共用同一判定。 */
    baseOf: function (name) {
      if (typeof name !== 'string' || !name) return 16;
      if (/^t[1-5]_/.test(name)) return 24;
      if (/^(floor_[1-8]|floor_stairs|floor_ladder|wall_(left|mid|right)|wall_top_(left|mid|right))$/.test(name)) return 24;
      if (/^(chest|room_chest|barrel|torch|vine|crate|skull)$/.test(name)) return 24;
      /* D-80：角色/怪物帧按 24 基原生重画——原生高即当前屏幕绘制高（玩家 24×42、小怪 24×24）
       * 15 组怪物全部覆盖：漏掉任意一组都会让 24 基素材按 16 基放大 1.5 倍（落屏尺寸变大），
       * verify_d80 A9 逐组钉死 base=24 与 unitBox=原生尺寸。 */
      if (/^(knight_m_|tiny_slug_|imp_|goblin_|tiny_zombie_|angel_|skelet_|orc_warrior_|orc_shaman_|wogol_|necromancer_|masked_orc_|pumpkin_dude_|ogre_|big_demon_|big_zombie_|dragon_|zombie_king_)/.test(name)) return 24;
      /* D-80 裁定 B：道具/UI 图标全部 24×24 原生 1:1（背包行 / 商店行 / HUD 一律按原生尺寸绘制） */
      if (/^(weapon_|icon_armor_|icon_scroll_|flask_|flask_big_|ui_heart_|coin$|button_)/.test(name)) return 24;
      return 16;
    }
  };
})();
