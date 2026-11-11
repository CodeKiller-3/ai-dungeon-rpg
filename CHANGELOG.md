# 更新日志（CHANGELOG）

本文件记录**已实现并已通过回归**的变更。版本号唯一权威来源是 `index.html` 的 `<meta name="game-version">`，本文件顶部条目与之一致。

> 每条条目末尾带一个不可见的锚点注释（形如 `锚点: 相对路径#符号名`），由 `preflight/verify_d31.html` 扫描校验"提到的功能在代码里真实存在"，防止把没做的功能写进来。

## [1.0.0] - 2026-11-12

首个可交付版本：五层地牢、回合制战斗、背包装备、商店、任务、图鉴、排行榜、本地存档、四类 AI 能力（A\* / 行为状态机 / 大模型 NPC / Q-learning），零构建、`file://` 双击即玩。

### 机制

- 五层地牢：DFS 迷宫生成、上下楼梯换层、每层主题与期望强度单调递增（第 5 层 44.1）。<!-- 锚点: js/data/maps.js#floors -->
- 回合制战斗：攻击 / 防御 / 逃跑，经验金币掉落、死亡结算。<!-- 锚点: js/systems/battle.js#Game.Systems.Battle -->
- 三技能：火球 / 冲刺 / 护盾，消耗 MP、按回合冷却。<!-- 锚点: js/systems/skills.js#Game.Skills -->
- 三名 Boss 二阶段：第 2 层独眼酋长、第 4 层僵尸王、第 5 层地牢巨龙（半血狂暴）。<!-- 锚点: js/data/monsters.js#enrage -->
- 陷阱与状态：地刺 / 毒气，流血 / 中毒按回合结算。<!-- 锚点: js/systems/battle.js#Game.Systems.Status -->
- 密室：第 2 层起每层最多 1 间单门封闭房间 + 密室宝箱。<!-- 锚点: js/systems/map.js#Game.Systems.Map -->
- 装备强化 +1~+5：强化卷轴、每级 +10% 向上取整、`effValue` 单一公式。<!-- 锚点: js/systems/inventory.js#effValue -->
- 12 条任务（1 主线 + 11 支线），按击杀 / 楼层 / 等级 / 收集推进。<!-- 锚点: js/data/quests.js#Game.Data.QUESTS -->
- 图鉴：怪物 / 物品自动登记，未遭遇显示 ???。<!-- 锚点: js/systems/bestiary.js#Game.Systems.Bestiary -->
- 本地排行榜：通关时间 / 金币 / 等级，最近 10 条。<!-- 锚点: js/systems/leaderboard.js#aiDungeon_leaderboard -->
- 起手匕首：新档与重开都发一把 `knife`（+1 攻击），旧档不补发。<!-- 锚点: js/core/main.js#START_WEAPON -->
- 本地存档 `ai_dungeon_rpg_save_v1`：自动存档、读档按等级重算属性。<!-- 锚点: js/systems/save.js#ai_dungeon_rpg_save_v1 -->
- 大模型 NPC 对话：配置 Key 走 DeepSeek，无 Key / 断网降级为离线规则问答。<!-- 锚点: js/systems/npc.js#Game.Systems.NPC -->
- Q-learning 寻宝鼠演示：ε-贪心 + 距离势引导，实时显示成功率。<!-- 锚点: js/systems/learner.js#Game.Systems.Learner -->
- 怪物 AI：巡逻→追击状态机 + A\* 逐格追击。<!-- 锚点: js/systems/ai.js#Game.Systems.AI -->

### 界面

- 游戏内弹窗：背包 / 商店 / 任务图鉴 / 设置 / 死亡结算，键盘 ↑↓ + Enter 与鼠标点击双路。<!-- 锚点: js/systems/modal.js#Game.Modal -->
- 背包信息层：页头装备摘要、行尾「已装备 / 强化实值」徽标、逻辑宽 ≥700 的只读装备栏、装备对比差值（`modal._rowDelta`，▲/▼/持平）。<!-- 锚点: js/systems/modal.js#_railLayout -->
- 物品图标：48 件物品 48 条显式映射，逻辑宽 <420 自动不画图标。<!-- 锚点: js/data/items.js#ITEM_ICONS -->
- 顶部 HUD：心形血条、金币、楼层、击杀进度、等级经验。<!-- 锚点: js/systems/hud.js#Game.hud -->
- 底部提示条：战斗失败原因、引导、胜利与升级文字统一走 `ui:notice`。<!-- 锚点: js/systems/notice.js#Game.Notice -->
- 战斗表现：时间轴分段、伤害飘字、受击抖动、顿帧与震屏。<!-- 锚点: js/systems/fx.js#Game.Fx -->
- 音效与 BGM：Web Audio 程序化合成，三场景自动切换，K 静音 / Q 音量面板。<!-- 锚点: js/systems/audio.js#Game.Systems.Audio -->
- 视野与光影：rot.js 精确投影迷雾、火把光晕、视野软边、暗角。<!-- 锚点: js/systems/fov.js#Game.fov -->

### 工具

- 回归批跑：72 个 headless 验证页 + 页数兜底（页数不符即 FAIL，杜绝 `TOTAL=0` 假绿）。<!-- 锚点: preflight/selfcheck/run-all.ps1#Get-PageVerdict -->
- 素材审计：207 张 PNG 的空帧 / 尺寸 / 编号 / 注册 / 60 色调色板一次性核对。<!-- 锚点: preflight/selfcheck/d21_audit.js#paletteSize -->
- 三层自检：UI / 数据口径 / 文档一致性共 33 项，含 README 数字一致性。<!-- 锚点: preflight/selfcheck/selfcheck.js#SUMMARY -->
- bot 跑局压测台：同种子批量跑局，产出死亡归因统计。<!-- 锚点: preflight/bot_d23.html#maxActions -->
- 线上核验产物：逐页记录 Pages 取数通道的运行时裁决行。<!-- 锚点: preflight/selfcheck/d26-online-verify.json#pages -->

### 文档

- README：玩法、按键、AI 亮点与四组 Q-learning 口径、目录结构、组件来源。<!-- 锚点: README.md#功能列表 -->
- 任务卡体系：每张卡一份 `docs/tasks/*.md`，含契约与验收。<!-- 锚点: docs/tasks/S3-3-modal.md#弹窗 -->
- 第三方许可：`THIRD-PARTY-NOTICES.md`（含 rot.js BSD-3 全文）与 `assets/sprites/LICENSE.md`。<!-- 锚点: THIRD-PARTY-NOTICES.md#rot.js -->
- 本更新日志与版本号收敛：`index.html` meta 为唯一版本源。<!-- 锚点: CHANGELOG.md#锚点 -->
