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
    /* S-03：装备强化等级表 { itemId: 0..5 }；按物品 id 记，换装后旧装备保留强化 */
    upg: {},
    /* S-04：状态效果 { bleed: 回合, poison: 回合 }；只作用于玩家，回合数归零即移除 */
    status: {},
    quests: {},
    /* D-49：自适应救援记录（旧档由 save.js 补默认；全部随本档保存，不另开键） */
    adaptive: { deaths: {}, triggers: 0, spent: 0, log: [], trace: [], gearGranted: false }
  };
  Game.Data.Player = player;

  /* D-27：起手武器——只给最弱的一把匕首（+1 攻击），不发护甲。
   * 只在新开档（无存档）与 restart() 两处发放；读档路径不调用，
   * 因此旧档 equipment.weapon 为 null 时不会凭空补发（不新增字段、不改存档键名）。
   * 发完立刻 recalcEquip，保证"装备栏"与"atk"从第一帧起一致（L1：10 → 11）。 */
  var START_WEAPON = 'knife';
  function giveStartingGear() {
    player.equipment = { weapon: START_WEAPON, armor: null };
    if (Game.Systems && Game.Systems.Inventory && typeof Game.Systems.Inventory.recalcEquip === 'function') {
      Game.Systems.Inventory.recalcEquip();
    } else {
      /* Inventory 未加载（极简验证页场景）：按 L1 基础值 + 匕首 1 点手算 */
      player.atk = 10 + (Game.Data.ITEMS[START_WEAPON].effect.atk || 0);
    }
  }

  /* UI 状态（背包/商店/任务） */
  var ui = { list: [], sel: 0, shopMode: 'buy' };

  /* ---------- D-48：首屏设置（只放既有开关） ----------
   * 三项全部对应已存在的运行时能力，不新造玩法配置：
   *   fx    → Game.Fx 的 off/low/high（D-16，战斗内 F 同源）
   *   muted → Game.Systems.Audio 静音开关（M9-4，K 键同源）
   *   zoom  → Render 自适应缩放的显式档位（2026-11 自适应缩放）
   * 持久化到一个独立键，不碰存档键 ai_dungeon_rpg_save_v1。 */
  var SETTINGS_KEY = 'aiDungeon_settings_v1';
  var FX_LEVELS = ['off', 'low', 'high'];
  var ZOOM_LEVELS = ['auto', '1', '1.25', '1.5'];
  var FX_LABEL = { off: '关', low: '低', high: '高' };
  var ZOOM_LABEL = { auto: '自动（自适应）', '1': '100%', '1.25': '125%', '1.5': '150%' };
  var settings = { fx: 'low', muted: false, zoom: 'auto', adaptive: true };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && FX_LEVELS.indexOf(d.fx) >= 0) settings.fx = d.fx;
      if (d) settings.muted = !!d.muted;
      if (d && ZOOM_LEVELS.indexOf(d.zoom) >= 0) settings.zoom = d.zoom;
      if (d) settings.adaptive = (d.adaptive === undefined) ? true : !!d.adaptive;
    } catch (e) { /* 存储损坏/禁用 → 保留默认 */ }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 降级 */ }
  }
  function applySettings() {
    if (Game.Fx && typeof Game.Fx.setLevel === 'function') Game.Fx.setLevel(settings.fx);
    var A = Game.Systems && Game.Systems.Audio;
    if (A && settings.muted && typeof A.setMuted === 'function') A.setMuted(true);
    var R = Game.Core && Game.Core.Render;
    if (R && typeof R.setScaleMode === 'function') R.setScaleMode(settings.zoom);
    var D = Game.Systems && Game.Systems.Adaptive;
    if (D && typeof D.setEnabled === 'function') D.setEnabled(settings.adaptive);
  }

  /* D-48：首屏是否显示。默认关闭（所有既有验证页/机器人页的 init() 行为不变）；
   * 只有 index.html 显式置 __AI_DUNGEON_MENU__，或用 ?skipmenu=1 / 全局跳过开关时才改变。 */
  function menuSkippedByEnv() {
    if (window.__AI_DUNGEON_SKIP_MENU__ === true) return true;
    try {
      if (/[?&]skipmenu=1(?:&|$)/.test(String(location.search || ''))) return true;
    } catch (e) { /* 非浏览器环境 */ }
    return false;
  }
  function shouldShowMenu(opts) {
    if (opts && opts.skipMenu === true) return false;
    if (menuSkippedByEnv()) return false;
    return !!(opts && opts.menu);
  }

  /* D-48：菜单运行期状态（页面/选中项/说明滚动），不落盘 */
  var menu = { page: 'root', sel: 0, settingsSel: 0, helpScroll: 0, confirmSel: 1, confirm: null };

  /* ---------- D-51：ESC 暂停面板 ----------
   * 只做"把游戏停下来"这层界面：不碰任何战斗/怪物/掉落/价格/经验/救援数值。
   * 真停的判据不是"盖了遮罩"，而是暂停期间 loop 在推进任何 update/tick/计时之前就 return：
   *   - 玩家移动/AI tick 不执行（_updateExplore 不调用）
   *   - 战斗时间轴不推进（Battle.tick 不调用）
   *   - 反馈/粒子/插值/提示条生命周期不推进
   * stoppedAt 记录最后一帧的 rAF 时间戳；恢复时把这段真实时长一次性补给 Battle 时钟偏移，
   * 于是未到点的怪物段/输入锁/回合收尾保留原剩余量，既不跳帧也不重复结算。 */
  var pause = {
    active: false,
    page: 'root',   /* root | settings | confirmAbandon | confirmClear */
    sel: 0,
    settingsSel: 0,
    confirmSel: 1,  /* 二次确认默认停在「确认」，仍需再按一次 Enter（第一次 Enter 只弹出提示） */
    stoppedAt: 0,
    wasPaused: false
  };
  var PAUSE_ITEMS = [
    { id: 'resume', label: '继续游戏' },
    { id: 'settings', label: '设置' },
    { id: 'menu', label: '返回主菜单' },
    { id: 'abandon', label: '放弃本局' }
  ];

  /* D-48：玩法说明正文——只写代码里确实存在的机制。
   * 每条都带 src（源码文件）与 need（必须字面出现的实现片段），验证页逐条对照；
   * 任何一条写了未实现功能，need 就对不上 → 验证失败。 */
  var HELP = [
    {
      id: 'move', title: '移动与交互',
      lines: ['方向键 / WASD 移动；踩到怪物即进入战斗。',
        'B 背包 · E 商店 · M 任务 · T 对话（需相邻）· Q 设置 · H 重看引导'],
      src: ['js/core/main.js'],
      need: ['KeyB', 'KeyE', 'KeyM', 'KeyT', 'KeyQ', 'KeyH']
    },
    {
      id: 'fireball', title: '火球',
      lines: ['战斗按 4 释放火球，消耗 12 MP、冷却 3 回合。'],
      src: ['js/core/main.js', 'js/data/skills.js'],
      need: ['Digit4', 'mpCost: 12', 'cd: 3']
    },
    {
      id: 'flee', title: '逃跑',
      lines: ['战斗按 3 逃跑；成功后退一格、怪物留在原地，失败会被反击。'],
      src: ['js/core/main.js', 'js/systems/battle.js'],
      need: ['Digit3', "cmd === 'run'", 'retreatAfterFlee']
    },
    {
      id: 'potion', title: '战斗内用药',
      lines: ['战斗中按 7 用药（优先回血）；探索中在背包按 Enter 使用。'],
      src: ['js/core/main.js', 'js/systems/battle.js'],
      need: ['Digit7', "cmd === 'item'", 'pickBattlePotion']
    },
    {
      id: 'equip', title: '装备与强化',
      lines: ['武器 / 护甲在背包按 Enter 装备；强化卷轴每级 +10%（向上取整），上限 +5。'],
      src: ['js/systems/inventory.js'],
      need: ['equip: function', 'Math.ceil(b * n * 0.1)', 'lv >= 5']
    },
    {
      id: 'bag', title: '背包与已装备标记',
      lines: ['背包行尾标出「已装备」，页头汇总当前武器 / 护甲。'],
      src: ['js/systems/modal.js'],
      need: ['已装备：', '已装备 1｜背包 ']
    },
    {
      id: 'shop', title: '商店买价高于卖价',
      lines: ['商店买价严格高于卖价（卖价约为买价一半）；已装备物品不能卖。'],
      src: ['js/systems/shop.js'],
      need: ['p.gold < item.price', 'p.gold += item.sell', '已装备，请先卸下']
    },
    {
      id: 'save', title: '存档',
      lines: ['自动存档：换层、开箱、战斗结束时；存档键 ai_dungeon_rpg_save_v1。'],
      src: ['js/systems/save.js', 'js/core/main.js'],
      need: ["var KEY = 'ai_dungeon_rpg_save_v1'", 'Game.Systems.Save.save()']
    }
  ];

  /* M9-5：本局开始时间戳（死亡结算"用时"；重新开始时重置） */
  var runStart = performance.now();

  /* ---------- D-52：本局结局统计 ----------
   * 只累加"运行期真实发生的事件"，不做任何估算：
   *   floorReached ← 每帧 syncHud 时取 max(当前层)
   *   kills        ← battle:end 且 result=win 的次数（onBattleEnd）
   *   maxLevel     ← 每帧 syncHud 时取 max(当前等级)
   *   turns        ← 探索成功走一格 + 战斗中被接受的行动各 +1
   *   potions      ← Inventory.use 成功喝下回血/回蓝药剂 +1（卷轴不算）
   *   rescues      ← player.adaptive.triggers（D-49/D-50 的真实触发计数）
   *   elapsedMs    ← getElapsedMs（D-51 已扣除暂停时长）
   * known=false 表示从"没有 run 字段的旧档"继续：未知字段保持 null，结局页不显示。 */
  var runStats = { known: true, floorReached: 1, kills: 0, maxLevel: 1, turns: 0, potions: 0 };
  var endingRecord = null; /* 通关结局记录（随存档保存；死亡/新局清空） */
  var lastDeath = null;    /* 最近一次 battle:end(lose) 的遥测副本 */
  var endingSel = 0;       /* 结局页按钮选中：0=再来一局 / 1=回主菜单 */

  function resetRunStats(known) {
    runStats = (known === false)
      ? { known: false, floorReached: null, kills: null, maxLevel: null, turns: null, potions: null }
      : { known: true, floorReached: 1, kills: 0, maxLevel: 1, turns: 0, potions: 0 };
    return runStats;
  }
  function bumpRunStat(key, v) {
    if (!runStats.known) return;
    if (typeof runStats[key] !== 'number' || !isFinite(runStats[key])) runStats[key] = v;
    else if (v > runStats[key]) runStats[key] = v;
  }
  function addRunStat(key) {
    if (!runStats.known) return;
    runStats[key] = (typeof runStats[key] === 'number' ? runStats[key] : 0) + 1;
  }

  /* D-52：评级（纯函数，权重写死在这里；验证页按同一公式复算）。
   *   score = 通关 1000 + 层数×120 + 击杀×6 + 最高等级×50 + 喝药×4
   *           − 救援×40 − 整分钟数×3，最低 0
   * 阈值：S ≥2200 / A ≥1700 / B ≥1300 / C ≥900 / D <900。
   * 统计不完整（旧档 continue）时返回 grade='—'，不编分数。 */
  var RATING_W = { win: 1000, floor: 120, kills: 6, level: 50, potion: 4, rescue: -40, minute: -3 };
  var RATING_T = [{ g: 'S', min: 2200 }, { g: 'A', min: 1700 }, { g: 'B', min: 1300 }, { g: 'C', min: 900 }];
  function gradeOfScore(score) {
    if (typeof score !== 'number' || !isFinite(score)) return '—';
    for (var j = 0; j < RATING_T.length; j++) {
      if (score >= RATING_T[j].min) return RATING_T[j].g;
    }
    return 'D';
  }
  function computeRating(stats, win) {
    var s = stats || {};
    var nums = [s.floorReached, s.kills, s.maxLevel, s.turns, s.potions, s.rescues, s.elapsedMs];
    for (var i = 0; i < nums.length; i++) {
      if (typeof nums[i] !== 'number' || !isFinite(nums[i])) {
        return { score: null, grade: '—', parts: null };
      }
    }
    var parts = {
      win: win ? RATING_W.win : 0,
      floor: Math.max(0, Math.floor(s.floorReached)) * RATING_W.floor,
      kills: Math.max(0, Math.floor(s.kills)) * RATING_W.kills,
      level: Math.max(0, Math.floor(s.maxLevel)) * RATING_W.level,
      potion: Math.max(0, Math.floor(s.potions)) * RATING_W.potion,
      rescue: Math.max(0, Math.floor(s.rescues)) * RATING_W.rescue,
      minute: Math.floor(Math.max(0, s.elapsedMs) / 60000) * RATING_W.minute
    };
    var sum = parts.win + parts.floor + parts.kills + parts.level + parts.potion + parts.rescue + parts.minute;
    var score = Math.max(0, Math.round(sum));
    return { score: score, grade: gradeOfScore(score), parts: parts };
  }
  /* 手改分数/评级必须被识破：按同一 stats 重算后逐项比对 */
  function verifyRating(stats, win, record) {
    var r = computeRating(stats, win);
    return !!(record && record.score === r.score && record.grade === r.grade);
  }

  /* D-52：结局页文本行（纯函数；缺字段就不显示，绝不用 0 冒充未知）。
   * 返回 [{key,text}]；验证页断言"有数据=显示（含 0）/ 无数据=整行不出现"。 */
  function fmtDuration(ms) {
    var secs = Math.max(0, Math.floor((typeof ms === 'number' ? ms : 0) / 1000));
    var mm = Math.floor(secs / 60), ss = secs % 60;
    return (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  }
  /* D-52：死因归类（纯函数）。口径与 D-38 一致：先看 death.source，
   * battle→被怪打死、trap→陷阱、other/status→状态效果；D-52 只在 other 下按 statusId
   * 细分为中毒/流血（statusId 是 Status.tick 已发生的事实，不是推断）。 */
  function deathCauseText(d) {
    if (!d) return '未知';
    if (d.source === 'battle') return d.monsterName ? ('被' + d.monsterName + '打死') : '被怪打死';
    if (d.source === 'trap') return d.trapName ? ('陷阱（' + d.trapName + '）') : '陷阱';
    if (d.source === 'other' || d.source === 'status') {
      if (d.statusId === 'poison') return '中毒';
      if (d.statusId === 'bleed') return '流血';
      return '状态效果';
    }
    return '未知';
  }
  function verifyDeathCause(d, label) { return deathCauseText(d) === label; }

  /* D-52：死亡时"离下一层还差什么"。只用死亡遥测里已经存在的真实值：
   *   · 背包回血药为 0 → 药
   *   · 战斗死亡且怪物还有血 → 回合（按玩家真实 atk、怪物真实 def 复算还要几回合）
   *   · 其余（陷阱/状态/无战斗数据）→ 血量（死亡时 0 HP 的事实）
   * 不接受"感觉"，每一条都能用 payload 数字复算。 */
  function dmgOf(atk, def) {
    var a = Math.max(Number(atk) || 0, 0), b = Math.max(Number(def) || 0, 0);
    if (a + b <= 0) return 1;
    return Math.max(1, Math.round(a * a / (a + b)));
  }
  function deathGap(d) {
    if (!d) return null;
    var potions = (typeof d.potionsLeft === 'number') ? d.potionsLeft : null;
    var rounds = null, per = null, left = null;
    if (d.source === 'battle' && typeof d.monsterHpLeft === 'number' && d.monsterHpLeft > 0) {
      left = d.monsterHpLeft;
      per = dmgOf(d.playerAtk, d.monsterDef);
      rounds = Math.ceil(left / per);
    }
    if (potions === 0) {
      return { kind: '药', rounds: rounds, text: '还差一瓶回血药（死亡时背包 0 瓶）' };
    }
    if (rounds !== null) {
      return {
        kind: '回合', rounds: rounds,
        text: '还差 ' + rounds + ' 回合（怪物剩 ' + left + ' HP，每回合约 ' + per + ' 伤害）'
      };
    }
    var maxHp = (typeof d.maxHp === 'number') ? String(d.maxHp) : '?';
    return { kind: '血量', rounds: null, text: '还差血量：死亡时 HP 0/' + maxHp + '，没能扛住最后一击' };
  }

  function endingLines(stats) {
    var s = stats || {};
    var out = [];
    if (typeof s.floorReached === 'number') out.push({ key: 'floor', text: '到达层数：第 ' + s.floorReached + ' 层' });
    if (typeof s.kills === 'number') out.push({ key: 'kills', text: '总击杀：' + s.kills + ' 只' });
    if (typeof s.maxLevel === 'number') out.push({ key: 'level', text: '最高等级：Lv.' + s.maxLevel });
    if (typeof s.turns === 'number') out.push({ key: 'turns', text: '总回合：' + s.turns });
    if (typeof s.potions === 'number') out.push({ key: 'potions', text: '喝掉药水：' + s.potions + ' 瓶' });
    if (typeof s.rescues === 'number') out.push({ key: 'rescues', text: '被救援：' + s.rescues + ' 次' });
    if (typeof s.elapsedMs === 'number') out.push({ key: 'time', text: '总耗时：' + fmtDuration(s.elapsedMs) });
    return out;
  }

  /* 修复 P1：移动节流。原实现每帧移动 1 格（60fps ≈ 60 格/秒），既难操控也违背 roguelike 手感。
   * 取 120ms/步（≈8.3 格/秒）：接近传统 roguelike 长按移动的节奏，且与 140ms 移动插值同量级。
   * 玩家与 AI 共用同一个"步"：每步只 tick 一次 AI（AI 内部 4 步一追击），
   * 保持原有"怪物约比玩家慢 4 倍"的相对关系，不改变战斗数值。 */
  var MOVE_INTERVAL = 120;
  var lastStepAt = -1e9; /* 首帧立即可走 */
  /* D-12：跟手修复——原实现把"节流窗口内的按键"整步丢弃（短按 80% 没反应）。
   * 现语义：新按下/换方向 → 立即走一格；同一方向按住 → 仍按 MOVE_INTERVAL 连发；
   * 节流只限制"按住连发"，不再丢任何一次按下。AI 节奏单独用 lastAiAt 维持 120ms，
   * 不随玩家按键频率变化（怪物相对速度不变）。 */
  var lastDir = null;
  var lastAiAt = -1e9;

  /* D-15：本次战斗的遭遇上下文。
   * 逃跑：按它把玩家后退一格、怪物留在原地；胜利：按它移除对应的那一只怪。
   * 只在这两种结算里消费一次，避免"逃跑删怪 → Boss 消失 → 本局无法通关"。 */
  var encounter = null;

  /* 修复：启动/读档期间禁止 floorChanged 自动写档。
   * 原流程 init 中 Map.generate() 先于 Save.load() 触发 map:floorChanged → Save.save()，
   * 会用默认新档覆盖磁盘旧档，导致读档永远读不到进度。 */
  var booting = true;

  /* M9-5：首次引导覆盖层（localStorage 键 aiDungeon_guided）
   * D-14：该标记只决定"是否首次自动弹出"，不再是"永远看不到引导"的唯一原因——
   *       探索中按 H、或点底部提示栏的「H 帮助」可随时重看，且重看不写任何新键。 */
  var GUIDE_KEY = 'aiDungeon_guided';
  function needsGuide() {
    try { return localStorage.getItem(GUIDE_KEY) === null; } catch (e) { return true; } /* 存储禁用→每局显示（降级） */
  }
  function markGuided() {
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) { /* 存储禁用降级 */ }
  }
  /* D-14：不再"任意键关闭"。只接受两种明确确认：Enter，或点击引导页上的确认按钮 */
  function guideConfirm(evt) {
    var M = Game.Core.Main;
    if (!M || !M._guideVisible || !evt) return;
    if (evt.type === 'keydown') {
      if (evt.key !== 'Enter' && evt.code !== 'Enter' && evt.code !== 'NumpadEnter') return;
    } else {
      var R = Game.Core && Game.Core.Render;
      var p = (R && typeof R.toLogical === 'function') ? R.toLogical(evt.clientX, evt.clientY) : null;
      var r = (R && typeof R._guideRect === 'function') ? R._guideRect() : null;
      if (!p || !r) return;
      if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) return;
    }
    if (typeof evt.preventDefault === 'function') evt.preventDefault();
    closeGuide();
  }
  function closeGuide() {
    var M = Game.Core.Main;
    if (!M || !M._guideVisible) return;
    M._guideVisible = false;
    markGuided();
    window.removeEventListener('keydown', guideConfirm);
    window.removeEventListener('click', guideConfirm);
    if (Game.Core && Game.Core.Input && typeof Game.Core.Input.clear === 'function') {
      Game.Core.Input.clear();
    }
  }
  /* D-14：随时重看（H 键 / 底部提示栏入口），不依赖存档状态、不落新键 */
  function openGuide() {
    var M = Game.Core.Main;
    if (!M || M._guideVisible) return;
    M._guideVisible = true;
    window.addEventListener('keydown', guideConfirm);
    window.addEventListener('click', guideConfirm);
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
    /* D-12：视野变化 = 静态图层（地板/墙/装饰/记忆覆盖）失效，下一帧重建离屏缓存。
     * 放在这里而不是每帧判断：FOV 只在移动/换层/读档后变化，重建频率与"步"一致（≈8/s）。 */
    if (Game.Core.Render && typeof Game.Core.Render.invalidateStatic === 'function') {
      Game.Core.Render.invalidateStatic();
    }
  }

  /* S3-2 HUD：汇总顶部信息栏数据。M8-1：MP 传真实 mp/maxMp（替换遗留 0/0 占位）；
     M8-6：等级 + 经验进度传给 HUD（expNext 按 60×level 公式）；
     kills/killTarget 由 hud.js 自行统计（battle:end 胜场 + map:floorChanged 重置），故不在此传 */
  function syncHud() {
    /* D-52：本局统计的最高层/最高等级——每帧取真实当前值，只进不退 */
    if (runStats.known) {
      bumpRunStat('floorReached', player.floor || 1);
      bumpRunStat('maxLevel', player.level || 1);
    }
    if (!Game.hud || !Game.hud.update) return;
    Game.hud.update({
      hp: player.hp, hpMax: player.maxHp,
      mp: player.mp, mpMax: player.maxMp,
      gold: player.gold,
      floor: player.floor,
      level: player.level,
      exp: player.exp,
      expNext: (Game.Systems.Battle && typeof Game.Systems.Battle.expToNext === 'function')
        ? Game.Systems.Battle.expToNext(player.level) : 60 * player.level,
      /* S-04：状态列表交给 HUD 画 chip（无状态为空数组，不占屏） */
      status: (Game.Systems.Status && typeof Game.Systems.Status.list === 'function')
        ? Game.Systems.Status.list() : []
    });
  }

  function onQuestComplete(evt) {
    Game.Core.EventBus.emit('audio:play', { sfx: 'quest' });
    Game.Core.EventBus.emit('ui:notice', { msg: '任务完成：+金币' + evt.reward.gold + ' +经验' + evt.reward.exp });
  }

  /* D-15：逃跑成功 → 玩家后退一格，怪物留在原地（绝不删除）。
   * 固定遭遇：退回踩怪前的格子；巡逻怪：沿背离方向退一格。
   * 退不动时保持原位，但给该巡逻怪一次短暂喘息，避免下一 tick 立刻重新贴脸。 */
  function retreatAfterFlee(enc) {
    var tx = player.x, ty = player.y;
    if (enc.kind === 'ambush') {
      tx = enc.fromX; ty = enc.fromY;
    } else {
      var dx = player.x - enc.x, dy = player.y - enc.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        tx = player.x + (dx >= 0 ? 1 : -1); ty = player.y;
      } else {
        tx = player.x; ty = player.y + (dy >= 0 ? 1 : -1);
      }
    }
    var canMove = Game.Systems.Map.isWalkable(tx, ty) && !(tx === enc.x && ty === enc.y);
    if (canMove) {
      var fx = player.x, fy = player.y;
      player.x = tx; player.y = ty;
      if (Game.Motion && typeof Game.Motion.setStep === 'function') {
        Game.Motion.setStep('player', fx, fy, tx, ty, 140);
      }
      refreshFov();
    }
    if (enc.kind === 'patrol' && Game.Systems.AI && typeof Game.Systems.AI.fleeStunAt === 'function') {
      Game.Systems.AI.fleeStunAt(enc.x, enc.y, 6);
    }
  }

  function onBattleEnd(evt) {
    /* D-15：先消费遭遇上下文——只有 win 才移除怪物；run 只后退 */
    var enc = encounter;
    encounter = null;
    if (enc && evt.result === 'win') {
      if (enc.kind === 'ambush') Game.Systems.Map.removeEnemyAt(enc.x, enc.y);
      else if (Game.Systems.AI && typeof Game.Systems.AI.removePatrolAt === 'function') {
        Game.Systems.AI.removePatrolAt(enc.x, enc.y);
      }
    } else if (enc && evt.result === 'run') {
      retreatAfterFlee(enc);
    }
    if (evt.result === 'win') {
      addRunStat('kills'); /* D-52：本局总击杀（每场胜利的真实次数） */
      Game.Systems.Quest.progress('kill', evt.monsterId);
      if (Game.Systems.Quest.isDone('main_clear_dragon')) {
        /* D-52：通关 → 结算统计 / 评级 / 结局存档，再切独立结局画面 */
        Game.Core.Main._commitVictory();
        return;
      }
    } else if (evt.result === 'lose') {
      /* D-52：死亡遥测只读副本（结局/死因页只认这一份，不现场猜） */
      lastDeath = evt;
      /* D-49：先让自适应系统决定是否兜底救援（复活 + 补给），能救就不走死亡结算。
       * 触发点固定在战斗结束的死亡结算，不在战斗回合中塞东西。 */
      var A = Game.Systems && Game.Systems.Adaptive;
      var rescue = (A && typeof A.onDeath === 'function') ? A.onDeath(player.floor) : null;
      if (rescue) {
        refreshFov();
        syncHud();
        Game.Systems.Save.save();
        Game.Core.Main.switchScene('explore');
        return;
      }
      Game.Core.Main._finalizeDeath(evt);
      return;
    }
    Game.Systems.Save.save();
    Game.Core.Main.switchScene('explore');
  }

  /* M5：巡逻怪贴脸 → 触发战斗 */
  function onAiEncounter(evt) {
    /* D-15：记录遭遇上下文（巡逻怪已在 evt 中带上坐标；战斗期间 AI 不 tick，坐标保持有效） */
    encounter = { kind: 'patrol', x: evt.x, y: evt.y, monsterId: evt.monsterId };
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
    /* D-51：暂停真停的计数器（只读埋点，不参与任何数值/顺序）。
     * steps 只在玩家真的移动一格时 +1；aiTicks 只在 AI.tick 真正被调用时 +1；
     * battleTicks 只在非暂停帧调用 Battle.tick 时 +1。验证页据此断言"暂停 3 秒后三类计数全部不变"。 */
    _stats: { steps: 0, aiTicks: 0, battleTicks: 0 },
    _guideVisible: false,  /* M9-5：首次引导覆盖层是否显示 */
    _guidePending: false,  /* D-48：首屏菜单期间挂起，进场景后再显示 */
    HELP: HELP,            /* D-48：玩法说明正文（验证页逐条对照源码） */

    init: function (opts) {
      var canvas = document.getElementById('game');
      var showMenu = shouldShowMenu(opts);
      Game.Core.Render.init(canvas);
      Game.Core.Input.bind();
      Game.Core.EventBus.on('battle:end', onBattleEnd);
      Game.Core.EventBus.on('map:floorChanged', onFloorChanged);
      Game.Core.EventBus.on('quest:complete', onQuestComplete);
      Game.Core.EventBus.on('ai:encounter', onAiEncounter);
      encounter = null; /* D-15：新一局不继承上一局的遭遇上下文 */
      Game.Systems.NPC.bind();
      Game.Systems.Audio.init();
      Game.Systems.Audio.bind();
      /* D-48：读取并立即应用首屏设置（默认值与原行为完全一致） */
      loadSettings();
      applySettings();
      if (Game.Core.Sprites) Game.Core.Sprites.load();
      this._lastT = performance.now();
      this._stats = { steps: 0, aiTicks: 0, battleTicks: 0 }; /* D-51：计数器新局归零 */
      /* D-51：暂停状态与战斗时间轴偏移一并复位（验证页会重复 init） */
      pause.active = false; pause.page = 'root'; pause.sel = 0; pause.settingsSel = 0;
      pause.confirmSel = 1; pause.stoppedAt = 0; pause.wasPaused = false;
      if (Game.Systems.Battle && typeof Game.Systems.Battle._resetClock === 'function') {
        Game.Systems.Battle._resetClock();
      }
      runStart = performance.now(); /* M9-5：计时起点 */
      /* D-52：本局统计/结局记录归零（旧档续玩时由 Save.load 恢复或标记 unknown） */
      resetRunStats(true);
      endingRecord = null;
      lastDeath = null;
      endingSel = 0;
      /* D-48：showMenu 时进入 menu 场景（不启动第二条循环，仍由 start() 唯一驱动）；
       * 其余情况保持原行为，直接进 explore。 */
      this.switchScene(showMenu ? 'menu' : 'explore');
      Game.Systems.Map.generate();
      Game.Systems.Quest.init();
      if (Game.Systems.NpcQuest && typeof Game.Systems.NpcQuest.init === 'function') {
        Game.Systems.NpcQuest.init();
      }
      resetPlayer();
      /* 读档：有存档则恢复进度；D-27 起手武器只发给"真正的新档"，旧档读入不补发 */
      var loaded = Game.Systems.Save.load();
      if (!loaded) giveStartingGear();
      booting = false; /* 启动/读档完成，恢复 floorChanged 自动写档 */
      refreshFov(); /* S3-1：初始视野（含读档后落点） */
      syncHud();    /* S3-2：初始顶部 HUD 数据 */
      /* D-48：首屏期间不弹提示/引导，等玩家真正进场景后再给 */
      var bootNotice = loaded ? ('已读取存档（楼层 ' + loaded.floor + '）') : '新冒险开始';
      if (!showMenu) {
        Game.Core.EventBus.emit('ui:notice', { msg: bootNotice });
      }
      /* M9-5：首次引导 + resize 监听（静默降级）；D-14：改为明确确认键关闭 */
      if (showMenu) {
        this._guidePending = needsGuide();
      } else {
        this._guideVisible = needsGuide();
        if (this._guideVisible) {
          window.addEventListener('keydown', guideConfirm);
          window.addEventListener('click', guideConfirm);
        }
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
      /* D-48：唯一 rAF 链守卫——菜单/场景切换都只是 loop 内部的分支，
       * 不允许任何路径再开第二条链；同一 rAF 实现下重复调用 start() 直接忽略。
       * 例外：验证页会先把 requestAnimationFrame 换成可控假实现再调 start()，
       * 此时宿主函数已变，允许重新绑定一条链（生产环境该函数恒定，不触发）。 */
      var raf = window.requestAnimationFrame;
      if (this._rafStarted && raf === this._rafFn) return false;
      this._rafFn = raf;
      this._rafStarted = true;
      this._rafChains = (this._rafChains || 0) + 1;
      requestAnimationFrame(function loop(ts) {
        /* D-11：单帧异常不得打断 rAF 链。
           旧实现把 requestAnimationFrame(loop) 放在 self.loop(ts) 之后，任意一帧
           抛错（绘制/更新/子模块）都会让下一帧永远不再注册——画面定格、输入全失效，
           只能刷新，正是真人反馈的“卡死”。这里捕获并记录后无条件续帧；
           正常路径（无异常）行为与耗时不变。 */
        try {
          self.loop(ts);
        } catch (e) {
          self._errorCount = (self._errorCount || 0) + 1;
          self._lastError = {
            msg: String((e && e.message) || e),
            stack: String((e && e.stack) || ''),
            scene: self._scene,
            at: Date.now()
          };
          if (self._errorCount === 1 && window.console && typeof console.error === 'function') {
            console.error('[Main.loop] 帧内异常已捕获，游戏继续运行：', e);
          }
        }
        requestAnimationFrame(loop);
      });
      return true;
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

    /* D-52：评级 / 死因 / 差距 / 结局文本——纯函数对外只读入口（验证页复算同一公式） */
    computeRating: computeRating,
    gradeOfScore: gradeOfScore,
    verifyRating: verifyRating,
    deathCauseText: deathCauseText,
    verifyDeathCause: verifyDeathCause,
    deathGap: deathGap,
    endingLines: endingLines,
    RATING_W: RATING_W,
    RATING_T: RATING_T,

    /* D-52：本局统计快照（含 elapsedMs；unknown 档保持 null，不补零） */
    getRunStats: function (win) {
      var rescues = (player.adaptive && typeof player.adaptive.triggers === 'number')
        ? player.adaptive.triggers : 0;
      if (!runStats.known) {
        return {
          known: false, floorReached: null, kills: null, maxLevel: null,
          turns: null, potions: null, rescues: rescues,
          elapsedMs: this.getElapsedMs(), win: !!win
        };
      }
      return {
        known: true,
        floorReached: runStats.floorReached,
        kills: runStats.kills,
        maxLevel: runStats.maxLevel,
        turns: runStats.turns,
        potions: runStats.potions,
        rescues: rescues,
        elapsedMs: this.getElapsedMs(),
        win: !!win
      };
    },
    /* D-52：只读埋点——探索成功走一格 / 战斗被接受的行动 / 喝下一瓶药 */
    _noteStep: function () { addRunStat('turns'); },
    _noteBattleTurn: function () { addRunStat('turns'); },
    _notePotion: function () { addRunStat('potions'); },
    _restoreRunStats: function (s) {
      if (s && s.known === true &&
          typeof s.floorReached === 'number' && typeof s.kills === 'number' &&
          typeof s.maxLevel === 'number' && typeof s.turns === 'number' &&
          typeof s.potions === 'number') {
        runStats = {
          known: true, floorReached: s.floorReached, kills: s.kills,
          maxLevel: s.maxLevel, turns: s.turns, potions: s.potions
        };
      } else {
        resetRunStats(false); /* 旧档没有 run 字段：未知，不估算 */
      }
      if (runStats.known) {
        bumpRunStat('floorReached', player.floor || 1);
        bumpRunStat('maxLevel', player.level || 1);
      }
      return runStats;
    },
    _restoreEnding: function (e) { endingRecord = (e && e.cleared === true) ? e : null; return endingRecord; },
    getEnding: function () { return endingRecord; },
    _endingForSave: function () { return endingRecord; },
    /* 结局页渲染数据（drawVictory 用；无记录时按当前运行期统计现场生成） */
    _endingSpec: function () {
      var e = endingRecord;
      var stats = (e && e.stats) ? e.stats : this.getRunStats(true);
      var score = (e && typeof e.score === 'number') ? e.score : null;
      var grade = (e && e.grade) ? e.grade : null;
      if (score === null || !grade) {
        var r = computeRating(stats, true);
        score = r.score; grade = r.grade;
      }
      return { stats: stats, score: score, grade: grade, lines: endingLines(stats), sel: endingSel };
    },
    _getEndingSel: function () { return endingSel; },

    /* D-52：通关结算——统计 → 评级 → 写结局档 → 切独立结局画面（幂等：同局只结算一次） */
    _commitVictory: function () {
      if (this._scene === 'victory' && endingRecord) return endingRecord;
      var stats = this.getRunStats(true);
      var rating = computeRating(stats, true);
      endingRecord = {
        cleared: true, win: true, stats: stats,
        score: rating.score, grade: rating.grade,
        at: new Date().toISOString()
      };
      endingSel = 0;
      /* M8-5：通关写本地排行榜（须在切 victory 前调用；scene 已为 victory 时幂等跳过） */
      this.submitRank();
      /* 结局档：写入当前局面 + ending 记录；「继续游戏」据此回到结局页而不是重打 */
      Game.Systems.Save.save();
      Game.Core.EventBus.emit('audio:play', { sfx: 'victory' });
      this.switchScene('victory');
      return endingRecord;
    },

    /* D-52：死亡收尾——清档（沿用 D-51 口径）、清图鉴，再打开死亡结算 */
    _finalizeDeath: function (death) {
      lastDeath = death || lastDeath;
      endingRecord = null;
      endingSel = 0;
      Game.Systems.Save.clear(); /* 死亡清档，重新开始走新档 */
      if (Game.Systems.Bestiary && typeof Game.Systems.Bestiary.reset === 'function') {
        Game.Systems.Bestiary.reset();
      }
      this.openGameOver();
    },

    /* D-52：自适应名额是否真的还没用完（只有这时才提示"守夜人还能拉你一次"） */
    canRescueNow: function () {
      var A = Game.Systems && Game.Systems.Adaptive;
      if (!A || typeof A.isEnabled !== 'function' || !A.isEnabled()) return false;
      var used = (player.adaptive && typeof player.adaptive.triggers === 'number') ? player.adaptive.triggers : 0;
      var max = (typeof A.MAX_TRIGGERS === 'number') ? A.MAX_TRIGGERS : 2;
      return used < max;
    },

    /* M9-5：死亡结算（D-52 扩展：死因 / 差什么 / 救援名额 / 本局统计）。
     * 仍以 gameover 弹窗呈现——D-10/D-38/D-51 的表现与键盘路径（Enter 重开）保持不变。 */
    openGameOver: function (deathOverride) {
      var d = deathOverride || lastDeath || null;
      var statKills = runStats.known ? runStats.kills
        : ((Game.hud && typeof Game.hud.getKills === 'function') ? Game.hud.getKills() : null);
      var stats = {
        floor: player.floor,
        gold: player.gold,
        kills: statKills,
        elapsedMs: this.getElapsedMs(),
        death: d,
        cause: deathCauseText(d),
        gap: deathGap(d),
        canRescue: this.canRescueNow(),
        run: this.getRunStats(false)
      };
      if (Game.Modal) {
        Game.Modal.open('gameover', stats);
      }
      /* 切回探索场景（弹窗悬停其上，_updateExplore 因弹窗打开而暂停） */
      this.switchScene('explore');
    },

    /* D-52：死亡结算「回主菜单」（存档已在 _finalizeDeath 清掉；只离开当前局） */
    _deathReturnToMenu: function () {
      if (Game.Modal && Game.Modal.isOpen && Game.Modal.isOpen()) Game.Modal.close();
      menu.page = 'root'; menu.sel = 0; menu.settingsSel = 0; menu.helpScroll = 0;
      menu.confirm = null; menu.confirmSel = 1;
      if (Game.Core.Input && typeof Game.Core.Input.clear === 'function') Game.Core.Input.clear();
      this.switchScene('menu');
      Game.Core.EventBus.emit('ui:notice', { msg: '已回到主菜单（本局已结束，存档已清除）' });
      return true;
    },

    /* D-52：结局页「回主菜单」——保留已通关存档，继续游戏可回到结局页 */
    _endingReturnToMenu: function () {
      menu.page = 'root'; menu.sel = 0; menu.settingsSel = 0; menu.helpScroll = 0;
      menu.confirm = null; menu.confirmSel = 1;
      if (Game.Core.Input && typeof Game.Core.Input.clear === 'function') Game.Core.Input.clear();
      this.switchScene('menu');
      Game.Core.EventBus.emit('ui:notice', { msg: '已回到主菜单（结局存档保留）' });
      return true;
    },

    /* M9-5：重新开始（既有 reset 逻辑；通关 R 键与死亡结算按钮共用） */
    restart: function () {
      runStart = performance.now();
      /* D-52：新局统计从零开始，清掉上一局结局记录与死亡遥测 */
      resetRunStats(true);
      endingRecord = null;
      lastDeath = null;
      endingSel = 0;
      /* D-51：新局不继承暂停态与残留战斗（从菜单/结算页重开时清干净） */
      pause.active = false; pause.page = 'root'; pause.sel = 0;
      pause.settingsSel = 0; pause.confirmSel = 1; pause.wasPaused = false;
      if (Game.Systems && Game.Systems.Battle && typeof Game.Systems.Battle.abort === 'function') {
        Game.Systems.Battle.abort();
      }
      /* 重置玩家为新档 */
      player.hp = 100; player.maxHp = 100;
      player.mp = 50; player.maxMp = 50; /* M8-1：新档 MP 满 */
      player.atk = 10; player.def = 5;
      player.gold = 0; player.exp = 0; player.level = 1;
      player.inventory = {}; giveStartingGear(); /* D-27：新局起手匕首（与 init 的无档路径同一函数） */
      player.quests = {};
      player.upg = {}; /* S-03：新局强化清零 */
      player.status = {}; /* S-04：新局状态清空 */
      /* D-49：新局自适应记录清零（开关状态由设置决定，不随局重置） */
      if (Game.Systems && Game.Systems.Adaptive && typeof Game.Systems.Adaptive.reset === 'function') {
        Game.Systems.Adaptive.reset();
      }
      if (Game.Systems && Game.Systems.Quest) Game.Systems.Quest.init();
      /* D-47：新局 NPC 任务状态清零（与 Player.quests 同一处重置） */
      if (Game.Systems && Game.Systems.NpcQuest && typeof Game.Systems.NpcQuest.reset === 'function') {
        Game.Systems.NpcQuest.reset();
      }
      if (Game.Systems && Game.Systems.Save) Game.Systems.Save.clear();
      /* 修复 P2：新局图鉴从空开始，与已清空的存档保持一致 */
      if (Game.Systems && Game.Systems.Bestiary && typeof Game.Systems.Bestiary.reset === 'function') {
        Game.Systems.Bestiary.reset();
      }
      lastStepAt = -1e9; /* 修复 P1：重开后立即响应移动 */
      lastAiAt = -1e9;
      lastDir = null;
      try {
        if (Game.Systems && Game.Systems.Map) {
          Game.Systems.Map.setFloor(1);
          resetPlayer();
        }
      } catch (e) { /* Map 缺失时仅重置 Player（验证页场景） */ }
      /* C-02：新局商店相位归零（只归零不推进；换层归零仍由 Shop.syncFloor 负责）。
       * 放在 Map.setFloor(1) 之后，保证 tickFloor 对齐新局首层。 */
      if (Game.Systems && Game.Systems.Shop && typeof Game.Systems.Shop.resetPhase === 'function') {
        Game.Systems.Shop.resetPhase();
      }
      refreshFov(); /* S3-1：重新开始后刷新视野 */
      if (Game.Modal) Game.Modal.close();
      this.switchScene('explore');
    },

    /* ---------- D-48：首屏菜单 ---------- */
    /* 纯函数：由 index.html 的 __AI_DUNGEON_MENU__ + skip 参数共同决定（验证页可直接断言） */
    shouldShowMenu: shouldShowMenu,

    /* 当前设置快照（只读副本；验证页断言三项且无第四项） */
    getSettings: function () { return { fx: settings.fx, muted: settings.muted, zoom: settings.zoom, adaptive: settings.adaptive }; },

    /* 设置项列表：三项既有开关（D-48 的断言口径不变） */
    _settingsSpec: function () {
      return [
        { id: 'fx', label: '打击感', value: FX_LABEL[settings.fx] || '低' },
        { id: 'muted', label: '音效', value: settings.muted ? '关' : '开' },
        { id: 'zoom', label: '画面缩放', value: ZOOM_LABEL[settings.zoom] || '自动（自适应）' }
      ];
    },

    /* D-49：设置页渲染行 = 三项既有开关 + 自适应难度（单独行，不并入 D-48 的 _settingsSpec） */
    _settingsRows: function () {
      var rows = this._settingsSpec();
      rows.push({ id: 'adaptive', label: '自适应难度', value: settings.adaptive ? '开' : '关' });
      /* D-51：清除存档是"动作行"而不是开关，由 Enter 触发二次确认 */
      var hasSave = !!(Game.Systems && Game.Systems.Save && typeof Game.Systems.Save.has === 'function' && Game.Systems.Save.has());
      rows.push({ id: 'clearSave', label: '清除存档', value: hasSave ? '删除' : '无存档', danger: true });
      return rows;
    },

    /* 单项设置：即时生效 + 立即持久化；非法值返回 false 且不改状态 */
    setSetting: function (id, value) {
      if (id === 'fx') {
        if (FX_LEVELS.indexOf(value) < 0) return false;
        settings.fx = value;
        if (Game.Fx && typeof Game.Fx.setLevel === 'function') Game.Fx.setLevel(value);
      } else if (id === 'muted') {
        settings.muted = !!value;
        var A = Game.Systems && Game.Systems.Audio;
        if (A && typeof A.setMuted === 'function') A.setMuted(settings.muted);
      } else if (id === 'zoom') {
        if (ZOOM_LEVELS.indexOf(value) < 0) return false;
        settings.zoom = value;
        var R = Game.Core && Game.Core.Render;
        if (R && typeof R.setScaleMode === 'function') R.setScaleMode(value);
      } else if (id === 'adaptive') {
        /* D-49：默认开；关闭后 onDeath/onFloorArrived 全部直接返回 null，行为回到 D-48 */
        settings.adaptive = !!value;
        var D = Game.Systems && Game.Systems.Adaptive;
        if (D && typeof D.setEnabled === 'function') D.setEnabled(settings.adaptive);
      } else {
        return false;
      }
      saveSettings();
      return true;
    },

    /* 键盘左右/Enter 的循环切换（方向 +1 / -1） */
    cycleSetting: function (id, dir) {
      var d = (dir < 0) ? -1 : 1;
      if (id === 'fx') {
        var i = FX_LEVELS.indexOf(settings.fx);
        return this.setSetting('fx', FX_LEVELS[(i + d + FX_LEVELS.length) % FX_LEVELS.length]);
      }
      if (id === 'muted') return this.setSetting('muted', !settings.muted);
      if (id === 'zoom') {
        var z = ZOOM_LEVELS.indexOf(settings.zoom);
        return this.setSetting('zoom', ZOOM_LEVELS[(z + d + ZOOM_LEVELS.length) % ZOOM_LEVELS.length]);
      }
      if (id === 'adaptive') return this.setSetting('adaptive', !settings.adaptive);
      return false;
    },

    /* 菜单渲染数据（选项可用状态来自 Save.has()，无档时"继续游戏"置灰并带一行说明） */
    _menuSpec: function () {
      var hasSave = !!(Game.Systems && Game.Systems.Save && typeof Game.Systems.Save.has === 'function' && Game.Systems.Save.has());
      return {
        page: menu.page,
        sel: menu.sel,
        settingsSel: menu.settingsSel,
        helpScroll: menu.helpScroll,
        confirm: menu.confirm,
        confirmSel: menu.confirmSel,
        items: [
          { id: 'new', label: '开始新游戏', enabled: true },
          { id: 'continue', label: '继续游戏', enabled: hasSave, note: hasSave ? '' : '暂无存档' },
          { id: 'help', label: '玩法说明', enabled: true },
          { id: 'settings', label: '设置', enabled: true },
          { id: 'about', label: '关于', enabled: true }
        ],
        settings: this._settingsRows(),
        help: HELP
      };
    },

    getMenuState: function () {
      return { page: menu.page, sel: menu.sel, settingsSel: menu.settingsSel, helpScroll: menu.helpScroll, confirmSel: menu.confirmSel };
    },

    /* D-51：删除存档（菜单设置页 / 暂停设置页共用）。
     * 只删 ai_dungeon_rpg_save_v1 并清空内存图鉴，不碰设置键；损坏档同样按 key 删除。 */
    clearSave: function () {
      var S = Game.Systems && Game.Systems.Save;
      if (!S || typeof S.clear !== 'function') return false;
      var had = (typeof S.has === 'function') ? S.has() : false;
      S.clear();
      if (Game.Systems.Bestiary && typeof Game.Systems.Bestiary.reset === 'function') {
        Game.Systems.Bestiary.reset();
      }
      return had;
    },

    /* 进入场景：new = 清档重开；continue = 读档进场景。返回是否真的进入。 */
    enterGame: function (mode) {
      var S = Game.Systems && Game.Systems.Save;
      if (mode === 'continue') {
        if (!S || typeof S.has !== 'function' || !S.has()) {
          Game.Core.EventBus.emit('ui:notice', { msg: '暂无存档：请先「开始新游戏」' });
          return false;
        }
        try {
          booting = true;               /* 读档期间不写档（与 init 同一守卫） */
          var loaded = S.load();
          booting = false;
          if (!loaded) {
            Game.Core.EventBus.emit('ui:notice', { msg: '存档无法读取：请先「开始新游戏」' });
            return false;
          }
          if (typeof loaded.floor === 'number') player.floor = loaded.floor;
          /* D-52：已通关的档——继续游戏回到结局页（不重打 Boss、不重新结算） */
          if (loaded.ending && loaded.ending.cleared === true) {
            endingRecord = loaded.ending;
            endingSel = 0;
            encounter = null;
            if (Game.Modal) Game.Modal.close();
            this.switchScene('victory');
            menu.page = 'root'; menu.sel = 0; menu.settingsSel = 0; menu.helpScroll = 0;
            if (Game.Core.Input && typeof Game.Core.Input.clear === 'function') Game.Core.Input.clear();
            Game.Core.EventBus.emit('ui:notice', { msg: '本局已通关：显示上一局结局' });
            return true;
          }
        } catch (e) {
          booting = false;
          Game.Core.EventBus.emit('ui:notice', { msg: '存档读取失败：请先「开始新游戏」' });
          return false;
        }
        encounter = null;
        refreshFov();
        syncHud();
        if (Game.Modal) Game.Modal.close();
        this.switchScene('explore');
        this._finishMenuEnter('已读取存档（楼层 ' + player.floor + '）');
        return true;
      }
      /* 新游戏：reuse restart()，它已包含清档、重生地图、重置任务/图鉴/商店相位 */
      encounter = null;
      this.restart();
      this._finishMenuEnter('新冒险开始');
      return true;
    },

    /* 离开首屏后的共同收尾：清残留按键、按需弹首次引导、给一条提示 */
    _finishMenuEnter: function (msg) {
      menu.page = 'root';
      menu.sel = 0;
      menu.settingsSel = 0;
      menu.helpScroll = 0;
      if (Game.Core.Input && typeof Game.Core.Input.clear === 'function') Game.Core.Input.clear();
      if (this._guidePending) {
        this._guidePending = false;
        this._guideVisible = false; /* openGuide 内部按需置 true */
        openGuide();
      }
      Game.Core.EventBus.emit('ui:notice', { msg: msg });
    },

    /* 菜单键盘：↑↓ 选择 / Enter 确认 / Esc 从子页返回（鼠标点击为可选增强，不依赖） */
    _updateMenu: function () {
      var k = Game.Core.Input.getState();
      var up = k['ArrowUp'] || k['KeyW'];
      var down = k['ArrowDown'] || k['KeyS'];
      var enter = k['Enter'] || k['NumpadEnter'];
      var esc = k['Escape'];

      if (menu.page === 'root') {
        if (up) { delete k['ArrowUp']; delete k['KeyW']; menu.sel = Math.max(0, menu.sel - 1); return; }
        if (down) { delete k['ArrowDown']; delete k['KeyS']; menu.sel = Math.min(4, menu.sel + 1); return; }
        if (enter) {
          delete k['Enter']; delete k['NumpadEnter'];
          var id = ['new', 'continue', 'help', 'settings', 'about'][menu.sel];
          if (id === 'new') { this.enterGame('new'); return; }
          if (id === 'continue') { this.enterGame('continue'); return; }
          if (id === 'help') { menu.page = 'help'; menu.helpScroll = 0; return; }
          if (id === 'settings') { menu.page = 'settings'; menu.settingsSel = 0; return; }
          if (id === 'about') { menu.page = 'about'; return; }
        }
        return;
      }

      if (esc) {
        delete k['Escape'];
        /* D-51：清除存档确认页 → 返回设置页（取消，不删除） */
        if (menu.page === 'confirmClear') { menu.page = 'settings'; menu.confirm = null; return; }
        menu.page = 'root';
        return;
      }

      /* D-51：清除存档二次确认——第一次 Enter 只弹提示，确认后才删 */
      if (menu.page === 'confirmClear') {
        if (k['ArrowLeft'] || k['KeyA']) { delete k['ArrowLeft']; delete k['KeyA']; menu.confirmSel = 0; return; }
        if (k['ArrowRight'] || k['KeyD']) { delete k['ArrowRight']; delete k['KeyD']; menu.confirmSel = 1; return; }
        if (enter) {
          delete k['Enter']; delete k['NumpadEnter'];
          if (menu.confirmSel === 1) {
            var had = this.clearSave();
            Game.Core.EventBus.emit('ui:notice', { msg: had ? '存档已清除（当前无存档）' : '当前没有存档可清除' });
          }
          menu.page = 'settings';
          menu.confirm = null;
          return;
        }
        return;
      }

      if (menu.page === 'help') {
        if (up) { delete k['ArrowUp']; delete k['KeyW']; menu.helpScroll = Math.max(0, menu.helpScroll - 1); return; }
        if (down) { delete k['ArrowDown']; delete k['KeyS']; menu.helpScroll += 1; return; }
        return;
      }

      if (menu.page === 'settings') {
        var setRows = this._settingsRows();
        if (up) { delete k['ArrowUp']; delete k['KeyW']; menu.settingsSel = Math.max(0, menu.settingsSel - 1); return; }
        if (down) { delete k['ArrowDown']; delete k['KeyS']; menu.settingsSel = Math.min(setRows.length - 1, menu.settingsSel + 1); return; }
        var ids = ['fx', 'muted', 'zoom', 'adaptive', 'clearSave'];
        var curId = ids[menu.settingsSel];
        /* D-51：清除存档 = 动作行，Enter（或右方向）弹出二次确认；无档时只提示 */
        if (curId === 'clearSave') {
          if (enter || k['ArrowRight'] || k['KeyD']) {
            delete k['Enter']; delete k['NumpadEnter']; delete k['ArrowRight']; delete k['KeyD'];
            var hasSave = !!(Game.Systems && Game.Systems.Save && typeof Game.Systems.Save.has === 'function' && Game.Systems.Save.has());
            if (!hasSave) { Game.Core.EventBus.emit('ui:notice', { msg: '当前没有存档可清除' }); return; }
            menu.confirm = 'clear';
            menu.confirmSel = 1;
            menu.page = 'confirmClear';
            return;
          }
          return;
        }
        if (k['ArrowLeft'] || k['KeyA']) { delete k['ArrowLeft']; delete k['KeyA']; this.cycleSetting(curId, -1); return; }
        if (k['ArrowRight'] || k['KeyD']) { delete k['ArrowRight']; delete k['KeyD']; this.cycleSetting(curId, 1); return; }
        if (enter) { delete k['Enter']; delete k['NumpadEnter']; this.cycleSetting(curId, 1); return; }
        return;
      }
      /* about：Esc 已在上面的统一分支处理 */
    },

    /* M9-5：首次引导（验证页断言用）
     * D-14：showGuide/closeGuide 供 H 键与验证页显式重看/关闭 */
    needsGuide: needsGuide,
    markGuided: markGuided,
    showGuide: openGuide,
    closeGuide: closeGuide,

    /* ---------- D-51：暂停面板 ---------- */
    /* 暂停面板渲染数据（与主菜单同源：设置行、选中态、二次确认文案） */
    _pauseSpec: function () {
      return {
        page: pause.page,
        sel: pause.sel,
        settingsSel: pause.settingsSel,
        confirmSel: pause.confirmSel,
        items: PAUSE_ITEMS,
        settings: this._settingsRows(),
        hasSave: !!(Game.Systems && Game.Systems.Save && typeof Game.Systems.Save.has === 'function' && Game.Systems.Save.has())
      };
    },

    getPauseState: function () {
      return {
        active: pause.active, page: pause.page, sel: pause.sel,
        settingsSel: pause.settingsSel, confirmSel: pause.confirmSel, stoppedAt: pause.stoppedAt
      };
    },
    isPaused: function () { return pause.active; },
    /* D-51：只读计数器（验证页断言"真停"） */
    _counters: function () {
      var B = Game.Systems && Game.Systems.Battle;
      return {
        steps: this._stats.steps,
        aiTicks: this._stats.aiTicks,
        battleTicks: this._stats.battleTicks,
        turnClock: (B && typeof B._now === 'function') ? B._now() : 0
      };
    },

    /* 打开暂停：只允许在游戏内（探索/战斗），弹窗与首屏引导期间不抢 ESC。
     * ts 传入当前帧时间戳；stoppedAt 据此记录"时间轴停在哪一毫秒"。 */
    openPause: function (ts) {
      if (pause.active) return false;
      if (this._scene !== 'explore' && this._scene !== 'battle') return false;
      if (Game.Modal && Game.Modal.isOpen && Game.Modal.isOpen()) return false;
      if (this._guideVisible) return false;
      /* 胜利消散动画期间不开放暂停：此时战斗结果已结算但 battle:end 尚未发出，
       * 若在 700ms 内退出会把已赢下的奖励丢掉。等动画播完（场景自动切换）再允许。 */
      var bs = (Game.Systems && Game.Systems.Battle && typeof Game.Systems.Battle.getState === 'function')
        ? Game.Systems.Battle.getState() : null;
      if (bs && bs.dying) return false;
      pause.active = true;
      pause.page = 'root';
      pause.sel = 0;
      pause.settingsSel = 0;
      pause.confirmSel = 1;
      pause.stoppedAt = (typeof ts === 'number' && isFinite(ts)) ? ts : this._lastFrame;
      pause.wasPaused = false;
      /* 清掉按住的移动/动作键：恢复后不会因为"暂停时一直按着方向键"而突然走一步 */
      if (Game.Core.Input && typeof Game.Core.Input.clear === 'function') Game.Core.Input.clear();
      return true;
    },

    /* 关闭暂停（继续游戏）。真正的时钟补偿在下一帧由 _settlePauseClock 完成：
     * 把 (当前帧时间戳 − stoppedAt) 一次性补给 Battle 的时间偏移，时间轴从原处继续。 */
    closePause: function () {
      if (!pause.active) return false;
      pause.active = false;
      pause.page = 'root';
      pause.confirmSel = 1;
      pause.wasPaused = true;
      if (Game.Core.Input && typeof Game.Core.Input.clear === 'function') Game.Core.Input.clear();
      return true;
    },

    /* 恢复时只补一次偏移。补的量是"暂停期间流逝的真实时间"：
     * 恢复后 now() 仍等于暂停前的时刻，pending/lockUntil/finalizeAt 的剩余量原样保留。 */
    _settlePauseClock: function (ts) {
      if (!pause.wasPaused) return 0;
      var t = (typeof ts === 'number' && isFinite(ts)) ? ts : this._lastFrame;
      var ms = t - pause.stoppedAt;
      pause.wasPaused = false;
      if (ms > 0) {
        var B = Game.Systems && Game.Systems.Battle;
        if (B && typeof B._shiftClock === 'function') B._shiftClock(ms);
        /* 玩家移动/AI 的节流起点同步后移，恢复后不会立刻连走两步 */
        lastStepAt += ms;
        lastAiAt += ms;
        runStart += ms; /* 暂停时长不计入本局用时 */
      }
      return ms;
    },

    /* 每帧：暂停中读暂停菜单；游戏内读 ESC 按下边沿打开暂停 */
    _updatePauseInput: function (ts) {
      var I = Game.Core.Input;
      if (pause.active) { this._updatePauseMenu(); return; }
      if (this._scene !== 'explore' && this._scene !== 'battle') return;
      if (Game.Modal && Game.Modal.isOpen && Game.Modal.isOpen()) return;
      if (this._guideVisible) return;
      var esc = (I && typeof I.takeEdge === 'function') ? I.takeEdge('Escape') : false;
      if (!esc) return;
      if (I && I.getState) delete I.getState()['Escape'];
      this.openPause(ts);
    },

    _updatePauseMenu: function () {
      var k = Game.Core.Input.getState();
      var I = Game.Core.Input;
      var esc = (I && typeof I.takeEdge === 'function') ? I.takeEdge('Escape') : false;
      var up = k['ArrowUp'] || k['KeyW'];
      var down = k['ArrowDown'] || k['KeyS'];
      var enter = k['Enter'] || k['NumpadEnter'];
      var left = k['ArrowLeft'] || k['KeyA'];
      var right = k['ArrowRight'] || k['KeyD'];

      if (pause.page === 'confirmAbandon' || pause.page === 'confirmClear') {
        if (esc) { delete k['Escape']; this._pauseBack(); return; }
        if (left) { delete k['ArrowLeft']; delete k['KeyA']; pause.confirmSel = 0; return; }
        if (right) { delete k['ArrowRight']; delete k['KeyD']; pause.confirmSel = 1; return; }
        if (enter) {
          delete k['Enter']; delete k['NumpadEnter'];
          if (pause.confirmSel !== 1) { this._pauseBack(); return; }
          if (pause.page === 'confirmAbandon') this._pauseAbandon();
          else this._pauseClearSave();
        }
        return;
      }

      if (esc) { delete k['Escape']; this._pauseBack(); return; }

      if (pause.page === 'settings') {
        var rows = this._settingsRows();
        if (up) { delete k['ArrowUp']; delete k['KeyW']; pause.settingsSel = Math.max(0, pause.settingsSel - 1); return; }
        if (down) { delete k['ArrowDown']; delete k['KeyS']; pause.settingsSel = Math.min(rows.length - 1, pause.settingsSel + 1); return; }
        var id = rows[pause.settingsSel] ? rows[pause.settingsSel].id : 'fx';
        if (id === 'clearSave') {
          if (enter || right) {
            delete k['Enter']; delete k['NumpadEnter']; delete k['ArrowRight']; delete k['KeyD'];
            if (!this._pauseSpec().hasSave) {
              Game.Core.EventBus.emit('ui:notice', { msg: '当前没有存档可清除' });
              return;
            }
            pause.page = 'confirmClear';
            pause.confirmSel = 1;
          }
          return;
        }
        if (left) { delete k['ArrowLeft']; delete k['KeyA']; this.cycleSetting(id, -1); return; }
        if (right) { delete k['ArrowRight']; delete k['KeyD']; this.cycleSetting(id, 1); return; }
        if (enter) { delete k['Enter']; delete k['NumpadEnter']; this.cycleSetting(id, 1); return; }
        return;
      }

      /* root */
      if (up) { delete k['ArrowUp']; delete k['KeyW']; pause.sel = Math.max(0, pause.sel - 1); return; }
      if (down) { delete k['ArrowDown']; delete k['KeyS']; pause.sel = Math.min(PAUSE_ITEMS.length - 1, pause.sel + 1); return; }
      if (!enter) return;
      delete k['Enter']; delete k['NumpadEnter'];
      var action = PAUSE_ITEMS[pause.sel] ? PAUSE_ITEMS[pause.sel].id : 'resume';
      if (action === 'resume') { this.closePause(); return; }
      if (action === 'settings') { pause.page = 'settings'; pause.settingsSel = 0; return; }
      if (action === 'menu') { this._pauseReturnToMenu(); return; }
      if (action === 'abandon') { pause.page = 'confirmAbandon'; pause.confirmSel = 1; return; }
    },

    /* Esc / 取消：确认页回到上一级，设置页回根页，根页 = 继续游戏 */
    _pauseBack: function () {
      if (pause.page === 'confirmAbandon') { pause.page = 'root'; return; }
      if (pause.page === 'confirmClear') { pause.page = 'settings'; return; }
      if (pause.page === 'settings') { pause.page = 'root'; return; }
      this.closePause();
    },

    /* 「返回主菜单」：先把当前局面落盘，再离开战斗回到首屏（继续游戏可回到该局面） */
    _pauseReturnToMenu: function () {
      if (Game.Systems.Save && typeof Game.Systems.Save.save === 'function') Game.Systems.Save.save();
      this._leaveToMenu();
      Game.Core.EventBus.emit('ui:notice', { msg: '已返回主菜单（当前进度已保存）' });
      return true;
    },

    /* 「放弃本局」：明确不写档——磁盘上仍是这局之前的存档；内存里的本局进度作废。
     * 这样"放弃"与"返回主菜单"语义可区分：前者丢弃本次进度、后者保留。 */
    _pauseAbandon: function () {
      this._leaveToMenu();
      Game.Core.EventBus.emit('ui:notice', { msg: '已放弃本局：本次进度未保存' });
      return true;
    },

    /* 清档：从暂停设置页清除 → 删档后直接回主菜单（避免下一帧自动存档又把档写回来） */
    _pauseClearSave: function () {
      var had = this.clearSave();
      this._leaveToMenu();
      Game.Core.EventBus.emit('ui:notice', { msg: had ? '存档已清除（当前无存档）' : '当前没有存档可清除' });
      return had;
    },

    /* 暂停 → 首屏共用的离开路径：静默终止本场战斗（不发 battle:end、不结算奖励），
     * 清掉遇敌上下文与暂停态，回到 menu 根页。全程只复用同一条 rAF 链。 */
    _leaveToMenu: function () {
      pause.active = false;
      pause.page = 'root';
      pause.sel = 0;
      pause.confirmSel = 1;
      pause.wasPaused = false;
      encounter = null;
      var B = Game.Systems && Game.Systems.Battle;
      if (B && typeof B.abort === 'function') B.abort();
      if (Game.Modal && Game.Modal.isOpen && Game.Modal.isOpen()) Game.Modal.close();
      menu.page = 'root';
      menu.sel = 0;
      menu.settingsSel = 0;
      menu.helpScroll = 0;
      menu.confirm = null;
      menu.confirmSel = 1;
      if (Game.Core.Input && typeof Game.Core.Input.clear === 'function') Game.Core.Input.clear();
      this.switchScene('menu');
    },

    _drawPause: function () {
      var R = Game.Core && Game.Core.Render;
      if (R && typeof R.drawPause === 'function') {
        try { R.drawPause(this._pauseSpec()); } catch (e) { /* 降级：绘制异常不影响暂停本身 */ }
      }
    },

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
      /* D-12：方向键"新按下"边沿每帧消费一次（弹窗/引导期间也消费，避免恢复后误触发） */
      var dirEdge = (Game.Core.Input.takeDirEdge && Game.Core.Input.takeDirEdge()) || false;
      /* M9-5：首次引导覆盖层显示时暂停游戏输入；D-14：仅 Enter / 点击确认按钮可关闭 */
      if (this._guideVisible) return;
      /* S3-3：弹窗打开时暂停地图移动输入（弹窗自行处理 Esc/↑↓/Enter/点击） */
      if (Game.Modal && Game.Modal.isOpen()) return;
      var k = Game.Core.Input.getState();
      /* D-14：H 随时重看帮助（不依赖存档状态，不再写新键） */
      if (k['KeyH']) { delete k['KeyH']; openGuide(); return; }
      if (k['KeyB']) { delete k['KeyB']; Game.Modal.open('inventory'); return; }
      /* 修复：S 是 WASD 的“向下移动”，不能再同时作为商店热键（否则按 S 会弹出商店面板）。
       * 商店改用 E 打开；S 保留给移动，其余按键语义不变。 */
      if (k['KeyE']) { delete k['KeyE']; Game.Modal.open('shop'); return; }
      if (k['KeyM']) { delete k['KeyM']; Game.Modal.open('quests'); return; }
      /* D-47：T 只对"实体 NPC"生效——必须站在相邻格（含斜向）。
       * 距离 >1 时不弹任何模态，只在底部提示条给一行"附近没有人"（非阻塞）。 */
      if (k['KeyT']) {
        delete k['KeyT'];
        var nq = Game.Systems.NpcQuest;
        var near = (nq && typeof nq.nearby === 'function') ? nq.nearby(player.x, player.y) : null;
        if (near) { Game.Modal.open('npcquest', near); return; }
        Game.Core.EventBus.emit('ui:notice', { msg: '附近没有人' });
        return;
      }
      if (k['KeyL']) { delete k['KeyL']; Game.Systems.Learner.init(Game.Systems.Map.getGrid()); this._scene = 'learner'; return; }
      /* M9-4：Q 打开设置弹窗；K 一键静音（不 return，允许同时移动） */
      if (k['KeyQ']) { delete k['KeyQ']; Game.Modal.open('settings'); return; }
      if (k['KeyK']) { delete k['KeyK']; Game.Systems.Audio.setMuted(!Game.Systems.Audio.isMuted()); }
      /* 修复 P1：定步长（120ms）处理 AI 与移动；动作键仍即时响应。
       * D-12：新按下/换方向立即生效（见 lastDir），只有"按住同方向"才吃 120ms 节流。 */
      var tNow = (typeof now === 'number') ? now : performance.now();
      var d = Game.Core.Input.direction(k);
      var dirDown = (d.dx !== 0 || d.dy !== 0);
      var fresh = dirDown && (dirEdge || !lastDir || d.dx !== lastDir.dx || d.dy !== lastDir.dy);
      if (!dirDown) lastDir = null;
      if (!fresh && tNow - lastStepAt < MOVE_INTERVAL) return;
      lastStepAt = tNow;
      if (dirDown) lastDir = { dx: d.dx, dy: d.dy };
      /* M5：怪物 AI 先行（感知/追击），再处理玩家移动。
       * D-12：AI 仍按固定 120ms 节奏 tick，不受玩家按键频率影响。 */
      if (tNow - lastAiAt >= MOVE_INTERVAL) {
        lastAiAt = tNow;
        this._stats.aiTicks++; /* D-51：AI tick 计数（暂停期间不执行，验证页据此断言真停） */
        Game.Systems.AI.tick(player);
      }
      if (d.dx !== 0 || d.dy !== 0) {
        var nx = player.x + d.dx;
        var ny = player.y + d.dy;
        if (Game.Systems.Map.isWalkable(nx, ny)) {
          /* S-04：一步 = 一个探索回合——先结算上一回合遗留状态（中毒/流血），再移动；
           * 状态扣血致死时提前返回（battle:end 通道已弹出结算） */
          if (Game.Systems.Status && typeof Game.Systems.Status.tick === 'function') {
            var stStep = Game.Systems.Status.tick();
            if (stStep.length && player.hp <= 0) { refreshFov(); return; }
          }
          var fromX = player.x, fromY = player.y;
          player.x = nx;
          player.y = ny;
          this._stats.steps++; /* D-51：真的走了一格才 +1（暂停期间走不动） */
          this._noteStep();    /* D-52：本局总回合 = 探索步数 + 战斗行动 */
          /* D-47：NPC 任务进度——每一步都检查"是否走到下行梯旁"（不含楼梯格自身） */
          if (Game.Systems.NpcQuest && typeof Game.Systems.NpcQuest.checkPosition === 'function') {
            Game.Systems.NpcQuest.checkPosition(nx, ny);
          }
          /* M9-3：登记移动插值（逻辑坐标已更新，渲染层取视觉位置） */
          if (Game.Motion && typeof Game.Motion.setStep === 'function') {
            Game.Motion.setStep('player', fromX, fromY, nx, ny, 140);
          }
          Game.Core.EventBus.emit('audio:play', { sfx: 'move' });
          var t = Game.Systems.Map.tileAt(nx, ny);
          if (t === 2) {
            /* 修复：最深层踩下行梯不再静默重生成当前层（changeFloor 边界返回 null） */
            var prevDown = player.floor;
            if (Game.Systems.Map.changeFloor(1)) {
              player.floor = Game.Systems.Map.getFloor();
              resetPlayer();
              /* D-49：层间落点检查"上一层出口血 <20%"——只在换层后触发，不在战斗中 */
              if (Game.Systems.Adaptive && typeof Game.Systems.Adaptive.onFloorArrived === 'function') {
                Game.Systems.Adaptive.onFloorArrived(prevDown);
              }
            }
          } else if (t === 3) {
            /* 修复：第 1 层踩上行梯不再静默重生成当前层 */
            var prevUp = player.floor;
            if (Game.Systems.Map.changeFloor(-1)) {
              player.floor = Game.Systems.Map.getFloor();
              resetPlayer();
              if (Game.Systems.Adaptive && typeof Game.Systems.Adaptive.onFloorArrived === 'function') {
                Game.Systems.Adaptive.onFloorArrived(prevUp);
              }
            }
          } else {
            /* S-04：先判陷阱（踩中即结算、该格永久显现），再判遭遇——同格有怪时先吃陷阱伤害 */
            if (Game.Systems.Map && typeof Game.Systems.Map.triggerTrap === 'function') {
              Game.Systems.Map.triggerTrap(nx, ny);
            }
            var e = Game.Systems.Map.enemyAt(nx, ny);
            if (e) {
              /* D-15：记录遭遇上下文（含来路），逃跑时据此后退一格、胜利时据此删怪 */
              encounter = {
                kind: 'ambush', x: nx, y: ny, monsterId: e.monsterId,
                fromX: fromX, fromY: fromY
              };
              Game.Systems.Battle.start(e.monsterId);
              this.switchScene('battle');
            } else {
              /* M9-1：站上宝箱自动拾取（不阻挡移动，拾取后 decor 置空）
               * S-05：密室宝箱（room_chest）同样走 takeDecor，掉落口径在 map.js 内区分 */
              var dec = Game.Systems.Map.getDecor(nx, ny);
              /* D-46：gold_pile / potion_stash 与宝箱同一拾取路径（站上即拿，不阻挡移动） */
              if (dec === 'chest' || dec === 'room_chest' || dec === 'gold_pile' || dec === 'potion_stash') {
                Game.Systems.Map.takeDecor(nx, ny);
                /* D-15：开箱同时改金币/背包 + 清空装饰格，两件事必须同一次落盘，
                 * 否则刷新后会出现"箱子回来了、金币没回"或"金币涨了、箱子还在"。 */
                Game.Systems.Save.save();
              }
            }
          }
          refreshFov(); /* S3-1：移动/换层后刷新视野 */
        }
      }
    },

    /* 战斗场景
     * D-16：输入不再直接打到 playerAction——先过输入锁。锁定期间按键"缓冲一条"（不丢弃），
     * 解锁后由 Battle.tick 执行一次；锁时长 ≤160ms，玩家不会感到"按了没反应"。 */
    _updateBattle: function () {
      var k = Game.Core.Input.getState();
      var B = Game.Systems.Battle;
      /* F：三档特效强度切换（关→低→高），入口可达且不改任何战斗数值 */
      if (k['KeyF']) {
        delete k['KeyF'];
        if (Game.Fx && typeof Game.Fx.cycle === 'function') {
          Game.Fx.cycle();
          Game.Core.EventBus.emit('ui:notice', { msg: '战斗特效：' + Game.Fx.label() + '（F 切换）' });
        }
        return;
      }
      var cmd = null;
      if (k['Digit1'] || k['Numpad1']) { delete k['Digit1']; delete k['Numpad1']; cmd = 'attack'; }
      else if (k['Digit2'] || k['Numpad2']) { delete k['Digit2']; delete k['Numpad2']; cmd = 'defend'; }
      else if (k['Digit3'] || k['Numpad3']) { delete k['Digit3']; delete k['Numpad3']; cmd = 'run'; }
      /* M8-1：数字键 4/5/6 释放技能（探索场景无动作，不占用原有按键） */
      else if (k['Digit4'] || k['Numpad4']) { delete k['Digit4']; delete k['Numpad4']; cmd = 'skill:fireball'; }
      else if (k['Digit5'] || k['Numpad5']) { delete k['Digit5']; delete k['Numpad5']; cmd = 'skill:dash'; }
      else if (k['Digit6'] || k['Numpad6']) { delete k['Digit6']; delete k['Numpad6']; cmd = 'skill:shield'; }
      /* D-19：7 = 战斗内用药。卡面建议用 4，但 4/5/6 已被三个技能占用（M8-1），
       * 改键会直接破坏既有战斗操作，故取同序列的下一个空闲数字键 7。 */
      else if (k['Digit7'] || k['Numpad7']) { delete k['Digit7']; delete k['Numpad7']; cmd = 'item'; }
      if (!cmd) return;
      if (B && typeof B.isInputLocked === 'function' && B.isInputLocked()) {
        B.bufferCommand(cmd);   /* 只缓冲一条，解锁后执行一次 */
        return;
      }
      B.playerAction(cmd);
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

    /* 通关结局画面（D-52）：两个按钮，键盘全操作 */
    _updateVictory: function () {
      var k = Game.Core.Input.getState();
      if (k['KeyR']) {
        delete k['KeyR'];
        this.restart(); /* M9-5：R 仍是再来一局快捷键 */
        return;
      }
      if (k['ArrowLeft'] || k['KeyA'] || k['ArrowRight'] || k['KeyD'] || k['Tab'] ||
          k['ArrowUp'] || k['KeyW'] || k['ArrowDown'] || k['KeyS']) {
        delete k['ArrowLeft']; delete k['KeyA']; delete k['ArrowRight']; delete k['KeyD'];
        delete k['ArrowUp']; delete k['KeyW']; delete k['ArrowDown']; delete k['KeyS'];
        delete k['Tab'];
        endingSel = endingSel === 0 ? 1 : 0;
        return;
      }
      if (k['Enter'] || k['NumpadEnter']) {
        delete k['Enter']; delete k['NumpadEnter'];
        if (endingSel === 1) this._endingReturnToMenu();
        else this.restart();
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
      /* ---------- D-51：暂停闸门 ----------
       * 先处理暂停菜单/ESC，再决定是否推进游戏。暂停期间直接 return：
       * 反馈/特效/提示条/插值/粒子/Battle.tick/场景更新一个都不调用，
       * 画面只重绘暂停面板——这才是"真停"，不是盖遮罩。
       * 恢复帧先补一次时钟偏移，使 now() 仍等于暂停前的时刻。 */
      this._updatePauseInput(ts);
      if (pause.active) {
        this._drawPause();
        return;
      }
      this._settlePauseClock(ts);
      if (Game.Feedback && typeof Game.Feedback.update === 'function') Game.Feedback.update(dt);
      /* D-16：战斗特效时钟（顿帧消耗 / 过期效果清理），放在反馈层之前推进 */
      if (Game.Fx && typeof Game.Fx.update === 'function') Game.Fx.update(dt);
      /* D-14：底部提示条生命周期（2.4s 存活 + 400ms 淡出，最多 3 条） */
      if (Game.Notice && typeof Game.Notice.update === 'function') Game.Notice.update(dt);
      /* M9-3：推进移动插值、粒子生命、战斗死亡消散计时 */
      if (Game.Motion && typeof Game.Motion.update === 'function') Game.Motion.update(dt);
      if (Game.Particles && typeof Game.Particles.update === 'function') Game.Particles.update(dt);
      /* D-16：把帧时间戳交给战斗时间轴（与 rAF 同钟；验证页可合成定步长驱动） */
      if (Game.Systems && Game.Systems.Battle && typeof Game.Systems.Battle.tick === 'function') {
        this._stats.battleTicks++;
        Game.Systems.Battle.tick(ts);
      }
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
        Game.Core.Render.drawVictory(player, this._endingSpec());
      } else if (scene === 'menu') {
        /* D-48：首屏菜单是 loop 内的一个场景——不新开 rAF 链 */
        this._updateMenu();
        Game.Core.Render.drawMainMenu(this._menuSpec());
      }
      /* D-14：底部提示条画在所有场景之上（含弹窗），但在引导覆盖层之下 */
      if (Game.Notice && typeof Game.Notice.draw === 'function') {
        try { Game.Notice.draw(); } catch (e) { /* 降级 */ }
      }
      /* M9-5：首次引导覆盖层（悬停最顶层；D-14：Enter / 点击确认按钮关闭） */
      if (this._guideVisible) {
        try { Game.Core.Render.drawGuide(); } catch (e) { /* 降级 */ }
      }
    }
  };

  /* script 位于 body 末尾，DOM 已就绪，直接启动（测试页可设 __AI_DUNGEON_NO_AUTOSTART__ 跳过）
   * D-48：只有 index.html 显式声明 __AI_DUNGEON_MENU__ 才走首屏菜单；
   * 既有验证页/机器人页未声明，init 仍直接进 explore（行为不变）。 */
  if (!window.__AI_DUNGEON_NO_AUTOSTART__) {
    Game.Core.Main.init({ menu: !!window.__AI_DUNGEON_MENU__ });
    Game.Core.Main.start();
  }
})();
