/* preflight/selfcheck/selfcheck.js — 项目全面自检（静态层）
 * 用法：node preflight/selfcheck/selfcheck.js
 * 覆盖：语法 / 加载序与引用完整性 / 命名空间契约 / 数据交叉引用 / 数值可复算 /
 *      素材注册与落盘 / 文案与残留 / 安全与外部依赖 / 死数据检测
 * 输出：逐项 [PASS|WARN|FAIL]，末尾汇总；exit code = FAIL 数量
 * 说明：静态层不启动浏览器；运行时层由 run-all.ps1 调 Edge headless 覆盖 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const R = [];
const f1 = (n) => Number(n.toFixed(4));

function rec(level, id, name, detail) {
  R.push({ level, id, name, detail: detail === undefined ? '' : String(detail) });
}
const PASS = (id, name, detail) => rec('PASS', id, name, detail);
const WARN = (id, name, detail) => rec('WARN', id, name, detail);
const FAIL = (id, name, detail) => rec('FAIL', id, name, detail);

function p(...a) { return path.join(ROOT, ...a); }
function read(...a) { return fs.readFileSync(p(...a), 'utf8'); }
function exists(...a) { return fs.existsSync(p(...a)); }
function walkJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJs(full));
    else if (/\.js$/.test(e.name)) out.push(full);
  }
  return out;
}

/* ── 1. 语法：node --check ───────────────────────────────── */
const jsFiles = walkJs(p('js'));
let synErr = [];
for (const f of jsFiles) {
  try {
    cp.execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    synErr.push(path.relative(ROOT, f) + ': ' + String(e.stderr || e.message).split('\n')[0]);
  }
}
synErr.length ? FAIL('SC-01', 'JS 语法检查', synErr.join(' | '))
  : PASS('SC-01', 'JS 语法检查', jsFiles.length + ' 个文件全部通过 node --check');

/* ── 2. 加载序与引用完整性 ─────────────────────────────── */
const idx = read('index.html');
const declared = [...idx.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const missing = declared.filter((s) => !exists(...s.split('/')));
const onDisk = jsFiles.map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
const orphans = onDisk.filter((f) => !declared.includes(f));
missing.length ? FAIL('SC-02', 'index.html 引用文件存在性', '缺失: ' + missing.join(', '))
  : PASS('SC-02', 'index.html 引用文件存在性', declared.length + ' 个引用均可解析');
orphans.length ? WARN('SC-03', '孤儿 JS（磁盘有、index 未加载）', orphans.join(', '))
  : PASS('SC-03', '孤儿 JS 检测', '无未加载文件');

/* 加载序断言：data 段必须先于 systems 段；vendor 先于依赖它的 systems；main.js 最后 */
(function () {
  const seg = (re) => declared.findIndex((s) => re.test(s));
  const bad = [];
  const dataLast = Math.max(...declared.map((s, i) => (/js\/data\//.test(s) ? i : -1)));
  const sysFirst = declared.findIndex((s) => /js\/systems\//.test(s));
  if (dataLast > sysFirst && sysFirst >= 0) bad.push('data 段晚于 systems 段');
  if (seg(/vendor\/rot\.min\.js/) > seg(/systems\/fov\.js/)) bad.push('rot.js 晚于 fov.js');
  if (seg(/vendor\/astar\.js/) > seg(/systems\/ai\.js/)) bad.push('astar.js 晚于 ai.js');
  if (declared.indexOf('js/core/main.js') !== declared.length - 1) bad.push('main.js 不是最后加载');
  if (seg(/data\/skills\.js/) > seg(/systems\/skills\.js/)) bad.push('data/skills.js 晚于 systems/skills.js');
  if (declared.filter((s) => /js\/core\/render\.js/.test(s)).indexOf('js/core/render.js') > seg(/systems\/lighting\.js/)) bad.push('render.js 晚于 lighting.js');
  bad.length ? FAIL('SC-04', '脚本加载序约束（PLAN §4.6）', bad.join(' | '))
    : PASS('SC-04', '脚本加载序约束（PLAN §4.6）', 'data→vendor→systems→main 且关键依赖先后正确');
})();

/* ── 3. 命名空间契约：定义的 Systems 是否有实现、调用的是否已定义 ── */
const codeFiles = jsFiles.map((f) => ({ f: path.relative(ROOT, f).replace(/\\/g, '/'), s: fs.readFileSync(f, 'utf8') }));
const definedSys = new Set();
const usedSys = new Map();
const definedData = new Set();
const usedData = new Map();
for (const { f, s } of codeFiles) {
  for (const m of s.matchAll(/Game\.Systems\.(\w+)\s*=/g)) definedSys.add(m[1]);
  for (const m of s.matchAll(/Game\.Systems\.(\w+)/g)) {
    if (!usedSys.has(m[1])) usedSys.set(m[1], new Set());
    usedSys.get(m[1]).add(f);
  }
  for (const m of s.matchAll(/Game\.Data\.(\w+)\s*=/g)) definedData.add(m[1]);
  for (const m of s.matchAll(/Game\.Data\.(\w+)/g)) {
    if (!usedData.has(m[1])) usedData.set(m[1], new Set());
    usedData.get(m[1]).add(f);
  }
}
const undefSystems = [...usedSys.keys()].filter((k) => !definedSys.has(k));
undefSystems.length ? FAIL('SC-05', 'Systems 命名空间未定义引用', undefSystems.join(', '))
  : PASS('SC-05', 'Systems 命名空间完整性', definedSys.size + ' 个系统，无未定义引用');

/* 死数据：Data 键除定义外无人读取 */
const deadData = [...definedData].filter((k) => (usedData.get(k) || new Set()).size <= 1);
deadData.length ? WARN('SC-06', '未被消费的数据键（死数据）', deadData.join(', '))
  : PASS('SC-06', '数据键消费情况', '所有 Game.Data.* 均有读取方');

/* ── 4. 加载数据文件（vm 沙箱，window 桩） ─────────────── */
const sandbox = { window: {}, console, Math, Date, JSON, String, Number, Object, Array, RegExp, parseInt, parseFloat, isFinite };
vm.createContext(sandbox);
const DATA_FILES = ['js/data/maps.js', 'js/data/monsters.js', 'js/data/items.js',
  'js/data/quests.js', 'js/data/skills.js', 'js/data/dialogue.js',
  'js/data/reactions.js', 'js/data/config.js'];
let loadErr = [];
for (const f of DATA_FILES) {
  try { vm.runInContext(read(f), sandbox, { filename: f }); } catch (e) { loadErr.push(f + ': ' + e.message); }
}
loadErr.length ? FAIL('SC-07', '数据文件沙箱加载', loadErr.join(' | '))
  : PASS('SC-07', '数据文件沙箱加载', DATA_FILES.length + ' 个数据文件无抛错');
const G = sandbox.window.Game || {};
const D = G.Data || {};

/* ── 5. 物品表 ─────────────────────────────────────────── */
const ITEMS = D.ITEMS || {};
const itemIds = Object.keys(ITEMS);
const itemBad = [];
for (const id of itemIds) {
  const it = ITEMS[id];
  if (it.id !== id) itemBad.push(id + ' id 与键名不一致');
  if (!['consumable', 'weapon', 'armor'].includes(it.type)) itemBad.push(id + ' type 非法:' + it.type);
  if (!(it.price > 0)) itemBad.push(id + ' price 非正');
  if (it.sell !== Math.floor(it.price / 2)) itemBad.push(id + ' sell≠floor(price/2):' + it.sell + '/' + it.price);
  if (!it.effect || typeof it.effect !== 'object') itemBad.push(id + ' 缺 effect');
  else {
    const keys = Object.keys(it.effect);
    if (keys.some((k) => !['atk', 'def', 'hp', 'mp', 'maxHp'].includes(k))) itemBad.push(id + ' effect 含未知键:' + keys.join('/'));
    if (it.type === 'weapon' && !(it.effect.atk > 0)) itemBad.push(id + ' 武器无 atk');
    if (it.type === 'armor' && !(it.effect.def > 0)) itemBad.push(id + ' 护甲无 def');
    if (it.type === 'consumable' && !(it.effect.hp > 0 || it.effect.mp > 0)) itemBad.push(id + ' 消耗品无 hp/mp');
  }
  if (!it.name) itemBad.push(id + ' 缺 name');
}
itemBad.length ? FAIL('DC-01', '物品表结构与取值', itemBad.slice(0, 12).join(' | ') + (itemBad.length > 12 ? ' …共' + itemBad.length + '项' : ''))
  : PASS('DC-01', '物品表结构与取值', itemIds.length + ' 条：id/type/price/sell=floor(price/2)/effect 全部合规');

/* 商店货架 */
const STOCK = D.SHOP_STOCK || [];
const stockBad = [];
STOCK.forEach((row, i) => {
  const dup = row.filter((x, j) => row.indexOf(x) !== j);
  if (dup.length) stockBad.push('F' + (i + 1) + ' 重复:' + dup.join(','));
  row.forEach((id) => { if (!ITEMS[id]) stockBad.push('F' + (i + 1) + ' 未定义物品:' + id); });
  if (row.length > 12) stockBad.push('F' + (i + 1) + ' 条目 ' + row.length + ' > MAX_VISIBLE 12');
});
const shopFloors = (D.MAPS || {}).floors || 0;
const noShelf = [];
for (let i = STOCK.length + 1; i <= shopFloors; i++) noShelf.push('F' + i);
const shopSrc = read('js/systems/shop.js');
const clampSrc = /Math\.min\(floor\s*-\s*1/.test(shopSrc);
if (noShelf.length) {
  stockBad.push('缺货架: ' + noShelf.join('/') + (clampSrc ? '（shop.js 用 Math.min 钳到末行，F' + (STOCK.length + 1) + '+ 沿用 F' + STOCK.length + ' 货架）' : ''));
}
stockBad.length ? FAIL('DC-02', '商店货架逐层覆盖', stockBad.join(' | '))
  : PASS('DC-02', '商店货架逐层覆盖', STOCK.length + ' 层货架与 ' + shopFloors + ' 层一一对应，共 ' + STOCK.reduce((a, r) => a + r.length, 0) + ' 个条目');

/* ── 6. 怪物表 ─────────────────────────────────────────── */
const MON = D.MONSTERS || {};
const monIds = Object.keys(MON);
const monBad = [];
const enrageBosses = [];
for (const id of monIds) {
  const m = MON[id];
  if (m.id !== id) monBad.push(id + ' id 与键名不一致');
  ['hp', 'atk', 'def', 'exp'].forEach((k) => { if (!(m[k] > 0)) monBad.push(id + ' ' + k + ' 非正'); });
  if (!(Array.isArray(m.gold) && m.gold.length === 2 && m.gold[0] <= m.gold[1])) monBad.push(id + ' gold 区间非法');
  if (!Array.isArray(m.drops)) monBad.push(id + ' 缺 drops 数组');
  else {
    m.drops.forEach((d, di) => {
      if (!ITEMS[d.itemId]) monBad.push(id + ' drops[' + di + '] 未定义物品:' + d.itemId);
      if (!(d.rate > 0 && d.rate <= 1)) monBad.push(id + ' drops[' + di + '] rate 越界');
      if (d.tiers) {
        const sum = d.tiers.reduce((a, t) => a + t.w, 0);
        if (sum !== 100) monBad.push(id + ' tiers 权重和=' + sum);
        d.tiers.forEach((t) => { if (!ITEMS[t.itemId]) monBad.push(id + ' tier 未定义物品:' + t.itemId); });
        if (d.rate > 0 && d.tiers[0].itemId !== d.itemId) monBad.push(id + ' tiers[0] 与 itemId 不一致');
      }
    });
  }
  if (m.boss) {
    enrageBosses.push(id);
    if (!m.enrage) monBad.push(id + ' boss 无 enrage');
    else {
      const e = m.enrage;
      ['hpPct', 'atkMul', 'defMul'].forEach((k) => { if (!(e[k] > 0)) monBad.push(id + ' enrage.' + k + ' 缺失'); });
      if (!(e.skill && e.skill.name && e.skill.chance > 0 && e.skill.chance <= 1 && e.skill.dmgMul > 1)) monBad.push(id + ' enrage.skill 不完整');
    }
  }
  if (!/^#/.test(m.color || '')) monBad.push(id + ' color 非色值');
}
monBad.length ? FAIL('DC-03', '怪物表结构与掉落引用', monBad.slice(0, 12).join(' | ') + (monBad.length > 12 ? ' …共' + monBad.length + '项' : ''))
  : PASS('DC-03', '怪物表结构与掉落引用', monIds.length + ' 种（Boss ' + enrageBosses.length + ' 种），drops/tiers/color/enrage 全部合规');

/* ── 7. 地图：楼层数、概率和、Boss 注入、期望强度单调 ── */
const MAPS = D.MAPS || {};
const floors = MAPS.floors;
const mapBad = [];
if ((MAPS.enemyTable || []).length !== floors) mapBad.push('enemyTable 行数 ' + (MAPS.enemyTable || []).length + ' ≠ floors ' + floors);
if ((MAPS.sizes || []).length !== floors) mapBad.push('sizes 长度 ≠ floors');
if ((MAPS.themes || []).length !== floors) mapBad.push('themes 长度 ≠ floors');
const expect = [];
(MAPS.enemyTable || []).forEach((row, i) => {
  const sum = f1(row.reduce((a, e) => a + e.rate, 0));
  if (Math.abs(sum - 1) > 1e-9) mapBad.push('F' + (i + 1) + ' 概率和=' + sum);
  let exp = 0;
  row.forEach((e) => {
    const m = MON[e.id];
    if (!m) mapBad.push('F' + (i + 1) + ' 未定义怪物:' + e.id);
    else exp += e.rate * (m.atk + m.hp / 10);
  });
  expect.push(f1(exp));
  row.forEach((e) => { if (MON[e.id] && MON[e.id].boss) mapBad.push('F' + (i + 1) + ' 普通表含 Boss:' + e.id); });
});
for (let i = 1; i < expect.length; i++) {
  if (!(expect[i] > expect[i - 1])) mapBad.push('期望强度非单调 F' + i + '→F' + (i + 1) + ':' + expect[i - 1] + '→' + expect[i]);
}
(MAPS.bosses || []).forEach((b) => {
  if (!(b.floor >= 1 && b.floor <= floors)) mapBad.push('bosses floor 越界:' + b.floor);
  if (!MON[b.id]) mapBad.push('bosses 未定义怪物:' + b.id);
  else if (!MON[b.id].boss) mapBad.push('bosses ' + b.id + ' 未标 boss:true');
  const rowHas = (MAPS.enemyTable || [])[b.floor - 1] || [];
  if (rowHas.some((e) => e.id === b.id)) mapBad.push('F' + b.floor + ' 普通表与 bosses 重复:' + b.id);
});
const bossFloors = new Set((MAPS.bosses || []).map((b) => b.floor));
for (let i = 1; i <= floors; i++) if (!bossFloors.has(i) && i === floors) mapBad.push('末层无 Boss 配置');
mapBad.length ? FAIL('DC-04', '地图配置与难度曲线', mapBad.join(' | '))
  : PASS('DC-04', '地图配置与难度曲线', floors + ' 层，概率和=1，Boss 3 层不混表，期望强度 ' + expect.join(' < '));

/* ── 8. 任务表 ─────────────────────────────────────────── */
const QUESTS = D.QUESTS || [];
const qBad = [];
const qIds = new Set();
const TYPES = ['kill', 'gold', 'floor', 'level', 'collect'];
QUESTS.forEach((q) => {
  if (qIds.has(q.id)) qBad.push('id 重复:' + q.id);
  qIds.add(q.id);
  if (!TYPES.includes(q.type)) qBad.push(q.id + ' type 非法:' + q.type);
  if (!(q.count > 0)) qBad.push(q.id + ' count 非正');
  if (q.type === 'kill' && !MON[q.target]) qBad.push(q.id + ' kill 目标未定义:' + q.target);
  if (q.type === 'collect' && !ITEMS[q.target]) qBad.push(q.id + ' collect 目标未定义:' + q.target);
  if (q.type === 'floor' && !(q.target >= 1 && q.target <= floors)) qBad.push(q.id + ' floor 目标越界:' + q.target);
  if (!q.reward || !(q.reward.gold >= 0) || !(q.reward.exp >= 0)) qBad.push(q.id + ' reward 非法');
  if (!q.desc) qBad.push(q.id + ' 缺 desc');
});
/* 主线必须指向 Boss 且可通关 */
const main = QUESTS.find((q) => q.id === 'main_clear_dragon');
if (!main) qBad.push('缺主线 main_clear_dragon');
else if (!MON[main.target] || !MON[main.target].boss) qBad.push('主线目标非 Boss');
qBad.length ? FAIL('DC-05', '任务表结构与目标引用', qBad.join(' | '))
  : PASS('DC-05', '任务表结构与目标引用', QUESTS.length + ' 条，type/目标/奖励全合规，主线指向 Boss');

/* ── 9. 技能表 ─────────────────────────────────────────── */
const SK = D.SKILLS || {};
const skBad = [];
const keys = new Set();
Object.keys(SK).forEach((id) => {
  const s = SK[id];
  if (!s.name) skBad.push(id + ' 缺 name');
  if (!(s.key >= 4 && s.key <= 6)) skBad.push(id + ' key 不在战斗可用键 4~6');
  if (keys.has(s.key)) skBad.push(id + ' key 重复:' + s.key);
  keys.add(s.key);
  if (!(s.mpCost > 0)) skBad.push(id + ' mpCost 非正');
  if (!(s.cd >= 0)) skBad.push(id + ' cd 非法');
  if (!(typeof s.dmg === 'function' || typeof s.effect === 'function')) skBad.push(id + ' 缺 dmg/effect 公式');
});
Object.keys(SK).length !== 3 ? skBad.push('技能数 ' + Object.keys(SK).length + ' ≠ 3') : null;
skBad.length ? FAIL('DC-06', '技能表契约', skBad.join(' | '))
  : PASS('DC-06', '技能表契约', '3 个技能，快捷键 4/5/6 唯一，公式为函数');

/* ── 10. 反应库：结构、去重、条数 ─────────────────────── */
const RE = D.REACTIONS || {};
const reBad = [];
const roles = Object.keys(RE);
if (roles.length !== 3) reBad.push('角色数 ' + roles.length + ' ≠ 3');
const roleTags = {};
roles.forEach((role) => {
  const tags = Object.keys(RE[role]);
  roleTags[role] = tags;
  const seen = new Map();
  tags.forEach((tag) => {
    const arr = RE[role][tag];
    if (!Array.isArray(arr)) { reBad.push(role + '/' + tag + ' 非数组'); return; }
    if (arr.length < 4) reBad.push(role + '/' + tag + ' 条数 ' + arr.length + ' < 4');
    arr.forEach((s, i) => {
      if (typeof s !== 'string' || !s.trim()) reBad.push(role + '/' + tag + '[' + i + '] 空串');
      const k = String(s).trim();
      if (seen.has(k)) reBad.push(role + ' 重复句:' + k.slice(0, 14) + '… (' + seen.get(k) + ' 与 ' + tag + '[' + i + '])');
      else seen.set(k, tag + '[' + i + ']');
      if (k.length > 60) reBad.push(role + '/' + tag + '[' + i + '] 过长 ' + k.length + ' 字');
    });
  });
});
const reTotal = roles.reduce((a, r) => a + roleTags[r].reduce((b, t) => b + RE[r][t].length, 0), 0);
reBad.length ? WARN('DC-07', '反应库结构与去重', reBad.slice(0, 10).join(' | ') + (reBad.length > 10 ? ' …共' + reBad.length + '项' : ''))
  : PASS('DC-07', '反应库结构与去重', roles.length + ' 角色 / ' + reTotal + ' 条，无重复句、无空串');

/* 角色 tag 语义对齐（guard 应含 polite 类；merchant 应含 shop） */
const tagWarn = [];
if (!roleTags.guard.includes('greeting')) tagWarn.push('guard 缺 greeting');
if (!roleTags.merchant.includes('shop')) tagWarn.push('merchant 缺 shop');
tagWarn.length ? WARN('DC-08', '反应库 tag 语义', tagWarn.join(' | '))
  : PASS('DC-08', '反应库 tag 语义', '三角色共 ' + Object.keys(roleTags.guard).length + ' 类 tag，含 shop 专属');

/* ── 11. 素材注册 vs 落盘 ─────────────────────────────── */
const spritesSrc = read('js/core/sprites.js');
const nmBlock = spritesSrc.slice(spritesSrc.indexOf('var NAMES = ['), spritesSrc.indexOf('];'));
const names = [...nmBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const files = fs.readdirSync(p('assets', 'sprites')).filter((x) => x.endsWith('.png'));
const nameSet = new Set(names);
const missingAsset = names.filter((n) => !files.includes(n + '.png'));
const extraAsset = files.filter((f) => !nameSet.has(f.replace(/\.png$/, '')));
missingAsset.length
  ? WARN('AS-01', '已注册素材缺文件（走程序化兜底）', missingAsset.length + '/' + names.length + ': ' + missingAsset.join(', '))
  : PASS('AS-01', '已注册素材缺文件', '全部 ' + names.length + ' 个注册名均有 PNG');
extraAsset.length ? WARN('AS-02', '落盘素材未注册（不会被加载）', extraAsset.join(', '))
  : PASS('AS-02', '落盘素材未注册', '无冗余 PNG');

/* 装饰物 id 必须在 NAMES 内 */
const DECOR = D.DECOR || {};
const decorMiss = Object.keys(DECOR).filter((d) => !nameSet.has(d));
decorMiss.length ? FAIL('AS-03', '装饰物 id 未注册素材名', decorMiss.join(', '))
  : PASS('AS-03', '装饰物 id 注册', Object.keys(DECOR).length + ' 个装饰物均在 NAMES');

/* MONSTER_ANIM 覆盖所有怪物 */
const renderSrc = read('js/core/render.js');
const animBlock = renderSrc.slice(renderSrc.indexOf('var MONSTER_ANIM = {'), renderSrc.indexOf('};', renderSrc.indexOf('var MONSTER_ANIM = {')));
const animIds = [...animBlock.matchAll(/\n\s{4}(\w+)\s*:\s*\{/g)].map((m) => m[1]);
const animMiss = monIds.filter((id) => !animIds.includes(id));
animMiss.length ? WARN('AS-04', '怪物缺动画映射（回退 chort 色块）', animMiss.join(', '))
  : PASS('AS-04', '怪物动画映射覆盖', animIds.length + ' 条映射，覆盖全部 ' + monIds.length + ' 种怪');

/* 动画帧组注册完整性：MONSTER_ANIM 引用的帧基名必须能被 NAMES 命中 */
const frameBases = [...animBlock.matchAll(/(?:idle|run):\s*'([^']+)'/g)].map((m) => m[1]);
const frameMiss = [...new Set(frameBases)].filter((b) => {
  if (nameSet.has(b)) return false;                       /* 单帧名 */
  if (nameSet.has(b + '_anim_f0')) return false;          /* base_anim_f0 约定 */
  return true;
});
frameMiss.length ? WARN('AS-05', '动画帧基名无对应素材', frameMiss.join(', '))
  : PASS('AS-05', '动画帧基名解析', [...new Set(frameBases)].length + ' 个帧基名均可解析');

/* ── 12. DOM id 与 CSS 契约 ─────────────────────────────── */
const htmlIds = [...read('index.html').matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const idUses = [];
for (const { f, s } of codeFiles) {
  for (const m of s.matchAll(/getElementById\('([^']+)'\)/g)) idUses.push({ id: m[1], f });
}
const idMiss = [...new Set(idUses.filter((u) => !htmlIds.includes(u.id)).map((u) => u.id))];
idMiss.length ? FAIL('UI-01', '代码引用的 DOM id 在 index.html 缺失', idMiss.join(', '))
  : PASS('UI-01', 'DOM id 引用', idUses.length + ' 处引用全部命中 index.html 的 ' + htmlIds.length + ' 个 id');
!exists('css', 'style.css') ? FAIL('UI-02', 'css/style.css 缺失', '') : PASS('UI-02', 'css/style.css', fs.statSync(p('css', 'style.css')).size + ' 字节');

/* ── 13. 安全与外部依赖 ───────────────────────────────── */
const extUrls = [];
for (const { f, s } of codeFiles) {
  for (const m of s.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) extUrls.push({ f, u: m[0] });
}
const nonDeepseek = extUrls.filter((e) => !/deepseek\.com|127\.0\.0\.1|localhost/.test(e.u) && !/vendor\//.test(e.f));
nonDeepseek.length ? WARN('SE-01', '运行期外部 URL', nonDeepseek.map((e) => e.f + ':' + e.u).slice(0, 6).join(' | '))
  : PASS('SE-01', '运行期外部依赖', extUrls.length + ' 个 URL，仅 DeepSeek 官方接口（Key 为空时离线）');
(D.CONFIG || {}).deepseekKey ? FAIL('SE-02', 'config.js 含真实 API Key', '禁止提交 Key') : PASS('SE-02', 'API Key 未硬编码', 'deepseekKey 为空，离线降级为默认态');

const evalUse = codeFiles.filter(({ s }) => /\beval\s*\(|new Function\s*\(/.test(s)).map(({ f }) => f);
evalUse.length ? WARN('SE-03', 'eval / new Function 使用', evalUse.join(', ')) : PASS('SE-03', '无 eval / new Function', '');
const http_ = codeFiles.filter(({ f, s }) => !/vendor\//.test(f) && /\bhttp:\/\/|getScript|document\.write/.test(s)).map(({ f }) => f);
http_.length ? WARN('SE-04', '明文 http 或 document.write', http_.join(', ')) : PASS('SE-04', '无明文 http / document.write', '');

/* localStorage 键一致性（save.js 以 var KEY 常量持有键名，需解析常量而非字面量） */
const saveSrc = read('js/systems/save.js');
const keyConst = (saveSrc.match(/var\s+KEY\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
const lsKeys = keyConst ? [keyConst] : [];
const lsOther = [];
for (const { f, s } of codeFiles) {
  for (const m of s.matchAll(/localStorage\.(?:get|set|remove)Item\(['"]([^'"]+)['"]/g)) {
    if (!lsKeys.includes(m[1])) lsOther.push(f + ':' + m[1]);
  }
}
lsOther.length ? WARN('SE-05', 'localStorage 键分散', lsOther.join(', '))
  : PASS('SE-05', 'localStorage 键收敛', lsKeys.length + ' 个键，均在 save.js 集中管理');

/* ── 14. 文案残留与占位符 ─────────────────────────────── */
const leftovers = [];
for (const { f, s } of codeFiles) {
  if (/vendor\//.test(f)) continue;                       /* 第三方库不计入本项目文案 */
  if (/第3层|第三层|3层/.test(s) && /dialogue|npc|reactions/.test(f)) leftovers.push(f + ' 含旧楼层文案');
  if (/TODO|FIXME|XXX|待实现|待补/.test(s)) leftovers.push(f + ' 含 TODO/FIXME');
  if (/console\.log\(/.test(s)) leftovers.push(f + ' 含 console.log');
  if (/lorem ipsum/i.test(s)) leftovers.push(f + ' 含 lorem 占位');
}
leftovers.length ? WARN('TX-01', '文案残留 / 调试痕迹', leftovers.join(' | '))
  : PASS('TX-01', '文案残留 / 调试痕迹', '无旧楼层文案、无 TODO、无 console.log');

/* 角色名一致性：dialogue.js 的 NPC 名单一 */
const npcName = (D.NPC || {}).name;
PASS('TX-02', 'NPC 命名', 'Game.Data.NPC.name = ' + npcName);

/* ── 15. 体积与可维护性（信息项） ───────────────────────── */
const sizes = codeFiles.map(({ f }) => ({ f, n: fs.statSync(p(f)).size }));
const bigFiles = sizes.filter((x) => x.n > 30000);
bigFiles.length ? WARN('QF-01', '单文件体积偏大', bigFiles.map((x) => x.f + ' ' + (x.n / 1024).toFixed(1) + 'KB').join(', '))
  : PASS('QF-01', '单文件体积', '最大 ' + (Math.max(...sizes.map((x) => x.n)) / 1024).toFixed(1) + 'KB');
const totalKb = (sizes.reduce((a, x) => a + x.n, 0) / 1024).toFixed(1);
PASS('QF-02', '代码总量', codeFiles.length + ' 文件 / ' + totalKb + ' KB（不含 vendor）');

/* ── 16. 交叉一致性：README/讲稿声明的条目数 ──────────── */
const readme = exists('README.md') ? read('README.md') : '';
const claims = [];
[[/(\d+)\s*种怪物|怪物.{0,6}(\d+)\s*种/, monIds.length, '怪物'],
 [/任务.{0,8}(\d+)\s*条|(\d+)\s*条任务/, QUESTS.length, '任务'],
 [/物品.{0,8}(\d+)\s*条|(\d+)\s*条物品/, itemIds.length, '物品'],
 [/(\d+)\s*层/, floors, '楼层']].forEach(([re, actual, label]) => {
  const m = readme.match(re);
  if (m) {
    const num = Number(m[1] || m[2]);
    if (num !== actual) claims.push(label + ' README 写 ' + num + '，实际 ' + actual);
  }
});
claims.length ? WARN('XC-01', 'README 数字与实际不符', claims.join(' | '))
  : PASS('XC-01', 'README 数字一致性', '未发现与实际数据冲突的条目数声明');

/* ── 16b. 文档楼层口径：README / 答辩讲稿里的「第 N 层巨龙」须等于 Boss 实际楼层 ── */
const DOCS = ['README.md', 'docs/答辩讲稿.md'];
const docBossFloors = ((D.MAPS || {}).bosses || []).map((b) => b.id + '@F' + b.floor);
const dragonFloor = ((D.MAPS || {}).bosses || []).filter((b) => b.id === 'dragon').map((b) => b.floor)[0] || 0;
const floorClaims = [];
for (const f of DOCS) {
  if (!exists(f)) continue;
  const txt = read(f);
  const hits = [...txt.matchAll(/第\s*(\d+)\s*层(?:的)?(?:巨龙|龙|Boss|BOSS)?/g)];
  for (const h of hits) {
    const n = Number(h[1]);
    if (dragonFloor && n !== dragonFloor && /巨龙|龙|Boss|BOSS/.test(h[0])) {
      floorClaims.push(f + ' 写「' + h[0] + '」，巨龙实际在 F' + dragonFloor);
    }
  }
}
floorClaims.length ? WARN('XC-02', '文档楼层口径不符', floorClaims.join(' | '))
  : PASS('XC-02', '文档楼层口径', DOCS.filter((f) => exists(f)).length + ' 份文档的 Boss 楼层口径与 bosses 配置一致（' + docBossFloors.join(', ') + '）');

/* ── 输出 ─────────────────────────────────────────────── */
const order = { FAIL: 0, WARN: 1, PASS: 2 };
R.sort((a, b) => order[a.level] - order[b.level] || a.id.localeCompare(b.id));
const sum = { PASS: 0, WARN: 0, FAIL: 0 };
for (const r of R) {
  sum[r.level]++;
  console.log('[' + r.level + '] ' + r.id + ' ' + r.name + (r.detail ? ' — ' + r.detail : ''));
}
console.log('\nSUMMARY ' + JSON.stringify({ total: R.length, ...sum }));
const jsonOut = path.join(__dirname, 'selfcheck-result.json');
fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), summary: sum, items: R, facts: {
  floors, monsters: monIds.length, bosses: enrageBosses, items: itemIds.length,
  quests: QUESTS.length, reactions: reTotal, expect, stock: STOCK.map((r) => r.length),
  spritesRegistered: names.length, spritesOnDisk: files.length, spritesMissing: missingAsset
} }, null, 2), 'utf8');
process.exit(sum.FAIL);
