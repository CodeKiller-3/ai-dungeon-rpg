# P2-3b 扩层收尾补丁（文案同步 / 图鉴滚动 / 末层唯一 Boss / F4-F5 数值上调）

> 阶段：P2 内容扩量 · P2-3 收尾
> 状态：待 Trae 实现
> 前置：P2-3 主体已完成（工作区未提交），豆包独立验证 5 页全绿

## 一、背景

P2-3 扩到 5 层后暴露 3 个可见缺口 + 1 个数值遗留，需一并修完再提交：

1. `js/data/dialogue.js` 3 处 NPC 台词仍写"第3层巨龙"，实际 Boss 已迁到 F5。
2. `js/systems/modal.js` 图鉴页 `MAX_VISIBLE=12` 硬截断：怪物 16 种、物品 42 条，只能看到前 12 行，且无滚动/分页。
3. F5 敌表 dragon .2 × 13 只怪 ≈ 2.6 只龙，"Boss 层"出现多只 Boss，观感异常。
4. F4/F5 期望强度（29.65 / 32.1）低于卡面建议（33~40 / 45+），后期压力不足。

## 二、实现要点

### 1. 文案同步（js/data/dialogue.js）
- L14：`'打败第3层的巨龙即可通关；怪物会巡逻，小心被追击。'` → `'打败地牢最深处的巨龙即可通关；怪物会巡逻，小心被追击。'`
- L16：`'...最后到第3层打败巨龙。...'` → `'...最后到地牢最深处打败巨龙。...'`
- L18：`'第3层的巨龙是这里的主宰，...'` → `'地牢最深处的巨龙是这里的主宰，...'`
- 全文 grep "第3层|第三层|3层"，确认无残留（含 reactions.js 如涉及层数表述一并检查，允许保留但需与 5 层一致）。

### 2. 图鉴滚动（js/systems/modal.js）
- 新增模块级变量 `qScroll = 0`（仅 quests 图鉴 page 1/2 使用）。
- 渲染：
  - `var start = (kind === 'quests' && data.length > MAX_VISIBLE) ? qScroll : 0;`
  - `var rows = Math.min(data.length - start, MAX_VISIBLE);`
  - 行数据取 `data[start + i]`，选中高亮判断 `i + start === sel`；图形左移/图标取 `entry = data[start + i]`。
  - 底部提示区显示 `↑↓ 浏览` + `(sel+1)/total`（可选但建议，便于知道还有内容）。
- 键盘（现有 ↑↓ 已改 sel，本卡补滚动跟随）：
  - `if (kind==='quests' && data.length > MAX_VISIBLE) { if (sel < qScroll) qScroll = sel; else if (sel >= qScroll + MAX_VISIBLE) qScroll = sel - MAX_VISIBLE + 1; }`
  - 图鉴页 PageUp/PageDown 可选（不改也行）。
- 点击热区：`var absIdx = rowIdx + start; if (absIdx >= 0 && absIdx < data.length) { sel = absIdx; this._confirm(); }`（替换现 L377 的 `rowIdx < data.length && rowIdx < MAX_VISIBLE`）。
- 打开面板 / `_setPage` 切页时：`qScroll = 0; sel = 0;`（避免上次滚动残留）。
- 商店/背包/任务页行为不变（它们条目数 ≤ MAX_VISIBLE 或已另有分页，若商店 9 项 <12 不受影响）。

### 3. 末层唯一 Boss（js/systems/map.js）
- `spawnEnemies()` 末层处理：现有逻辑只保证"至少 1 只 dragon"。改为：**统计 dragon 数量，保留第一只，其余替换为同层敌表中非 dragon 的随机 id**（保证恰好 1 只 Boss）。
- 不改其他层逻辑；不改随机数调用顺序以外的行为（尽量最小改动，替换用同一次 random 取表内非 dragon 项）。

### 4. F4/F5 数值上调（js/data/monsters.js）
- 目标期望强度：F4 ≈ 35~38、F5 ≈ 44~48（严格单调且高于 F3=23.75）。
- 建议调整（保持 F1~F3 不变）：
  - big_zombie：hp 170→200 / atk 22→26（对 F4/F5 均值贡献最大）
  - necromancer：hp 100→115 / atk 19→24
  - masked_orc：hp 105→120 / atk 19→23
  - pumpkin_dude：hp 110→120 / atk 18→22
  - angel：hp 90→100 / atk 21→28
  - 按当前概率复算 F4/F5 期望值并填卡输出；若不到目标区间可再微调，但**不得改动 F1~F3 数值**。
- 注意：数值上调会改变 `verify_m8_6` 的 t7_nogrind 伤害模拟（对 dragon 不变，dragon 未改），一般不影响；若影响需同步并输出新旧对比。

## 三、硬性约束

- 不改战斗公式/升级曲线/装备体系；不改 F1~F3 怪物数值与敌表；素材不动。
- 图鉴滚动只在 quests 图鉴页生效，tasks/shop/inventory 页行为不变。
- 保持 file:// 零构建可玩；不引新库。

## 四、完成标准

1. 改动文件清单。
2. `preflight/verify_p2_3b.html`（R-01 模板）断言：
   - t2_dialogue：dialogue.js 无"第3层/第三层"残留（读取 Game.Data.DIALOGUE 或 NPC 数据中的 reply 文本扫描）
   - t3_bestiaryScroll：图鉴怪物页 data=16 时，qScroll 生效——sel 从 0 移到 15 后可见窗口包含第 16 条（渲染行数据读取 data[15]，通过包装 drawImage/fillText 记录行的名称/??? 判断，或读取 Modal 暴露的调试字段）
   - t4_bestiaryItems：物品页 42 条同样可滚到第 42 条
   - t5_oneDragon：F5 生成 20 次，每次 dragon 数恰为 1；非末层为 0
   - t6_strengthUp：F4/F5 期望强度落在 35~38 / 44~48 区间且保持五层严格单调（输出 f1~f5）
   - 输出 `PASS {"patchLoaded":true,"patchApi":true,"patchOk":true}` + 子断言
3. `verify_p2_3` 的 t8_dragonFinal 断言如与新逻辑冲突（例如原断言"存在 dragon"仍成立，但若断言了数量/位置需同步），同步后整页 PASS。
4. `verify_m8_6` 如受数值影响需同步；`verify_m3`（如含图鉴/商店断言）如受影响需说明。
5. index.html 冒烟 0 JS 错误；全量回归全 PASS。
6. 剩余风险点。

## 五、风险点（已知）

- 图鉴滚动新增 qScroll 状态，若 `_setPage` 未重置会出现"切页后停在中间"——卡面已要求打开/切页重置，需实测。
- 末层唯一 Boss 替换逻辑依赖敌表存在非 dragon 项；若某天表里只有 dragon，需兜底（保留 1 只、其余保留原样）。
- 数值上调后 F4/F5 单体战斗可能更痛（big_zombie atk26），需要试玩确认不是"必死关"。
