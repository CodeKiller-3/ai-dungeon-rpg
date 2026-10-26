# AI勇者闯地牢：像素冒险RPG小游戏

> 《人工智能基础》课程大作业 · 组件化拼装的 AI 冒险 RPG

[在线试玩](https://<username>.github.io/ai-dungeon-rpg/)（GitHub Pages 部署后生效）

![演示](assets/img/demo.gif)（待补充录屏）

## 项目简介

一款可离线运行的像素风冒险 RPG 小游戏：随机迷宫探索、回合制战斗、背包装备、商店交易、任务对话、本地存档一应俱全，并集成三层 AI 能力——**A\* 寻路、AI 行为状态机、大模型 NPC 对话**。本项目采用组件化拼装思路构建，全程零构建、零依赖，浏览器双击即玩。

## 功能列表

- 🗺️ 随机地图生成 · 多楼层探索
- ⚔️ 回合制战斗 · 属性成长 · 经验升级 · 道具掉落
- 🎒 背包管理 · 装备穿戴 · 道具合成
- 🏪 商店交易 · 随机商品刷新
- 📜 任务链 · NPC 分支对话
- 💾 本地存档 · 随时继续
- 🤖 **AI 亮点**：怪物 A\* 寻路追踪 · 巡逻/追击/逃离状态机 · 大模型 NPC 自由对话（含离线兜底）

## 技术栈

原生 JavaScript（ES6+）· Canvas 2D · localStorage · DeepSeek API（可选）· GitHub Pages

## AI 亮点说明

| 模块 | 说明 |
|---|---|
| A\* 寻路 | 怪物追踪玩家的路径搜索，展示 g/h/f 值与访问节点统计 |
| AI 状态机 | 巡逻 → 追击 → 攻击 → 逃离的决策迁移，参数配置化 |
| NPC 对话 | 接入 DeepSeek API 的自由对话；无 Key/断网自动降级为离线规则问答 |

## 运行方式

**方式一（推荐）**：双击 `index.html` 直接在浏览器运行（已适配 file:// 协议，无需服务器）。

**方式二**：本地起静态服务器
```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

**AI 对话开启（可选）**：在游戏设置页输入 DeepSeek API Key（仅存本地浏览器，不会上传代码仓库）。获取 Key 见 <https://platform.deepseek.com>。

## 目录结构

```
ai-dungeon-rpg/
├── index.html
├── css/style.css
├── js/core/      # 游戏循环/渲染/输入/事件总线
├── js/systems/   # 战斗/背包/商店/任务/对话/存档/音效
├── js/ai/        # A*寻路/状态机/AI对话
├── js/data/      # 物品/怪物/NPC/任务/地图数据
├── assets/       # 图片与音效素材
├── README.md
├── PLAN.md       # 开发规划书
├── LICENSE
└── .gitignore
```

## 组件来源声明

本项目借鉴以下开源资源，特此声明：

| 组件 | 来源 | 协议 | 使用方式 |
|---|---|---|---|
| 游戏骨架/战斗/商店参考 | freeCodeCamp《Building a Role Playing Game》 | 开源教程 | 参考结构重构 |
| 背包/装备逻辑 | @reldens/items-system | MIT | 读源码摘核心逻辑自写 |
| 背包 UI 交互 | Template Foundry《HTML5 RPG Inventory System》 | 免费框架 | 借鉴布局 |
| A\* 寻路 | PathFinding.js（qiao） | MIT | 引入并二次开发 |
| 音效/图片素材 | 见 assets/ 内逐文件声明 | CC0 等 | 按文件声明 |

详细开发规划见 [PLAN.md](PLAN.md)。

## License

[MIT](LICENSE) © 2026 黄文博
