# S3-3 任务卡：游戏内弹窗系统（Modal）—— 背包/商店/任务界面升级

> 阶段：S3 界面定稿第 3 步（S3-1 FOV ✅ → S3-2 HUD ✅ → **S3-3 弹窗系统** → S3-4 战斗反馈）
> 参考基准：Shattered Pixel Dungeon 物品栏弹窗（半透明遮罩 + 居中面板 + 条目列表 + Esc 关闭 + 点击使用/购买）
> 打磨上限：2-3 遍（判据是 PASS，不是遍数）

## 一、背景

现有背包(B)/商店(S)/任务(M)界面由 `render.js` 的 `drawInventory/drawShop/drawQuests` 直接平铺绘制，与 SPD 参考的"游戏内弹窗"体验不符。本任务把三者统一升级为**模态弹窗**：打开时半透明遮罩压暗地图、居中面板列出条目、Esc 或点遮罩关闭、点击条目执行使用/购买/卖出售。

## 二、契约（新增，不改既有接口）

新增 `js/systems/modal.js`（IIFE + `window.Game` 命名空间，风格与 fov.js/hud.js 一致）：

```
Game.Modal = {
  open: function (kind, data),   // kind: 'inventory' | 'shop' | 'quests'；data 为渲染所需数据快照
  close: function (),            // 关闭并恢复游戏输入
  isOpen: function () -> bool,
  current: function () -> kind | null,
  draw: function ()              // 绘制遮罩+面板（render.js 每帧调用）
};
```

- `open()` 必须订阅一次 `keydown`/点击事件（关闭/选择），`close()` 必须取消，避免叠加。
- 打开弹窗时：暂停地图移动输入（`Game.Core.Input` 有开关则以开关；无开关则用内部 flag，不触碰既有接口）。
- 不修改 `Game.Data.Player`、`Game.Systems.Inventory/Shop/Quest` 的既有方法；`use/equip/buy/sell` 仍由它们执行，弹窗只负责"选中条目→调用"。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/systems/modal.js` | **新增**：Modal 状态机 + 绘制（半透明遮罩 rgba(0,0,0,0.55) + 居中面板 + 标题 + 条目行 + 高亮选中 + 底部提示"Esc 关闭 · 数字/方向键选择 · 回车确认"） |
| `index.html` | 修改：`modal.js` 插入 systems 组（`hud.js` 之后、`quest.js` 之前） |
| `js/core/render.js` | 修改：`drawMap/drawHUD/...` 末尾追加 `Game.Modal.draw()` 调用（弹窗打开时遮罩压住地图）；`drawInventory/drawShop/drawQuests` 改为只提供数据快照给 Modal 或直接由 Modal 接管（二选一，保持画布零构建） |
| `js/core/main.js` | 修改：B/S/M 键打开对应 Modal.open，Esc 键优先传给 Modal.close()（不吞其他输入） |
| `README.md` | 修改：功能列表补充"游戏内弹窗（背包/商店/任务）" |
| `preflight/verify_s3_3.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- 不改 `window.Game` 既有接口与事件总线契约；Modal 为纯新增。
- 弹窗必须适配窄窗口（面板宽 ≤ 画布 88%，条目行可换行/截断），中文不溢出。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_s3_3.html`，输出必须出现 `modalLoaded:true`、`modalApi:true`、`modalOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（本机已确认可靠，用 Start-Process 而非 `&` 重定向）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\s33.out.txt"; $ed="$env:TEMP\s33.err.txt"; $pd="$env:TEMP\edge33"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_s3_3.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求：加载 eventBus → render → modal（与主游戏同序），断言 title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1 验证页复跑 PASS；S3-2 验证页复跑 PASS（HUD 与弹窗共存，HUD 在弹窗遮罩之下仍每帧同步）。
