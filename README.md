# AI勇者闯地牢：像素冒险RPG小游戏

> 《人工智能基础》课程大作业 · 组件化拼装的 AI 冒险 RPG

[在线试玩](https://CodeKiller-3.github.io/ai-dungeon-rpg/)（GitHub Pages 已部署）

## 项目简介

一款可离线运行的像素风冒险 RPG 小游戏：随机迷宫探索、回合制战斗、背包装备、商店交易、任务系统、本地存档一应俱全，并集成三层 AI 能力——**A\* 寻路、AI 行为状态机、大模型 NPC 对话**。项目采用组件化拼装思路构建：站在开源巨人肩膀上，引入 GitHub 现成模块（javascript-astar）与 freeCodeCamp 经典教程结构，全程零构建、零依赖，浏览器双击即玩。

## 功能列表

- 🗺️ 随机迷宫地图（DFS 回溯生成）· 3 层地牢 · 楼梯换层
- ⚔️ 回合制战斗（攻击/防御/逃跑）· 经验金币掉落 · 死亡半血复活
- 🎒 背包管理 · 血瓶使用 · 武器/防具装备加成
- 🏪 商店交易 · 按楼层解锁更强货架 · 支持出售
- 📜 任务系统：主线（击败第 3 层巨龙通关）+ 支线（击杀计数/金币累计）
- 💾 本地存档（localStorage）· 自动存档 · 通关重开
- 🤖 **AI 亮点**：怪物 A\* 寻路追击 · 巡逻→追击→贴脸触发战斗的行为状态机 · 大模型 NPC 自由对话（含离线兜底）

## 操作说明

| 按键 | 功能 |
|---|---|
| 方向键 / WASD | 移动（红点=埋伏怪，灰块=巡逻怪，紫梯=下，绿梯=上） |
| 1 / 2 / 3 | 战斗中：攻击 / 防御 / 逃跑 |
| B / S / M / T | 背包 / 商店 / 任务 / NPC 对话 |
| ↑↓ + Enter | 列表中移动与确认 |
| Esc | 返回 / 关闭面板 |
| R | 通关画面重新开始 |

## 技术栈

原生 JavaScript · Canvas 2D · localStorage · DeepSeek API（可选）· GitHub Pages

**AI 协作开发工具链**：Trae CN（AI IDE 执行端：Agent 模式直接生成/修改文件、内置 git）+ 豆包（对话端：方案规划、修复方案、代码审查）。分工与衔接机制见 PLAN.md §8。

## AI 亮点说明

| 模块 | 实现 |
|---|---|
| A\* 寻路 | 引入 GitHub 开源库 `javascript-astar`（MIT），怪物感知玩家后用 A\* 计算最短路径，每 4 帧重规划，沿路径逐格追击 |
| AI 行为状态机 | 巡逻怪状态机：IDLE（待机灰块）→ CHASE（感知半径 6 格内，变红块追击）→ ATTACK（贴脸触发战斗）。状态转移可视化（灰/红/! 标记） |
| NPC 对话 | 按 T 打开"地牢守门人"对话：配置 DeepSeek API Key 后为在线自由对话；无 Key/断网自动降级为离线规则问答 |

## 运行方式

**方式一（推荐）**：双击 `index.html` 直接在浏览器运行（已适配 file:// 协议，无需服务器）。

**方式二**：GitHub Pages 在线试玩（上方链接）。

**开启在线 AI 对话（可选）**：编辑 `js/data/config.js` 填入 `deepseekKey`（仅本地使用，不会上传代码仓库）。获取 Key 见 <https://platform.deepseek.com>。

## 目录结构

```
ai-dungeon-rpg/
├── index.html            # 入口（canvas + NPC 对话面板）
├── css/style.css
├── js/core/              # 事件总线 / 输入 / 渲染 / 主循环与场景调度
├── js/data/              # 地图 / 怪物 / 物品 / 任务 / 对话 / 配置
├── js/systems/           # 地图生成 / 战斗 / 背包 / 商店 / 任务 / 存档 / AI / NPC
├── js/vendor/            # 开源库：javascript-astar（MIT）
├── preflight/            # 各里程碑 headless 逻辑验证页（M1–M5）
├── docs/                 # 答辩讲稿
├── PLAN.md               # 开发规划书（AI 协作模式）
├── README.md
├── LICENSE               # MIT © 2026 黄文博
└── .gitignore
```

## 组件来源声明（站在巨人的肩膀上）

| 组件 | 来源 | 协议 | 使用方式 |
|---|---|---|---|
| 战斗 / 背包逻辑 | freeCodeCamp《Building a Role Playing Game》 | 开源教程 | 参考结构与数值设计，自写重构 |
| A\* 寻路算法 | bgrins/javascript-astar（1391★） | MIT | **直接引入** `js/vendor/astar.js`（原始文件，未修改） |
| 大模型 NPC 对话 | DeepSeek API | 官方 API | fetch 在线对话 + 离线规则兜底 |
| 像素美术 / 音效 | 项目自绘（Canvas 色块） | — | 零第三方素材依赖，离线可玩 |

详细开发规划见 [PLAN.md](PLAN.md)。

## License

[MIT](LICENSE) © 2026 黄文博
