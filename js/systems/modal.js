/* js/systems/modal.js — 游戏内弹窗系统（S3-3，参考 Shattered Pixel Dungeon 物品栏弹窗）
 * 契约（docs/tasks/S3-3-modal.md，纯新增，不改既有接口）：
 *   Game.Modal.open(kind)   // kind: 'inventory' | 'shop' | 'quests'
 *   Game.Modal.close()
 *   Game.Modal.isOpen() -> bool
 *   Game.Modal.current() -> kind | null
 *   Game.Modal.draw()        // 绘制半透明遮罩 + 居中面板
 * 行为：
 *   - Esc 或点击面板外遮罩 → 关闭并清掉 Input 残留按键
 *   - ↑↓/WS 选择，Enter 确认（消耗品使用 / 武器防具装备 / 商店买 / 卖；任务仅查看）
 *   - 商店按 Tab 切换 购买/出售
 *   - 点击条目行 = 直接执行该条目操作
 * 数据：use/equip/buy/sell 仍由 Game.Systems.Inventory/Shop 执行，弹窗只负责选中与调用
 * 降级：ctx 缺失或数据异常时 draw 静默返回，不影响主画面
 * 来源：自写 */
(function () {
  'use strict';
  var Game = window.Game = window.Game || {};
  Game.Systems = Game.Systems || {};

  var MAX_VISIBLE = 12;   /* 面板最多显示行数（安全阀：单次最多渲染行数，语义不变） */
  var ROW_H = 30;
  var HEADER_H = 46;
  var FOOTER_H = 34;
  var MARGIN = 16;        /* C-03：面板与逻辑视口上下的最小留白（滚动的判定依据） */
  var MAX_W = 520;
  var W_RATIO = 0.88;    /* 窄窗口时面板宽 ≤ 画布 88% */
  /* D-29：背包双栏——逻辑宽 ≥ RAIL_MIN_W 时右侧展开只读装备栏。
   * 左列表仍受 MAX_W(520) 约束（单列宽上限不变）；面板总宽上限 = 520 + 12 + 200 = 732。
   * < RAIL_MIN_W 整体回退单列（右栏不占位、不画、不参与命中），页头摘要仍在。 */
  var RAIL_MIN_W = 700;
  var RAIL_W = 200;
  var RAIL_GAP = 12;
  var RAIL_H = 184;      /* 右栏内容高（页头之下）：标题 + 两槽 */

  var kind = null;
  var data = [];
  var sel = 0;
  /* D-100：鼠标两段式——armed 记录"已被第一次点击选中"的目标 id；
   * 只有再次点同一目标才执行。键盘 Enter 不受影响（按键即执行）。 */
  var armed = null;
  var shopMode = 'buy';
  var page = 0;        /* M8-4：quests 页签（0=任务 / 1=怪物 / 2=物品；D-85 起 3=系统），open 时重置 */
  var qScroll = 0;     /* P2-3b：图鉴（quests page1/2）滚动窗口起点；其他页恒为 0（行为不变） */
  var rect = null;       /* 最近一帧面板矩形 {x,y,w,h}，点击命中用 */
  var onKey = null, onClick = null;
  /* M9-4：设置面板状态 */
  var volTrack = null;   /* 音量滑块轨道矩形 {x,y,w,h} */
  var muteRect = null;   /* 静音开关矩形 {x,y,w,h} */
  var volDragging = false;
  var onMouseDown = null, onMouseMove = null, onMouseUp = null;
  /* M9-5：死亡结算状态 */
  var gameStats = null;       /* gameover 战绩（open 传入或现场拉取） */
  var gameRestartRect = null; /* 重新开始按钮矩形 {x,y,w,h} */
  var gameMenuRect = null;    /* D-52：回主菜单按钮矩形 */
  var gameoverSel = 0;        /* D-52：0=再来一局 / 1=回主菜单 */
  var npcId = null;           /* D-47：当前对话的 NPC id（npcquest 面板专用） */
  var stairConfirm = null;    /* D-98：下行楼梯确认（{floor, onConfirm}）；确认后才真正切层 */

  function canvas() {
    return (Game.Core && Game.Core.Render && Game.Core.Render._canvas) || document.getElementById('game');
  }
  function cctx() {
    return Game.Core && Game.Core.Render && Game.Core.Render._ctx;
  }
  /* M9-5：取 CSS 像素尺寸（DPR 适配后 canvas.width 为物理像素，绘制坐标用 CSS 像素） */
  function cssSize() {
    var R = Game.Core && Game.Core.Render;
    var cv = canvas();
    var w = (R && typeof R.cssW === 'number') ? R.cssW : (cv && cv.clientWidth) || (cv && cv.width) || 0;
    var h = (R && typeof R.cssH === 'number') ? R.cssH : (cv && cv.clientHeight) || (cv && cv.height) || 0;
    return { w: w, h: h };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* D-100：页签/买-卖页签的唯一几何来源——绘制与命中都调这两个函数，避免第二份坐标。 */
  function tabRect(px, py, i) {
    return { x: px + 14 + i * 72 - 4, y: py + 8, w: 64, h: 28 };
  }
  function shopModeRect(px, py, i) {
    return { x: px + 64 + i * 52, y: py + 8, w: 48, h: 28 };
  }

  /* D-29：右栏可见性——只看逻辑宽，与 kind 无关（调用方叠加 kind === 'inventory'）。
   * 单独抽出便于验证页在 699/700 两个边界直接判定，而不是靠"画出来看不见"。 */
  function railVisible(cw) { return cw >= RAIL_MIN_W; }

  /* D-29：面板总宽 / 左列表宽。双栏时总宽上限 732（左列仍 ≤520），
   * 仅在视口太窄时装不下才被 cw - 2*MARGIN 压回；单列公式与 D-28 完全一致。 */
  function panelWidth(cw, rail) {
    return rail ? Math.min(cw - 2 * MARGIN, MAX_W + RAIL_GAP + RAIL_W)
      : Math.min(cw * W_RATIO, MAX_W);
  }
  function listWidth(cw, rail) {
    var pw = panelWidth(cw, rail);
    return rail ? pw - RAIL_GAP - RAIL_W : pw;
  }

  /* C-03：当前视口可容纳的列表行数 = min(MAX_VISIBLE, 可用高度能放下的行数)。
   * 可用高度 = 逻辑视口高 - 上下留白 - 页头 - 页尾；至少 1 行（极小视口降级，不出现负高度）。
   * 1280×800（逻辑 1024×640）下算得 17 行 → 被 MAX_VISIBLE 压回 12，与改动前完全一致；
   * 逻辑高 ≤ 450 时可用高度不足 12 行，列表转为滚动而不是被视口裁切。 */
  function visibleRowCount(sz) {
    var h = (sz && typeof sz.h === 'number') ? sz.h : 0;
    var byH = Math.floor((h - 2 * MARGIN - HEADER_H - FOOTER_H) / ROW_H);
    if (!isFinite(byH) || byH < 1) byH = 1;
    return Math.max(1, Math.min(MAX_VISIBLE, byH));
  }

  /* D-28：强化后的实际数值——与 Inventory.effValue 同一公式。
   * modal.js 先于 inventory.js 加载，故运行时取；缺失时按同式兜底（不产生第二套口径）。 */
  function effOf(base, plus) {
    var I = Game.Systems && Game.Systems.Inventory;
    if (I && typeof I.effValue === 'function') return I.effValue(base, plus);
    var b = Number(base) || 0;
    var n = Math.min(Math.max(Number(plus) || 0, 0), 5);
    return b + (b ? Math.ceil(b * n * 0.1) : 0);
  }

  function itemDesc(item, plus) {
    if (!item) return '';
    var hp = (item.effect && item.effect.maxHp) ? (' 生命+' + item.effect.maxHp) : '';
    if (item.type === 'consumable') {
      /* S-03：强化卷轴（scroll:true）不靠 effect 字段，单独描述 */
      if (item.scroll === true) return '强化装备 +1（上限 +5）';
      var parts = [];
      if (item.effect && item.effect.hp) parts.push('恢复HP+' + item.effect.hp);
      if (item.effect && item.effect.mp) parts.push('恢复MP+' + item.effect.mp);
      return parts.length ? parts.join(' ') : '回复道具';
    }
    /* D-28：plus 只在背包上下文传入；商店/图鉴不传（默认 0）→ 仍显示原始基础值 */
    if (item.type === 'weapon') return '攻击+' + effOf((item.effect && item.effect.atk) || 0, plus) + hp;
    if (item.type === 'armor') return '防御+' + effOf((item.effect && item.effect.def) || 0, plus) + hp;
    return '';
  }

  /* S-03：背包行强化后缀 +N（只对已强化的武器/护甲有意义；商店卖的是未强化新货，不加后缀） */
  function upgSuffix(id) {
    var p = Game.Data && Game.Data.Player;
    var n = (p && p.upg && p.upg[id]) || 0;
    return n > 0 ? ' +' + n : '';
  }

  /* D-30：物品 id → 图标名只查显式表（Game.Data.ITEM_ICONS，见 js/data/items.js）。
   * 表缺失或该 id 未登记 → null（不再按 id 命名规则猜；画不出图标就退回纯文字行）。
   * 品质变体（_rare/_epic）在表里逐条写明，映射关系可机器读、可断言。 */
  function itemIcon(id) {
    if (typeof id !== 'string' || !id) return null;
    var map = Game.Data && Game.Data.ITEM_ICONS;
    if (!map || !Object.prototype.hasOwnProperty.call(map, id)) return null;
    var name = map[id];
    var S = Game.Core && Game.Core.Sprites;
    if (!S || typeof S.get !== 'function') return null;
    return S.get(name) || null;
  }

  /* M8-4：枚举数据表为图鉴条目 [{id, def}]（保持插入序；for-in + hasOwnProperty） */
  function collectEntries(dict) {
    var out = [];
    for (var id in dict) {
      if (Object.prototype.hasOwnProperty.call(dict, id)) out.push({ id: id, def: dict[id] });
    }
    return out;
  }

  /* ---------- D-85（C-7）：M 面板第 4 页「系统」 ----------
   * buildSystemRows(width) 纯只读：只读 Game.Data.Player / Game.Data.* 与
   * Battle.dragonDread()，不改玩家状态、不写存档、不消耗随机数。
   * 返回字符串数组（每行一条），三档排版：
   *   全宽（w ≥ 520 或宽度未知）→ 最多 12 行（龙战 12 / 非龙战 11）
   *   中屏 420 ≤ w < 520        → 去掉三个分区表头，第 2/3/10 行压缩
   *   窄屏 w < 420              → 固定 6 行，第 6 行顶替（龙威 / 估算） */
  function sysNum(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : (d || 0); }

  function sysMMSS(ms) {
    var t = Math.max(0, Math.floor(sysNum(ms, 0) / 1000));
    var m = Math.floor(t / 60), s = t % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* 龙威（§1.5）——只读 dragonDread()，分段常量不在这里重写。
   * D-87：拆成 parts + 文本行，画布仪表盘与文本行共用同一份快照（不产生第二套口径）。 */
  function sysDreadParts() {
    var B = Game.Systems && Game.Systems.Battle;
    if (!B || typeof B.dragonDread !== 'function') return null;
    var d = null;
    try { d = B.dragonDread(); } catch (e) { return null; }
    if (!d || typeof d.tier !== 'number') return null;
    var tier = d.tier, round = sysNum(d.round, 0), bonus = sysNum(d.bonus, 0);
    var next = (tier <= 0) ? 9 : (tier === 1 ? 13 : (tier === 2 ? 17 : 0));
    return {
      tier: tier, round: round, bonus: bonus,
      nextRound: next, left: next ? Math.max(0, next - round) : 0
    };
  }
  function sysDreadLine(parts) {
    var p = parts || sysDreadParts();
    if (!p) return null;
    var val;
    if (p.tier <= 0) val = '未启动（第 9 回合开始）';
    else if (p.tier === 1) val = '+' + p.bonus + '（第 1/3 段，' + Math.max(0, 13 - p.round) + ' 回合后升档）';
    else if (p.tier === 2) val = '+' + p.bonus + '（第 2/3 段，' + Math.max(0, 17 - p.round) + ' 回合后升档）';
    else val = '+' + p.bonus + '（第 3/3 段，已到顶）';
    return '龙威 ' + val;
  }

  /* 「下一突破」——两段累加都用 Battle.expToNext，不写死 2450 之外的第二个常量 */
  function sysBreakthroughParts() {
    var P = Game.Data.Player || {};
    var B = Game.Systems && Game.Systems.Battle;
    var lv = sysNum(P.level, 1);
    if (lv >= 11) {
      var G = Game.Data.GROWTH;
      var ms = (G && G.milestones && G.milestones[11]) || null;
      if (!ms) return null;
      return { kind: 'done', ms: ms };
    }
    if (!B || typeof B.expToNext !== 'function') return null;
    var need = 0, have = sysNum(P.exp, 0), i;
    for (i = 1; i <= 10; i++) need += sysNum(B.expToNext(i), 0);
    for (i = 1; i < lv; i++) have += sysNum(B.expToNext(i), 0);
    return {
      kind: (have >= need) ? 'ready' : 'next',
      need: need, have: Math.min(have, need), remain: Math.max(0, need - have)
    };
  }
  function sysBreakthroughLine(parts) {
    var p = parts || sysBreakthroughParts();
    if (!p) return null;
    if (p.kind === 'done') {
      var ms = p.ms;
      return '已突破：攻击 +' + sysNum(ms.atk, 0) + ' · 防御 +' + sysNum(ms.def, 0) +
        ' · 生命 +' + sysNum(ms.maxHp, 0);
    }
    if (p.kind === 'ready') return '下一突破：Lv.11 可突破';
    return '下一突破：Lv.11 还差 ' + p.remain + ' 经验';
  }

  /* 武器共鸣——基础取 ITEMS[id].effect.atk，有效值走 Inventory.atkOf（唯一口径）。
   * D-87：gain = 有效值 − 基础值，就是"等级在放大它"的那一段；gain=0 的武器如实显示 0。 */
  function sysWeaponParts() {
    var P = Game.Data.Player || {};
    var IT = Game.Data.ITEMS || {};
    var id = P.equipment && P.equipment.weapon;
    if (!id || !IT[id]) return null;
    var I = Game.Systems && Game.Systems.Inventory;
    var lv = sysNum(P.level, 1);
    var base = sysNum(IT[id].effect && IT[id].effect.atk, 0);
    var eff = (I && typeof I.atkOf === 'function') ? sysNum(I.atkOf(id, lv), base) : base;
    var upg = sysNum(P.upg && P.upg[id], 0);
    return {
      id: id, name: IT[id].name || id, base: base, eff: eff,
      gain: eff - base, plus: upg, level: lv,
      growth: !!(IT[id].growth && IT[id].growth.length)
    };
  }
  function sysWeaponLine(parts) {
    var w = parts || sysWeaponParts();
    if (!w) return null;
    return '武器共鸣：' + w.name + ' 攻击 ' + w.eff + '（基础 ' + w.base + ' + 等级 ' + w.gain + '）';
  }

  /* 档案：精英刀 owned/5 · 图鉴 known/18 · 任务 done/12 */
  function sysArchiveParts() {
    var D = Game.Data || {};
    var P = D.Player || {};
    var IT = D.ITEMS || {};
    var M = D.MONSTERS || {};
    var Q = D.QUESTS || [];
    var inv = P.inventory || {};
    var eq = P.equipment || {};
    var owned = 0, k;
    for (k in IT) {
      if (!Object.prototype.hasOwnProperty.call(IT, k)) continue;
      if (IT[k].elite === true && IT[k].type === 'weapon' &&
          (sysNum(inv[k], 0) > 0 || eq.weapon === k)) owned++;
    }
    var Bst = Game.Systems && Game.Systems.Bestiary;
    var known = 0;
    for (k in M) {
      if (!Object.prototype.hasOwnProperty.call(M, k)) continue;
      if (Bst && typeof Bst.getMonsterCount === 'function' && sysNum(Bst.getMonsterCount(k), 0) > 0) known++;
    }
    var Qs = Game.Systems && Game.Systems.Quest;
    var done = 0;
    for (k = 0; k < Q.length; k++) {
      if (Qs && typeof Qs.isDone === 'function' && Qs.isDone(Q[k].id)) done++;
    }
    return { owned: owned, known: known, done: done };
  }

  /* 环境：主题取 themes 数组；Boss 按 bosses 的 floor 匹配 */
  function sysEnvParts() {
    var D = Game.Data || {};
    var P = D.Player || {};
    var MAPS = D.MAPS || {};
    var M = D.MONSTERS || {};
    var floor = Math.max(1, sysNum(P.floor, 1));
    var theme = '未知';
    if (MAPS.themes && MAPS.themes[floor - 1] && MAPS.themes[floor - 1].name) {
      theme = MAPS.themes[floor - 1].name;
    }
    var boss = '无首领';
    var list = MAPS.bosses || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].floor === floor) {
        var md = M[list[i].id];
        boss = md && md.name ? md.name : list[i].id;
        break;
      }
    }
    return { floor: floor, theme: theme, boss: boss };
  }

  /* 窄屏第 6 行的估算：本层权重最高的普通怪 / 玩家每击有效伤害 */
  function sysEstimateLine() {
    var D = Game.Data || {};
    var P = D.Player || {};
    var MAPS = D.MAPS || {};
    var M = D.MONSTERS || {};
    var floor = Math.max(1, sysNum(P.floor, 1));
    var table = (MAPS.enemyTable && MAPS.enemyTable[floor - 1]) || null;
    if (!table || !table.length) return null;
    var best = table[0];
    for (var i = 1; i < table.length; i++) {
      if (sysNum(table[i].rate, 0) > sysNum(best.rate, 0)) best = table[i];
    }
    var md = M[best.id];
    if (!md) return null;
    var per = Math.max(1, sysNum(P.atk, 1) - sysNum(md.def, 0));
    var rounds = Math.max(1, Math.ceil(sysNum(md.hp, 1) / per));
    return '约' + rounds + '回合/只（估算）';
  }

  /* D-87：唯一的只读快照。文本行与画布仪表盘都只读这一份，画布上每个数字都能在
   * 文本行里找到同一来源（不做第二套计算）。纯读取：不改 Player、不写存档、不掷随机数。 */
  function sysModel() {
    var P = Game.Data.Player || {};
    var B = Game.Systems && Game.Systems.Battle;
    var lv = sysNum(P.level, 1);
    var exp = sysNum(P.exp, 0);
    var atk = sysNum(P.atk, 0), def = sysNum(P.def, 0);
    var hp = sysNum(P.hp, 0), maxHp = sysNum(P.maxHp, 0);
    var gold = sysNum(P.gold, 0), floor = Math.max(1, sysNum(P.floor, 1));
    var expNext = (B && typeof B.expToNext === 'function') ? sysNum(B.expToNext(lv), 0) : 0;

    var S = Game.Core && Game.Core.Main;
    var st = (S && typeof S.getRunStats === 'function') ? S.getRunStats(true) : null;
    var known = !!(st && st.known !== false);
    var killed = known ? sysNum(st.kills, 0) : 0;
    var turns = known ? sysNum(st.turns, 0) : 0;
    var potions = known ? sysNum(st.potions, 0) : 0;
    var rescues = known ? sysNum(st.rescues, 0) : 0;
    var maxLevel = known ? sysNum(st.maxLevel, lv) : lv;
    var floorReached = known ? sysNum(st.floorReached, floor) : floor;
    var elapsed = (S && typeof S.getElapsedMs === 'function') ? S.getElapsedMs() : 0;

    var gr = (S && typeof S.getRunGrowth === 'function') ? S.getRunGrowth() : null;
    var growth = null;
    if (gr) {
      var delta = sysNum(gr.delta, sysNum(gr.atk, atk) - sysNum(gr.startAtk, atk));
      growth = { startAtk: sysNum(gr.startAtk, atk), atk: sysNum(gr.atk, atk), delta: delta };
    }
    return {
      lv: lv, exp: exp, expNext: expNext, remain: Math.max(0, expNext - exp),
      atk: atk, def: def, hp: hp, maxHp: maxHp,
      gold: gold, floor: floor, known: known, killed: killed, turns: turns,
      potions: potions, rescues: rescues, maxLevel: maxLevel, floorReached: floorReached,
      elapsed: elapsed, growth: growth,
      arch: sysArchiveParts(), env: sysEnvParts(),
      dread: sysDreadParts(), dreadText: sysDreadLine(),
      weapon: sysWeaponParts(), brk: sysBreakthroughParts(),
      estimate: sysEstimateLine()
    };
  }

  function buildSystemRows(width, model) {
    var M = model || sysModel();
    var lv = M.lv, exp = M.exp, expNext = M.expNext;
    var atk = M.atk, def = M.def, hp = M.hp, maxHp = M.maxHp;
    var gold = M.gold, floor = M.floor;
    var known = M.known, killed = M.killed, turns = M.turns, potions = M.potions, rescues = M.rescues;
    var maxLevel = M.maxLevel, floorReached = M.floorReached, elapsed = M.elapsed;
    var gr = M.growth, arch = M.arch, env = M.env, dread = M.dreadText;
    var w = (typeof width === 'number' && isFinite(width) && width > 0) ? width : 0;

    /* 窄屏：固定 6 行，第 6 行顶替 */
    if (w && w < 420) {
      var out6 = [];
      out6.push('Lv.' + lv + ' 经验 ' + exp + '/' + expNext);
      out6.push('攻' + atk + ' 防' + def + ' 血' + hp + '/' + maxHp + ' 金' + gold + ' F' + floor);
      out6.push('击杀' + killed + ' 回合' + turns + ' 药水' + potions + ' 救援' + rescues + '/2');
      out6.push('最高Lv' + maxLevel + ' 最深F' + floorReached + ' ' + sysMMSS(elapsed));
      var wl = sysWeaponLine(M.weapon);
      out6.push(wl ? wl : '档案 ' + arch.owned + '/5 ' + arch.known + '/18 ' + arch.done + '/12');
      var est = M.estimate;
      out6.push(dread ? dread : (est ? est : '本层无普通怪'));
      return out6;
    }

    /* 中屏：去掉三个分区表头，压缩第 2/3/10 行 */
    var mid = !!(w && w < 520);
    var rows = [];
    if (!mid) rows.push('【宿主】');
    rows.push(mid ? ('Lv.' + lv + ' 经验 ' + exp + '/' + expNext)
      : ('系统 · Lv.' + lv + ' · 经验 ' + exp + '/' + expNext));
    rows.push(mid ? ('攻' + atk + ' 防' + def + ' 血' + hp + '/' + maxHp + ' 金' + gold + ' F' + floor)
      : ('攻击 ' + atk + ' · 防御 ' + def + ' · 生命 ' + hp + '/' + maxHp + ' · 金币 ' + gold + ' · 第 ' + floor + ' 层'));
    if (!mid) rows.push('【本局】');
    if (known) rows.push('击杀 ' + killed + ' · 回合 ' + turns + ' · 药水 ' + potions + ' · 救援 ' + rescues + '/2');
    if (known) rows.push('最高等级 ' + maxLevel + ' · 最深层 ' + floorReached + ' · 用时 ' + sysMMSS(elapsed));
    if (gr) {
      var delta = sysNum(gr.delta, sysNum(gr.atk, atk) - sysNum(gr.startAtk, atk));
      rows.push('本局成长：攻击 ' + sysNum(gr.startAtk, atk) + ' → ' + sysNum(gr.atk, atk) +
        '（' + (delta >= 0 ? '+' + delta : String(delta)) + '）');
    }
    var brk = sysBreakthroughLine(M.brk);
    if (brk) rows.push(brk);
    var wl2 = sysWeaponLine(M.weapon);
    if (wl2) rows.push(wl2);
    if (!mid) rows.push('【档案】精英刀 ' + arch.owned + '/5 · 图鉴 ' + arch.known + '/18 · 任务 ' + arch.done + '/12');
    else rows.push('档案 ' + arch.owned + '/5 ' + arch.known + '/18 ' + arch.done + '/12');
    rows.push('【环境】第 ' + env.floor + ' 层 · ' + env.theme + ' · Boss ' + env.boss);
    if (dread) rows.push(dread);
    return rows;
  }

  /* ---------- D-87：第 4 页「系统」仪表盘 ----------
   * 只画、不读状态的第二来源：所有数字来自 sysModel()（与文本行同一份快照）。
   * 像素纪律：坐标/宽度一律取整，1px 边框落在 .5 偏移上；图标只走 Render.drawIcon（原生 1:1）。
   * 版式三档与文本行同宽阈值（<420 窄 / <520 中 / 其余全宽），高度由面板行数决定，
   * 容量不够时压缩条带与字号，不新增页、不改行数。 */
  var SYS_C = {
    label: '#8a8aa0', text: '#cfcfcf', gold: '#ffcf6e', goldDim: '#6b5a2e',
    cyan: '#7fd1ff', blue: '#9bbbf4', green: '#4ade80', dim: '#5f6578',
    trackBg: '#1c1c33', trackEdge: '#3a3a5c', cellFill: '#2a2a44',
    base: '#4a5060', chipBg: '#1b1b30', name: '#e8e2d0'
  };

  function sr(v) { return Math.round(v); }
  function sysBox(c, x, y, w, h, fill) {
    c.fillStyle = fill; c.fillRect(sr(x), sr(y), sr(w), sr(h));
  }
  function sysEdge(c, x, y, w, h, col) {
    c.strokeStyle = col; c.lineWidth = 1;
    c.strokeRect(sr(x) + 0.5, sr(y) + 0.5, sr(w) - 1, sr(h) - 1);
  }
  function sysTxt(c, s, x, y, font, col, align) {
    c.font = font; c.fillStyle = col; c.textAlign = align || 'left';
    c.fillText(String(s), sr(x), sr(y));
    c.textAlign = 'left';
    return c.measureText(String(s)).width;
  }
  /* 连续条：整数像素填充 + 1px 外框（ratio 0..1） */
  function sysBar(c, x, y, w, h, ratio, col, bg, edgeCol) {
    var W = Math.max(1, sr(w)), H = Math.max(2, sr(h));
    sysBox(c, x, y, W, H, bg || SYS_C.trackBg);
    var f = Math.round(W * Math.max(0, Math.min(1, ratio)));
    if (f > 0) sysBox(c, x, y, f, H, col);
    if (edgeCol) sysEdge(c, x, y, W, H, edgeCol);
    return { x: sr(x), y: sr(y), w: W, h: H, fill: f };
  }
  /* 分段条：n 段等宽，每段间隔 1px（进度条用，刻度感来自间隔而非半透明） */
  function sysSegBar(c, x, y, w, h, ratio, col, n) {
    var W = Math.max(1, sr(w)), H = Math.max(2, sr(h));
    var segs = Math.max(1, n | 0);
    var sw = Math.max(1, Math.floor((W - (segs - 1)) / segs));
    var on = Math.round(segs * Math.max(0, Math.min(1, ratio)));
    for (var i = 0; i < segs; i++) {
      sysBox(c, x + i * (sw + 1), y, sw, H, i < on ? col : SYS_C.trackBg);
    }
    return { x: sr(x), y: sr(y), w: W, h: H, seg: sw, on: on, n: segs };
  }

  /* 版式度量：返回条带矩形与所有可断言的图元（验证页与绘制共用同一份） */
  function sysLayout(x, top, w, avail, narrow, mid, M) {
    /* 版式不只按宽度：高度装不下全宽条带时逐级压缩（不改行数/容量，只压排版） */
    var v = narrow ? 2 : (mid ? 1 : 0);
    if (v === 0 && avail < 330) v = 1;
    if (v === 1 && avail < 250) v = 2;
    narrow = (v === 2); mid = (v === 1);
    var spec = narrow
      ? [['identity', 15], ['growth', 44], ['weapon', 42], ['run', 22], ['arch', 15], ['env', 15]]
      : (mid
        ? [['identity', 27], ['growth', 70], ['weapon', 58], ['run', 42], ['arch', 22], ['env', 17]]
        : [['identity', 33], ['growth', 82], ['weapon', 68], ['run', 58], ['arch', 24], ['env', 19]]);
    if (M && M.dreadText) spec.push(['dread', narrow ? 13 : (mid ? 17 : 19)]);
    var sum = 0, i;
    for (i = 0; i < spec.length; i++) sum += spec[i][1];
    var n = spec.length;
    /* 间距按剩余高度均分：先保证 sum + gap*(n-1) ≤ avail（不越界是硬线），再限制上限避免过散 */
    var gap = (n > 1) ? Math.floor((avail - sum) / (n - 1)) : 0;
    if (!isFinite(gap) || gap < 0) gap = 0;
    if (gap > 12) gap = 12;
    var used = sum + gap * (n - 1);
    var y = top + Math.max(0, Math.floor((avail - used) / 2));
    var bands = {};
    for (i = 0; i < n; i++) {
      bands[spec[i][0]] = { x: x, y: y, w: w, h: spec[i][1] };
      y += spec[i][1] + gap;
    }
    return { x: x, top: top, w: w, avail: avail, gap: gap, bands: bands,
      narrow: narrow, mid: mid, variant: narrow ? 'narrow' : (mid ? 'mid' : 'full') };
  }

  /* 宿主条：Lv + 四枚属性芯片（放不下就从右往左丢，绝不压字） */
  function sysPaintIdentity(c, r, M, L) {
    var x = r.x, y = r.y, w = r.w;
    var narrow = L.narrow, mid = L.mid;
    sysTxt(c, narrow ? '宿主' : '宿 主', x, y + (narrow ? 11 : 15), '11px monospace', SYS_C.label);
    var lx = x + (narrow ? 30 : 38);
    var lvW = sysTxt(c, 'Lv.' + M.lv, lx, y + (narrow ? 13 : (mid ? 20 : 23)),
      'bold ' + (narrow ? 14 : (mid ? 17 : 20)) + 'px monospace', SYS_C.gold);
    var chips = narrow
      ? [['攻', M.atk], ['防', M.def], ['金', M.gold]]
      : [['攻', M.atk], ['防', M.def], ['血', M.hp + '/' + M.maxHp], ['金', M.gold]];
    var fs = narrow ? '9px' : '10px';
    var ch = narrow ? 13 : 16;
    var right = x + w, made = [];
    c.font = fs + ' monospace';
    for (var i = chips.length - 1; i >= 0; i--) {
      var s = chips[i][0] + ' ' + chips[i][1];
      var tw = Math.round(c.measureText(s).width) + 10;
      var bx = right - tw;
      if (bx < lx + lvW + 6) break;               /* 放不下就停，不重叠 */
      sysBox(c, bx, y + (narrow ? 0 : 1), tw, ch, SYS_C.chipBg);
      sysEdge(c, bx, y + (narrow ? 0 : 1), tw, ch, SYS_C.trackEdge);
      sysTxt(c, s, bx + 5, y + (narrow ? 10 : 13), fs + ' monospace', SYS_C.text);
      made.push({ x: sr(bx), y: sr(y), w: tw, h: ch });
      right = bx - 4;
    }
    L.chips = made.reverse();
  }

  /* 成长账本：等级格（我在哪 / 下一格）+ 本级经验条 + 突破条 */
  function sysPaintGrowth(c, r, M, L) {
    var x = r.x, y = r.y, w = r.w;
    var narrow = L.narrow, mid = L.mid;
    var n = 11;
    var remain = Math.max(0, M.expNext - M.exp);
    sysTxt(c, '成长账本', x, y + (narrow ? 10 : 12), '11px monospace', SYS_C.label);
    var head = narrow ? ('经验 ' + M.exp + '/' + M.expNext + ' · 差 ' + remain)
      : ('经验 ' + M.exp + '/' + M.expNext + ' · 还差 ' + remain);
    sysTxt(c, head, x + w, y + (narrow ? 10 : 12), '11px monospace',
      SYS_C.blue, 'right');

    /* 等级格：窄屏只开当前附近的 5 格窗口（左右用 … 标记还有格子） */
    var ty = y + (narrow ? 14 : 18);
    var th = narrow ? 11 : (mid ? 16 : 19);
    var winFrom = 1, winTo = n;
    if (narrow) { winFrom = Math.max(1, M.lv - 2); winTo = Math.min(n, winFrom + 4); winFrom = Math.max(1, winTo - 4); }
    var total = winTo - winFrom + 1;
    var gapC = narrow ? 2 : 3;
    var markL = (narrow && winFrom > 1) ? 10 : 0;
    var markR = (narrow && winTo < n) ? 10 : 0;
    var cellW = Math.max(6, Math.floor((w - markL - markR - gapC * (total - 1)) / total));
    var realW = cellW * total + gapC * (total - 1);
    var cx0 = x + markL + Math.floor((w - markL - markR - realW) / 2);
    if (markL) sysTxt(c, '‹', x + 1, ty + th - 2, '10px monospace', SYS_C.dim);
    if (markR) sysTxt(c, '›', x + w - 6, ty + th - 2, '10px monospace', SYS_C.dim);
    var cells = [];
    for (var i = winFrom; i <= winTo; i++) {
      var cxi = cx0 + (i - winFrom) * (cellW + gapC);
      var isPast = i < M.lv, isNow = i === M.lv, isNext = i === M.lv + 1;
      var fill = isNow ? SYS_C.gold : (isPast ? SYS_C.goldDim : (isNext ? SYS_C.cellFill : SYS_C.trackBg));
      var edge = isNow ? SYS_C.gold : (isNext ? SYS_C.gold : SYS_C.trackEdge);
      sysBox(c, cxi, ty, cellW, th, fill);
      sysEdge(c, cxi, ty, cellW, th, edge);
      var tc = isNow ? '#14142a' : (isNext ? SYS_C.gold : (isPast ? '#d8c58a' : SYS_C.dim));
      sysTxt(c, i, cxi + cellW / 2, ty + th - Math.max(2, Math.floor((th - 9) / 2) + 1),
        (th >= 16 ? '10px' : '9px') + ' monospace', tc, 'center');
      cells.push({ lv: i, x: cxi, y: ty, w: cellW, h: th, now: isNow, next: isNext, past: isPast });
    }
    /* 当前格上方的指示三角 + 突破格（Lv.11）的顶标 */
    var nowCell = null, nextCell = null, msCell = null;
    for (i = 0; i < cells.length; i++) {
      if (cells[i].now) nowCell = cells[i];
      if (cells[i].next) nextCell = cells[i];
      if (cells[i].lv === 11) msCell = cells[i];
    }
    if (nowCell) {
      c.fillStyle = SYS_C.gold;
      var tcx = sr(nowCell.x + nowCell.w / 2);
      c.beginPath();
      c.moveTo(tcx - 3, ty - 4); c.lineTo(tcx + 3, ty - 4); c.lineTo(tcx, ty - 1);
      c.closePath(); c.fill();
    }
    if (msCell && !msCell.now) {
      sysBox(c, msCell.x + Math.floor(msCell.w / 2) - 1, msCell.y - 3, 3, 2, SYS_C.gold);
    }

    /* 本级经验条 + 突破条 */
    var by = ty + th + (narrow ? 3 : 5);
    var bh = narrow ? 7 : (mid ? 8 : 9);
    var labelW = narrow ? 0 : (mid ? 56 : 62);
    var valW = narrow ? 0 : 72;
    var barX = x + labelW;
    var barW = Math.max(20, w - labelW - (narrow ? 0 : valW));
    var ePct = M.expNext > 0 ? Math.min(1, M.exp / M.expNext) : 1;
    if (!narrow) {
      sysTxt(c, '本级', x, by + bh - 1, '10px monospace', SYS_C.label);
    }
    L.expBar = sysSegBar(c, barX, by, barW, bh, ePct, SYS_C.cyan, 10);
    L.expBar.ratio = ePct;
    /* D-114：经验读数只在表头写一次（含"还差"），这里不再重复 exp/expNext */
    var brk = M.brk;
    var bpt = 0, btxt = '';
    if (brk && brk.kind === 'done') { bpt = 1; btxt = '已突破'; }
    else if (brk && brk.kind === 'ready') { bpt = 1; btxt = 'Lv.11 可突破'; }
    else if (brk && brk.need > 0) { bpt = brk.have / brk.need; btxt = '还差 ' + brk.remain; }
    var by2 = by + bh + (narrow ? 3 : 4);
    var bh2 = narrow ? 4 : 5;
    if (!narrow) sysTxt(c, '突破 Lv.11', x, by2 + bh2, '10px monospace', SYS_C.label);
    L.brkBar = sysBar(c, barX, by2, barW, bh2, bpt, '#8a7440', SYS_C.trackBg, SYS_C.trackEdge);
    L.brkBar.ratio = bpt;
    if (!narrow) sysTxt(c, btxt, x + w, by2 + bh2, '10px monospace', SYS_C.gold, 'right');
    L.track = { x: cx0, y: ty, w: realW, h: th, cells: cells, winFrom: winFrom, winTo: winTo };
    L.remain = remain;
  }

  /* 武器共鸣：图标 24×24 原生 + 基础/等级成长两段条（等级不放大时如实全灰） */
  function sysPaintWeapon(c, r, M, L) {
    var x = r.x, y = r.y, w = r.w;
    var narrow = L.narrow, mid = L.mid;
    var wp = M.weapon;
    var eff = wp ? wp.eff : 0;
    /* 标题行：左「武器共鸣」，右「武器 N」——这里 N 是武器自身的有效攻击（基础+等级成长），
     * 不是宿主总攻击（总攻击只在宿主芯片出一次，D-114 去重：同名事实不许两种数值）。 */
    sysTxt(c, '武器共鸣', x, y + (narrow ? 9 : 11), '10px monospace', SYS_C.label);
    sysTxt(c, '武器 ' + eff, x + w, y + (narrow ? 10 : 13),
      'bold ' + (narrow ? 12 : (mid ? 14 : 16)) + 'px monospace', SYS_C.gold, 'right');

    var icon = wp ? itemIcon(wp.id) : null;
    var iy = y + (narrow ? 12 : (mid ? 13 : 15));
    var Rr = Game.Core && Game.Core.Render;
    /* 图标槽：24×24 深底 + 1px 框，让细长刀具也能读成"一件装备"；图标本身仍原生 1:1 */
    sysBox(c, x - 1, iy - 1, 26, 26, '#232338');
    sysEdge(c, x - 1, iy - 1, 26, 26, '#565f78');
    if (icon && Rr && typeof Rr.drawIcon === 'function') {
      L.icon = Rr.drawIcon(c, icon, x, iy);   /* 原生 24×24 1:1，不做任何缩放 */
      L.icon.native = { w: icon.naturalWidth || 24, h: icon.naturalHeight || 24 };
    } else {
      L.icon = { x: sr(x), y: sr(iy), w: 24, h: 24, native: null };
    }
    var tx = x + 30;
    var name = wp ? wp.name : '未装备';
    sysTxt(c, name, tx, y + (narrow ? 22 : (mid ? 26 : 30)),
      (narrow ? '11px' : (mid ? '12px' : '13px')) + ' monospace', SYS_C.name);

    var gain = wp ? wp.gain : 0;
    var base = wp ? wp.base : 0;
    var by = y + (narrow ? 26 : (mid ? 39 : 42));
    var bh = narrow ? 6 : (mid ? 7 : 9);
    var barW = Math.max(20, w - 30);
    var fw = 0;
    if (eff > 0) fw = Math.round(barW * (base / eff));
    sysBox(c, tx, by, barW, bh, SYS_C.trackBg);
    if (fw > 0) sysBox(c, tx, by, fw, bh, SYS_C.base);
    if (eff > fw) sysBox(c, tx + fw, by, barW - fw, bh, SYS_C.gold);
    sysEdge(c, tx, by, barW, bh, SYS_C.trackEdge);
    L.weaponBar = { x: sr(tx), y: sr(by), w: sr(barW), h: sr(bh), baseW: fw, gainW: sr(barW) - fw, ratio: eff > 0 ? base / eff : 0 };
    var ly = by + bh + (narrow ? 7 : 9);
    sysTxt(c, '基础 ' + base, tx, ly, (narrow ? '9px' : '10px') + ' monospace', '#9aa0ad');
    var gtxt = (gain > 0) ? ('等级 +' + gain) : '不随等级成长';
    sysTxt(c, gtxt, x + w, ly, (narrow ? '9px' : '10px') + ' monospace', gain > 0 ? SYS_C.gold : SYS_C.dim, 'right');
    if (wp && wp.plus > 0 && !narrow) {
      sysTxt(c, '强化 +' + wp.plus, tx + 62, ly, '10px monospace', SYS_C.cyan);
    }
  }

  /* 本局 + 档案 + 环境 + 龙威 */
  function sysPaintRun(c, r, M, L) {
    var x = r.x, y = r.y, w = r.w;
    var narrow = L.narrow, mid = L.mid;
    var fs = narrow ? '10px' : '11px';
    if (narrow) {
      sysTxt(c, '击杀' + M.killed + ' 回合' + M.turns + ' 药水' + M.potions + ' 救援' + M.rescues + '/2',
        x, y + 9, fs + ' monospace', SYS_C.text);
      sysTxt(c, '最高Lv' + M.maxLevel + ' 最深F' + M.floorReached + ' ' + sysMMSS(M.elapsed),
        x, y + 20, fs + ' monospace', SYS_C.text);
      return;
    }
    sysTxt(c, '本局', x, y + 11, '11px monospace', SYS_C.label);
    if (mid) {
      if (M.growth) {
        var gd = (M.growth.delta >= 0 ? '+' + M.growth.delta : String(M.growth.delta));
        sysTxt(c, '本局成长：攻击 ' + M.growth.startAtk + ' → ' + M.growth.atk + '（' + gd + '）',
          x + w, y + 11, '11px monospace', SYS_C.green, 'right');
      }
    }
    sysTxt(c, '击杀 ' + M.killed + ' · 回合 ' + M.turns + ' · 药水 ' + M.potions + ' · 救援 ' + M.rescues + '/2',
      x, y + (mid ? 24 : 27), fs + ' monospace', SYS_C.text);
    sysTxt(c, '最高等级 ' + M.maxLevel + ' · 最深层 ' + M.floorReached + ' · 用时 ' + sysMMSS(M.elapsed),
      x, y + (mid ? 37 : 41), fs + ' monospace', SYS_C.text);
    if (!mid) {
      if (M.growth) {
        var gd2 = (M.growth.delta >= 0 ? '+' + M.growth.delta : String(M.growth.delta));
        sysTxt(c, '本局成长：攻击 ' + M.growth.startAtk + ' → ' + M.growth.atk,
          x, y + 55, fs + ' monospace', SYS_C.text);
        sysTxt(c, '（' + gd2 + '）', x + 96, y + 55, fs + ' monospace', SYS_C.green);
      } else {
        sysTxt(c, '本局成长：读档继续（无起点）', x, y + 55, fs + ' monospace', SYS_C.dim);
      }
    }
  }

  function sysPaintArch(c, r, M, L) {
    var x = r.x, y = r.y, w = r.w;
    var narrow = L.narrow, mid = L.mid;
    var a = M.arch;
    if (narrow) {
      /* D-118：窄档不许单字缩写（刀/鉴/任 读不出词义）。先按完整词排一行；
       * 只有实测真的放不下才换排版（折两行、降到既有 9px 档），绝不把词砍成一个字。 */
      var s1 = '精英刀 ' + a.owned + '/5 · 图鉴 ' + a.known + '/18 · 任务 ' + a.done + '/12';
      c.font = '10px monospace';
      var tw = c.measureText(s1).width;
      if (tw <= w) {
        sysTxt(c, s1, x, y + 10, '10px monospace', SYS_C.blue);
        L.arch = { text: s1, w: Math.round(tw), lines: 1, font: '10px' };
      } else {
        var la = '精英刀 ' + a.owned + '/5 · 图鉴 ' + a.known + '/18';
        var lb = '任务 ' + a.done + '/12';
        sysTxt(c, la, x, y + 9, '9px monospace', SYS_C.blue);
        sysTxt(c, lb, x, y + 18, '9px monospace', SYS_C.blue);
        c.font = '9px monospace';
        L.arch = { text: la + ' | ' + lb, w: Math.round(Math.max(c.measureText(la).width, c.measureText(lb).width)),
          lines: 2, font: '9px' };
      }
      return;
    }
    var parts = [
      ['精英刀', a.owned, 5], ['图鉴', a.known, 18], ['任务', a.done, 12]
    ];
    var colW = Math.floor((w - 2 * 10) / 3);
    for (var i = 0; i < parts.length; i++) {
      var px = x + i * (colW + 10);
      sysTxt(c, parts[i][0] + ' ' + parts[i][1] + '/' + parts[i][2], px, y + (mid ? 10 : 11),
        (mid ? '10px' : '11px') + ' monospace', SYS_C.label);
      var bw = Math.max(10, colW - 4);
      var ratio = parts[i][2] > 0 ? parts[i][1] / parts[i][2] : 0;
      var bb = sysBar(c, px, y + (mid ? 13 : 15), bw, mid ? 4 : 5, ratio,
        i === 0 ? SYS_C.gold : (i === 1 ? SYS_C.cyan : SYS_C.green), SYS_C.trackBg, SYS_C.trackEdge);
      if (!L.archBars) L.archBars = [];
      L.archBars.push(bb);
    }
  }

  function sysPaintEnv(c, r, M, L) {
    var x = r.x, y = r.y, w = r.w;
    var env = M.env;
    var s = '第 ' + env.floor + ' 层 · ' + env.theme + ' · Boss ' + env.boss;
    c.font = (L.narrow ? '10px' : '11px') + ' monospace';
    sysTxt(c, '环境', x, y + (L.narrow ? 10 : 13), '10px monospace', SYS_C.label);
    sysTxt(c, modalFit(c, s, Math.max(20, w - 34)), x + 30, y + (L.narrow ? 10 : 13),
      (L.narrow ? '10px' : '11px') + ' monospace', SYS_C.text);
  }

  function sysPaintDread(c, r, M, L) {
    var x = r.x, y = r.y, w = r.w;
    var d = M.dread;
    if (!d || !M.dreadText) return;
    sysTxt(c, M.dreadText, x, y + (L.narrow ? 10 : 14),
      (L.narrow ? '10px' : '11px') + ' monospace', d.tier > 0 ? '#ff9b6b' : SYS_C.dim);
    /* 右端 3 格档位指示：已到的段点亮 */
    var pw = 12, ph = 6, pg = 3;
    var px0 = x + w - (pw * 3 + pg * 2);
    for (var i = 1; i <= 3; i++) {
      var on = d.tier >= i;
      sysBox(c, px0 + (i - 1) * (pw + pg), y + (L.narrow ? 6 : 10), pw, ph,
        on ? (i === 3 ? '#ff5a4a' : '#ff9b6b') : SYS_C.trackBg);
      sysEdge(c, px0 + (i - 1) * (pw + pg), y + (L.narrow ? 6 : 10), pw, ph, SYS_C.trackEdge);
    }
    L.dreadPips = { x: sr(px0), y: sr(y), w: pw * 3 + pg * 2, h: ph, tier: d.tier };
  }

  /* 与 Render 无关的本地截断（绘制时字体已设好） */
  function modalFit(c, text, maxW) {
    var s = String(text);
    if (c.measureText(s).width <= maxW) return s;
    while (s.length > 0 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  /* 七块条带按 variant 逐块绘制——_drawSystem 与 _sysMetrics 共用这一条路径 */
  function sysPaintAll(c, L, M) {
    var b = L.bands;
    if (b.identity) sysPaintIdentity(c, b.identity, M, L);
    if (b.growth) sysPaintGrowth(c, b.growth, M, L);
    if (b.weapon) sysPaintWeapon(c, b.weapon, M, L);
    if (b.run) sysPaintRun(c, b.run, M, L);
    if (b.arch) sysPaintArch(c, b.arch, M, L);
    if (b.env) sysPaintEnv(c, b.env, M, L);
    if (b.dread) sysPaintDread(c, b.dread, M, L);
    return L;
  }

  Game.Modal = {
    /* D-90（S0 取舍方案）：画面层唯一可读的系统令牌。
     * 颜色与 5 个原语逐字沿用本文件既有定义，不复制第二份 SYS_C；
     * sysviz.js 通过它取色/画线，突破刻度也直接调这里的同一份 sysBreakthroughParts。 */
    _sys: {
      C: SYS_C,
      box: sysBox, edge: sysEdge, txt: sysTxt, bar: sysBar, segBar: sysSegBar,
      breakthrough: sysBreakthroughParts
    },
    /* D-28：供验证页断言"背包上下文传强化等级 / 商店图鉴走基础值"的只读入口 */
    _itemDesc: function (item, plus) { return itemDesc(item, plus); },
    /* D-85：第 4 页「系统」的只读行快照（验证页直接断言，不依赖画布像素） */
    _systemRows: function (width) { return buildSystemRows(width); },
    /* D-87：第 4 页的唯一只读快照（文本行与画布同源；验证页断言数值口径） */
    _systemModel: function () { return sysModel(); },
    /* D-87：第 4 页版式度量——用真实绘制路径画进 2×2 离屏画布，捕获每一块条带与图元矩形。
     * 只读：不改 Player/存档，不消耗随机数；不产生任何屏幕输出。 */
    _sysMetrics: function (cwIn, chIn) {
      var sz = cssSize();
      var cw = (typeof cwIn === 'number' && cwIn > 0) ? cwIn : sz.w;
      var ch = (typeof chIn === 'number' && chIn > 0) ? chIn : sz.h;
      var vr = visibleRowCount({ w: cw, h: ch });
      var M = sysModel();
      var rows = buildSystemRows(cw, M).length;
      var shown = Math.min(rows, vr);
      var W = panelWidth(cw, false);
      var H = HEADER_H + shown * ROW_H + FOOTER_H;
      var px = (cw - W) / 2, py = (ch - H) / 2;
      var narrow = cw < 420, mid = !narrow && cw < 520;
      var x = sr(px + (narrow ? 12 : 14));
      var innerW = sr(W - (narrow ? 24 : 28));
      var top = py + HEADER_H, bot = py + H - FOOTER_H;
      var L = sysLayout(x, top, innerW, bot - top, narrow, mid, M);
      var cv = null, c = null;
      try {
        cv = document.createElement('canvas');
        cv.width = 2; cv.height = 2;
        c = cv.getContext('2d');
      } catch (e) { c = null; }
      if (c) sysPaintAll(c, L, M);
      L.panel = { x: px, y: py, w: W, h: H };
      L.content = { x: x, y: top, w: innerW, h: bot - top };
      L.rows = rows; L.shown = shown; L.visibleRows = vr;
      L.model = M;
      return L;
    },
    /* D-87：第 4 页绘制入口（由 draw 分流调用；只读） */
    _drawSystem: function (c, px, py, w, h) {
      var sz = cssSize();
      var cw = sz.w;
      var narrow = cw < 420, mid = !narrow && cw < 520;
      var x = sr(px + (narrow ? 12 : 14));
      var innerW = sr(w - (narrow ? 24 : 28));
      var top = py + HEADER_H, bot = py + h - FOOTER_H;
      var M = sysModel();
      var L = sysLayout(x, top, innerW, bot - top, narrow, mid, M);
      L.panel = { x: px, y: py, w: w, h: h };
      L.content = { x: x, y: top, w: innerW, h: bot - top };
      sysPaintAll(c, L, M);
      return L;
    },
    open: function (k, stats) {
      if (k !== 'inventory' && k !== 'shop' && k !== 'quests' && k !== 'settings' && k !== 'gameover' && k !== 'npcquest' && k !== 'stairconfirm') return;
      /* D-18：连开（如死亡结算被重复触发）时先解绑旧的键盘/点击监听。
       * 原来直接 _bind() 会把上一份监听器引用覆盖掉，导致它永远删不掉：
       * 之后每次 Enter 都会被重复确认 N 次（实测长跑后一次 Enter 触发 8 次确认）。 */
      if (kind !== null) this._unbind();
      kind = k;
      sel = 0;
      armed = null;
      shopMode = 'buy';
      /* S-01：每次开张推进一次确定性换货（同级守卫，Shop 未加载时跳过） */
      if (k === 'shop' && Game.Systems.Shop && typeof Game.Systems.Shop.refresh === 'function') {
        Game.Systems.Shop.refresh();
      }
      page = 0; /* M8-4：每次打开 quests 默认回到任务页 */
      qScroll = 0; /* P2-3b：打开面板重置滚动窗口 */
      volDragging = false;
      gameStats = (k === 'gameover') ? (stats || null) : null;
      gameRestartRect = null;
      gameMenuRect = null;
      gameoverSel = 0;
      npcId = (k === 'npcquest' && stats && stats.id) ? stats.id : null;
      /* D-98：下行确认——默认焦点「取消」（sel=0），确认动作由调用方以回调传入，
       * 弹窗只负责选择与触发；changeFloor 仍是"调用即生效"，没有改成异步。 */
      stairConfirm = (k === 'stairconfirm' && stats)
        ? { floor: (stats.floor | 0) || 1, onConfirm: stats.onConfirm || null }
        : null;
      this._refresh();
      this._bind();
    },

    close: function () {
      kind = null;
      data = [];
      armed = null;
      qScroll = 0;
      volDragging = false;
      volTrack = null;
      muteRect = null;
      gameStats = null;
      gameRestartRect = null;
      gameMenuRect = null;
      gameoverSel = 0;
      stairConfirm = null;
      if (kind === 'npcquest') npcId = null;
      this._unbind();
      /* 关闭时清掉 Input 残留按键，避免移动键粘滞导致关闭瞬间移动 */
      if (Game.Core && Game.Core.Input && typeof Game.Core.Input.clear === 'function') {
        Game.Core.Input.clear();
      }
    },

    isOpen: function () { return kind !== null; },
    current: function () { return kind; },
    /* D-52：死亡结算按钮选中态（验证页断言键盘可全操作） */
    _gameoverSel: function () { return gameoverSel; },

    /* 按当前 kind 重建数据快照（调用既有系统方法，不改它们） */
    _refresh: function () {
      data = [];
      try {
        if (kind === 'inventory') data = Game.Systems.Inventory.list();
        else if (kind === 'shop') data = (shopMode === 'buy') ? Game.Systems.Shop.getStock() : Game.Systems.Inventory.list();
        else if (kind === 'quests') {
          /* M8-4：三页数据源——任务页保持 getActive（行为不变）；怪物/物品页枚举 Data 全量
           * D-85：第 4 页「系统」是只读快照（buildSystemRows），不参与选中/消耗逻辑 */
          if (page === 1) data = collectEntries(Game.Data.MONSTERS);
          else if (page === 2) data = collectEntries(Game.Data.ITEMS);
          else if (page === 3) {
            var sysRows = buildSystemRows(cssSize().w);
            data = [];
            for (var si = 0; si < sysRows.length; si++) data.push({ text: sysRows[si], sys: true });
          }
          else data = Game.Systems.Quest.getActive();
        }
        /* D-47：NPC 任务面板——行文本来自 NpcQuest.panel（四态 + 操作提示） */
        else if (kind === 'npcquest') {
          data = (Game.Systems.NpcQuest && typeof Game.Systems.NpcQuest.panel === 'function')
            ? Game.Systems.NpcQuest.panel(npcId) : [];
        }
        /* D-98：下行确认——两行固定文案，默认停在「取消」（与 D-91 的确认页同口径） */
        else if (kind === 'stairconfirm') {
          var sf = (stairConfirm && stairConfirm.floor) ? stairConfirm.floor : 1;
          data = [{ text: '取消' }, { text: '进入第 ' + sf + ' 层' }];
        }
        /* gameover 无列表，战绩在 _drawGameover 现场拉取 */
      } catch (e) { data = []; }
      sel = clamp(sel, 0, Math.max(data.length - 1, 0));
      /* P2-3b/C-03：数据变化后把滚动窗口夹回有效区间（列表超出当前可见行数时生效） */
      var maxScroll = Math.max(0, data.length - visibleRowCount(cssSize()));
      if (qScroll > maxScroll) qScroll = maxScroll;
      if (qScroll < 0) qScroll = 0;
      armed = null; /* D-100：数据快照变了，上一次的"已选中"不再可信 */
    },

    _bind: function () {
      var self = this;
      var cv = canvas();
      onKey = function (e) {
        if (!self.isOpen()) return;
        var c = e.code;
        if (c === 'Escape') {
          e.preventDefault();
          /* 修复：死亡结算不允许 Esc 关闭。原逻辑关闭后留下 hp=0 且已清档的探索场景，
           * 玩家无法重新开始也无法正常继续。 */
          if (kind === 'gameover') return;
          self.close(); return;
        }
        /* M9-4：设置面板键盘——左右调音量、空格/回车切换静音 */
        if (kind === 'settings') {
          if (c === 'ArrowLeft') { e.preventDefault(); self._adjVolume(-0.05); return; }
          if (c === 'ArrowRight') { e.preventDefault(); self._adjVolume(0.05); return; }
          if (c === 'Space' || c === 'Enter' || c === 'NumpadEnter') { e.preventDefault(); self._toggleMute(); return; }
          return;
        }
        /* M9-5：死亡结算——回车/R/空格重新开始；D-52：←→ 切换按钮，Enter 确认 */
        if (kind === 'gameover') {
          if (c === 'ArrowLeft' || c === 'KeyA' || c === 'ArrowRight' || c === 'KeyD' || c === 'Tab') {
            e.preventDefault();
            armed = null;
            gameoverSel = gameoverSel === 0 ? 1 : 0;
            return;
          }
          if (c === 'Enter' || c === 'NumpadEnter') {
            e.preventDefault();
            if (gameoverSel === 1) self._deathMenu(); else self._restart();
            return;
          }
          if (c === 'KeyR' || c === 'Space') { e.preventDefault(); self._restart(); return; }
          return;
        }
        /* D-98：下行确认——←→/Tab/↑↓ 都在两项之间切换，默认「取消」 */
        if (kind === 'stairconfirm') {
          if (c === 'ArrowLeft' || c === 'ArrowRight' || c === 'KeyA' || c === 'KeyD' || c === 'Tab' ||
              c === 'ArrowUp' || c === 'ArrowDown' || c === 'KeyW' || c === 'KeyS') {
            e.preventDefault();
            armed = null;
            sel = (sel === 0) ? 1 : 0;
            return;
          }
        }
        if (c === 'ArrowUp' || c === 'KeyW') { e.preventDefault(); armed = null; sel = clamp(sel - 1, 0, Math.max(data.length - 1, 0)); self._syncScroll(); return; }
        if (c === 'ArrowDown' || c === 'KeyS') { e.preventDefault(); armed = null; sel = clamp(sel + 1, 0, Math.max(data.length - 1, 0)); self._syncScroll(); return; }
        if (c === 'Enter' || c === 'NumpadEnter') { e.preventDefault(); self._confirm(); return; }
        if (c === 'Tab' && kind === 'shop') { e.preventDefault(); self._toggleShopMode(); return; }
        /* M8-4：quests 三页签切页——Tab/→ 下一页、← 上一页（↑↓ 仍是列表选择，无冲突） */
        if (kind === 'quests') {
          if (c === 'Tab' || c === 'ArrowRight') { e.preventDefault(); self._setPage(page + 1); return; }
          if (c === 'ArrowLeft') { e.preventDefault(); self._setPage(page - 1); return; }
        }
      };
      onClick = function (e) {
        if (!self.isOpen()) return;
        var v = canvas();
        if (!v) return;
        /* 自适应缩放：统一用 Render.toLogical 换算，避免 scale≠1 时点击偏移 */
        var R = Game.Core && Game.Core.Render;
        var pt = (R && typeof R.toLogical === 'function') ? R.toLogical(e.clientX, e.clientY)
          : { x: e.clientX, y: e.clientY };
        self._handleClick(pt.x, pt.y);
      };
      /* M9-4：设置面板音量滑块拖拽 */
      onMouseDown = function (e) {
        if (!self.isOpen() || kind !== 'settings' || !volTrack) return;
        var v = canvas();
        if (!v) return;
        var R = Game.Core && Game.Core.Render;
        var pt = (R && typeof R.toLogical === 'function') ? R.toLogical(e.clientX, e.clientY)
          : { x: e.clientX, y: e.clientY };
        var mx = pt.x;
        var my = pt.y;
        if (mx >= volTrack.x && mx <= volTrack.x + volTrack.w &&
            my >= volTrack.y - 8 && my <= volTrack.y + volTrack.h + 8) {
          volDragging = true;
          self._setVolumeFromX(mx);
          e.preventDefault();
        }
      };
      onMouseMove = function (e) {
        if (!volDragging) return;
        var v = canvas();
        if (!v) return;
        var R = Game.Core && Game.Core.Render;
        var pt = (R && typeof R.toLogical === 'function') ? R.toLogical(e.clientX, e.clientY)
          : { x: e.clientX, y: e.clientY };
        self._setVolumeFromX(pt.x);
      };
      onMouseUp = function () { volDragging = false; };
      window.addEventListener('keydown', onKey);
      if (cv) {
        cv.addEventListener('click', onClick);
        cv.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      }
    },

    _unbind: function () {
      window.removeEventListener('keydown', onKey);
      var cv = canvas();
      if (cv) {
        cv.removeEventListener('click', onClick);
        cv.removeEventListener('mousedown', onMouseDown);
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      onKey = null; onClick = null;
      onMouseDown = null; onMouseMove = null; onMouseUp = null;
    },

    _toggleShopMode: function () {
      shopMode = (shopMode === 'buy') ? 'sell' : 'buy';
      this._refresh();
    },

    /* M8-4：quests 页签切换（环形 0→1→2→3→0；← 反向），切页后选中行归零 */
    _setPage: function (p) {
      page = ((p % 4) + 4) % 4;
      sel = 0;
      qScroll = 0; /* P2-3b：切页重置滚动窗口，避免停在上次中间位置 */
      this._refresh();
    },

    /* P2-3b/C-03：选中行变化后让滚动窗口跟随（列表超出当前可见行数时生效，四类列表统一） */
    _syncScroll: function () {
      var vr = visibleRowCount(cssSize());
      if (data.length <= vr) return;
      if (sel < qScroll) qScroll = sel;
      else if (sel >= qScroll + vr) qScroll = sel - vr + 1;
      var maxScroll = Math.max(0, data.length - vr);
      if (qScroll > maxScroll) qScroll = maxScroll;
      if (qScroll < 0) qScroll = 0;
    },

    /* P2-3b/C-03：当前可见窗口（验证/调试读取）：{start, rows, total, sel} */
    _visibleRange: function () {
      var vr = visibleRowCount(cssSize());
      var start = (data.length > vr) ? qScroll : 0;
      return { start: start, rows: Math.min(Math.max(data.length - start, 0), vr), total: data.length, sel: sel };
    },

    /* C-03：布局快照（验证/调试读取）——与 draw 使用同一套行数/起点计算，
     * 返回逻辑视口、可见行数、面板高、完整内容高、是否滚动、面板顶 y 与逐行 y。 */
    _layout: function () {
      var sz = cssSize();
      var vr = visibleRowCount(sz);
      var start = (data.length > vr) ? qScroll : 0;
      var rows = Math.min(Math.max(data.length - start, 0), vr);
      var panelH = (kind === 'settings') ? HEADER_H + 280 + FOOTER_H
        : (kind === 'gameover') ? Math.min(sz.h - 24, HEADER_H + 300 + FOOTER_H)
        : HEADER_H + rows * ROW_H + FOOTER_H;
      /* D-29：与 draw 共用同一套双栏度量 */
      var railOn = (kind === 'inventory') && railVisible(sz.w);
      if (railOn) panelH = Math.max(panelH, HEADER_H + RAIL_H + FOOTER_H);
      var panelW = panelWidth(sz.w, railOn);
      var listW = listWidth(sz.w, railOn);
      var px = (sz.w - panelW) / 2;
      var py = (sz.h - panelH) / 2;
      var rowYs = [];
      for (var i = 0; i < rows; i++) rowYs.push(py + HEADER_H + i * ROW_H);
      return {
        viewport: sz, visibleRows: vr, start: start, rows: rows,
        panelH: panelH, contentH: HEADER_H + data.length * ROW_H + FOOTER_H,
        scrollable: data.length > vr, panelTop: py, panelBottom: py + panelH,
        panelW: panelW, listW: listW, panelLeft: px,
        rail: railOn ? this._railLayout(px, py, listW, panelH) : null,
        firstRowY: rowYs.length ? rowYs[0] : null,
        lastRowY: rowYs.length ? rowYs[rowYs.length - 1] : null,
        rowYs: rowYs, total: data.length, sel: sel
      };
    },

    /* D-29：布局度量（验证/调试读取）——不绘制，纯算。 */
    _metrics: function (cw) {
      var rail = railVisible(cw);
      return {
        cw: cw, railVisible: rail, panelW: panelWidth(cw, rail),
        listW: listWidth(cw, rail), margin: (cw - panelWidth(cw, rail)) / 2,
        minFont: 11
      };
    },

    /* D-29：右栏几何 + 槽位内容快照（与 draw 共用；只读，不可选中）。
     * 槽内 name/plus/value 全部从 Player.equipment / Player.upg 现场取，
     * 空槽显式 empty:true、name:'空'、value 归零（不允许留白）。 */
    _railLayout: function (px, py, listW, panelH) {
      var x = px + listW + RAIL_GAP;
      var top = py + HEADER_H;
      var bottom = py + panelH - FOOTER_H;
      var p = Game.Data.Player || {};
      var eq = p.equipment || {};
      var upg = p.upg || {};
      var IT = Game.Data.ITEMS || {};
      function buildSlot(key, label, field, id, sy) {
        var it = id ? IT[id] : null;
        var base = (it && it.effect && it.effect[field]) ? it.effect[field] : 0;
        var n = it ? Math.min(Math.max(upg[id] || 0, 0), 5) : 0;
        return {
          slot: key, label: label, field: field,
          x: x + 8, y: sy, w: RAIL_W - 16, h: 60,
          empty: !it, id: it ? id : null,
          name: it ? it.name : '空', plus: n,
          value: (field === 'atk' ? '攻+' : '防+') + (it ? effOf(base, n) : 0)
        };
      }
      return {
        x: x, y: top, w: RAIL_W, h: Math.max(0, bottom - top),
        title: '装备栏（只读）', selectable: false,
        slots: [
          buildSlot('weapon', '武器', 'atk', eq.weapon, top + 40),
          buildSlot('armor', '护甲', 'def', eq.armor, top + 120)
        ]
      };
    },

    /* M8-4：当前页签（验证/调试读取） */
    getPage: function () { return page; },

    /* M9-4：设置面板辅助方法 */
    _getAudio: function () {
      return (Game.Systems && Game.Systems.Audio) ? Game.Systems.Audio : null;
    },
    _adjVolume: function (delta) {
      var a = this._getAudio();
      if (!a) return;
      a.setVolume(a.getVolume() + delta);
    },
    _toggleMute: function () {
      var a = this._getAudio();
      if (!a) return;
      a.setMuted(!a.isMuted());
    },
    _setVolumeFromX: function (mx) {
      if (!volTrack) return;
      var a = this._getAudio();
      if (!a) return;
      var ratio = clamp((mx - volTrack.x) / volTrack.w, 0, 1);
      a.setVolume(ratio);
    },

    /* M9-5：死亡结算战绩（open 传入优先，否则现场取 Player/HUD 状态）
     * D-52：追加死因 / 差什么 / 救援名额 / 本局统计（全部来自 open 传入的遥测） */
    _gameoverStats: function () {
      var p = (Game.Data && Game.Data.Player) || {};
      var kills = (Game.hud && typeof Game.hud.getKills === 'function') ? Game.hud.getKills() : 0;
      var s = gameStats || {};
      return {
        floor: (typeof s.floor === 'number') ? s.floor : (typeof p.floor === 'number' ? p.floor : 0),
        kills: (typeof s.kills === 'number') ? s.kills : kills,
        gold: (typeof s.gold === 'number') ? s.gold : (typeof p.gold === 'number' ? p.gold : 0),
        elapsedMs: (typeof s.elapsedMs === 'number') ? s.elapsedMs : 0,
        death: s.death || null,
        cause: (typeof s.cause === 'string') ? s.cause : null,
        gap: s.gap || null,
        canRescue: (s.canRescue === true),
        run: s.run || null
      };
    },

    /* D-52：死亡结算「回主菜单」 */
    _deathMenu: function () {
      var M = Game.Core && Game.Core.Main;
      if (M && typeof M._deathReturnToMenu === 'function') { M._deathReturnToMenu(); return; }
      this.close();
    },

    /* M9-5：重新开始——走 Main.restart（既有 reset 逻辑），Main 不可用时兜底重置 Player */
    _restart: function () {
      try {
        var M = Game.Core && Game.Core.Main;
        if (M && typeof M.restart === 'function') {
          M.restart();
          return;
        }
        /* 兜底：无 Main 时仅重置 Player 字段（验证页场景） */
        var p = Game.Data && Game.Data.Player;
        if (p) {
          p.hp = 100; p.maxHp = 100; p.atk = 10; p.def = 5;
          p.gold = 0; p.exp = 0; p.level = 1;
          p.inventory = {}; p.equipment = { weapon: null, armor: null };
          p.quests = {};
          p.upg = {};
        }
        this.close();
      } catch (e) { this.close(); }
    },

    /* D-14：把 {ok,msg} 的结果接到提示条（notice.js 底部提示）。原先返回值被直接丢弃，
     * 金币不足 / MP 已满 / 未装备武器 / 生命已满 全部无声失败。 */
    _report: function (res) {
      if (!res || typeof res.msg !== 'string' || !res.msg) return;
      var EB = Game.Core && Game.Core.EventBus;
      if (EB && typeof EB.emit === 'function') {
        EB.emit('ui:notice', { msg: res.msg, ok: res.ok === true });
      }
    },

    _confirm: function () {
      armed = null;
      /* D-98：下行确认——只有选中「进入第 N 层」才回调；默认焦点是「取消」，
       * Enter 落在默认焦点上即取消（与「开始新游戏」确认页一致）。 */
      if (kind === 'stairconfirm') {
        var go = (sel === 1);
        var cb = stairConfirm ? stairConfirm.onConfirm : null;
        this.close();
        if (go && typeof cb === 'function') cb();
        return;
      }
      if (data.length === 0) return;
      /* D-47：NPC 任务面板——Enter 按状态执行 接取 / 交付；其余状态只给提示。
       * 交付由 NpcQuest.deliver 内部拦截"已交付"，这里不再重复判断。 */
      if (kind === 'npcquest') {
        var NQ = Game.Systems.NpcQuest;
        var nres = null;
        try {
          var nst = NQ.state(npcId);
          if (nst === 'unaccepted') nres = NQ.accept(npcId);
          else if (nst === 'ready') nres = NQ.deliver(npcId);
          else { this.close(); return; }
          this._refresh();
        } catch (e) { /* 降级：面板异常不影响主游戏 */ }
        if (nres && nres.ok === true && Game.Systems.Save && typeof Game.Systems.Save.save === 'function') {
          Game.Systems.Save.save();
        }
        this._report(nres);
        return;
      }
      var entry = data[sel];
      var res = null;
      try {
        if (kind === 'inventory') {
          var it = Game.Data.ITEMS[entry.id];
          if (it && it.type === 'consumable') res = Game.Systems.Inventory.use(entry.id);
          else res = Game.Systems.Inventory.equip(entry.id);
        } else if (kind === 'shop') {
          if (shopMode === 'buy') res = Game.Systems.Shop.buy(entry.id);
          else res = Game.Systems.Shop.sell(entry.id);
        } else if (kind === 'quests') {
          this.close(); return;
        }
        this._refresh();
      } catch (e) { /* 降级：弹窗内操作异常不影响主游戏 */ }
      /* D-15：背包/商店的成功操作会改金币、背包、装备、HP/MP 等持久状态。
       * 旧实现只有换层/战斗结算才写档，于是"买到的装备/药水效果"刷新即消失。
       * 失败（res.ok 非 true）不写档，避免把"没发生"的操作写进存档。 */
      if (res && res.ok === true && Game.Systems.Save && typeof Game.Systems.Save.save === 'function') {
        Game.Systems.Save.save();
      }
      this._report(res);
    },

    /* 点击：面板外→关闭；面板内按 D-100 两段式——首次只选中，第二次点同一目标才执行。
     * 例外：页签/买-卖模式是"导航"，点一次即切换；设置页沿用原有直接操作（音量/静音）。 */
    _handleClick: function (x, y) {
      if (!rect) return;
      if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) {
        /* 修复：死亡结算点遮罩不关闭（与 Esc 同理，避免 0 HP 游离态） */
        if (kind !== 'gameover') this.close();
        return;
      }
      if (kind === 'settings') {
        /* M9-4：点击静音开关区域切换静音 */
        if (muteRect && x >= muteRect.x && x <= muteRect.x + muteRect.w &&
            y >= muteRect.y && y <= muteRect.y + muteRect.h) {
          this._toggleMute();
        }
        return;
      }
      /* D-100：图鉴四页签——点击直接切页（不是"执行某一行"，无需二次确认） */
      if (kind === 'quests') {
        for (var ti = 0; ti < 4; ti++) {
          var tr = tabRect(rect.x, rect.y, ti);
          if (x >= tr.x && x <= tr.x + tr.w && y >= tr.y && y <= tr.y + tr.h) {
            this._setPage(ti);
            return;
          }
        }
      }
      /* D-100：商店「购买/出售」页签——点一次即切换 */
      if (kind === 'shop') {
        for (var mi = 0; mi < 2; mi++) {
          var mr = shopModeRect(rect.x, rect.y, mi);
          if (x >= mr.x && x <= mr.x + mr.w && y >= mr.y && y <= mr.y + mr.h) {
            var want = (mi === 0) ? 'buy' : 'sell';
            if (shopMode !== want) this._toggleShopMode();
            return;
          }
        }
      }
      if (kind === 'gameover') {
        /* D-52 两个按钮；D-100：第一次点击只选中，第二次点同一按钮才执行 */
        var hit = null;
        if (gameRestartRect && x >= gameRestartRect.x && x <= gameRestartRect.x + gameRestartRect.w &&
            y >= gameRestartRect.y && y <= gameRestartRect.y + gameRestartRect.h) hit = 0;
        else if (gameMenuRect && x >= gameMenuRect.x && x <= gameMenuRect.x + gameMenuRect.w &&
            y >= gameMenuRect.y && y <= gameMenuRect.y + gameMenuRect.h) hit = 1;
        if (hit === null) return;
        if (gameoverSel !== hit) { gameoverSel = hit; armed = 'gameover:' + hit; return; }
        if (armed !== 'gameover:' + hit) { armed = 'gameover:' + hit; return; }
        armed = null;
        if (hit === 0) this._restart(); else this._deathMenu();
        return;
      }
      /* 系统页是只读仪表盘：点击不选中不可见行、更不执行 _confirm（旧版会直接关面板） */
      if (kind === 'quests' && page === 3) return;
      /* D-29：命中统一走 _rowAt——落在右栏（≥700 的装备栏）或列表区外一律返回 null，
       * 右栏点不中、也不会改 sel；键盘路径本就不把右栏放进 data，同样选不中。 */
      var absIdx = this._rowAt(x, y);
      if (absIdx === null) return;
      if (armed === 'row:' + absIdx) {
        sel = absIdx;
        armed = null;
        this._confirm();
        return;
      }
      sel = absIdx;
      armed = 'row:' + absIdx;
      this._syncScroll();
    },

    /* D-100：滚轮——背包/商店列表按行滚动；返回是否消费了本次滚轮 */
    _wheel: function (deltaY) {
      if (!this.isOpen() || !rect) return false;
      if (kind !== 'inventory' && kind !== 'shop') return false;
      var vr = visibleRowCount(cssSize());
      var maxScroll = Math.max(0, data.length - vr);
      if (maxScroll <= 0) return false;
      var step = (deltaY > 0) ? 1 : -1;
      qScroll = clamp(qScroll + step, 0, maxScroll);
      return true;
    },

    /* D-100：测试/验证用只读状态——armed 目标（null 表示还没有第一次点击） */
    _armed: function () { return armed; },

    /* D-29：行命中测试——返回绝对行索引；x 落在左列表之外（含右栏）返回 null。
     * 抽出独立函数是为了让"右栏不可被选中"可被验证页用真实点击坐标反复断言。 */
    _rowAt: function (x, y) {
      if (!rect) return null;
      var cw = cssSize().w;
      var railOn = (kind === 'inventory') && railVisible(cw);
      var lw = railOn ? listWidth(cw, true) : rect.w;
      if (x < rect.x || x > rect.x + lw) return null;
      var rowIdx = Math.floor((y - (rect.y + HEADER_H)) / ROW_H);
      var vr = visibleRowCount(cssSize());
      if (rowIdx < 0 || rowIdx >= vr) return null;
      /* P2-3b/C-03：点击行按滚动窗口偏移换算为绝对索引（超出可见行数时 start 才非 0） */
      var start = (data.length > vr) ? qScroll : 0;
      var absIdx = rowIdx + start;
      if (absIdx < 0 || absIdx >= data.length) return null;
      return absIdx;
    },

    /* D-29：状态快照（验证/调试只读）——sel 一定指向 data 下标；rail.selectable 恒 false */
    _debugState: function () {
      return {
        kind: kind, sel: sel, total: data.length, page: page, shopMode: shopMode,
        rect: rect,
        layout: this._layout()
      };
    },

    /* M9-4：绘制设置面板——音量滑块（拖拽）/静音开关（点击）/操作说明 */
    _drawSettings: function (c, cv, px, py, w, h) {
      var a = this._getAudio();
      var vol = a ? a.getVolume() : 0.7;
      var muted = a ? a.isMuted() : false;

      var left = px + 20;
      var contentW = w - 40;
      var y = py + HEADER_H + 10;

      /* ---- 音量滑块 ---- */
      c.fillStyle = '#cfcfcf';
      c.font = '14px monospace';
      c.fillText('音量  ' + Math.round(vol * 100) + '%', left, y + 14);

      var trackY = y + 24;
      var trackH = 8;
      volTrack = { x: left, y: trackY, w: contentW, h: trackH };
      if (Game.Core.Render && Game.Core.Render._hotAdd) {
        Game.Core.Render._hotAdd('modal:volume', volTrack.x, volTrack.y - 6, volTrack.w, volTrack.h + 12);
      }
      /* 轨道背景 */
      c.fillStyle = '#3a3a55';
      c.fillRect(volTrack.x, volTrack.y, volTrack.w, volTrack.h);
      /* 已填充 */
      c.fillStyle = '#ffcf6e';
      c.fillRect(volTrack.x, volTrack.y, Math.max(0, volTrack.w * vol), volTrack.h);
      /* thumb */
      var thumbX = volTrack.x + volTrack.w * vol;
      c.fillStyle = '#ffffff';
      c.fillRect(thumbX - 5, volTrack.y - 5, 10, volTrack.h + 10);

      y = trackY + trackH + 28;

      /* ---- 静音开关 ---- */
      muteRect = { x: left, y: y, w: 18, h: 18 };
      if (Game.Core.Render && Game.Core.Render._hotAdd) {
        Game.Core.Render._hotAdd('modal:mute', muteRect.x - 4, muteRect.y - 4, muteRect.w + 8, muteRect.h + 8);
      }
      c.fillStyle = '#1a1a2e';
      c.fillRect(muteRect.x, muteRect.y, muteRect.w, muteRect.h);
      c.strokeStyle = '#cfcfcf';
      c.lineWidth = 1;
      c.strokeRect(muteRect.x + 0.5, muteRect.y + 0.5, muteRect.w - 1, muteRect.h - 1);
      if (muted) {
        c.fillStyle = '#ffcf6e';
        c.fillRect(muteRect.x + 3, muteRect.y + 3, muteRect.w - 6, muteRect.h - 6);
      }
      c.fillStyle = muted ? '#ff6b6b' : '#cfcfcf';
      c.font = '14px monospace';
      c.fillText('静音（' + (muted ? '开' : '关') + '）', muteRect.x + muteRect.w + 10, y + 14);

      y += muteRect.h + 24;

      /* ---- 操作说明 ---- */
      c.fillStyle = '#9bbbf4';
      c.font = 'bold 13px monospace';
      c.fillText('操作说明', left, y + 12);
      y += 26;

      c.fillStyle = '#cfcfcf';
      c.font = '12px monospace';
      var lines = [
        '方向键 / WASD : 移动',
        'B 背包 · E 商店 · M 任务',
        'T 对话 · L AI 演示',
        'F 侦测 / 拆除陷阱（相邻）',
        'K 静音 · Q 设置 · H 重看引导',
        'Esc : 关闭弹窗'
      ];
      for (var i = 0; i < lines.length; i++) {
        c.fillText(lines[i], left, y + i * 18);
      }

      /* 底部提示（窄屏缩字号，避免 320 宽溢出） */
      c.fillStyle = '#9bbbf4';
      c.font = (cssSize().w < 420 ? '11px monospace' : '12px monospace');
      c.fillText('← → 调音量 · 空格切换静音 · Esc/点遮罩关闭', px + 14, py + h - 12);
    },

    /* M9-5：死亡结算面板 → D-52：死因 / 死在第几层 / 差什么 / 救援名额 / 双按钮 */
    _drawGameover: function (c, px, py, w, h) {
      var st = this._gameoverStats();
      var left = px + 20;
      var maxW = w - 40;
      var y = py + HEADER_H + 12;
      var self = this;

      /* 用时格式：mm:ss */
      var secs = Math.max(0, Math.floor((st.elapsedMs || 0) / 1000));
      var mm = Math.floor(secs / 60);
      var ss = secs % 60;
      var timeStr = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;

      function line(text, color, size, bold) {
        c.font = (bold ? 'bold ' : '') + (size || 13) + 'px monospace';
        c.fillStyle = color;
        c.textAlign = 'left';
        c.fillText(self._fitRow(c, text, maxW), left, y + (size || 13));
        y += Math.round((size || 13) * 1.7);
      }

      /* ① 死因（与 death.source 同源；具体怪物名 / 陷阱 / 中毒 / 流血） */
      line('死因：' + (st.cause || '未知') + '（第 ' + st.floor + ' 层）', '#ff9b6b', 15, true);

      /* ② 本局统计：只显示 run 里真实存在的数字；没有的项不显示 */
      var run = st.run || {};
      var parts1 = [];
      if (typeof run.floorReached === 'number') parts1.push('第 ' + run.floorReached + ' 层');
      if (typeof st.kills === 'number') parts1.push('击杀 ' + st.kills);
      if (typeof run.maxLevel === 'number') parts1.push('Lv.' + run.maxLevel);
      if (parts1.length) line(parts1.join(' · '), '#cfcfcf', 13, false);
      var parts2 = [];
      if (typeof run.turns === 'number') parts2.push('回合 ' + run.turns);
      if (typeof run.potions === 'number') parts2.push('药水 ' + run.potions + ' 瓶');
      if (typeof run.rescues === 'number') parts2.push('救援 ' + run.rescues + ' 次');
      if (parts2.length) line(parts2.join(' · '), '#cfcfcf', 13, false);
      line('用时 ' + timeStr + ' · 金币 ' + st.gold, '#9bbbf4', 13, false);

      /* ③ 离下一层还差什么（血量 / 回合 / 药）——来自死亡遥测的可复算字段 */
      if (st.gap && st.gap.text) {
        line('系统评估：' + st.gap.text + '。', '#9fe3a1', 13, false);
      }
      /* ④ 只在自适应名额真的还没用完时出现（关闭/用尽都不显示） */
      if (st.canRescue) {
        var used = (run.rescues || 0);
        var _mx = (Game.Systems && Game.Systems.Adaptive && Game.Systems.Adaptive.MAX_TRIGGERS) || 2;
        var remain = Math.max(0, _mx - used);
        line('系统：应急协议剩余 ' + remain + ' 次', '#ffcf6e', 13, true);
      }

      /* ⑤ 双按钮：再来一局 / 回主菜单（←→ 选择，Enter 确认） */
      var bw = Math.min(160, (w - 60) / 2), bh = 34, gap = 12;
      var total = bw * 2 + gap;
      var bx = px + (w - total) / 2;
      var by = Math.min(py + h - FOOTER_H - bh - 10, y + 8);
      var labels = ['再来一局 (Enter)', '回主菜单 (Enter)'];
      gameRestartRect = { x: bx, y: by, w: bw, h: bh };
      gameMenuRect = { x: bx + bw + gap, y: by, w: bw, h: bh };
      for (var b = 0; b < 2; b++) {
        var rx = bx + b * (bw + gap);
        var on = (gameoverSel === b);
        if (Game.Core.Render && Game.Core.Render._hotAdd) {
          Game.Core.Render._hotAdd('modal:gameover:' + b, rx, by, bw, bh);
        }
        c.fillStyle = on ? 'rgba(255,207,110,0.18)' : '#3a3a5c';
        c.fillRect(rx, by, bw, bh);
        c.strokeStyle = on ? '#ffcf6e' : '#5a5f70';
        c.lineWidth = on ? 2 : 1;
        c.strokeRect(rx + 0.5, by + 0.5, bw - 1, bh - 1);
        c.fillStyle = on ? '#ffcf6e' : '#9bbbf4';
        c.font = 'bold 13px monospace';
        c.textAlign = 'center';
        c.fillText(self._fitRow(c, labels[b], bw - 12), rx + bw / 2, by + bh / 2 + 5);
      }
      c.textAlign = 'left';

      /* 底部提示（窄屏缩字号，避免 320 宽溢出） */
      c.fillStyle = '#9bbbf4';
      c.font = (cssSize().w < 420 ? '11px monospace' : '12px monospace');
      c.fillText('←→ 选择 · Enter 确认 · R 再来一局', px + 14, py + h - 12);
    },

    draw: function () {
      if (!this.isOpen()) return;
      var c = cctx();
      var cv = canvas();
      if (!c || !cv) return;
      /* M9-5：确保 DPR 变换已应用（直接调用 draw 时兜底），绘制坐标用 CSS 像素 */
      if (Game.Core && Game.Core.Render && typeof Game.Core.Render._applyDpr === 'function') {
        Game.Core.Render._applyDpr();
      }
      var sz = cssSize();
      var cw = sz.w, ch = sz.h;

      /* P2-3b/C-03：滚动窗口起点；列表未超出当前可见行数时 start 恒为 0（高视口行为不变） */
      var vr = visibleRowCount(sz);
      var start = (data.length > vr) ? qScroll : 0;
      var rows = Math.min(Math.max(data.length - start, 0), vr);
      /* D-29：只有背包在逻辑宽 ≥700 时展开右栏；w 为面板总宽，listW 为左侧列表可用宽 */
      var railOn = (kind === 'inventory') && railVisible(cw);
      var w = panelWidth(cw, railOn);
      var listW = listWidth(cw, railOn);
      /* M9-4/M9-5：设置面板与死亡结算使用固定内容高度（非列表） */
      var h = (kind === 'settings') ? HEADER_H + 280 + FOOTER_H
        : (kind === 'gameover') ? Math.min(ch - 24, HEADER_H + 300 + FOOTER_H)
        /* D-27：空列表也保留 1 行高度，避免"空态提示"与底部操作提示叠在同一条线上
         * （新档背包为空是首屏常态，页头又加了装备摘要，必须让空态有独立一行） */
        : HEADER_H + Math.max(rows, 1) * ROW_H + FOOTER_H;
      /* D-29：右栏两槽最小需要 RAIL_H 内容高（行数很少时也不许把槽压扁/裁切） */
      if (railOn) h = Math.max(h, HEADER_H + RAIL_H + FOOTER_H);
      var px = (cw - w) / 2;
      var py = (ch - h) / 2;
      rect = { x: px, y: py, w: w, h: h };
      var rail = railOn ? this._railLayout(px, py, listW, h) : null;

      /* 半透明遮罩（压暗地图与 HUD，HUD 仍每帧同步在遮罩下） */
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(0, 0, cw, ch);

      /* 居中面板：P1-2 双层像素边框（外黑 1px + 内白 1px） */
      c.fillStyle = '#14142a';
      c.fillRect(px, py, w, h);
      /* 底部操作提示区分隔线（设置/结算面板同样适用，先于各自 return 绘制） */
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(px + 10, py + h - FOOTER_H, w - 20, 1);
      c.strokeStyle = 'rgba(0,0,0,0.9)';
      c.lineWidth = 1;
      c.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.strokeRect(px + 1.5, py + 1.5, w - 3, h - 3);

      /* P1-2：标题行分隔线（金色 1px，标题 y=py+30，线在 y=py+34） */
      c.fillStyle = 'rgba(255,207,110,0.35)';
      c.fillRect(px + 10, py + 34, w - 20, 1);

      /* 标题 + 金币 */
      var title = '';
      if (kind === 'inventory') title = '背包';
      else if (kind === 'shop') title = '商店 · ' + (shopMode === 'buy' ? '购买' : '出售');
      else if (kind === 'settings') title = '设置';
      else if (kind === 'gameover') title = '系统评估：未达标';
      else if (kind === 'stairconfirm') {
        title = '进入第 ' + ((stairConfirm && stairConfirm.floor) ? stairConfirm.floor : 1) + ' 层';
      }
      else if (kind === 'npcquest') {
        var nd = (Game.Systems.NpcQuest && Game.Systems.NpcQuest.def) ? Game.Systems.NpcQuest.def(npcId) : null;
        title = (nd ? nd.name : '???') + ' · 任务';
      }
      if (kind === 'quests') {
        /* M8-4：四页签（任务/怪物/物品/系统，当前页高亮加粗）；D-100：页签可点击 */
        var tabs = ['任务', '怪物', '物品', '系统'];
        for (var ti = 0; ti < tabs.length; ti++) {
          var tr = tabRect(px, py, ti);
          c.fillStyle = (ti === page) ? '#ffcf6e' : '#8a8aa0';
          c.font = (ti === page) ? 'bold 18px monospace' : '15px monospace';
          c.textAlign = 'left';
          c.fillText(tabs[ti], tr.x + 4, py + 30);
          if (Game.Core.Render && Game.Core.Render._hotAdd) {
            Game.Core.Render._hotAdd('modal:tab:' + ti, tr.x, tr.y, tr.w, tr.h);
          }
        }
      } else if (kind === 'shop') {
        /* D-100：买/卖做成两个可点页签（点一次切换），标题只留「商店」 */
        c.fillStyle = '#ffcf6e';
        c.font = 'bold 18px monospace';
        c.textAlign = 'left';
        c.fillText('商店', px + 14, py + 30);
        var modes = [['buy', '购买'], ['sell', '出售']];
        for (var mi = 0; mi < 2; mi++) {
          var mr = shopModeRect(px, py, mi);
          var mOn = (shopMode === modes[mi][0]);
          c.fillStyle = mOn ? 'rgba(255,207,110,0.18)' : 'rgba(255,255,255,0.04)';
          c.fillRect(mr.x, mr.y, mr.w, mr.h);
          c.strokeStyle = mOn ? '#ffcf6e' : '#3a3a55';
          c.lineWidth = 1;
          c.strokeRect(mr.x + 0.5, mr.y + 0.5, mr.w - 1, mr.h - 1);
          c.fillStyle = mOn ? '#ffcf6e' : '#9aa0b4';
          c.font = (mOn ? 'bold ' : '') + '13px monospace';
          c.textAlign = 'center';
          c.fillText(modes[mi][1], mr.x + mr.w / 2, mr.y + 19);
          if (Game.Core.Render && Game.Core.Render._hotAdd) {
            Game.Core.Render._hotAdd('modal:shopmode:' + modes[mi][0], mr.x, mr.y, mr.w, mr.h);
          }
        }
        c.textAlign = 'left';
      } else {
        c.fillStyle = '#ffcf6e';
        c.font = 'bold 18px monospace';
        c.fillText(title, px + 14, py + 30);
      }
      if (kind === 'inventory' || kind === 'shop') {
        var p = Game.Data.Player;
        c.fillStyle = '#ffcf6e';
        c.font = '13px monospace';
        c.fillText('金币: ' + (p ? p.gold : 0), px + w - 90, py + 30);
      }

      /* D-27：背包页头装备摘要——让"已装备"在界面上看得见（新档起手就有匕首，
       * 但背包为空，不能只显示"背包空空如也"）。文本由 equipSummary() 统一生成，
       * 后续 UI 重做时替换/扩写该函数即可，绘制这里只负责排版与截断。 */
      if (kind === 'inventory') {
        c.fillStyle = '#9fb6cf';
        c.font = '11px monospace';
        var sumMaxW = Math.max(0, w - 84 - 100);
        c.fillText(this._fitRow(c, this.equipSummary(), sumMaxW), px + 84, py + 30);
      }

      /* M9-4：设置面板专用渲染（音量滑块/静音开关/操作说明） */
      if (kind === 'settings') {
        this._drawSettings(c, cv, px, py, w, h);
        return;
      }

      /* M9-5：死亡结算专用渲染（战绩 + 重新开始按钮） */
      if (kind === 'gameover') {
        this._drawGameover(c, px, py, w, h);
        return;
      }

      /* 条目列表（窄屏单行超长时截断加省略号，避免 320 宽溢出） */
      c.font = '14px monospace';
      /* D-87：第 4 页「系统」不再逐行铺字，改画仪表盘（同一份只读快照；行数据仍保留给
       * 断言/滚动语义，容量与四页签不变）。其余页仍走原逐行路径，行为不动。 */
      if (kind === 'quests' && page === 3) {
        this._drawSystem(c, px, py, w, h);
      } else {
      for (var i = 0; i < rows; i++) {
        var ry = py + HEADER_H + i * ROW_H;
        var entry = data[start + i]; /* P2-3b：按滚动窗口取行数据 */
        if (Game.Core.Render && Game.Core.Render._hotAdd) {
          Game.Core.Render._hotAdd('modal:row:' + (start + i), px + 6, ry + 2, listW - 12, ROW_H - 4);
        }
        if (i + start === sel) {
          c.fillStyle = 'rgba(255,207,110,0.18)';
          /* D-29：高亮只铺左列表宽（listW），不跨到右栏去 */
          c.fillRect(px + 6, ry + 2, listW - 12, ROW_H - 4);
          /* P1-2：选中行左侧 2px 金色竖条 */
          c.fillStyle = '#ffcf6e';
          c.fillRect(px + 6, ry + 2, 2, ROW_H - 4);
          c.fillStyle = '#ffcf6e';
        } else {
          c.fillStyle = '#cfcfcf';
        }
        /* D-80：行左物品图标按素材原生 24×24 1:1 绘制（旧版固定 16×16 会把 24 素材压到 2/3）；
         * 文字起点随之右移到 px+14+24+6，行宽上限同步扣掉 30。 */
        var ric = this._rowIcon(entry);
        var ICON = 24, ICON_GAP = 6;
        var rowTextX = px + 14;
        var rowMaxW = listW - 28;
        if (ric) {
          rowTextX = px + 14 + ICON + ICON_GAP;
          rowMaxW = listW - 28 - (ICON + ICON_GAP);
          var riy = ry + Math.floor((ROW_H - ICON) / 2);
          var Rr = Game.Core && Game.Core.Render;
          if (Rr && Rr.drawIcon) Rr.drawIcon(c, ric, px + 14, riy);
          else c.drawImage(ric, px + 14, riy, ICON, ICON);
        }
        /* D-28：行尾徽标独立绘制（已装备 / 强化后数值），行串本身不变
         * D-29：再往右独立绘制差值徽标（▲+N / ▼-N / 持平），两者都不拼进 _rowText */
        var badge = this._rowBadges(kind, entry);
        var delta = this._rowDelta(entry);
        var badgeW = 0, deltaW = 0;
        c.font = '11px monospace';
        if (badge) badgeW = Math.round(c.measureText(badge.text).width) + 14;
        if (delta) deltaW = Math.round(c.measureText(delta.text).width) + 10;
        c.font = '14px monospace';
        c.fillText(this._fitRow(c, this._rowText(entry), rowMaxW - badgeW - deltaW), rowTextX, ry + 20);
        var rightEdge = px + listW - 14;
        if (delta) {
          c.fillStyle = delta.color;
          c.font = '11px monospace';
          c.textAlign = 'right';
          c.fillText(delta.text, rightEdge, ry + 20);
          c.textAlign = 'left';
          rightEdge -= deltaW;
        }
        if (badge) {
          c.fillStyle = badge.color;
          c.font = '11px monospace';
          c.textAlign = 'right';
          c.fillText(badge.text, rightEdge, ry + 20);
          c.textAlign = 'left';
        }
      }
      }
      /* M9-5：空状态——居中灰字提示（背包/任务各自文案） */
      if (data.length === 0) {
        c.fillStyle = '#9bbbf4';
        c.font = '14px monospace';
        var emptyMsg = '（空）';
        if (kind === 'inventory') emptyMsg = '背包空空如也';
        else if (kind === 'quests') emptyMsg = (page === 3) ? '暂无数据' : '暂无任务';
        /* 居中：估算文字宽度后水平居中（灰字）；D-29 双栏时居中于左列表 */
        c.textAlign = 'center';
        c.fillText(emptyMsg, px + listW / 2, py + HEADER_H + 20);
        c.textAlign = 'left';
      }

      /* D-29：右栏只读装备栏（仅背包、逻辑宽 ≥700 时存在；否则一行都不画） */
      if (rail) this._drawRail(c, rail);

      /* 底部操作提示（窄屏缩字号，避免 320 宽溢出；D-28：溢出时折两行且保留操作指导） */
      c.fillStyle = '#9bbbf4';
      var hintInfo = this._hintFor(c, kind, cw, sz);
      if (hintInfo.lines.length > 1) {
        c.fillText(hintInfo.lines[0], px + 14, py + h - 25);
        c.fillText(hintInfo.lines[1], px + 14, py + h - 10);
      } else {
        c.fillText(hintInfo.lines[0], px + 14, py + h - 12);
      }
    },

    /* D-28：底栏提示文本——非溢出态返回原串（逐字节不变，D-25 精确比对依赖它）；
     * 溢出态（320 逻辑宽实测）保留「Enter 使用/装备」，把 Esc 提示折到第二行，
     * 丢掉的是浏览计数那一侧，不是操作指导。 */
    _hintFor: function (c, kind, cw, sz) {
      c.font = (cw < 420 ? '11px monospace' : '12px monospace');
      var hint;
      if (kind === 'inventory') hint = '↑↓ 选择 · Enter 使用/装备 · Esc/点遮罩关闭';
      else if (kind === 'shop') hint = '↑↓ 选择 · Enter ' + (shopMode === 'buy' ? '购买' : '出售') + ' · Tab 切换 · Esc/点遮罩关闭';
      else if (kind === 'quests') hint = 'Tab/←→ 切页 · ↑↓ 选择 · Esc/点遮罩关闭'; /* M8-4 */
      else if (kind === 'npcquest') hint = 'Enter 接取/交付 · Esc/点遮罩关闭'; /* D-47 */
      else if (kind === 'stairconfirm') hint = '←→ 选择 · Enter 确认 · Esc 取消'; /* D-98 */
      else hint = '↑↓ 选择 · Esc/点遮罩关闭';
      /* P2-3b/C-03：列表滚动时底部显示当前位置 (sel+1)/total */
      var scrolling = data.length > visibleRowCount(sz);
      if (scrolling) {
        hint = '↑↓ 浏览 · ' + (sel + 1) + '/' + data.length + ' · ' +
          (kind === 'quests' ? 'Tab 切页 · ' : '') + 'Esc 关闭';
      }
      var maxW = Math.min(cw * W_RATIO, MAX_W) - 28;
      var hintW = c.measureText(hint).width;
      /* 字宽随环境字体 fallback 浮动，留 24px 安全边距；320 逻辑宽实测触发两行，1024 不触发 */
      var overflow = hintW > (maxW - 24);
      if (overflow && kind === 'inventory') {
        return {
          lines: [(scrolling ? '↑↓ 浏览 · ' : '↑↓ 选择 · ') + 'Enter 使用/装备', 'Esc/点遮罩关闭'],
          full: hint, overflow: true, width: hintW, maxW: maxW
        };
      }
      /* D-80：320 逻辑宽下商店/任务页的底栏同样会越界（只是原先没有折行分支），
       * 按背包同款口径折两行；宽屏不触发，full 原串不变（D-25 逐字节比对不受影响）。 */
      if (overflow && kind === 'shop') {
        return {
          lines: ['↑↓ 选择 · Enter ' + (shopMode === 'buy' ? '购买' : '出售') + ' · Tab 切换', 'Esc/点遮罩关闭'],
          full: hint, overflow: true, width: hintW, maxW: maxW
        };
      }
      if (overflow && kind === 'quests') {
        return {
          lines: ['Tab/←→ 切页 · ↑↓ 选择', 'Esc/点遮罩关闭'],
          full: hint, overflow: true, width: hintW, maxW: maxW
        };
      }
      return { lines: [hint], full: hint, overflow: overflow, width: hintW, maxW: maxW };
    },

    /* D-28：背包页头装备摘要（在 D-27 的函数上扩写，不另造第二套）。
     * 两槽各带强化等级与强化后数值；护甲为空显式写"无"；末尾给两槽合计加成。 */
    equipSummary: function () {
      var p = Game.Data.Player || {};
      var IT = Game.Data.ITEMS || {};
      var eq = p.equipment || {};
      var upg = p.upg || {};
      function slot(id, field, label) {
        if (!id) return label + '无';
        var it = IT[id];
        if (!it) return label + id;
        var base = (it.effect && it.effect[field]) ? it.effect[field] : 0;
        var n = Math.min(Math.max(upg[id] || 0, 0), 5);
        return label + it.name + '+' + n + '（' + (field === 'atk' ? '攻击+' : '防御+') + effOf(base, n) + '）';
      }
      var wIt = IT[eq.weapon], aIt = IT[eq.armor];
      var wAdd = wIt ? effOf((wIt.effect && wIt.effect.atk) || 0, upg[eq.weapon] || 0) : 0;
      var aAdd = aIt ? effOf((aIt.effect && aIt.effect.def) || 0, upg[eq.armor] || 0) : 0;
      return '已装备：' + slot(eq.weapon, 'atk', '') +
        ' · ' + slot(eq.armor, 'def', '护甲：') +
        ' · 合计 攻+' + wAdd + ' 防+' + aAdd;
    },

    /* D-28：背包行尾徽标（独立绘制元素，绝不拼进 _rowText 串）。
     * - 已装备：把总数拆成「已装备 1｜背包 N」——equip() 不扣物品，
     *   所以 x2 里有一件在身上，N=count-1 明确指出背包里还剩几件，杜绝误读
     * - 强化：画强化后的实际数值（攻击+4）；商店/图鉴不画，仍用基础值 */
    _rowBadges: function (kind, entry) {
      if (kind !== 'inventory' || !entry || !entry.id) return null;
      var IT = Game.Data.ITEMS || {};
      var it = IT[entry.id];
      if (!it || (it.type !== 'weapon' && it.type !== 'armor')) return null;
      var p = Game.Data.Player || {};
      var eq = p.equipment || {};
      var equipped = (eq.weapon === entry.id) || (eq.armor === entry.id);
      var plus = Math.min(Math.max((p.upg && p.upg[entry.id]) || 0, 0), 5);
      var field = it.type === 'weapon' ? 'atk' : 'def';
      var base = (it.effect && it.effect[field]) ? it.effect[field] : 0;
      var parts = [];
      if (equipped) parts.push('已装备 1｜背包 ' + Math.max((entry.count || 1) - 1, 0));
      if (plus > 0) parts.push((field === 'atk' ? '攻击+' : '防御+') + effOf(base, plus));
      if (!parts.length) return null;
      return { text: parts.join(' · '), color: equipped ? '#ffcf6e' : '#7fd1ff' };
    },

    /* D-29：装备对比差值——"这件装上之后，该槽位的实际变化"，口径与 recalcEquip 完全一致：
     *   主属性 = effOf(候选基础值, 候选强化等级) − effOf(当前槽基础值, 当前强化等级)
     *   生命   = 候选 effect.maxHp − 当前槽 effect.maxHp（maxHp 不参与强化倍率，故取原始差）
     * 规则：
     *   - 只对背包里的武器/护甲出徽标；消耗品、强化卷轴、其他类型 → null（不显示）
     *   - 当前槽为空 → 当前值按 0 起算（即"从 0 起算"，不写"首次装备"特例）
     *   - 主属性为 0 且生命为 0 → "持平"
     *   - 符号以主属性优先；主属性为 0 时看生命。混合符号（攻升血降）会同时列出两项
     *     （如 ▲+2 生命-10），不隐藏任何一边
     * 商店/图鉴：kind !== 'inventory' 直接 null（沿用 D-28 的上下文分离）。 */
    _rowDelta: function (entry) {
      if (kind !== 'inventory' || !entry || !entry.id) return null;
      var IT = Game.Data.ITEMS || {};
      var it = IT[entry.id];
      if (!it || (it.type !== 'weapon' && it.type !== 'armor')) return null;
      var p = Game.Data.Player || {};
      var eq = p.equipment || {};
      var upg = p.upg || {};
      var field = it.type === 'weapon' ? 'atk' : 'def';
      var curId = (it.type === 'weapon') ? (eq.weapon || null) : (eq.armor || null);
      var cur = curId ? IT[curId] : null;
      var candBase = (it.effect && it.effect[field]) ? it.effect[field] : 0;
      var curBase = (cur && cur.effect && cur.effect[field]) ? cur.effect[field] : 0;
      var candPlus = Math.min(Math.max(upg[entry.id] || 0, 0), 5);
      var curPlus = curId ? Math.min(Math.max(upg[curId] || 0, 0), 5) : 0;
      var dMain = effOf(candBase, candPlus) - effOf(curBase, curPlus);
      var dHp = ((it.effect && it.effect.maxHp) || 0) - ((cur && cur.effect && cur.effect.maxHp) || 0);

      var sign = (dMain !== 0) ? dMain : dHp;   /* 主属性优先，其为 0 时看生命 */
      var parts = [];
      if (dMain !== 0) parts.push((dMain > 0 ? '+' : '') + dMain);
      if (dHp !== 0) parts.push('生命' + (dHp > 0 ? '+' : '') + dHp);
      var text, color;
      if (!parts.length) {
        text = '持平';
        color = '#9aa0b0';
      } else {
        text = (sign > 0 ? '▲' : '▼') + parts.join(' ');
        color = sign > 0 ? '#7ce38b' : '#ff8080';
      }
      return { text: text, color: color, sign: sign, dMain: dMain, dHp: dHp, cur: curId };
    },

    /* D-29：右栏装备栏绘制——两个槽（武器/护甲），程序化色块占位，不引入新 PNG。
     * 只读：不参与 sel、不响应点击（_rowAt 在 listW 之外直接返回 null）。 */
    _drawRail: function (c, rail) {
      if (!rail) return;
      /* 与左列表之间的竖分隔线 */
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(rail.x - RAIL_GAP / 2, rail.y, 1, rail.h);

      c.fillStyle = '#9fb6cf';
      c.font = '11px monospace';
      c.fillText(rail.title, rail.x + 8, rail.y + 16);

      for (var i = 0; i < rail.slots.length; i++) {
        var s = rail.slots[i];
        /* 槽位标签（武器 / 护甲） */
        c.fillStyle = '#8a8aa0';
        c.font = '11px monospace';
        c.fillText(s.label, s.x, s.y - 6);
        /* 槽框：外黑 1px + 内亮 1px——形状与边框要能一眼看出"这是一个槽" */
        c.fillStyle = '#1b1b33';
        c.fillRect(s.x, s.y, s.w, s.h);
        c.strokeStyle = 'rgba(0,0,0,0.9)';
        c.lineWidth = 1;
        c.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
        c.strokeStyle = s.empty ? 'rgba(255,255,255,0.22)' : 'rgba(255,207,110,0.45)';
        c.strokeRect(s.x + 1.5, s.y + 1.5, s.w - 3, s.h - 3);

        /* D-80：图标位 26×26——已装备物品改用与行内同一张 24×24 原生图标（1:1 居中，
         * 不再用程序化色块，避免"行内真图标 / 右栏假图标"两套画法）；空槽仍是短横。 */
        var ix = s.x + 8, iy = s.y + Math.floor((s.h - 26) / 2);
        c.fillStyle = '#0f0f1e';
        c.fillRect(ix, iy, 26, 26);
        c.strokeStyle = 'rgba(255,255,255,0.18)';
        c.strokeRect(ix + 0.5, iy + 0.5, 25, 25);
        var railIcon = s.empty ? null : this._rowIcon({ id: s.id });
        if (s.empty) {
          c.fillStyle = 'rgba(255,255,255,0.16)';
          c.fillRect(ix + 9, iy + 12, 8, 2);
        } else if (railIcon) {
          var Rr2 = Game.Core && Game.Core.Render;
          if (Rr2 && Rr2.drawIcon) Rr2.drawIcon(c, railIcon, ix + 1, iy + 1);
          else c.drawImage(railIcon, ix + 1, iy + 1, 24, 24);
        } else if (s.slot === 'weapon') {
          c.fillStyle = '#c9d4e3';
          c.fillRect(ix + 12, iy + 5, 2, 12);
          c.fillStyle = '#ffcf6e';
          c.fillRect(ix + 8, iy + 17, 10, 2);
          c.fillStyle = '#b5793f';
          c.fillRect(ix + 12, iy + 19, 2, 4);
        } else {
          c.fillStyle = '#6f8bb5';
          c.fillRect(ix + 7, iy + 7, 12, 12);
          c.fillStyle = '#4d6389';
          c.fillRect(ix + 7, iy + 7, 4, 12);
          c.fillStyle = '#a9c0e0';
          c.fillRect(ix + 13, iy + 7, 2, 7);
        }

        /* 名称+强化等级 / 实际加成（空槽写"空"与 0 加成，不许留白） */
        var tx = ix + 34;
        var maxW = s.x + s.w - tx - 6;
        c.fillStyle = s.empty ? '#7c8296' : '#e8e8f0';
        c.font = '12px monospace';
        c.fillText(this._fitRow(c, s.empty ? '空' : (s.name + '+' + s.plus), maxW), tx, s.y + 26);
        c.fillStyle = s.empty ? '#5f6578' : '#7fd1ff';
        c.font = '11px monospace';
        c.fillText(s.value, tx, s.y + 46);
      }
    },

    /* 自适应：单行文本超宽时按实际字宽截断并加省略号（调用前已设好字体） */
    _fitRow: function (c, text, maxW) {
      var str = String(text);
      if (!c || c.measureText(str).width <= maxW) return str;
      var ell = '…';
      while (str.length > 0 && c.measureText(str + ell).width > maxW) {
        str = str.slice(0, -1);
      }
      return str + ell;
    },

    /* P1-2：当前行物品图标（inventory/shop/图鉴物品页）。D-30 起物品 id → 图标名走显式表，
     * 表里没有的 id（含未知物品）返回 null，不画图标、行文字保持原位。
     * shop 条目结构为 {id, item}，inventory 为 {id, count}，图鉴 page2 为 {id, def} */
    _rowIcon: function (entry) {
      if (!entry) return null;
      /* D-30：逻辑宽 < 420（含 320 档）一律不画图标——那里连正文都在截断，
       * 再让图标占 22px 行首只会更挤；宽屏照常。宽度未知（0）时保持旧行为。 */
      var vw = cssSize().w;
      if (vw && vw < 420) return null;
      var id = null;
      if (kind === 'shop') id = (entry.item && entry.item.id) || entry.id;
      else if (kind === 'inventory') id = entry.id;
      else if (kind === 'quests' && page === 2) id = entry.id;
      if (!id) return null;
      return itemIcon(id);
    },

    _rowText: function (entry) {
      if (kind === 'inventory') {
        var it = Game.Data.ITEMS[entry.id];
        var nm = (it && it.name) ? it.name : entry.id;
        return nm + upgSuffix(entry.id) + ' x' + entry.count + '   ' + itemDesc(it);
      } else if (kind === 'shop') {
        var item = entry.item || Game.Data.ITEMS[entry.id];
        var name = (item && item.name) ? item.name : entry.id;
        var price = (shopMode === 'buy' ? (item ? item.price : 0) : (item ? item.sell : 0)) + ' 金币';
        return name + '   ' + itemDesc(item) + '   ' + price;
      } else if (kind === 'quests') {
        /* D-85：第 4 页「系统」的行文本在构建时已定稿（只读快照） */
        if (page === 3) return entry.text || '';
        /* M8-4：page 0 任务页（行格式与改造前完全一致，行为不变） */
        if (page === 0) {
          var q = entry.q;
          var prog = Math.min(entry.progress, q.count);
          return q.desc + ' [' + prog + '/' + q.count + '] +' + q.reward.gold + '金+' + q.reward.exp + 'exp';
        }
        /* M8-4：page 1 怪物图鉴——已击杀显示 HP/ATK/DEF + 击杀数；未击杀只显示名称 + ???（隐藏数值，不新增描述文案） */
        var b = Game.Systems && Game.Systems.Bestiary;
        if (page === 1) {
          var mc = (b && typeof b.getMonsterCount === 'function') ? b.getMonsterCount(entry.id) : 0;
          if (mc > 0) {
            /* D-58：图鉴补一行习性说明（守卫 / 巡逻 / 追击 + 感知半径），
             * 只读 MONSTERS[id].habit，未击杀仍只显示 ???（不提前泄露） */
            var hb = entry.def.habit;
            var hx = hb ? ('   习性:' + (hb.label || hb.kind) + '(' + hb.sight + '格)') : '';
            return entry.def.name + '   HP:' + entry.def.hp + ' ATK:' + entry.def.atk + ' DEF:' + entry.def.def +
              '   击杀x' + mc + hx;
          }
          return entry.def.name + '   ???';
        }
        /* M8-4：page 2 物品图鉴——已获得显示 类型/效果 + 价格 + 获得数；未获得只显示名称 + ???（变体 id 同理） */
        var ic = (b && typeof b.getItemCount === 'function') ? b.getItemCount(entry.id) : 0;
        if (ic > 0) {
          return entry.def.name + '   ' + itemDesc(entry.def) + '   ' + entry.def.price + ' 金币   获得x' + ic;
        }
        return entry.def.name + '   ???';
      } else if (kind === 'stairconfirm') {
        return entry.text || '';
      } else if (kind === 'npcquest') {
        /* D-47：面板行文本由 NpcQuest.panel 统一生成（状态 / 进度 / 奖励 / 操作） */        return entry.text || '';
      }
      return '';
    }
  };
})();
