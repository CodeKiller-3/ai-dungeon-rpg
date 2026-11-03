# M8-5 任务卡：本地排行榜（通关时间/金币/等级，localStorage 最近 10 条）

> 阶段：M8 内容深度（PLAN.md §14.3 / §15.4 M8-5）
> 目标：通关时写入排行榜（用时/金币/等级/楼层），排行榜面板展示最近 10 条
> 打磨上限：2-3 遍（判据是 PASS，不是遍数）

## 一、背景

- 通关判定点：`main.js` 中 `Game.Systems.Quest.isDone('main_clear_dragon')` 为真时 emit `victory` 音效 + `switchScene('victory')`（约 L93-95）；
- 本局起点：M9-5 已引入 `runStart = performance.now()`（"用时"数据源），死亡结算面板已用；
- 存档：`save.js` 顶层字段 localStorage 读写，已有 bestiary/mp 兼容先例。

## 二、契约（纯新增模块 + 胜利面板展示）

### 2.1 排行榜模块（新增 `js/systems/leaderboard.js`）

```
Game.Systems.Leaderboard = {
  submit: function (entry) -> array,   // entry: { timeSec, gold, level, floor, date }；写入并返回最新列表
  get: function () -> array,           // 最近 10 条（新→旧）
  clear: function () -> void           // 清空（可选，供调试/演示）
};
```

- **存储**：localStorage 键 `aiDungeon_leaderboard`，JSON 数组，最多 10 条（超出丢最旧）；读写 try/catch（隐私模式禁用则静默空列表，不抛错）；
- **排序**：按写入时间倒序（新记录在前），不是按分数排序（"最近 10 条"语义）；
- **数据**：`date` 用 `new Date().toLocaleDateString('zh-CN')` 或 `toLocaleString`（短格式），其余字段从 Player 与 runStart 实取。

### 2.2 通关写入（main.js victory 分支）

- `Quest.isDone('main_clear_dragon')` 触发 victory 时：组装 entry（`timeSec = Math.round((performance.now() - runStart) / 1000)`、`gold = Player.gold`、`level = Player.level`、`floor = Player.floor`、`date = 当日`）→ `Leaderboard.submit(entry)`；
- **只写一次**：v victory 场景重复触发（重进）不重复写入（submit 幂等保护：scene 已为 victory 时不重复提交，或 entry 去重——以最简单方式保证单局一条）。

### 2.3 展示（victory 场景绘制 或 modal 'rank' kind，二选一）

- 方案 A（推荐）：victory 场景画面内绘制排行榜列表（`render.js` drawVictory 区域下方，最近 10 条：序号 + 用时 + 金币 + 等级 + 日期）；
- 方案 B：modal 新增 'rank' kind，victory 场景按 R 键查看；
- 二选一，**选实现成本低且不破坏胜利画面布局者**；列表超 10 条截断（存储层已保证 ≤10）。

### 2.4 约束

- 排行榜为**本地单机**数据（localStorage），不上云、不联网；
- 不新增自由文案；列表行格式与既有面板风格一致（如 `#1 3分25秒 金币120 等级5 2026/11/3`）；
- 失败降级：localStorage 不可用时 submit/get 均返回空/静默，不抛错。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/systems/leaderboard.js` | **新增**：submit/get/clear + localStorage 存取 |
| `js/core/main.js` | 修改：通关分支 submit（幂等） |
| `js/core/render.js` 或 `js/systems/modal.js` | 修改：胜利画面/弹窗展示列表（按所选方案） |
| `index.html` | 修改：systems 组接入 leaderboard.js |
| `README.md` | 修改：功能列表补充本地排行榜 |
| `preflight/verify_m8_5.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- 排行榜数据只来自现有状态（runStart/Player 字段），**不新增数值系统**；date 用系统时间短格式。
- localStorage 键固定 `aiDungeon_leaderboard`；禁用存储静默降级不抛错。
- 单局通关只写一条（幂等保护）。
- 不改胜利判定逻辑（isDone 判定不动，只在其后加写入）。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m8_5.html`，输出必须出现 `rankLoaded:true`、`rankApi:true`、`rankOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m85.out.txt"; $ed="$env:TEMP\m85.err.txt"; $pd="$env:TEMP\edgem85"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m8_5.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载顺序与主游戏一致）：
- 模块加载与接口齐备（submit/get/clear）；
- **写入**：submit({timeSec:123,gold:50,level:3,floor:2,date:'2026/11/3'}) 后 get() 返回 1 条且字段原样；
- **顺序**：连续 submit 3 条，get() 新→旧排列（先提交的在末尾）；
- **上限**：submit 12 条后 get() 长度 ===10 且保留最新 10（丢最旧）；
- **持久化**：clear 后 get() 空；localStorage 键写入可读（JSON 合法）；存储禁用（mock 抛错）时 submit/get 不抛错且返回合理值（空数组）；
- **通关写入**：触发通关路径（mock isDone 或直接调用胜利分支函数）后排行榜含 1 条且 timeSec 为数值、gold/level 来自 Player 当前值；再次触发不重复写入；
- **展示**：所选方案绘制路径可调用不抛错（victory 绘制或 modal open('rank')）；
- 重复 submit/clear 不抛错；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1/2/3/4 + M9-1/2/3/4/5 + M8-1/2/3/4 验证页复跑 PASS。
