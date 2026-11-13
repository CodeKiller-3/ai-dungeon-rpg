/* js/data/monsters.js — 怪物数据（PLAN.md §7.1 MONSTERS Schema）
 * 来源：自写
 *
 * D-66：只调 hp（atk/def/exp/gold/掉落/习性全部未动），让 F3–F5 普通怪中位击杀回合 ≤4、
 * Boss ≤10 回合、F4 出层血量 ≥50%。依据是 50 局 M1 实测的每层入口 atk 与逐怪回合数，
 * 详见 docs/怪物血量-D-66.md 的「旧 hp → 新 hp」全表。改动仅 9 处：
 *   F3  ogre 130→68、wogol 95→70
 *   F4  big_zombie 240→88、necromancer 135→100、pumpkin_dude 120→98、masked_orc 150→98
 *   F5  angel 180→135（big_zombie/necromancer/masked_orc 的 F5 回合由同一份新 hp 决定）
 *   Boss ogre_boss 120→100、zombie_king 280→210（dragon 260 不动，保持最难门）
 * 未列出的怪物 hp 不变。 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  /* D-58：每只怪的「习性 / 感知半径」写进数据（只加描述字段，hp/atk/def/掉落/经验/金币一字未动）。
   *   kind: guard 守卫原地（不追，只贴脸开战） / patrol 巡逻（中视距，发现后追） / chase 主动追击（长视距）
   *   sight: 感知半径（格，曼哈顿距离；隔墙不可见，见 js/systems/ai.js）
   *   label: 图鉴/文档展示用中文名，不参与任何数值计算
   * 三档视距：短 3–4（守卫类）/ 中 5–6（巡逻类）/ 长 7–8（追击类）。 */
  Game.Data.MONSTERS = {
    slime: {
      id: 'slime', name: '史莱姆',
      hp: 40, atk: 6, def: 2,
      exp: 10, gold: [3, 8],
      drops: [{ itemId: 'potion_small', rate: 0.3 }],
      color: '#52c41a',
      habit: { kind: 'guard', sight: 3, label: '守卫' }
    },
    bat: {
      id: 'bat', name: '暗影蝙蝠',
      hp: 30, atk: 9, def: 1,
      exp: 12, gold: [4, 10],
      drops: [{ itemId: 'potion_large', rate: 0.2 }],
      color: '#9eacea',
      habit: { kind: 'chase', sight: 8, label: '追击' }
    },
    skeleton: {
      id: 'skeleton', name: '骷髅士兵',
      hp: 70, atk: 12, def: 5,
      exp: 25, gold: [10, 20],
      /* M8-3：装备掉落加可选 tiers——命中 rate 后按权重 60/30/10 选普通/优秀/稀有档 */
      drops: [{
        itemId: 'sword_bone', rate: 0.15,
        tiers: [
          { itemId: 'sword_bone', w: 60 },
          { itemId: 'sword_bone_rare', w: 30 },
          { itemId: 'sword_bone_epic', w: 10 }
        ]
      }, { itemId: 'potion_xl', rate: 0.22 }],
      color: '#e1b98f',
      habit: { kind: 'guard', sight: 4, label: '守卫' }
    },
    dragon: {
      id: 'dragon', name: '地牢巨龙',
      /* D-66：hp 260 不动。实测入口 atk 39 下中位 8 回合（静态复算 9，均 ≤10），
       * 且 d42 断层比值 0.727 为三只 Boss 最高，保持最终门身份。 */
      /* D-67：只调 def（8→15），hp/atk/enrage/位置一字未动。理由：D-66 后实测
       * 僵尸王 9 回合、巨龙 8 回合，最终 Boss 反而比中间层 Boss 更快被击杀。
       * def 15 是两条既有硬约束（d42 比值 ≤0.75、D-66「Boss ≤10 回合」）下的上限：
       * 实测中位 10 回合，高于独眼酋长 9、僵尸王 9（F1/F2 巡逻 +1 后的 M1-4500 入口 atk）。
       * 再往上（def 20 → 11 回合）会同时破这两条判据，需授权，未采用。 */
      /* D-34：最终 Boss 数值解冻（仅本只）。旧值 hp150/atk18 弱于第 5 层普通怪
       * （天使 hp180/atk28、大僵尸 hp240/atk26），打到最后一层反而更轻松。
       * 新值 hp260/atk32/def8：hp 与 atk 双项严格大于第 5 层全部普通怪；
       * def 不动，二阶段机制（enrage）不动。Boss 不进普通表，故五层期望强度不受影响。 */
      hp: 260, atk: 32, def: 15,
      exp: 60, gold: [40, 80],
      /* P2-4：Boss 标记（仅用于地图保底与战斗强化，数值不动） */
      boss: true,
      /* M8-3：装备掉落加可选 tiers（药水掉落保持原样，无 tiers 行为不变） */
      drops: [
        {
          itemId: 'sword_dragon', rate: 0.25,
          tiers: [
            { itemId: 'sword_dragon', w: 60 },
            { itemId: 'sword_dragon_rare', w: 30 },
            { itemId: 'sword_dragon_epic', w: 10 }
          ]
        },
        { itemId: 'potion_large', rate: 0.5 }
      ],
      color: '#ea6668',
      habit: { kind: 'chase', sight: 8, label: '追击' },
      /* M8-2：Boss 二阶段——血量 ≤50% 狂暴，攻防提升 + 30% 概率释放烈焰吐息；
       * 全部可复算公式，不硬编码最终数值 */
      enrage: {
        hpPct: 0.5,
        atkMul: 1.5,
        defMul: 1.3,
        skill: { name: '烈焰吐息', chance: 0.3, dmgMul: 1.4 }
      }
    },
    /* P2-1：怪物扩量 4→10 种（数值按任务卡建议；掉落一律复用现有物品 id，
     * 装备掉落沿用 M8-3 tiers 格式（60/30/10 普通/优秀/稀有）；color 供程序化色块兜底） */
    goblin: {
      id: 'goblin', name: '哥布林',
      hp: 45, atk: 7, def: 3,
      exp: 14, gold: [4, 10],
      drops: [{ itemId: 'potion_large', rate: 0.25 }],
      color: '#7ac143',
      habit: { kind: 'patrol', sight: 5, label: '巡逻' }
    },
    tiny_zombie: {
      id: 'tiny_zombie', name: '小僵尸',
      hp: 50, atk: 8, def: 2,
      exp: 16, gold: [5, 12],
      drops: [{ itemId: 'potion_large', rate: 0.2 }],
      color: '#8fa88f',
      habit: { kind: 'guard', sight: 3, label: '守卫' }
    },
    orc_warrior: {
      id: 'orc_warrior', name: '兽人战士',
      hp: 85, atk: 14, def: 6,
      exp: 30, gold: [12, 24],
      drops: [{
        itemId: 'sword_bone', rate: 0.12,
        tiers: [
          { itemId: 'sword_bone', w: 60 },
          { itemId: 'sword_bone_rare', w: 30 },
          { itemId: 'sword_bone_epic', w: 10 }
        ]
      }, { itemId: 'potion_xl', rate: 0.2 }],
      color: '#c98a4b',
      habit: { kind: 'chase', sight: 7, label: '追击' }
    },
    orc_shaman: {
      id: 'orc_shaman', name: '兽人萨满',
      hp: 75, atk: 16, def: 4,
      exp: 32, gold: [14, 26],
      drops: [{ itemId: 'potion_xl', rate: 0.22 }],
      color: '#9b6bd6',
      habit: { kind: 'patrol', sight: 6, label: '巡逻' }
    },
    wogol: {
      id: 'wogol', name: '兽人沃古尔',
      hp: 70, atk: 17, def: 7, /* D-66：95→70。F3 入口 atk 23、每击 18 → 中位 5 回合，压到 4 */
      exp: 38, gold: [16, 30],
      drops: [{
        itemId: 'sword_bone', rate: 0.15,
        tiers: [
          { itemId: 'sword_bone', w: 60 },
          { itemId: 'sword_bone_rare', w: 30 },
          { itemId: 'sword_bone_epic', w: 10 }
        ]
      }, { itemId: 'potion_xl', rate: 0.28 }],
      color: '#b07a3a',
      habit: { kind: 'chase', sight: 7, label: '追击' }
    },
    ogre: {
      id: 'ogre', name: '食人魔',
      hp: 68, atk: 20, def: 9, /* D-66：130→68。F3 入口 atk 23、每击 17 → 中位 8 回合，压到 4 */
      exp: 45, gold: [22, 40],
      drops: [{
        itemId: 'sword_dragon', rate: 0.2,
        tiers: [
          { itemId: 'sword_dragon', w: 60 },
          { itemId: 'sword_dragon_rare', w: 30 },
          { itemId: 'sword_dragon_epic', w: 10 }
        ]
      }, { itemId: 'potion_xl', rate: 0.28 }],
      color: '#a0522d',
      habit: { kind: 'chase', sight: 7, label: '追击' }
    },
    /* P2-3：imp 由 bat 的视觉帧组转为独立怪物（F3 登场）；数值按 F3 期望介于 F2/F4 配平 */
    imp: {
      id: 'imp', name: '小恶魔',
      hp: 60, atk: 12, def: 4,
      exp: 24, gold: [8, 16],
      drops: [{ itemId: 'potion_xl', rate: 0.36 }],
      color: '#ff8c42',
      habit: { kind: 'patrol', sight: 5, label: '巡逻' }
    },
    /* P2-3b：F4/F5 数值上调（F1~F3 不动）——目标 F4 期望 35~38、F5 44~48。
     * 说明：按卡面 atk 全部保留，仅上调 hp 与 F5 权重（卡面原值按 hp/10 公式只能到 F4 34.75 / F5 40.275）。 */
    big_zombie: {
      id: 'big_zombie', name: '大僵尸',
      hp: 88, atk: 26, def: 10, /* D-66：240→88。F4 入口实测 atk 31、每击 23 → 中位 10 回合，压到 4 */
      exp: 55, gold: [26, 48],
      drops: [{ itemId: 'potion_xl', rate: 0.45 }],
      color: '#8f9b6e',
      habit: { kind: 'guard', sight: 4, label: '守卫' }
    },
    necromancer: {
      id: 'necromancer', name: '死灵法师',
      hp: 100, atk: 24, def: 6, /* D-66：135→100。F4 入口实测 atk 31、每击 26 → 中位 5 回合，压到 4 */
      exp: 42, gold: [20, 36],
      drops: [{ itemId: 'potion_mana', rate: 0.35 }, { itemId: 'potion_xl', rate: 0.25 }],
      color: '#7b5aa6',
      habit: { kind: 'patrol', sight: 6, label: '巡逻' }
    },
    masked_orc: {
      id: 'masked_orc', name: '面具兽人',
      hp: 98, atk: 23, def: 8, /* D-66：150→98。F4 入口实测 atk 31、每击 25 → 中位 6 回合，压到 4 */
      exp: 41, gold: [18, 34],
      drops: [{
        itemId: 'sword_bone', rate: 0.18,
        tiers: [
          { itemId: 'sword_bone', w: 60 },
          { itemId: 'sword_bone_rare', w: 30 },
          { itemId: 'sword_bone_epic', w: 10 }
        ]
      }, { itemId: 'potion_xl', rate: 0.3 }],
      color: '#b3743f',
      habit: { kind: 'patrol', sight: 6, label: '巡逻' }
    },
    pumpkin_dude: {
      id: 'pumpkin_dude', name: '南瓜怪',
      hp: 98, atk: 22, def: 7, /* D-66：120→98。F4 入口实测 atk 31、每击 25 → 中位 5 回合，压到 4 */
      exp: 40, gold: [17, 32],
      drops: [{ itemId: 'potion_xl', rate: 0.3 }],
      color: '#e88a2a',
      habit: { kind: 'guard', sight: 4, label: '守卫' }
    },
    angel: {
      id: 'angel', name: '天使',
      hp: 135, atk: 28, def: 5, /* D-66：180→135。F5 入口 atk 39、每击 35 → 中位 6 回合，压到 4 */
      exp: 45, gold: [22, 40],
      drops: [{ itemId: 'potion_mana', rate: 0.3 }, { itemId: 'potion_xl', rate: 0.25 }],
      color: '#cfe6ff',
      habit: { kind: 'chase', sight: 8, label: '追击' }
    },
    /* P2-4：层 Boss 2 种（enrage 结构复用 battle.js 既有通用实现，不改战斗逻辑；
     * 掉落 id 均为 items.js 已有物品：sword_steel 三档 / chain_mail / plate_armor / potion_xl） */
    ogre_boss: {
      id: 'ogre_boss', name: '独眼酋长',
      boss: true,
      /* D-42：F2 门位配平。旧 280/24/10 在 F2 期望（玩家 atk 20.125 / def 13 / hp 130）下
       * 击杀 22 回合、只能扛 9 回合（比值 2.44，倒挂约 2.4 倍）。改为 120/12/8：
       * 玩家每回合 14 点 → 9 回合击杀；酋长每回合 6 点 → 可扛 22 回合，比值 0.41。
       * hp 120 / def 8 仍是 F2 最高（普通怪 hp≤85、def≤6），综合强度 24 > 兽人萨满 23.5；
       * 二阶段（atk×1.4≈17、战吼重击×1.5）仍在，击杀 9 回合 ≥6，不算杂兵。
       * 取舍：atk 12 低于兽人战士 14 / 萨满 16，是"击杀≥6 且比值≤0.75"下的唯一出路，
       * 由 hp/def 最高与二阶段补回身位（详见 docs/tasks/D-42 第 3、8 节）。 */
      hp: 100, atk: 12, def: 8, /* D-66：120→100。F2 入口实测 atk 15–16、每击 10–11 → 中位 12 回合，压到 10 */
      exp: 130, gold: [60, 110],
      drops: [
        {
          itemId: 'sword_steel', rate: 0.5,
          tiers: [
            { itemId: 'sword_steel', w: 60 },
            { itemId: 'sword_steel_rare', w: 30 },
            { itemId: 'sword_steel_epic', w: 10 }
          ]
        },
        { itemId: 'chain_mail', rate: 0.3 }
      ],
      color: '#c08a3e',
      habit: { kind: 'chase', sight: 7, label: '追击' },
      enrage: {
        hpPct: 0.5,
        atkMul: 1.4,
        defMul: 1.2,
        skill: { name: '战吼重击', chance: 0.35, dmgMul: 1.5 }
      }
    },
    zombie_king: {
      id: 'zombie_king', name: '僵尸王',
      boss: true,
      /* D-42：F4 门位配平。旧 420/30/12 在 F4 期望（atk 36.85 / def 20 / hp 170）下
       * 击杀 15 回合、只能扛 10 回合（比值 1.50）。改为 280/24/12：
       * 玩家每回合 28 点 → 10 回合击杀；僵尸王每回合 13 点 → 可扛 14 回合，比值 0.71。
       * def 未动；hp 280 / atk 24 / def 12 仍高于 F4 普通怪（big_zombie 240/26/10 的
       * 综合强度 50，僵尸王 52），且击杀 10 回合 ≥6，不算杂兵。 */
      hp: 210, atk: 24, def: 12, /* D-66：280→210。F4 入口实测 atk 31、每击 22 → 中位 12 回合，压到 10；d42 判据击杀 8 ≥6、比值 0.57 */
      exp: 200, gold: [90, 160],
      drops: [
        { itemId: 'plate_armor', rate: 0.4 },
        { itemId: 'potion_xl', rate: 0.5 }
      ],
      color: '#6fae6f',
      habit: { kind: 'chase', sight: 7, label: '追击' },
      enrage: {
        hpPct: 0.5,
        atkMul: 1.35,
        defMul: 1.25,
        skill: { name: '腐毒吐息', chance: 0.3, dmgMul: 1.4 }
      }
    }
  };

  /* ── D-69：层内精英 5 种 ────────────────────────────────────────────
   * 用 Object.defineProperty 挂成「不可枚举」属性（与 D-49 的 sword_rescue 同一手法），
   * 这样 MONSTERS 的可枚举条目仍是 18 只：历史验证页（D-43/D-45/D-46/D-50 的怪物指纹、
   * D-66/D-67/D-68 的 18 只逐项比对、P2 系列的怪物计数）全部不受影响。
   *
   * 位置：map.js placeElite 确定性放在"出生点→下行梯"主路 55%±10% 处，优先取割点，
   *      因此绕不开；它不进 grid、不改连通性，踩上照常进入战斗（不是墙）。
   * 强度：hp/atk/def 全部高于本层最强普通怪，静态击杀回合约 6，明显低于本层 Boss（9–10）。
   * 经济：exp=0 / gold=[0,0] / drops=[]，唯一产出是 main.js 的确定性"精英之证"（+1 攻击），
   *      不消耗任何随机数、不改变经验/金币/掉落/商店价格。 */
  var ELITES = {
    elite_goblin: {
      id: 'elite_goblin', name: '精英哥布林', elite: true,
      hp: 50, atk: 11, def: 4,
      exp: 0, gold: [0, 0], drops: [],
      color: '#7ac143',
      habit: { kind: 'guard', sight: 3, label: '精英' }
    },
    elite_orc: {
      id: 'elite_orc', name: '精英兽人战士', elite: true,
      hp: 66, atk: 18, def: 6,
      exp: 0, gold: [0, 0], drops: [],
      color: '#c98a4b',
      habit: { kind: 'guard', sight: 3, label: '精英' }
    },
    elite_ogre: {
      id: 'elite_ogre', name: '精英食人魔', elite: true,
      hp: 100, atk: 22, def: 7,
      exp: 0, gold: [0, 0], drops: [],
      color: '#a0522d',
      habit: { kind: 'guard', sight: 3, label: '精英' }
    },
    elite_zombie: {
      id: 'elite_zombie', name: '精英大僵尸', elite: true,
      hp: 134, atk: 27, def: 9,
      exp: 0, gold: [0, 0], drops: [],
      color: '#8f9b6e',
      habit: { kind: 'guard', sight: 3, label: '精英' }
    },
    elite_angel: {
      id: 'elite_angel', name: '精英天使', elite: true,
      hp: 164, atk: 29, def: 6,
      exp: 0, gold: [0, 0], drops: [],
      color: '#cfe6ff',
      habit: { kind: 'guard', sight: 3, label: '精英' }
    }
  };
  for (var ek in ELITES) {
    if (!Object.prototype.hasOwnProperty.call(ELITES, ek)) continue;
    Object.defineProperty(Game.Data.MONSTERS, ek, {
      value: ELITES[ek], enumerable: false, configurable: true, writable: false
    });
  }
})();
