/* preflight/lib/monster_hp_legacy.js — D-66/D-67 历史验证页的怪物数值快照（只读测试夹具，不进游戏）
 *
 * 背景：D-66 按爽感验收重排了 9 只怪的 hp（详见 docs/怪物血量-D-66.md）；D-67 把最终 Boss
 * 巨龙的 def 由 8 调到 15（详见 docs/难度收口-D-67.md）。历史验证卡的断言与期望值成卡时
 * 绑定的是当时的数值，本卡不改历史卡正文，因此在这些页面里加载本文件并调用
 * pinMonsterHpLegacy() / pinMonsterDefLegacy()，把对应字段写回旧值后再跑断言。
 *
 * 约束：
 *   - pinMonsterHpLegacy 只覆盖 hp；pinMonsterDefLegacy 只覆盖 dragon.def；
 *     atk/exp/掉落/习性/成长/地图一概不碰。
 *   - 只有 preflight 页面会加载它；index.html 的游戏运行时不含本文件。
 *   - 值来源：git HEAD（D-65 末 / D-66 末）的 js/data/monsters.js 逐项抄录。
 * 回滚：删除各历史页对它的引用即可（D-66/D-67 的 live 值不受影响）。
 */
(function () {
  'use strict';
  var LEGACY_HP = {
    slime: 40,
    bat: 30,
    skeleton: 70,
    dragon: 260,
    goblin: 45,
    tiny_zombie: 50,
    orc_warrior: 85,
    orc_shaman: 75,
    wogol: 95,
    ogre: 130,
    imp: 60,
    big_zombie: 240,
    necromancer: 135,
    masked_orc: 150,
    pumpkin_dude: 120,
    angel: 180,
    ogre_boss: 120,
    zombie_king: 280
  };

  window.MONSTER_HP_LEGACY = LEGACY_HP;

  window.pinMonsterHpLegacy = function () {
    var M = window.Game && window.Game.Data && window.Game.Data.MONSTERS;
    if (!M) return false;
    var n = 0;
    for (var k in LEGACY_HP) {
      if (!Object.prototype.hasOwnProperty.call(LEGACY_HP, k)) continue;
      if (M[k] && typeof M[k].hp === 'number') { M[k].hp = LEGACY_HP[k]; n++; }
    }
    return n === 18;
  };

  /* D-67：巨龙 def 快照。D-42 定档时 dragon.def = 8（enrage 后 10），D-67 改为 15。
   * 历史页（d34/d41/d42/d43/d45/d46/d50/m8_2/m8_6/d66）的复算与断言绑定 def 8，
   * 这里钉回去；D-67 自己的验收见 verify_d67（读 live 值）。 */
  var LEGACY_DEF = { dragon: 8 };
  window.MONSTER_DEF_LEGACY = LEGACY_DEF;
  window.pinMonsterDefLegacy = function () {
    var M = window.Game && window.Game.Data && window.Game.Data.MONSTERS;
    if (!M) return false;
    var n = 0;
    for (var k in LEGACY_DEF) {
      if (!Object.prototype.hasOwnProperty.call(LEGACY_DEF, k)) continue;
      if (M[k] && typeof M[k].def === 'number') { M[k].def = LEGACY_DEF[k]; n++; }
    }
    return n === 1;
  };
})();
