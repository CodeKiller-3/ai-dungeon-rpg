/* js/data/config.js — 运行时配置
 * deepseekKey：填入 DeepSeek API Key 后启用在线 NPC 对话（本地使用，勿提交真实 Key）
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Data = Game.Data || {};

  Game.Data.CONFIG = {
    deepseekKey: ''
  };

  /* D-65：玩家成长曲线的**唯一定义处**（升级增益 + 经验基数）。
   * 三处消费方（inventory.recalcEquip / battle.checkLevelUp / save.load 兜底）都只读这里，
   * 不再各自写 10+(lv-1) / 5+(lv-1) / 100+(lv-1)*10。
   *
   * statsAt(level)：L1 基础值 + 升到 2..level 时每一级的档位增益（整数，逐级累加）；
   * expToNext(level)：经验基数 × 当前等级，L1–4 用 early，L5+ 用 late（D-41 的分段保留）。
   *
   * D-65 新曲线（原为全程 +1 atk / +1 def / +10 maxHp）：
   *   L2–6  +1 atk / +1 def / +10 maxHp（F1–F2，保持早期节奏）
   *   L7–8  +2 atk / +1 def / +10 maxHp（F3–F4，本卡要抬的两层）
   *   L9+   +3 atk / +3 def / +10 maxHp（F5 前的终局段）
   * 经验基数不变（15 / 60）——实测证明只靠增益档位就能把 F3/F4 出层面板抬到 D-63 目标；
   * 动经验基数会把等级抬得更高、maxHp 溢出更多，属于没有收益的副作用。
   *
   * GROWTH_LEGACY 是 D-65 之前的曲线，只给历史基线页在 M.init 前钉回用；
   * 正常游戏不引用，也不参与任何断言放宽。 */
  function makeGrowthCurve(cfg) {
    var curve = {
      base: cfg.base,
      tiers: cfg.tiers,
      /* M1（D-84 C-2）：满级觉醒——某一级除当级档位外再叠一次突破增益。
       * 只有主曲线有；LEGACY 不传该字段，因此历史基线页拿不到任何突破。 */
      milestones: cfg.milestones || null,
      lastStep: cfg.lastStep || null,
      expBase: cfg.expBase,
      tierAt: function (lv) {
        for (var i = 0; i < cfg.tiers.length; i++) {
          var t = cfg.tiers[i];
          if (lv >= t.from && lv <= t.to) return t;
        }
        return null;
      },
      statsAt: function (level) {
        var lv = (typeof level === 'number' && level >= 1) ? Math.floor(level) : 1;
        var s = { atk: cfg.base.atk, def: cfg.base.def, maxHp: cfg.base.maxHp, maxMp: cfg.base.maxMp };
        for (var i = 2; i <= lv; i++) {
          var t = curve.tierAt(i);
          if (t) { s.atk += t.atk; s.def += t.def; s.maxHp += t.maxHp; s.maxMp += (t.maxMp || 0); }
          var ms = curve.milestones && curve.milestones[i];
          if (ms) {
            s.atk += ms.atk || 0; s.def += ms.def || 0;
            s.maxHp += ms.maxHp || 0; s.maxMp += ms.maxMp || 0;
          }
        }
        return s;
      },
      expToNext: function (level) {
        var lv = (typeof level === 'number' && level >= 1) ? Math.floor(level) : 1;
        /* D-84 r3/r4/r5：只改最后两格——L10→L11 600→200（满级觉醒在 F5 尾段稳定触发）、
         * L11→L12 660→1400（累计到 L12 = 3850 > 含 expPct 的经验池上界约 3600，L12 封死）。
         * 其余等级仍按 base×level，全图经验池与升级曲线前 9 格一个字未动。 */
        if (cfg.lastStep && typeof cfg.lastStep[lv] === 'number') return cfg.lastStep[lv];
        var b = (lv < cfg.expBase.split) ? cfg.expBase.early : cfg.expBase.late;
        return b * lv;
      }
    };
    return curve;
  }

  Game.Data.GROWTH = makeGrowthCurve({
    base: { atk: 10, def: 5, maxHp: 100, maxMp: 50 },
    tiers: [
      { from: 2, to: 6, atk: 1, def: 1, maxHp: 10, maxMp: 0 },
      { from: 7, to: 8, atk: 2, def: 1, maxHp: 10, maxMp: 0 },
      { from: 9, to: 10, atk: 3, def: 3, maxHp: 10, maxMp: 0 },
      { from: 11, to: 99, atk: 3, def: 3, maxHp: 10, maxMp: 0 }
    ],
    /* M1：L10 与现状一致（25/18/190），突破落在 L11——满级觉醒 +9/+4/+20 → 37/25/220。
     * 时点理由：F4 出层已实测到 L10，放 L10 等于把高潮埋进 F4（见下发卡 §4.3）。 */
    milestones: { 11: { atk: 9, def: 4, maxHp: 20 } },
    lastStep: { 10: 200, 11: 1400 },
    expBase: { early: 15, late: 60, split: 5 }
  });

  Game.Data.GROWTH_LEGACY = makeGrowthCurve({
    base: { atk: 10, def: 5, maxHp: 100, maxMp: 50 },
    tiers: [{ from: 2, to: 99, atk: 1, def: 1, maxHp: 10, maxMp: 0 }],
    expBase: { early: 15, late: 60, split: 5 }
  });
})();
