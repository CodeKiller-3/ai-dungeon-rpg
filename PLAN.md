# 《AI勇者闯地牢：像素冒险RPG小游戏》开发规划书

| 项 | 值 |
|---|---|
| 课程 | 《人工智能基础》大作业 |
| 项目类型 | 小游戏（AI 应用型） |
| 作者 | 黄文博（软件245） |
| 版本 | v1.0 |
| 日期 | 2026-10-26 |
| 状态 | 已定题登记，仓库已就绪，计划框架确认中 |
| 仓库 | https://github.com/CodeKiller-3/ai-dungeon-rpg（已创建，main 已推送） |

> 本文档为项目开发规划书，长期维护于仓库根目录（`PLAN.md`），随里程碑推进更新，作为需求基线、架构设计、拼装清单、开发排期与验收依据。

---

## 1. 项目概述

### 1.1 背景

《人工智能基础》课程要求完成一个大作业，可选工具软件、管理系统、游戏或 AI 短剧。本选题为 **《AI勇者闯地牢：像素冒险RPG小游戏》**，采用**组件化拼装**思路，集成多个 GitHub 开源组件搭建一款功能完整的 AI 冒险 RPG，并嵌入三类 AI 技术：**A\* 寻路、AI 行为状态机、大模型 NPC 对话**。

### 1.2 项目目标

| 目标类型 | 内容 |
|---|---|
| 功能目标 | 交付可离线运行、可在线演示、功能完整（探索/战斗/背包/商店/任务/对话/存档）的 RPG 小游戏 |
| 学习目标 | 掌握组件化代码复用、Canvas 2D 游戏开发、AI 搜索算法、提示工程与 API 集成 |
| 交付目标 | 代码托管 GitHub、GitHub Pages 在线试玩、README 与来源声明完整、答辩可演示可讲解 |

### 1.3 项目亮点

| 亮点 | 说明 |
|---|---|
| 组件化拼装 | 20+ 可拼组件点，全部来自开源项目，README 逐一声明来源与协议 |
| AI 三层设计 | A\* 寻路（搜索算法）+ AI 状态机（决策）+ 大模型对话（生成式 AI） |
| 零构建可玩 | 双击 `index.html` 即可运行，无依赖安装、无构建步骤 |
| 在线演示 | GitHub Pages 一键部署，评委可在线试玩 |

---

## 2. 需求分析

### 2.1 痛点分析

1. 市面上小游戏多玩法单一、系统单薄，缺乏完整 RPG 体验。
2. 多数小游戏 AI 含量低，难以体现人工智能课程所学的 AI 工具应用与算法能力。
3. 同类课程项目同质化严重（见班级选题登记表：17/34 为小游戏），需要差异化。
4. 个人开发时间有限，需要以组件化拼装控制开发成本。

### 2.2 功能需求（FR）

| 编号 | 功能 | 说明 | 优先级 |
|---|---|---|---|
| FR-01 | 地图探索 | 随机生成迷宫地图，支持多楼层场景切换 | P0 |
| FR-02 | 角色移动 | 键盘/触屏移动，碰撞检测，与障碍物/事件点交互 | P0 |
| FR-03 | 回合制战斗 | 玩家 vs 怪物，指令：攻击/技能/防御/逃跑 | P0 |
| FR-04 | 属性成长 | 生命/攻击/防御/金币/经验，升级加点 | P0 |
| FR-05 | 道具掉落 | 战斗胜利随机掉落物品 | P1 |
| FR-06 | 背包管理 | 物品拾取、使用、丢弃、堆叠 | P0 |
| FR-07 | 装备系统 | 武器/防具穿戴，属性加成，装备位校验 | P1 |
| FR-08 | 道具合成 | 配方合成更高级物品 | P2 |
| FR-09 | 商店交易 | 金币买卖，随机商品刷新 | P1 |
| FR-10 | 任务系统 | 主线/支线任务链，完成判定与奖励 | P1 |
| FR-11 | NPC 对话 | 分支对话树；AI 自由对话（可选开启） | P1 |
| FR-12 | 本地存档 | localStorage 存档/读档/多槽位 | P0 |
| FR-13 | 音效 | 战斗/拾取/交互基础音效 | P2 |
| FR-14 | UI/HUD | 生命/金币/经验显示，菜单系统 | P0 |
| FR-15 | 敌人 AI | A\* 寻路追踪玩家 + 巡逻/追击/逃离状态机 | P0（AI 亮点） |
| FR-16 | AI 对话 | 接入大模型 API 的自由对话 NPC，含离线兜底 | P1（AI 亮点） |

### 2.3 非功能需求（NFR）

| 编号 | 需求 | 指标/约束 |
|---|---|---|
| NFR-01 | 离线可用 | 不联网（无 API Key）时核心玩法完整可玩 |
| NFR-02 | 零构建 | 浏览器直接打开 `index.html` 可运行，无编译/打包 |
| NFR-03 | 浏览器兼容 | Chrome / Edge 最新两个大版本 |
| NFR-04 | 性能 | 普通笔记本单帧渲染 ≤ 16ms（60 FPS） |
| NFR-05 | 数据持久化 | 存档基于 localStorage，刷新不丢 |
| NFR-06 | 安全 | API Key 不写入代码仓库；不泄露至 GitHub |
| NFR-07 | 开源合规 | 所有借鉴代码按协议声明来源，LICENSE 采用 MIT |

---

## 3. 技术选型

| 选型项 | 方案 | 理由 |
|---|---|---|
| 语言 | 原生 JavaScript（ES6+） | 零依赖、无构建，浏览器原生支持 |
| 渲染 | Canvas 2D | 像素风渲染简单、性能可控 |
| 模块化 | 普通 `<script>` 顺序加载 + 全局命名空间（`window.Game`） | 规避 `file://` 下 ES Module 与 fetch 的 CORS 限制，保证双击即玩 |
| 数据 | `data.js` 常量文件（`const ITEMS = {...}`） | `file://` 下无法 fetch JSON，改用 JS 文件定义数据 |
| AI 对话 | DeepSeek API（OpenAI 兼容协议） | 中文能力强、按量计费、成本低 |
| AI 对话兜底 | 本地规则（预置问答 + 关键词匹配） | 无 Key/断网时功能可用 |
| 寻路 | 自写 A\*（参考 PathFinding.js 实现） | 算法约 100 行，答辩可讲解 |
| 存档 | localStorage | 简单可靠，无后端 |
| 部署 | GitHub Pages | 免费、零配置、在线演示 |

**关键设计决策**

1. **禁用 ES Module / fetch 加载数据**：浏览器以 `file://` 打开本地 HTML 时，模块加载和 fetch 均受 CORS 限制。为保证"双击即玩"，全部脚本用普通 `<script>` 标签按依赖顺序加载，数据以 JS 常量文件提供。
2. **事件总线解耦**：模块间不直接引用，统一通过 `eventBus` 发布/订阅（如 `inventory:itemAdded`），避免循环依赖，保证组件可插拔。
3. **数据驱动**：物品、怪物、NPC、任务、地图全部配置化，逻辑与数据分离，便于拼装与调试。

---

## 4. 系统架构

### 4.1 分层架构

```mermaid
flowchart TB
    subgraph UI["UI 层（界面）"]
        HUD["HUD 状态栏"]
        BAG_UI["背包界面"]
        SHOP_UI["商店界面"]
        DLG_UI["对话界面"]
        MENU["菜单/设置"]
    end

    subgraph SYS["系统层（拼装组件）"]
        BATTLE["battle.js 战斗"]
        INV["inventory.js 背包/装备"]
        SHOP["shop.js 商店/合成"]
        QUEST["quest.js 任务"]
        DIALOG["dialogue.js 对话树"]
        SAVE["save.js 存档"]
        AUDIO["audio.js 音效"]
    end

    subgraph AI["AI 层（课程亮点）"]
        ASTAR["astar.js A* 寻路"]
        FSM["stateMachine.js 行为状态机"]
        NPC_CHAT["npcChat.js 大模型对话"]
    end

    subgraph CORE["核心层（自写）"]
        MAIN["main.js 游戏循环"]
        RENDER["render.js Canvas 渲染"]
        INPUT["input.js 输入"]
        EVENT["eventBus.js 事件总线"]
    end

    subgraph DATA["数据层"]
        ITEMS["data/items"]
        MONSTERS["data/monsters"]
        NPCS["data/npcs"]
        QUESTS["data/quests"]
        MAPS["data/maps"]
    end

    UI --> SYS
    SYS --> CORE
    AI --> CORE
    SYS --> AI
    CORE --> DATA
    SYS --> DATA
```

### 4.2 模块职责表

| 模块 | 文件 | 职责 | 来源 |
|---|---|---|---|
| 游戏循环 | `js/core/main.js` | requestAnimationFrame 主循环、场景切换、状态调度 | 自写 |
| 渲染 | `js/core/render.js` | Canvas 绘制地图/角色/UI | 自写 |
| 输入 | `js/core/input.js` | 键盘/触屏事件分发 | 自写 |
| 事件总线 | `js/core/eventBus.js` | 模块间发布/订阅通信 | 自写 |
| 地图 | `js/systems/map.js` | 网格地图、随机生成（DFS 回溯）、楼层切换 | 自写 |
| 战斗 | `js/systems/battle.js` | 回合制战斗、伤害公式、经验掉落 | 参考 freeCodeCamp RPG 教程重构 |
| 背包 | `js/systems/inventory.js` | 物品堆叠、使用、装备位校验、属性加成 | 参考 @reldens/items-system 逻辑重构 |
| 商店 | `js/systems/shop.js` | 买卖、随机刷新、合成 | 自写 |
| 任务 | `js/systems/quest.js` | 任务链、进度判定、奖励 | 自写 |
| 对话 | `js/systems/dialogue.js` | 分支对话树渲染 | 自写 |
| 存档 | `js/systems/save.js` | localStorage 序列化/读档 | 自写 |
| 音效 | `js/systems/audio.js` | WebAudio 简单音效 | 自写 |
| 寻路 | `js/ai/astar.js` | A\* 寻路 + 访问统计 | 参考 PathFinding.js（MIT）重构 |
| 状态机 | `js/ai/stateMachine.js` | 敌人巡逻/追击/逃离/攻击状态 | 自写 |
| AI 对话 | `js/ai/npcChat.js` | DeepSeek API 调用 + 离线兜底 | 自写 |

### 4.3 目录结构

```
ai-dungeon-rpg/
├── index.html              # 入口页（双击即玩）
├── css/
│   └── style.css
├── js/
│   ├── core/               # 核心层
│   │   ├── main.js
│   │   ├── render.js
│   │   ├── input.js
│   │   └── eventBus.js
│   ├── systems/            # 系统层（拼装组件）
│   │   ├── map.js
│   │   ├── battle.js
│   │   ├── inventory.js
│   │   ├── shop.js
│   │   ├── quest.js
│   │   ├── dialogue.js
│   │   ├── save.js
│   │   └── audio.js
│   ├── ai/                 # AI 层
│   │   ├── astar.js
│   │   ├── stateMachine.js
│   │   └── npcChat.js
│   └── data/               # 数据层
│       ├── items.js
│       ├── monsters.js
│       ├── npcs.js
│       ├── quests.js
│       └── maps.js
├── assets/                 # 图片/音效素材
│   ├── img/
│   └── audio/
├── README.md
├── PLAN.md
├── LICENSE                 # MIT
└── .gitignore
```

### 4.4 模块接口契约（全局命名空间）

所有模块挂 `window.Game` 命名空间，普通 `<script>` 顺序加载，模块间只经接口与事件总线交互。**Trae CN 生成任何模块时必须实现对应接口**：

```js
window.Game = {
  Core:    { Main, Render, Input, EventBus },
  Systems: { Map, Battle, Inventory, Shop, Quest, Dialogue, Save, Audio },
  Ai:      { AStar, StateMachine, NpcChat },
  Data:    { ITEMS, MONSTERS, NPCS, QUESTS, MAPS, Player }
};
```

| 模块 | 全局对象 | 关键接口（必须实现） |
|---|---|---|
| main.js | Game.Core.Main | init() / start() / switchScene(name) / loop(ts) |
| render.js | Game.Core.Render | drawMap(map, cam) / drawPlayer() / drawHUD() |
| input.js | Game.Core.Input | bind() / getState() / clear() |
| eventBus.js | Game.Core.EventBus | on(channel, fn) / off(channel, fn) / emit(channel, payload) |
| map.js | Game.Systems.Map | generate(seed) / isWalkable(x, y) / tileAt(x, y) / changeFloor(dir) |
| battle.js | Game.Systems.Battle | start(monsterId) / playerAction(cmd) / tick() |
| inventory.js | Game.Systems.Inventory | add(itemId, n) / remove(itemId, n) / use(itemId) / equip(itemId) / unequip(slot) / list() |
| shop.js | Game.Systems.Shop | refresh() / buy(itemId) / sell(itemId) / combine(idA, idB) |
| quest.js | Game.Systems.Quest | accept(id) / progress(eventName, payload) / isDone(id) / reward(id) |
| dialogue.js | Game.Systems.Dialogue | open(npcId, nodeId) / choose(optionId) / close() |
| save.js | Game.Systems.Save | write(slot) / read(slot) / slots() |
| audio.js | Game.Systems.Audio | preload() / play(name) |
| astar.js | Game.Ai.AStar | findPath(grid, start, goal) → { path, visited, steps:[{g,h,f}] } |
| stateMachine.js | Game.Ai.StateMachine | create(cfg) / setState(name) / update(dt) / getState() |
| npcChat.js | Game.Ai.NpcChat | ask(npcId, userMsg) → Promise\<string\> |

### 4.5 事件总线频道清单（模块间唯一通信方式）

| 频道 | Payload | 发布者 | 订阅者 |
|---|---|---|---|
| inventory:itemAdded | { itemId, count } | Inventory | HUD、Quest |
| inventory:itemRemoved | { itemId, count } | Inventory | HUD |
| inventory:equipChanged | { slot, itemId\|null } | Inventory | HUD、Battle（属性重算） |
| player:statsChanged | { stat, old, now } | Player / Inventory | HUD、StateMachine |
| battle:start | { monsterId } | Map（遇敌） | Battle UI |
| battle:end | { result, exp, gold, drops } | Battle | Quest、Inventory、HUD |
| quest:complete | { questId } | Quest | Dialogue、Save |
| map:floorChanged | { floor } | Map | Render、AStar、Save |
| dialogue:open / dialogue:close | { npcId } / {} | Dialogue | Input（锁定移动）、Save |
| save:write | { slot } | Save | HUD |
| npc:chatReply | { npcId, text } | NpcChat | Dialogue UI |
| game:sceneChanged | { scene } | Main | 全部 UI |

### 4.6 脚本加载顺序（零构建关键）

`index.html` 的 `<script>` 严格按以下顺序，**Trae CN 生成时不得乱序**：

1. `js/core/eventBus.js` → `js/core/input.js` → `js/core/render.js`
2. `js/data/items.js` → `monsters.js` → `npcs.js` → `quests.js` → `maps.js`
3. `js/systems/map.js` → `inventory.js` → `battle.js` → `shop.js` → `quest.js` → `dialogue.js` → `save.js` → `audio.js`
4. `js/ai/astar.js` → `stateMachine.js` → `npcChat.js`
5. `js/core/main.js`（**最后加载，启动入口**）

规则：core 先于 data，data 先于 systems/ai，main.js 最后；每个模块用 IIFE 挂 `window.Game`，不污染全局。

---

## 5. 组件拼装清单

### 5.1 拼装原则

1. **能自写的不引依赖**：核心逻辑（地图、战斗、存档、任务）自写，保证答辩可讲解。
2. **能借鉴的读源码重写**：背包、装备等成熟系统读开源源码摘核心逻辑，重写为自有模块，文件头注明来源与协议。
3. **成熟算法直接引入**：A\* 等通用算法引入单文件实现并二次开发（增加统计输出）。
4. **零构建红线**：任何组件不引入需要打包的 npm 依赖；浏览器可直接运行。
5. **来源必声明**：README 与文件头逐一声明借鉴来源及 LICENSE。

### 5.2 拼装来源（2026-10-27 前置可达性验证后修订）

| 系统 | 来源 | 协议 | 拼装方式 | 可达性验证 |
|---|---|---|---|---|
| 游戏骨架/战斗/商店 | freeCodeCamp《Learn Basic JavaScript by Building a Role Playing Game》（Dragon Repeller） | 开源教程 | 参考结构重构 | ✅ 已验证可达（200），教程 URL 已修正 |
| 背包/装备/物品 | freeCodeCamp RPG 教程重构 + 自写扩展 | 开源教程 | 读教程武器/装备逻辑，自写堆叠/装备位/属性加成 | ✅（原 `@reldens/items-system` 于 2026-10-27 验证 npm 403 / registry 超时 / GitHub 404，**来源弃用**） |
| 背包 UI 交互 | 自写（原参考 Template Foundry《HTML5 RPG Inventory System》） | — | 自写像素风 UI | ⚠️ Template Foundry 当前网络不可达（超时），降级为自写；若后续可达可参考交互布局 |
| A\* 寻路 | PathFinding.js（qiao） | MIT | 引入单文件版并二次开发（g/h/f 统计） | ✅ 已验证仓库存在（gh api） |
| 地图生成 | 自写（DFS 回溯） | — | 自写 | ✅ |
| 存档 | localStorage 自写 | — | 自写 | ✅ |
| AI 对话 | DeepSeek API | 服务条款 | API 集成 + 离线兜底 | ✅ 已验证 API 端点可达（401=未授权属预期，接入 Key 即可用） |
| 音效/UI | 自写 + 免费 CC0 素材 | CC0 | 素材引入需记录来源 | ✅ |

### 5.3 风险等级说明

- **低**：纯本地逻辑，无外部依赖，进度风险小。
- **中**：涉及外部依赖（npm 包逻辑重写、API Key），需预留返工时间或兜底方案。

---

## 6. AI 模块设计

### 6.1 A\* 寻路（FR-15）

- **用途**：怪物追踪玩家，跨楼层房间寻路。
- **原理**：结合 Dijkstra 与贪心最佳优先，估价函数 `f(n) = g(n) + h(n)`，`h` 采用曼哈顿距离。
- **复杂度**：`O(b^d)`，`b` 为分支因子，`d` 为路径深度；网格场景 `d` 受地图尺寸限制。
- **二次开发点**：输出访问节点数、路径长度、每步 `g/h/f` 值，用于答辩展示与算法对比。
- **实现参考**：PathFinding.js（MIT），单文件约 300 行，摘核心 `BinaryHeap` 与 `AStarFinder` 重构。

### 6.2 AI 行为状态机（FR-15）

```mermaid
stateDiagram-v2
    [*] --> Patrol: 生成
    Patrol --> Chase: 玩家进入视野
    Chase --> Attack: 距离 < 攻击范围
    Chase --> Patrol: 玩家丢失/超出追踪距离
    Attack --> Chase: 玩家脱离攻击范围
    Patrol --> Escape: 生命值 < 20%
    Escape --> Patrol: 恢复/回到出生点
    Chase --> Dead: 生命值 ≤ 0
    Attack --> Dead: 生命值 ≤ 0
    Dead --> [*]
```

状态迁移条件全部配置化（视野半径、攻击范围、逃跑阈值），便于调参。

### 6.3 大模型 NPC 对话（FR-16）

- **接口**：OpenAI 兼容协议；`base_url: https://api.deepseek.com`；模型 `deepseek-chat`。
- **Prompt 设计**：系统提示词注入角色设定（姓名、背景、说话风格、可透露信息白名单），限制输出长度。
- **Key 安全**：Key 由玩家在设置页手动输入，存 `localStorage`，**不写入代码、不提交仓库**；README 说明获取方式。
- **三级容错**：
  1. 本地 Key + 直接调用；
  2. 云端代理（可选部署）；
  3. 离线兜底（预置问答 + 关键词匹配），无 Key/断网/限流时自动降级。

```mermaid
flowchart LR
    A["玩家输入"] --> B{"有 Key 且在线?"}
    B -- 是 --> C["DeepSeek API"]
    C --> D["生成回复"]
    B -- 否 --> E["离线规则问答"]
    E --> D
    D --> F["对话界面展示"]
```

---

## 7. 数据设计

核心实体：`Player`、`Item`、`Monster`、`NPC`、`Quest`、`Map`。数据以 `data/*.js` 常量提供。

```js
// data/items.js —— 示例
const ITEMS = {
  sword_iron: {
    id: "sword_iron",
    name: "铁剑",
    type: "weapon",          // weapon | armor | consumable | material
    atk: 5,
    price: 60,
    stackable: false,
    icon: "assets/img/sword_iron.png"
  },
  potion_small: {
    id: "potion_small",
    name: "小血瓶",
    type: "consumable",
    heal: 30,
    price: 15,
    stackable: true,
    maxStack: 9
  }
};

// data/monsters.js —— 示例
const MONSTERS = {
  slime: {
    id: "slime",
    name: "史莱姆",
    hp: 40, atk: 6, def: 2,
    exp: 10, gold: [3, 8],
    drops: [{ itemId: "potion_small", rate: 0.3 }],
    ai: { vision: 5, chaseRange: 12, escapeHp: 0.2, moveSpeed: 1 }
  }
};
```

装备位校验示例：`weapon` 仅可穿戴于武器槽，属性加成在装备/卸下时经事件总线广播重算。

### 7.1 Schema 契约（数据字段唯一标准，Trae CN 生成 data/ 必须匹配）

**ITEMS**（`data/items.js`，`const ITEMS = {...}`，键为 itemId）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 唯一标识，与键一致 |
| name | string | 显示名 |
| type | weapon\|armor\|consumable\|material | 类型 |
| price | number | 商店基准价 |
| stackable | boolean | 可否堆叠 |
| maxStack | number | 堆叠上限（stackable=true 时） |
| atk / def / heal / mp | number(可选) | 属性效果（按 type 使用） |
| slot | weapon\|armor(可选) | 装备位（weapon/armor 时必填） |
| icon | string | 图标相对路径 assets/img/ |

**MONSTERS**（`data/monsters.js`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id / name | string | 标识与显示名 |
| hp / atk / def | number | 基础三围 |
| exp | number | 经验 |
| gold | [min, max] | 金币区间 |
| drops | [{ itemId, rate }] | 掉落表 |
| ai | { vision, chaseRange, escapeHp, moveSpeed } | 状态机参数（见 §6.2） |

**NPCS**（`data/npcs.js`）：`id`、`name`、`dialogRoot`（对话树根节点 id）、`chatPrompt`（大模型系统提示词，可选）、`x/y/floor`（站位）。

**QUESTS**（`data/quests.js`）：`id`、`name`、`desc`、`type`（kill\|collect\|talk）、`target`（{monsterId/num} 或 {itemId/num} 或 {npcId}）、`reward`（{exp, gold, items[]}）、`prev`（前置任务 id\|null）、`acceptNpc`（接取 NPC）。

**MAPS**（`data/maps.js`）：`size`（w, h）、`roomMin/roomMax`（房间参数）、`floors`（楼层数）、`enemyTable`（每层怪物 id 概率表）、`stairUp/stairDown`（楼梯，换层入口）。

**Player**（运行时对象，`Game.Data.Player`）：`hp/maxHp/atk/def/gold/exp/level/floor/x/y`、`inventory`（{itemId: count}）、`equipment`（{weapon: itemId\|null, armor: itemId\|null}）、`quests`（{id: status}）。

**SAVE**（`data/save.js` 读写，localStorage 键 `aiDungeonSave_<slot>`）：整体序列化 `Game.Data.Player` + 楼层种子 + 已完成任务状态；写入前 JSON.stringify，读取后字段缺失按默认值补齐（防存档损坏）。

---

## 8. 计划框架总览（AI 协作模式）

### 8.1 开发模式：全程 AI 协作

本项目以「AI 作为主要开发协作者」推进：**不按天数排期**，以「与 AI 的协作轮次 × 达成效果」作为进度度量。每个里程碑由若干轮 AI 对话驱动，每轮有明确任务，以「可验证效果」作为完成判据——**达到该效果，即为该里程碑得到结果**。

协作范式（每轮固定闭环）：
1. 向 AI 下达明确指令（需求 + 约束 + 验收点）；
2. AI 生成代码或方案；
3. 本地运行验证，把报错/现象原文回传给 AI；
4. AI 修复或优化，直至效果达标。

### 8.2 AI 工具清单

**双端架构：Trae CN 做编程执行端，豆包做对话精修端**（两工具同属字节、模型同源，上下文一致性好）。

| 端 | 用途 | AI 工具 | 说明 |
|---|---|---|---|
| 执行端 | 编程执行主力 | **Trae CN**（字节 AI IDE） | Agent 模式直接读写项目文件、多文件协同修改、运行验证、内置 git；内置豆包 1.5 Pro + DeepSeek 免费不限量 |
| 对话端 | 开发主脑（规划/生成/修复方案/审查） | 豆包（当前对话） | 方案规划、接口契约维护、单模块代码生成、粘贴报错定位、代码审查 |
| 对话端 | 报错排查 | 豆包对话（贴错误信息原文） | 把控制台报错完整粘贴给 AI，给修复方案 |
| 对话端 | 参考检索 | 豆包联网搜索 / GitHub 站内搜索 | 找开源组件：freeCodeCamp RPG、PathFinding.js 等 |
| 素材 | 像素美术素材 | 豆包图像生成（像素风） | 角色、怪物、道具、地图瓦片，AI 生成后挑选导出 |
| 素材 | 音效素材 | 免费 AI 音效/TTS 工具 | 战斗/拾取/交互音效（优先 CC0 可商用素材） |
| 产品功能 | 游戏内 NPC 对话（运行时） | DeepSeek API（deepseek-chat） | 运行时大模型对话，无 Key 时走离线兜底 |

### 8.3 里程碑协作矩阵（三阶段）

| 阶段 | 里程碑 | 预计 AI 轮次 | 效果标准（完成判据 = 得到结果） |
|---|---|---|---|
| 地基 | M0 项目骨架 | 2–3 | 双击 index.html 出现空场景、60FPS、控制台无报错 |
| 地基 | M1 地图与移动 | 4–6 | 随机迷宫可走、移动碰撞正常、可切换楼层 |
| 玩法闭环 | M2 战斗系统 | 5–8 | 一局回合战斗完整结算，伤害/经验/金币/掉落正确 |
| 玩法闭环 | M3 背包/商店 | 5–8 | 拾取/穿戴/买卖/合成可操作且数据正确 |
| 玩法闭环 | M4 任务/对话/存档 | 4–6 | 任务链完成判定、对话树可走、刷新后存档恢复 |
| AI 与交付 | M5 AI 模块 | 6–10 | 怪物 A\* 追踪、状态机行为正确、AI 对话含离线兜底 |
| AI 与交付 | M6 收尾交付 | 3–5 | README/来源声明完整、Pages 在线可玩、讲稿可用 |

各里程碑轮次合计约 **29–46 轮**（素材生成与参考检索轮次另计）。

### 8.4 关键路径与裁剪线

- **关键路径**：M0 → M1 → M2 → M3 → M4 → M6（玩法主线，不可跳过）。
- **并行机会**：M5 仅依赖 M1 的地图数据，可在 M2–M4 的对话间隙穿插推进。
- **裁剪线**（轮次明显超支时依次放弃，不影响主线闭环）：M3 合成 → M4 支线任务 → M2 技能指令 → M5 在线对话（保留离线兜底）。

### 8.5 AI 协作衔接机制（多 AI 工具协同）

**总原则：AI 之间不直接通信，衔接靠「你（人）+ 项目文件」**。所有 AI 工具围绕同一套文件工作：写入共享目录、遵守接口契约、以 Git 提交作为接力点。

**衔接介质（单一事实来源）**：

| 介质 | 作用 |
|---|---|
| 项目目录 + 代码文件 | 所有 AI 读写同一套文件，产出落在各自负责的目录 |
| PLAN.md（规范） | 架构、命名、约束，任何 AI 开工前先读 |
| data/*.js 数据 Schema | 物品/怪物/NPC/任务/地图字段结构，模块间数据衔接的唯一标准 |
| eventBus 频道清单 | 模块间通信契约（如 `inventory:itemAdded`），生成模块按频道发布/订阅 |
| Git 提交历史 + 开发日志 | 接力棒：新 AI 从最新 commit 继续，经 git log 了解已完成内容 |

**接口契约（本项目）**：

- 目录职责表：`core/`（自写框架）、`systems/`（拼装系统）、`ai/`（AI 模块）、`data/`（纯数据）——各端只写自己负责的目录，不越界。
- eventBus 频道约定：`inventory:itemAdded`、`battle:end`、`quest:complete`、`save:write` 等——模块间不直接引用，解耦。
- 数据契约：ITEMS / MONSTERS / NPCS / QUESTS / MAPS 字段固定（见 §7 数据设计），AI 生成数据必须匹配，否则模块无法衔接。

**双端职责划分**：

| 端 | 工具 | 职责 |
|---|---|---|
| 执行端 | Trae CN | 读写项目文件、多文件协同修改、运行验证、内置 git 提交推送 |
| 对话端 | 豆包 | 方案规划、接口契约维护、单模块代码生成、报错定位与修复方案、代码审查 |

**实操编排流程**（以「地图模块」为例）：

1. 对话端（豆包）按契约确认接口与数据结构（`map.js` 的地图数据 Schema）；
2. 执行端（Trae CN）Agent 模式生成 `systems/map.js` 并落地到项目目录；
3. 在 Trae 内直接运行验证，把报错/现象原文粘贴给豆包，由豆包给出修复方案；
4. 修复方案由 Trae 应用到文件（或豆包给出补丁、Trae 应用）；
5. 里程碑达标后在 Trae 内置 git 提交推送——Git 历史成为下一模块的上下文。

**常见坑与对策**：

| 坑 | 对策 |
|---|---|
| AI 间风格不一致 | PLAN.md 统一命名/注释规范；每模块单文件单一职责 |
| 新 AI 不了解前情 | 开工前先读 PLAN.md + 对应模块文件 + git log |
| 接口对不上（A 的输出 B 不认） | 以接口契约为准，报错回传修复 |
| 文件冲突 / 重复定义 | 目录职责表固定归属，禁止越界写入 |
| 素材引用路径错误 | 素材统一放 assets/，代码按相对路径引用 |

---

## 9. 里程碑计划

### 9.1 AI 协作里程碑详表

| 里程碑 | 效果标准（达到即得到结果） | AI 协作轮次规划 |
|---|---|---|
| M0 项目骨架 | 双击 index.html 打开即出现空游戏场景，60FPS，控制台无报错 | 轮1：让 AI 生成 index.html、css/style.css、js/core/（main/render/input/eventBus）骨架；轮2：本地双击运行，把报错/黑屏现象回传 AI 修复；轮3：AI 审查代码结构，确认帧率与无报错 |
| M1 地图与移动 | 随机迷宫生成且每层不同，键盘移动不穿墙，可切换楼层 | 轮1：AI 生成 systems/map.js（DFS 回溯生成）+ render.js 瓦片绘制；轮2：AI 生成 input.js 移动与碰撞检测；轮3：联调（报错回传）；轮4：楼层切换与边界测试；轮5–6：AI 修正穿墙/性能问题 |
| M2 战斗系统 | 遭遇怪物进入回合战斗，攻击/防御/逃跑可操作，伤害公式正确，经验金币掉落生效 | 轮1：AI 生成 battle.js 回合流程 + data/monsters.js；轮2：伤害公式与回合判定；轮3：掉落与属性成长；轮4–5：与地图遇怪事件联调；轮6–8：AI 修 bug + 数值平衡 |
| M3 背包/商店 | 拾取入包、堆叠、使用、装备穿戴卸下、商店买卖、合成均可用且数据正确 | 轮1：AI 生成 inventory.js（堆叠/使用/装备位）核心逻辑；轮2：背包 UI 交互（参考 Template Foundry）；轮3：shop.js 买卖与随机刷新；轮4：合成；轮5–6：联调与数据校验；轮7–8：AI 优化操作体验 |
| M4 任务/对话/存档 | 主线任务可接可完成、奖励发放，对话树可走，存档后刷新页面进度恢复 | 轮1：AI 生成 quest.js 任务链与判定；轮2：dialogue.js 分支对话树；轮3：save.js 序列化与多槽位；轮4–5：三者联调；轮6：AI 审查边界（存档损坏/任务重复） |
| M5 AI 模块 | 怪物能 A\* 寻路追踪玩家，巡逻/追击/逃离状态正确，NPC 可大模型对话且断网走离线兜底 | 轮1：AI 生成 astar.js（含 g/h/f 统计输出）；轮2：stateMachine.js 状态迁移；轮3：npcChat.js 接入 DeepSeek；轮4：三级容错（离线兜底）；轮5–6：寻路与状态机联调；轮7–8：对话降级测试；轮9–10：AI 审查算法正确性与 Key 安全 |
| M6 收尾交付 | README 完整（含组件来源声明与在线链接）、Pages 可在线试玩、演示录屏与答辩讲稿可用 | 轮1：AI 生成/完善 README（来源声明表）；轮2：AI 指导 Pages 部署并验证在线；轮3：AI 辅助编写演示脚本与答辩讲稿；轮4–5：全量回归测试与文案打磨 |

### 9.2 轮次汇总

- 各里程碑预计 **29–46 轮** AI 对话（每轮含：指令 → 生成 → 运行验证 → 回传修复）。
- **执行落地统一在 Trae CN（执行端）完成**——Agent 直接生成/修改文件并运行验证；**方案与修复在豆包（对话端）完成**；素材与检索轮次另计。
- 素材轮次另计：像素图（角色/怪物/道具/瓦片）约 3–5 轮生成与挑选；音效约 1–2 轮。
- 检索轮次另计：组件来源（freeCodeCamp / PathFinding.js 等）约 2–3 轮，可在对话间隙用联网搜索完成。
- **判定原则**：每一轮结束前必须达到该轮指定的效果标准；未达标则继续追加轮次，直到「得到结果」。

### 9.3 子任务拆解（按文件粒度，Trae CN 执行顺序）

| 里程碑 | 子任务 | 产出文件 | 依赖 |
|---|---|---|---|
| M0 | ① 入口页与样式 ② 核心层 4 文件 ③ 空场景跑通 | index.html、css/style.css、js/core/{main,render,input,eventBus}.js | — |
| M1 | ① 地图数据与生成 ② 瓦片渲染 ③ 移动碰撞 ④ 楼层切换 | js/systems/map.js、data/maps.js、render.js、input.js | M0 |
| M2 | ① 怪物数据 ② 回合流程 ③ 伤害公式 ④ 掉落成长 | data/monsters.js、js/systems/battle.js | M1 |
| M3 | ① 物品数据 ② 背包逻辑 ③ 背包 UI ④ 商店 ⑤ 合成 | data/items.js、js/systems/{inventory,shop}.js | M2 |
| M4 | ① 任务数据与逻辑 ② 对话树 ③ 存档 | data/{quests,npcs}.js、js/systems/{quest,dialogue,save}.js | M2、M3 |
| M5 | ① A\* ② 状态机 ③ NPC 对话（API+兜底） | js/ai/{astar,stateMachine,npcChat}.js | M1（地图数据） |
| M6 | ① README/来源声明 ② Pages 部署 ③ 演示脚本/讲稿 | README.md、录屏、讲稿 | 全部 |

---

## 10. GitHub 工程实践

### 10.1 仓库规划

- 名称：`ai-dungeon-rpg`；可见性：Public；LICENSE：MIT。
- 提交规范：`feat:` / `fix:` / `docs:` / `refactor:` 前缀，如 `feat: 战斗系统`。
- 分支：单人开发主用 `main`；大功能可开 `dev` 分支合并。

### 10.2 GitHub Pages 部署

1. 推送代码后进入仓库 Settings → Pages。
2. Source 选择 `Deploy from a branch` → 分支 `main`、目录 `/ (root)`。
3. 保存后等待 1-2 分钟，得到 `https://<username>.github.io/ai-dungeon-rpg/`。
4. 将在线链接写入 README 顶部。

### 10.3 README 必备内容

项目简介 → 在线试玩链接 → 演示 GIF → 功能列表 → 技术栈 → AI 亮点 → 运行方式（双击 index.html / `python -m http.server`）→ 组件来源声明表 → LICENSE。

### 10.4 开源合规

- 所有借鉴代码在文件头注释来源与协议，并在 README 汇总声明。
- 若借鉴代码协议要求保留版权声明，原样保留。
- 大模型 API 为服务调用，不涉及代码许可证传染。

---

## 11. 测试与验收

### 11.1 功能验收清单（对应 FR）

| 编号 | 验收步骤 | 通过标准 |
|---|---|---|
| FR-01 | 新开一局，连续切换 3 层 | 地图随机生成且每层不同 |
| FR-03 | 与怪物战斗 | 回合结算、伤害计算正确 |
| FR-06 | 拾取 10 个物品并堆叠 | 背包数量正确、无越界 |
| FR-07 | 穿戴铁剑 | 攻击属性实时 +5，卸下还原 |
| FR-09 | 商店买卖 | 金币增减正确、刷新后商品变化 |
| FR-10 | 完成主线任务 | 任务状态流转、奖励发放 |
| FR-12 | 存档后刷新页面 | 进度完整恢复 |
| FR-15 | 站在怪物视野内 | 怪物寻路追至攻击，丢失视野后回巡逻 |
| FR-16 | 断网/无 Key 与 NPC 对话 | 离线兜底正常应答 |

### 11.2 兼容性

- Chrome / Edge 最新两版：运行、存档、音效通过。
- 触屏设备：虚拟按键可完成核心操作。

### 11.3 答辩准备清单

- 演示脚本：2 分钟主线流程（探索→战斗→背包→商店→AI 对话）。
- 讲解点：A\* 估价函数与 g/h/f 展示、状态机迁移表、三级容错设计、组件拼装与来源声明。
- 备好离线演示（无 Key 版本），避免现场网络问题。

---

## 12. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 背包逻辑重写工作量大 | M3 延期 | 简化装备位为武器/防具 2 槽；合成降级为可选 |
| AI 对话依赖 Key/网络 | 演示翻车 | 三级容错，默认演示走离线兜底 |
| 组件拼装风格不一致 | 代码混乱 | 事件总线解耦 + 统一命名规范 + 每模块单一职责 |
| 轮次超支 / 其他课程占用精力 | 交付延期 | 严格按里程碑效果标准推进，P2 功能按裁剪线降级，不影响主线闭环 |
| file:// 下功能异常 | 双击不可玩 | 全程不用 ES Module/fetch，验收前必测双击打开 |

---

## 13. 实施前置流程测试（Pre-flight，M0 动工前已完成）

> 目的：动工前验证环境、工具链、来源与核心技术基线全部就绪，避免 M0 首轮即返工。执行日期：2026-10-27。冒烟产物存于 `preflight/`。

### 13.1 检查结果

| # | 检查项 | 方法 | 标准 | 结果 |
|---|---|---|---|---|
| P-01 | 本地 git | `git --version` | 可用 | ✅ 2.56.0 |
| P-02 | gh CLI 登录 | `gh auth status` | 登录 CodeKiller-3 | ✅ 已登录（keyring，token 含 repo） |
| P-03 | 仓库 remote | `git remote -v` | origin 指向 ai-dungeon-rpg | ✅ 正确 |
| P-04 | 工作区 | `git status --porcelain` | 干净 | ✅ 无未提交变更 |
| P-05 | GitHub 可达 | `gh api repos/...` | 仓库可访问 | ✅ gh/git 通道正常（注：curl 直连 GitHub 在本网络不通，属通道差异，不影响开发） |
| P-06 | Trae CN 已安装 | 注册表 + 目录检索 | 可执行文件存在 | ✅ `D:\A-tools\Trae CN\` v3.4.3 |
| P-07 | Dev-sidecar | `Get-Process` | 运行中 | ✅ 运行中（5 进程） |
| P-08 | Python | `python --version` | 可起静态服务器 | ✅ 3.13.16 |
| P-09 | 浏览器 | 路径检索 | Edge/Chrome 存在 | ✅ Edge 可用 |
| P-10 | 组件来源可达 | HTTP 状态 / gh api | 见 §5.2 | ✅ freeCodeCamp(200)、PathFinding.js(仓库存在)、DeepSeek(401 属预期)；⚠️ reldens/Template Foundry 不可达 → 已替换/降级 |
| P-11 | file:// 技术基线 | Edge headless 冒烟页 | 无报错、渲染循环运行 | ✅ `PREFLIGHT-OK`，Canvas 渲染截图确认 |
| P-12 | Pages 域名 | `https://CodeKiller-3.github.io/` | 可达（404 属未部署预期） | ✅ 域名归属有效，待部署 |

### 13.2 前置验证结论与决策

1. **工具链就绪**：Trae CN（执行端）+ 豆包（对话端）+ gh/git + Dev-sidecar + Edge + Python 全部可用，可进入 M0。
2. **技术基线通过**：`file://` 协议下普通 `<script>` + Canvas 渲染 + rAF 循环实测零报错——「双击即玩」路线成立（冒烟页：`preflight/index.html`，双开即见画面与 FPS 计数）。
3. **来源调整已落实**：`@reldens/items-system` 与 Template Foundry 因当前网络不可达弃用/降级，替代方案已写入 §5.2，不影响主线。
4. **网络通道注意项**：本网络 curl 直连 GitHub 不通，统一使用 gh/git 凭据通道（推送、拉取均正常）；素材/参考网页访问如遇超时，改用豆包联网搜索或 gh 通道获取。

---

*本文件随开发推进持续更新；所有外部来源详见 README「组件来源声明」。*

---

## 14. 完整版扩展规划（M7+，从"小游戏"到"完整作品"）

> 规划原则不变：无天数排期，全部以「AI 协作轮次 × 效果判据」衡量；能引入 GitHub 现成模块的优先引入，站在巨人肩膀上。

### 14.1 扩展总纲（三个维度）

| 维度 | 目标 | 关键动作 |
|---|---|---|
| AI 深度 | 让"人工智能"含量配得上课程主题 | 新增**强化学习演示**（已完成）、技能 AI、Boss 行为 AI |
| 内容深度 | 从小游戏升级为完整 RPG | 技能系统、Boss 战、装备词缀、图鉴收集、本地排行榜 |
| 表现力 | 画面/听觉质变 | 音频引擎（已完成）、程序化音效（已完成）、粒子特效、像素美术接入 |

### 14.2 M7 强化学习/音频/画面（已完成）

| 子任务 | 组件来源 | 效果判据 | 状态 |
|---|---|---|---|
| 音频引擎 | **GitHub：goldfire/howler.js（MIT，js/vendor/howler.min.js）** | howler 全局对象可加载 | ✅ 验证通过 |
| 程序化音效 | Web Audio API 合成（move/attack/hit/gold/stair/victory 等 10 种） | `audio:play` 事件通道发声、离线可用 | ✅ 验证通过 |
| 强化学习演示 | 标准 Q-learning（参考开源 Grid-World-RL 等教学实现自写） | 训练 3000 步成功率 > 30%（随机基准约 5-8%） | ✅ 实测 32% |
| 渲染增强 | 自绘像素 + **引入 kni-dungeon 真实精灵**（骑士/小怪/Boss） | headless 无报错、素材就绪时自动替换色块 | ✅ 通过 |
| 素材尝试 | 0x72 DungeonTileset II（CC0，经 kni-dungeon 镜像） | LFS 通道部分受限：6/7 精灵成功，地板 atlas 失败 | ⚠️ 6 个精灵已接入，地板降级自绘砖纹 |

### 14.3 M8 内容深度（待办）

| 子任务 | 模块 | AI 协作轮次 | 效果判据 |
|---|---|---|---|
| 技能系统 | `js/systems/skills.js`：火球/冲刺/护盾（MP 消耗） | 4-6 轮 | 战斗中数字键 4/5/6 释放技能，有伤害/位移/减伤效果与冷却 |
| Boss 战机制 | `js/data/monsters.js` 扩展 + battle 分支：巨龙二阶段（半血狂暴，攻防提升） | 3-5 轮 | 主线 Boss 血量 <50% 触发狂暴，日志提示，数值正确 |
| 装备词缀 | ITEMS Schema 扩展：普通/优秀/稀有 3 档，随机附加属性 | 3-5 轮 | 商店与掉落出现多档装备，装备后属性结算正确 |
| 图鉴收集 | `js/systems/bestiary.js`：怪物/物品图鉴（M 面板分页） | 2-4 轮 | 首次击杀/获得自动登记，图鉴可翻页查看 |
| 本地排行榜 | `js/systems/rank.js`：通关时间/金币/等级 3 项排行（localStorage） | 2-3 轮 | 通关后写入排行，排行榜面板可查看最近 10 条 |
| 难度曲线 | MAPS/enemyTable 数值平衡（逐层强度） | 2-3 轮 | 1-3 层难度单调递增，不靠刷可通关 |

### 14.4 M9 表现力（待办）

| 子任务 | 模块 | AI 协作轮次 | 效果判据 |
|---|---|---|---|
| 粒子特效 | `js/systems/particles.js`：攻击/受伤/金币/楼梯光效 | 2-4 轮 | 关键动作有粒子反馈，低端机不掉帧 |
| 背景音乐 | Web Audio 合成循环旋律（BGM 分场景） | 3-4 轮 | 探索/战斗/通关三段不同旋律，可静音（K 键） |
| 像素美术接入 | 引入 0x72 DungeonTileset II（CC0）替换自绘 | 3-5 轮 | 瓦片/角色/UI 全面替换，`assets/sprites/` 有逐文件来源声明 |
| 音频素材 | opengameart CC0 音效包（经 howler 播放） | 2 轮 | 10+ 音效素材替换合成音，无版权风险 |
| 设置面板 | 音量/画面缩放/操作说明（`#settings` DOM） | 2-4 轮 | 音量可调、说明可看、不破坏存档 |

### 14.5 扩展验收红线

1. 每一模块完成必须过 headless 验证页（preflight 模式复用），禁止"写完就宣称完成"。
2. 引入的任何 GitHub 模块必须落在 `js/vendor/` 或 `assets/` 并有来源声明（README 组件来源表同步更新）。
3. 全程保持 file:// 双击即玩 + 零构建 + 离线可用（在线 AI 对话除外，属可选项）。
4. 存档 Schema 变更必须做版本兼容（旧存档可读）。
5. 交付前全量回归（index.html headless 启动 + Pages 在线验证）。

---

## 15. 文献驱动的项目评估与升级路线（2026-10-28 修订）

> 依据《docs/参考资料.md》中 15 篇学术文献与 10 条行业实践（Gemini 论文、OpenGame、UniGen、Ink Splotch、36氪案例、BSWEN、Codex+Godot 等）对 M0–M7 复盘，本修订章在 §14 基础上调整优先级并新增 M10。**执行以本章为准，§14 保留作基线。**

### 15.1 评估对照表（我们的做法 vs 文献/实证结论）

| # | 文献/实证结论 | 本项目现状 | 评估 |
|---|---|---|---|
| E-01 | 一次性大提示失败；拆小任务自底向上迭代成功（Gemini 学士论文 585 任务） | M0-M7 里程碑迭代 + 每轮 headless 验证 PASS 才提交 | ✅ 方法论已对齐，继续保持 |
| E-02 | LLM 擅长高层构思、不擅长复杂工程细节；人需提供架构（Ink Splotch） | M0 起即定 EventBus/命名空间契约/加载顺序，AI 只做模块内实现 | ✅ 已对齐，契约化应继续强化 |
| E-03 | Agent 框架需要"模板库 + 调试协议"（OpenGame Template/Debug Skill） | preflight/ 每里程碑手写验证页，无统一模板生成 | ⚠️ **待升级**：验证页模板化，新模块自动生成 |
| E-04 | 多智能体分工：新功能开新会话、修 bug 用长会话、模块专职会话（36氪案例、UniGen） | 豆包（对话端）+ Trae（执行端）分工已定，但会话策略未写入规范 | ⚠️ **待升级**：会话操作规范制度化 |
| E-05 | 30% 构建 / 70% 优化；性能在目标设备上验证（BSWEN） | M7 前无专门优化轮次；只在桌面 headless 验证 | ⚠️ **待升级**：M9 增加优化与兼容性轮次 |
| E-06 | 初期不约束架构 → 技术债意大利面，靠事件总线重构救回（Codex+Godot 案例） | M0 即引入 EventBus 解耦；各系统经 bus 通信 | ✅ 已受益，红线固化 |
| E-07 | LLM 内容必须与确定性规则耦合、可离线降级（LLMs in Game Development） | NPC 在线对话 + 离线规则兜底 | ✅ 已对齐 |
| E-08 | AI 是"核心机制"才算 AI 原生，而非辅助工具（AI Native Games） | 当前 AI 以"演示/增强"为主（L 键演示、T 键对话） | ⚠️ **升级点**：新增 M10，让 AI 直接进正式玩法 |
| E-09 | Q-learning 收敛依赖奖励设计/参数（α/γ/ε）；稀疏奖励导致不稳定（RL 三篇） | M7 寻宝鼠已用距离势 + ε 衰减，成功率 32% | ✅ 有据可依；M10 动态难度沿用同一套经验 |
| E-10 | 开源合规：改编需署名、商标规避（WorkBuddy 案例、MIT/CC0 协议） | 组件来源表 + LICENSE 已有 | ⚠️ **补强**：增加逐文件许可证核对轮次 |

### 15.2 评估结论（四条行动线）

1. **方法论已验证**：组件化 + 里程碑迭代 + 效果判据 + 契约解耦被文献与实证共同支持，路线不变。
2. **工程纪律补课**：验证页模板化（E-03）、会话操作规范（E-04）、优化轮次制度化（E-05）三项落地，补齐"过程质量"。
3. **AI 含量升级**：新增 M10"AI 原生机制"（E-08），把强化学习从演示推进正式玩法（AI 动态难度），把大模型从对话推进内容生成（任务文案/商店货架，离线降级）。
4. **合规审计**：E-10 增加开源许可证核对轮次，随每个 commit 检查。

### 15.3 AI 协作操作规范（新增，对应 E-03/E-04）

| 规则 | 内容 | 依据 |
|---|---|---|
| R-01 验证页模板 | `preflight/verify_template.html` 固化为模板（IIFE + try/catch + PASS/FAIL JSON 输出 + 加载顺序注释），新模块复制改断言即可 | E-03 |
| R-02 会话分工 | 每个新功能模块开新对话会话（无历史污染）；修 bug 保留长会话（了解全项目结构）；地图/UI/玩法逻辑分专会话 | E-04 |
| R-03 交接载体 | 跨 AI 衔接只通过项目文件（接口契约注释、PLAN.md、README、preflight）——人 + 文件，不用对话传递 | E-04 |
| R-04 改动验证 | 每次改动后：headless 验证 PASS + 双击试玩 ≥3 分钟（人工体验轮） | E-05 |
| R-05 性能审计 | 每个 M9 子任务末尾设"优化轮"：目标设备运行、对象池/事件清理检查 | E-05 |

### 15.4 升级后的里程碑计划（轮次 × 效果判据）

| 里程碑 | 内容 | 需用 AI 协作轮次 | 效果判据 |
|---|---|---|---|
| M8-1 技能系统 | `js/systems/skills.js`：火球/冲刺/护盾（MP、冷却） | 4-6 轮 | 战斗中 4/5/6 释放，数值与冷却正确，过验证页 |
| M8-2 Boss 二阶段 | 巨龙半血狂暴（攻防提升、新技能） | 3-5 轮 | 血线 50% 触发狂暴并提示，数值可复算 |
| M8-3 装备词缀 | 普通/优秀/稀有三档随机属性 | 3-5 轮 | 掉落/商店出现多档，装备结算正确 |
| M8-4 图鉴收集 | 怪物/物品图鉴（M 面板分页） | 2-4 轮 | 击杀/获得自动登记，翻页正常 |
| M8-5 本地排行榜 | 通关时间/金币/等级（localStorage） | 2-3 轮 | 通关写入，排行榜面板展示最近 10 条 |
| M8-6 难度曲线 | 逐层强度平衡 | 2-3 轮 | 1-3 层难度单调递增，不刷可通关（对齐 E-09 经验） |
| M9-1 粒子特效 | `js/systems/particles.js` | 2-4 轮 | 关键动作有粒子反馈，低端不掉帧 |
| M9-2 背景音乐 | Web Audio 合成三场景旋律 + K 键静音 | 3-4 轮 | 探索/战斗/通关旋律可辨，可静音 |
| M9-3 性能优化轮 | 事件清理/渲染裁剪/对象池审计 | 2-3 轮 | 目标设备 60fps，内存无增长（对齐 E-05） |
| M9-4 设置面板 | 音量/操作说明/画质档 | 2-4 轮 | 设置生效、不破坏存档 |
| M10-1 AI 动态难度 | 正式玩法引入 Q-learning 难度引擎：Boss 战按玩家胜率自动调强度（Q 表在线更新） | 4-6 轮 | 玩家连败→AI 降强度，连胜→升强度，胜率趋近 50%；主菜单可视化显示难度档 | 
| M10-2 三级 NPC 反应机制（§20） | NPC 对话升级为事件驱动智能：L1 离线反应库（LLM 预生成 100+ 条按事件触发）+ L2 关键词检索 + L3 实时 API 可选 | 4-6 轮 | L1/L2 无 Key 全可用（默认态）；L3 有 Key 时追问有生成式回复；同 tag 不短时重复 |
| M10-3 AI 内容审计 | 全仓开源许可证逐文件核对 + 素材来源声明更新 | 2 轮 | LICENSE 清单与引用文件一一对应（对齐 E-10） |

### 15.5 软件工具清单（全程免费，按用途分组）

| 用途 | 软件 | 角色 | 依据 |
|---|---|---|---|
| 对话端 / 规划 | 豆包（本对话） | 方案规划、文献综合、代码审查、进度调度 | 会话分工规范 R-02 |
| 执行端 / 编码 | Trae CN（AI IDE，内置豆包 1.5 Pro + DeepSeek 免费） | 直接生成/修改代码文件、内置 git、Agent 模式批量改动 | E-04 多智能体分工 |
| 在线模型（可选） | DeepSeek API（游戏内 NPC 对话） | 运行时 AI 对话（免费用量内） | E-07 |
| 版本托管 | GitHub（gh CLI 2.103.2 + git） | 仓库、Pages 部署、组件引入 | — |
| 网络通道 | Dev-sidecar（免费） | GitHub 访问代理（curl 直连不通时唯一通道） | — |
| 无头验证 | Edge headless（--dump-dom + virtual-time-budget） | 每模块逻辑验证、回归 | R-01/R-04 |
| 静态服务（可选） | Python http.server | 局域网试玩、验证页调试 | — |
| 素材（可选） | GitHub 开源像素包（kni-dungeon/0x72，CC0/MIT） | 已引入 6 张精灵；后续可按需补充 | E-10 合规 |
| 录音/演示（可选） | Edge 录屏或 OBS（免费） | 答辩演示录屏 | — |

### 15.6 交付序列

`M8-1→M8-2→M8-3→M8-4→M8-5→M8-6 → M9-1→M9-2→M9-3→M9-4 → M10-1→M10-2→M10-3`，每步完成即 commit + 过验证页 + 试玩轮；M10 完成后全量回归 + Pages 在线验证 + README/PLAN 同步更新。

## 16. 美术与界面创作管线（图片/界面何时做、怎么做）

> 回答"美术/界面是后期补还是一并做"：都不是。正确做法是**分层并行、分阶段替换**——功能开发期用占位、素材管线同步建立、功能稳定后一次性定稿布局、收尾期统一打磨。美术与界面是两条并行线，各自有自己的阶段，而不是一个在前一个在后。

### 16.1 四阶段模型（美术/界面与开发的配合节奏）

| 阶段 | 时机 | 产出 | 验收原则 |
|---|---|---|---|
| S1 占位期 | 每个功能模块开发时（M0-M7 已实践） | 色块/几何图形占位、功能按钮面板 | 先跑通逻辑；视觉可以丑，但必须可玩、可验证 |
| S2 素材管线期 | 功能稳定后、迭代过程中持续 | 锁定素材源 → 建加载器 → 素材就绪一批换一批 | 素材与逻辑解耦（加载器失败自动降级占位），不阻塞开发 |
| S3 布局定稿期 | 功能齐全、扩展动工前（即本次界面改向） | 按参考图一次性定稿：HUD 布局/配色/字体/面板样式 | 一次定稿，后续里程碑不再返工布局 |
| S4 统一打磨期 | 收尾（M9 表现力轮） | 粒子特效、BGM、标题画面、入场动效、全屏风格统一 | 全屏同一视觉语言，低端不掉帧 |

**关键结论：图片补充不是"后期"，而是 S2 从开发中期就开始并行推进、一直持续到 S4；界面定稿放在 S3（功能齐全后、扩展前）这个窗口，避免做一半再返工。**

### 16.2 素材来源四条通道（优先级从高到低）

1. **GitHub 开源像素包**（0x72 CC0 / fernandovmp/kni-dungeon / Dawnhack 16x16 tileset）：符合"站在巨人肩膀"原则，免绘制、免授权成本；**已引入 6 张精灵**（player / monster_chort / monster_chort_run / boss_demon / boss_demon_run）。后续图标、道具、UI 装饰优先从同类 CC0/MIT 包找。
2. **AI 生成**（豆包图像 / Seedream）：补开源包里缺失的定制素材——技能图标、词缀图标、Boss 专属形象、HUD 装饰。生成后归入 `assets/` 并按来源声明。
3. **程序化绘制**（Canvas 矢量：渐变瓦片、噪点纹理、粒子、飘字）：M7 已实践（砖纹地板、Q-learning 演示、音效合成）；零资源成本，用于特效与动态元素。
4. **自绘简单像素**：仅作最后兜底，避免人工绘制占用 AI 协作轮次。

### 16.3 界面（UI/HUD）管线

- **功能期（当前）**：面板化按钮界面，保证全部功能可操作、可验证——「不好玩」的观感主要来自这个阶段形态。
- **定稿期（S3，用户确认参考方向后）**：按 Shattered Pixel Dungeon 一类参考定稿——
  - 顶部常驻 HUD：HP / 金币 / 楼层 / 当前层杀怪进度
  - 底部道具栏：快捷使用/切换
  - 背包 / 商店 / 任务 / 图鉴改为**游戏内弹窗**（半透明面板 + 关闭键），替代跳转式按钮
  - 战斗反馈：伤害飘字、受击闪白、攻击动作帧
- **打磨期（S4）**：统一字体描边/配色/面板圆角，按钮悬停态，面板入场动效。

### 16.4 美术/界面 × 里程碑对照（各阶段产出）

| 里程碑 | 美术/界面产出 |
|---|---|
| S3 定稿（用户确认方向后立即执行） | HUD 布局与配色一次性定稿；`assets/ui/` 目录建立；缺口素材清单列明 |
| M8（内容深度） | 技能图标、装备词缀图标、图鉴图标随功能接入；素材缺口用 AI 生成补齐 |
| M9（表现力） | 粒子特效、合成 BGM、标题画面、设置面板 UI、全屏风格统一审计 |
| M10（AI 原生） | 难度档可视化面板、AI 生成内容（任务/商店文案）展示面板 |

### 16.5 现状盘点与下一步

- **已具备**：6 张真实精灵、色块自动降级、砖纹自绘地板、Web Audio 10 种音效、合成 BGM 能力（M9-2）。
- **缺口**：HUD 图标、道具/装备图标、技能图标、Boss 专属战斗表现、标题画面。
- **下一步（依赖界面方向确认）**：按参考风格定稿 HUD 与配色 → 建 `assets/ui/` 与 `assets/items/` → 缺口素材从 GitHub CC0 包优先、AI 生成补齐 → S4 统一打磨。

## 17. 参考驱动界面改向执行计划（用户已确认：按参考执行）

> 用户结论：当前界面"不好玩、不是想象中的"。经检索四类参考（传统地牢 roguelike / 房间制动作地牢 / AI 叙事 / 轻量网页 roguelike）后，确认**以 Shattered Pixel Dungeon（A 类传统地牢 roguelike）为主基准**执行改向：界面规格、可玩性指标、引入的 GitHub 功能模块全部对照参考落实。参考清单即验收基准。

### 17.1 设计参考清单（写入规划即执行基准）

| 参考 | 类型 | 借鉴点 | 用途 |
|---|---|---|---|
| **Shattered Pixel Dungeon**（pixel-dungeon.com 在线可玩；源码 glassesmonkey/shattered-pixel-dungeon-web，GPL） | **主基准** A 类 | 顶部 HUD（HP/金币/楼层常驻）、底部道具栏、背包/商店游戏内弹窗、战斗飘字+受击反馈、暗色地牢配色、迷雾视野 | 界面规格直接照此定稿 |
| WebDungeon（macbury.itch.io，MIT，PhaserJS+16x16 Dawnhack tileset） | 结构参照 | 16x16 瓦片比例、点击移动交互 | 瓦片尺寸与交互规格 |
| Rogule（rogule.com，GitHub chr15m/rogule.com，rot.js+Twemoji） | 技术参照 | rot.js 用于 FOV/地图生成；每日地牢+社交分享玩法 | rot.js 引入依据 |
| The Binding of Isaac（以撒的结合） | 远期可选 B | 房间+门结构、道具堆叠成长 | 记录为 M10 后远期方向，本次不实施 |
| AI Dungeon | 远期可选 C | AI 叙事输入框交互 | 与 M10-2（三级 NPC 反应机制，§20）衔接，本次不实施 |

### 17.2 界面规格定稿（S3 阶段，对照 SPD 执行）

1. **顶部常驻 HUD**：HP / MP、金币、当前楼层、击杀进度（替代现有边角数字堆叠）。
2. **底部快捷道具栏**：可选中项，数字键或点击使用。
3. **弹窗系统**（背包/商店/任务/图鉴/排行榜统一）：半透明暗底面板 + 网格列表 + 关闭键（Esc/点击外部）。
4. **战斗反馈**：伤害数字飘字、怪物受击闪白/抖动、攻击命中音效（已有 audio 通道复用）。
5. **配色基调**：深灰蓝地牢底 + 高亮点缀（参考 SPD：暗背景 + 绿色血条 + 金色金币 + 暖色道具图标）。
6. **迷雾视野（FOV）**：玩家周围可见、远处渐暗，通关后逐层点亮——地牢探索感核心来源。

### 17.3 GitHub 功能模块引入清单（站在巨人肩膀，全部免费合规）

| 模块 | 来源仓库 | 协议 | 引入内容 | 对应里程碑 |
|---|---|---|---|---|
| rot.js（地图/FOV/调度） | ondras/rot.js | BSD-3 | `js/vendor/rot.min.js`：FOV 视野迷雾 + 迷宫/洞穴地图生成增强 | S3 定稿 + M8 |
| A* 寻路 | bgrins/javascript-astar | MIT | **已引入** `js/vendor/astar.js`（M5） | 已完成 |
| 音频 | goldfire/howler.js | MIT | **已引入** `js/vendor/howler.min.js`（M7） | 已完成 |
| 像素素材 | fernandovmp/kni-dungeon（源自 0x72 CC0 包） | CC0 | 已引入 6 张精灵；**扩展引入**瓦片/道具/UI 图标（网络恢复后补拉） | S3 + M8 |
| 粒子/飘字/ HUD | 自写 `js/systems/{hud,particles}.js` | 本项目 MIT | 不引重量级引擎，保持零构建（对齐 R-05 性能审计） | S3 + M9-1 |

**引入顺序**：S3 定稿时先落 `rot.min.js`（验证 FOV 可运行）→ 扩展素材 → M8 内容接入 → M9 表现力。每个模块沿用 R-01 验证页模板 + 来源声明（对齐 E-10 合规）。

### 17.4 验收基准（"按参考做"的判定标准）

- 打开游戏：顶部 HUD 常驻、地牢有迷雾探索感、进入背包为游戏内弹窗（非页面跳转）、战斗有飘字与受击反馈。
- 与参考对照项：HUD 信息完整度 ≥ SPD 截图基础项；可玩性上"不打开背包也能看懂当前状态"。
- 每项完成过 `preflight/verify_template.html` 验证 + 人工试玩轮（R-04），全绿后进入下一项。

## 18. 参考游戏制作流程与作者分享（可借鉴经验库）

> 用户要求：把参考游戏的制作流程和经过写进计划，作者如有公开分享一并收录。本节记录主基准（Shattered Pixel Dungeon）、原版（Pixel Dungeon）、技术参照（Rogule/Chris McCormick）、远期方向（The Binding of Isaac）四款的开发历程与作者原话要点，并在 18.5 转化为本项目的落地动作。

### 18.1 Shattered Pixel Dungeon（主基准）——Evan Debenham（00-Evan）

**制作流程与经过（时间线）**：
1. **2014**：Pixel Dungeon 开源后不久，加拿大新手开发者 Evan 出于"花几个月平衡道具"的动机 fork 项目，仅 Android 平台。
2. **2014–2021（7 年迭代）**：从平衡调整逐步扩大到重做游戏每个方面——6 个英雄职业（Warrior/Mage/Rogue/Huntress/Duelist/Cleric）、250+ 物品、26 层地牢、5 大区域、Boss、挑战模式、原创配乐。**v1.0 于 2021-08-17 发布**（与 iOS 版同步），此时已成为其全职项目与主要收入来源。
3. **2021–2026（v2.0→v4.0）**：每年 1–2 个大版本，每版 = 一组新内容（新任务/新物品/新机制）+ 大量平衡与打磨；v4.0.0（2026-09-09）为其"史上最大更新"（新任务、新像素美术、6 新附魔）。

**作者公开分享要点**：
- **年度规划博客**：Evan 自 2019 年起每年初写"XX 年回顾与计划"，公开列出当年内容优先级、如实说明延期原因（"比预期大得多"是常态、个人事务影响排期、合作画师离职导致像素美术进度放缓）。→ 公开可见的迭代证据链。
- **分阶段发布**：每版走 alpha → beta（Steam 测试分支/itch devlog 公告）→ 正式发布，社区反馈进下一版。
- **美术是长期迭代**：作者长期与外包画师协作；2024–2025 年因画师无法投入，美术进展明显放缓——印证 §16"美术 S2–S4 持续替换、不阻塞开发"的判断。
- **核心 loop 不变**：12 年开发中"地牢探索→战斗→资源管理→随机重生"从未动摇，所有更新都是加深而非更换 loop。

### 18.2 Pixel Dungeon 原版——Oleg "Watabou" Dolya

**制作流程与经过**：
1. **2012**：受 Brogue（2009）启发制作，年末发布 Android beta（Java）。内容：25 层随机地牢、4 职业（2 子职业）、80+ 物品、25 敌人、5 Boss，目标"拿 Yendor 护符"。
2. **2014-07**：Google Play 破 100 万下载，同日开源（GPLv3）。
3. **2015**：v1.9.2 后 Watabou 宣布"游戏已完整"停更；此后转向地图生成器（One Page Dungeon 等，2026 仍在更新）。
4. **开源结果**：基于其代码衍生 100+ mod，最著名即 Shattered Pixel Dungeon；游戏以"可维护的开源项目"形态长存。

**可借鉴**：①核心 loop 简洁克制（非关键功能不贪多）；②开源让作品被社区续命（本项目 MIT + GitHub Pages 同理）；③开发者转向熟悉领域（程序化地图生成）是合理路径。

### 18.3 Rogule / Asterogue——Chris McCormick（技术参照）

**制作流程与经过**：
1. **2022-03**：7DRL（7 天 roguelike 挑战赛）诞生 Rogule 原型——ClojureScript + rot.js + Twemoji emoji 图形。
2. **玩法**：每日同图地牢、仅一次通关机会、社交分享（Wordle 模式）；约 1–5 分钟/局。
3. **2023-02 开源后走红**：r/webgames 发帖 → Hacker News → GitHub 官方转发 → 日本媒体报道，从每天几个玩家到每天数千玩家。**作者原话要点："软件没有任何改动就 viral 了。大教训：有时不需要加代码或功能，只需把作品放到对的人面前——也就是营销。"** 2023 GitNation 演讲《Rogule: Tales From the Dungeon of a Web Based Roguelike》。
4. **配套产物**：Roguelike Browser Boilerplate（**MIT**，rot.js 基础）——提供 splash/开始/制作名单/说明/设置/菜单/像素 UI/胜负画面/音效/动画等模板，含怪物、背包、关卡生成示例。
5. **Asterogue**：约 1.5 个月完成"juicy"图形 roguelike——纯 JS + 仅 rot.js 一个库、约 2000 行代码、用 CSS 动画做游戏手感（game juice）。作者原话："浏览器是杀手级游戏引擎。"

### 18.4 The Binding of Isaac（远期方向）——Edmund McMillen

**制作流程与经过**：
1. 一周 game jam 项目起步（与程序员 Florian Himsl 合作），灵感混合《塞尔达》随机地牢。
2. 约 3 个月兼职开发完成；发布后 Steam 日均 100–200 份，累计销量 200 万+。
3. 2014 年弃 Flash、用 C++ 自研引擎全量重制（Rebirth），全新 16-bit 像素美术（仍参考塞尔达）。
4. 作者经典分享：Gamasutra Postmortem《Postmortem: McMillen and Himsl's The Binding of Isaac》（2012）——**"I was positive Isaac would not do well… I was banking on it not doing well"**（作者对作品前景判断常是错的，小步发布让市场回答）。

### 18.5 可借鉴清单（落地为本项目动作）

| # | 借鉴点 | 落地动作 | 对应里程碑 |
|---|---|---|---|
| X-01 | 核心 loop 优先、加深而非更换 | 保留地牢探索→战斗→资源管理主线；界面改向只增强 loop 可见性，不改 loop | S3 定稿 |
| X-02 | 小步迭代 + 公开验证链 | 延续 M0-M10 里程碑 + headless 验证 + README/PLAN 记录每轮结果（等价于"年度博客"的课程版） | 全程 |
| X-03 | rot.js 单库方案（McCormick 实证：2000 行可成 game） | S3 引入 rot.js 做 FOV/地图；HUD 自写不引引擎 | S3 + M8 |
| X-04 | 像素 UI 模板复用（Boilerplate，MIT） | S3 参照其菜单/设置/像素 UI 模式，自写实现并保留来源声明 | S3 + M9-4 |
| X-05 | CSS/Canvas 动画做 game juice | M9-1 粒子、飘字、受击闪白沿用"小成本高手感"路线 | M9 |
| X-06 | 美术长期迭代不阻塞 | §16 S2 素材管线持续替换；画师缺口 = AI 生成补齐（本项目无外包依赖） | S2-S4 |
| X-07 | 开源即曝光（Rogule 走红） | GitHub Pages 在线可玩 + README 组件来源声明（已被"看见"） | 已上线 |
| X-08 | 内容先少而稳，再逐年扩展 | M8（内容）→M9（表现）→M10（AI 原生）顺序不变，每版只做一组新内容+平衡 | M8-M10 |

**来源**：Evan 年度博客（Steam 公告页/itch devlog，2019-2026）；HandWiki《Software:Pixel Dungeon》；enthub《Pixel Dungeon 开源史》；mccormick.cx 博客（Rogule 走红复盘/Asterogue 发布）；dev.to《Gamify JS: rot.js 入门》；Gamasutra《Binding of Isaac Postmortem》；RogueBasin《Rogule》。（详见 docs/参考资料.md 引用格式）

## 19. AI 协作作战手册（总索引）

**完整操作手册**：`docs/AI-协作作战手册.md`（豆包×Trae CN×黄文博三方协作的唯一权威文件）。

核心纪律（摘要，详见手册）：
1. **分工**：豆包=总指挥（任务卡/审查/验证/裁定 PASS）；Trae CN=执行工程师（只按任务卡写代码）；黄文博=传令+试玩+验收；GitHub=唯一交接黑板；WorkBuddy 不进入开发链路。
2. **模块顺序**：S3-1 rot.js+FOV → S3-2 HUD → S3-3 弹窗系统 → S3-4 战斗反馈 → M8（内容）→ M9（表现）→ M10（AI 原生）→ 收尾。
3. **打磨遍数**：标准 3 遍（初稿→修正→终验），简单 2 遍、复杂 4-5 遍；判据是 PASS 不是遍数。
4. **传递机制**：只走文件（docs/tasks/ 任务卡、代码注释契约、preflight/ 验证页）；你（黄文博）是唯一口头通道，豆包↔Trae 不直接对话。
5. **话术**：A 开工 / B 卡住 / C 带回疑问 / D 试玩反馈 / E 提交 / F 加需求，六种场景现成话术在手册 §6，到我上场时按场景复制。
6. **首个任务卡**：`docs/tasks/S3-1-rotjs-fov.md`（手册 §7 内嵌完整样例），S3 定稿开工时第一步执行。

## 20. 三级 NPC 反应机制（"事件驱动智能对话"，用户提案，已证成立）

### 20.1 用户提案与佐证结论

**提案**：让 LLM 生成大量文本信息，按角色活动/游戏事件触发不同反应（"伪装智能"），替代或补充运行时实时调用。
**结论：提案成立**，学界与业界均有明确支持，该方案学名为 **offline pre-generated dialogue pool + runtime lookup（离线预生成对话池 + 运行时查表）/ canned-line fallback（罐头台词回退）**：

- **学术佐证**：
  - ACM FDG 2026《Quest of Aivengarde：Comparative Study of Player Experience Across LLM Dialogue Systems》——64 名被试比较固定树/LLM 改写/混合/全开放四版：全开放 LLM 对话带来更长对话与沉浸，但同时产生不可控副作用，混合架构是工程平衡点。
  - ACM《Beyond Pre-Defined Scripts: Player Perceptions on Generative NPC Dialogues》——62 人调查：LLM 对话有输入灵活、更自然的优势，但产生难预料的副作用；引用 Värtinen 等研究：GPT 生成的 5 条任务描述仅 1 条被人类批评者接受——**支持"预生成+人工筛选"**。
  - arXiv:2511.10277《Fixed-Persona SLMs with Modular Memory》——云 LLM 用于游戏受硬件、延迟、知识边界三重限制，业界转向本地/离线替代。
  - ICAISD 2025《Generative AI-Driven Procedural Character and Dialogue System》——直接应用通用 LLM 面临角色一致性/叙事连贯/情境适应性挑战，必须加结构约束（记忆+情感+上下文控制）。
- **业界佐证**：
  - SpotdogGames《Diálogos generados con LLM en pipeline (no runtime)》——**LLM 移到构建期（pipeline），运行时零调用只查表**：零成本、零延迟、内容可审；模板+slots 批量生成变体，bag 机制防重复。
  - Patsnap Eureka 专利《Offline Hybrid Dialog Trees for Low-Latency Game Character AI》——离线阶段 AI 生成对话树存储、在线阶段检索调用，消除延迟与资源消耗。
  - Summer Engine《AI Dialogue Generator for Games: What Actually Works in 2026》——"**静态预写对话是更安全的默认选择**：生成一次、通读每行、编辑语气、交付完全可控；实时 LLM NPC 增加成本/延迟/出戏风险。许多已发售游戏用 AI 写静态对话、保持运行时确定性"。
  - GamineAI《LLM-Driven NPC Dialogue System with a Hard Fallback Net》——双路架构：网络健康走实时 LLM、否则走确定性本地罐头台词树；2026 平台评审已正式要求必须有确定性 fallback；每节点 3-6 条罐头台词是甜点位。
  - AiToolTutorials《Using LLMs to Generate Dynamic NPC Dialogue Trees》——三档方案（改写/分支引导/全开放）+ 混合流水线（Tartu 2025 论文）：LLM 只碰流水线最后阶段。
- **结论**：以"LLM 离线批量生成 → 筛选入库 → 运行时按事件条件触发"为默认路径；实时 API 是可选第三层增强。这与 §15 E-07（LLM 内容与确定性规则耦合、可离线降级）完全一致并强化。

### 20.2 三层架构

| 层 | 机制 | 依赖 | 定位 |
|---|---|---|---|
| **L1 离线反应库** | `js/data/reactions.js`：事件 tag → 文本池；事件触发随机抽取（bag 去重防短时重复） | 无（零 API、零延迟、file:// 可用） | **默认主路径** |
| **L2 关键词检索** | 玩家自由输入 → 关键词/意图映射到最近 tag；未命中给"没听懂"兜底话术 | 无 | 让"伪智能"接得住自由输入 |
| **L3 实时 API** | 有 Key 且在线且 L1/L2 未命中或玩家追问 → 调 DeepSeek 生成；失败自动落回 L1/L2 | DeepSeek Key（可选） | 可选增强，默认关闭 |

### 20.3 触发事件清单与内容规格（总量 100+ 条）

| 事件 tag | 触发点 | 文本量 | 事件 tag | 触发点 | 文本量 |
|---|---|---|---|---|---|
| enter_floor | 进入新层 | 8 | quest_done | 任务完成 | 8 |
| kill | 击杀怪物 | 8 | death | 死亡 | 10 |
| kill_boss | 击杀 Boss | 10 | victory | 通关 | 12 |
| hurt | 受击 | 8 | greeting | 打招呼 | 8 |
| low_hp | 残血 | 8 | idle | 闲聊 | 8 |
| gold | 拾金币 | 6 | shop | 进商店 | 6 |
| pickup_item | 拾道具 | 6 | — | — | — |

每条 1-3 句、贴合角色人设（守门人/商人/向导），含任务/剧情彩蛋呼应。

### 20.4 生成流程（开发期，无需运行时 API）

1. 我给"批量生成模板 prompt"（角色人设 + 事件场景 + 语气要求 + 输出格式）。
2. 用豆包或 DeepSeek 批量生成（每 tag 10-15 条原始变体）。
3. AI 筛选去重、过滤出戏内容 → 写入 `js/data/reactions.js`（结构化 JSON/JS 对象）。
4. 集成：新增 `js/systems/npc.js` 事件挂钩（在 main.js/battle.js/quest.js 既有触发点 emit）→ L2 检索器（简单包含匹配）→ L3 复用现有 DeepSeek 调用。
5. 无 DeepSeek Key 也能完整完成（豆包直接生成文本）。

### 20.5 里程碑归属与验收判据

- **归属**：并入 M10-2（§15.4 已更新为三级机制）；L1+L2 必做，L3 可选。
- **验收**：L1：各事件触发有反应、同 tag 不短时重复（bag）；L2：输入"你是谁/金币/商店"命中对应池、乱输入有兜底；L3：无 Key 全部降级正常（默认态）、有 Key 追问有生成式回复且失败自动回落。
- **答辩亮点**：展示"内容生成（LLM 离线产内容）→ 确定性触发 → 检索 → 实时增强"四层工程权衡，比单纯实时调用更能体现 AI 工程能力。

### 20.6 与现有代码衔接

- M5 `js/systems/npc.js`（T 键对话、在线+离线降级）保留为 **L3 + 对话入口**。
- 新增 `js/data/reactions.js` + L2 检索器 + 事件挂钩（在各系统触发点 emit，复用现有 EventBus）。
- 不改动既有接口；reactions.js 数据文件独立，可随时扩充。
