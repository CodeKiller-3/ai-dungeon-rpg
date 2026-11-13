/* js/data/maps.js — 地图配置（PLAN.md §7.1 MAPS Schema）
 * M9-1 扩展：新增 TILE_DETAILS（tile 细节候选池）与 DECOR（装饰物定义）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  Game.Data.MAPS = {
    floors: 5,                                   /* 楼层数（P2-3：3→5，dragon 移至 F5） */
    /* D-64：每层宽高各 +4（21×15→25×19 … 37×23→41×27）。
     * 扩图前的尺寸留在 map.js 的 BASE_SIZES，用于按面积等比放大怪物/宝箱/陷阱/装饰密度。 */
    sizes: [[25, 19], [29, 21], [33, 23], [37, 25], [41, 27]], /* 每层网格尺寸 */
    enemyTable: [                               /* 每层怪物概率表（M2 使用；每行概率和=1，逐层期望强度严格递增） */
      /* F1 地牢杂兵（P2-1，期望 11.125） */
      [{ id: 'slime', rate: 0.45 }, { id: 'bat', rate: 0.3 },
        { id: 'goblin', rate: 0.15 }, { id: 'tiny_zombie', rate: 0.1 }],
      /* F2 兽人营地（P2-1，期望 20.125） */
      [{ id: 'bat', rate: 0.15 }, { id: 'skeleton', rate: 0.3 },
        { id: 'orc_warrior', rate: 0.3 }, { id: 'orc_shaman', rate: 0.25 }],
      /* F3 龙巢前哨（P2-3：dragon 移出、imp 独立登场，期望 23.75） */
      [{ id: 'skeleton', rate: 0.3 }, { id: 'ogre', rate: 0.25 },
        { id: 'wogol', rate: 0.2 }, { id: 'imp', rate: 0.25 }],
      /* F4 冰霜墓穴（P2-3b 数值上调后期望 36.85） */
      [{ id: 'big_zombie', rate: 0.2 }, { id: 'necromancer', rate: 0.2 },
        { id: 'pumpkin_dude', rate: 0.15 }, { id: 'masked_orc', rate: 0.3 },
        { id: 'skeleton', rate: 0.15 }],
      /* F5 恶魔深渊（P2-4：Boss（dragon）不再出现在普通表，由 MAPS.bosses + map.js 注入恰 1 只；
       * 普通怪权重 big_zombie .35 / necromancer .2 / masked_orc .2 / angel .25，期望强度 44.1） */
      [{ id: 'big_zombie', rate: 0.35 }, { id: 'necromancer', rate: 0.2 },
        { id: 'masked_orc', rate: 0.2 }, { id: 'angel', rate: 0.25 }]
    ],
    /* D-67：遭遇成本系数（只影响"每层怪物数量"，不碰尺寸/陷阱/装饰/怪物数值）。
     * 计数 = 基准 + (D-64 面积放大后的增量) × 系数：
     *   1 = D-64/D-66 现状；>1 更密；0 = 回到扩图前密度。
     * 可写成一个数（全层同系数）或长度 5 的数组（逐层）；只放大"增量"意味着把
     * sizes 钉回扩图前的历史页（areaRatio=1）恒等于基准，历史基线不因本卡漂移。
     * enemyArea 作用于静态怪，patrolArea 作用于巡逻怪（主动贴脸那批，等价于巡逻遭遇率）。
     * 现值：静态怪不动（enemyArea=1）；F1/F2 巡逻怪 3→4（+2 只/局）。依据是实测归因：
     * 静态密度 ± 都会把 B1 推向 54%~68%，且密度上调会把 M1-6000 全清从 100% 压到 98%；
     * 巡逻 +2 是唯一能在 2500 步内把 B1 拉回 42%~48% 的遭遇成本项（详见 docs/难度收口-D-67.md）。 */
    density: { enemyArea: 1, patrolArea: [1.5, 1.5, 1, 1, 1] },
    /* P2-4：层 Boss 配置（floor 为 1-based；普通 enemyTable 不含 Boss id，
     * map.js 按此表在对应层注入恰好 1 只 Boss） */
    bosses: [
      { floor: 2, id: 'ogre_boss' },
      { floor: 4, id: 'zombie_king' },
      { floor: 5, id: 'dragon' }
    ],
    /* P2-3：层主题（纯视觉参数，透明度 ≤0.12，避免压暗贴图；drawMap 叠色用） */
    themes: [
      { name: '地牢', tint: 'rgba(120,130,150,0.06)' },
      { name: '兽人营地', tint: 'rgba(150,120,70,0.08)' },
      { name: '龙巢前哨', tint: 'rgba(160,60,50,0.10)' },
      { name: '冰霜墓穴', tint: 'rgba(80,140,200,0.10)' },
      { name: '恶魔深渊', tint: 'rgba(110,60,160,0.12)' }
    ]
  };

  /* M9-1：tile 细节候选池——按权重随机出现在地板/墙上，纯视觉不影响通行
   * type: grass(草丛) | puddle(水洼) | bones(碎骨) | moss(苔藓) */
  Game.Data.TILE_DETAILS = {
    floor: [
      { type: 'grass', weight: 12 },
      { type: 'puddle', weight: 6 },
      { type: 'bones', weight: 4 },
      { type: 'moss', weight: 8 }
    ],
    wall: [
      { type: 'moss', weight: 6 }
    ],
    boss: []
  };

  /* M9-1：装饰物定义——不阻挡移动；chest 可拾取（金币或道具）
   * loot: 'gold' | 'item' | 'random'
   * D-46：gold_pile / potion_stash 是"每层固定奖励点"，额度只读 Game.Data.REWARD，
   *       不参与宝箱随机池（不碰 CHEST_LOOT），也不出武器/护甲。 */
  Game.Data.DECOR = {
    chest:  { id: 'chest',  name: '宝箱', desc: '内含金币或道具', loot: 'random' },
    room_chest: { id: 'room_chest', name: '密室宝箱', desc: '封闭小房里的厚赏', loot: 'rich' },
    gold_pile: { id: 'gold_pile', name: '金币堆', desc: '散落的金币（固定额度）', loot: 'gold' },
    potion_stash: { id: 'potion_stash', name: '补给包', desc: '一罐药水（固定额度）', loot: 'potion' },
    barrel: { id: 'barrel', name: '木桶', desc: '装饰物' },
    torch:  { id: 'torch',  name: '火把', desc: '照亮周围（静态，M9-2 加光晕）' },
    vine:   { id: 'vine',   name: '藤蔓', desc: '装饰物' }
  };

  /* D-69：层内精英——每层主路 1 只，挡在主路上但不是墙。
   *   atFrac / band：主路（出生点→下行梯）进度 55%、允许 45%–65%；
   *                  placeElite 在该窗口内优先取"割点"（去掉它出生点就到不了下行梯），
   *                  保证绕不开；窗口内没有割点才退回"绕行代价最大"的合法格并记录 cut=false。
   *   loot：打赢后必掉的该层专属武器（D-71，items.js 里的不可枚举条目）；
   *         纯确定性，不消耗随机数、不进商店、不改经验/金币/普通掉落。
   *   sprite：复用现有贴图（MONSTER_ANIM 的 key），不新增美术素材。
   *   进精英层不改 grid / 连通性 / 普通怪数量，地图指纹与历史基线可逐格对照。 */
  Game.Data.ELITE = {
    enabled: true,
    atFrac: 0.55,
    band: [0.45, 0.65],
    /* D-71：精英战利品按楼层固定（1→5），替代 D-69 的"精英之证 +2 攻击"。
     * 五把武器属性严格递增，且都高于同层商店最强武器，拿到即用。 */
    loot: ['elite_fang_1', 'elite_axe_2', 'elite_blade_3', 'elite_edge_4', 'elite_fang_5'],
    floors: [
      { floor: 1, id: 'elite_goblin', sprite: 'goblin' },
      { floor: 2, id: 'elite_orc', sprite: 'orc_warrior' },
      { floor: 3, id: 'elite_ogre', sprite: 'ogre' },
      { floor: 4, id: 'elite_zombie', sprite: 'big_zombie' },
      { floor: 5, id: 'elite_angel', sprite: 'angel' }
    ]
  };

  /* D-46：每层固定奖励点（只加补给：金币 / 药）。
   * 放置规则见 map.js placeRewards：沿"出生点→下行梯"的主路确定性取点，
   * 不消耗随机数（既有地图指纹不变），每层 ≤2 处（count 上限 2），
   * 与楼梯 / Boss / 出生点 / 敌人 / 陷阱 / 已有装饰错开，绝不是"贴楼梯白拿"。
   * 额度口径：F1–F4 给金币，正好补上"首次进店差的钱"；F5 给 2 瓶特大血瓶，
   * 因为 F5 的商店在落地时就已经开过了，金币到那里买不到东西。
   * 金币增量合计 60+90+110+100 = 360，相对 D-40 的期望总收入 2860 增幅 12.6%（护栏 ≤60%）。 */
  Game.Data.REWARD = {
    floors: [
      { count: 2, kind: 'gold', amount: 30 },
      { count: 2, kind: 'gold', amount: 45 },
      { count: 2, kind: 'gold', amount: 80 },
      { count: 2, kind: 'gold', amount: 80 },
      { count: 2, kind: 'potion', id: 'potion_xl' }
    ],
    maxPerFloor: 2,      /* 护栏：每层奖励点 ≤2 处 */
    minSpawnDist: 5,     /* 距出生点至少 5 步（不是一落地就白拿） */
    minStairDist: 3      /* 与下行梯 / Boss 至少隔 3 步（不许贴楼梯白拿） */
  };

  /* D-58：宝箱布置参数（只改"放在哪"，不改宝箱数量、金币/道具池与任何数值）。
   *   boundRate  普通宝箱落在怪物附近的概率（设计值 65%，实际比例由 50 种子实测回报）
   *   bindRadius "附近"的定义：与怪物的曼哈顿距离 ≤ 2 格（不含怪物本格）
   * 密室宝箱（room_chest）不属于普通宝箱，固定留在密室里，不计入绑怪比例。 */
  Game.Data.CHEST_PLACEMENT = {
    boundRate: 0.65,
    bindRadius: 2
  };

  /* D-43：宝箱道具池（数据化）——takeDecor 从这里抽取，验证页可整体换回改前池做负例。
   * 改前（D-42）：chest = [potion_small, sword_bone, armor_leather]；
   *               room_chest = [potion_small, sword_bone, armor_leather, scroll_upgrade]。
   * 现在把药水权重调高并把小血瓶换成大/特大盘，属于"宝箱出药水的概率与数量"这一条补给线。 */
  Game.Data.CHEST_LOOT = {
    chest: ['potion_large', 'potion_large', 'potion_small', 'sword_bone', 'armor_leather'],
    room_chest: ['potion_xl', 'potion_large', 'sword_bone', 'armor_leather', 'scroll_upgrade']
  };

  /* S-05：特殊房间（密室）——每层最多 1 间，F2 起出现；房内只放 1 个密室宝箱与 2 个火把，
   * 不放陷阱、不放普通装饰、不放楼梯；单扇门与主迷宫相连，生成后必须通过可达性校验 */
  Game.Data.ROOMS = {
    startFloor: 2,          /* 从第 2 层开始出现 */
    minW: 4, maxW: 6,       /* 房间内部宽（含边界墙外的可用区） */
    minH: 3, maxH: 4,       /* 房间内部高 */
    tries: 40,              /* 找封闭空区的最大尝试次数 */
    safeRadius: 7,          /* 房间中心与出生点的曼哈顿距离下限（避免一出生白拿厚赏） */
    roomChestGoldMul: 2.5,  /* 密室宝箱金币倍率（普通宝箱为 1） */
    roomChestMin: 1         /* 每间房恰好 1 个密室宝箱 */
  };

  /* S-04：陷阱定义——踩中即触发一次，触发后该格永久显现（seen=true）且不再伤人
   * spike：伤害 = 当前 HP 8%，全层上限 30（F1 单次 ≤15），并附带流血
   * gas：不直接扣血，施加中毒（3 回合 × -2 HP/回合） */
  Game.Data.TRAPS = {
    spike: { id: 'spike', name: '地刺', dmgPct: 0.08, dmgCap30: 30, dmgCap1: 15, status: 'bleed', turns: 2 },
    gas:   { id: 'gas',   name: '毒气', dmgPct: 0, status: 'poison', turns: 3 }
  };

  /* S-04：状态效果——只作用于玩家；每「回合」（探索走一步 / 战斗行动一次）结算一次，
   * tickDmg 直接扣 HP，回合数归零即移除。不写入 ITEMS/MONSTERS，不影响 Boss 狂暴 */
  Game.Data.STATUS = {
    bleed:  { id: 'bleed',  name: '流血', tickDmg: 3, color: '#ef4444' },
    poison: { id: 'poison', name: '中毒', tickDmg: 2, color: '#84cc16' }
  };

  /* S-04：陷阱放置参数——每层 3~6 个，出生点 3 格内不放，F1 只放地刺 */
  Game.Data.TRAP_PLACEMENT = {
    min: 3, max: 6, safeRadius: 3,
    firstFloorOnly: 'spike',
    gasRate: 0.45 /* F2 起每个陷阱为毒气的概率 */
  };
})();
