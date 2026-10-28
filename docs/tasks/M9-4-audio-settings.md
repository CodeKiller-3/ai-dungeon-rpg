# M9-4 任务卡：音效与设置（BGM 三场景旋律 + K 键静音 + 音量设置面板）

> 阶段：S4 精修像素期（PLAN.md §16.6 C 档 / M9-4）
> 目标：探索/战斗/通关三场景可辨 BGM（Web Audio 合成，零素材）、K 键一键静音、弹窗内音量设置面板（持久化）
> 打磨上限：3-4 遍（判据是 PASS，不是遍数）

## 一、背景

M7 已有 Web Audio 10 种音效与合成 BGM 能力（`js/systems/audio.js`）。本任务把它升级为**完整听觉层**：三场景 BGM 自动切换、静音快捷键、音量面板（音量/静音持久化）。

## 二、契约（纯新增接口，不改既有音效触发点）

### 2.1 BGM 三场景旋律（audio.js 扩展）

```
Game.Audio = 原接口 + {
  bgmPlay: function (scene),        // scene: 'explore'|'battle'|'victory'|null(停)
  bgmStop: function (),
  getBgmScene: function () -> string|null,
  isMuted: function () -> bool,
  setMuted: function (bool),        // 一键静音（含音效与 BGM），emit 'audio:muted'（纯新增）
  setVolume: function (v),          // 0..1 钳制；写 localStorage（键 'aiDungeon_volume'）
  getVolume: function () -> number  // 启动时从 localStorage 读（无记录默认 0.7）
};
```

- **BGM 实现**：Web Audio 振荡器+包络合成（如低频 drone + 简单琶音循环），探索=低沉稳定、战斗=快节奏、通关=明亮上行——不引外部音频文件（保持零构建、离线可玩）。循环用 `AudioContext` 调度（`oscillator` + `gain` 包络），切换场景时先 `bgmStop` 再 `bgmPlay`。
- **场景切换钩子**（main.js）：探索场景开始/结束、战斗进入/退出、胜利结算分别调 `Audio.bgmPlay(...)`；弹窗打开不切 BGM。
- **静音**：K 键（键盘）切换 `setMuted`，同时静音 BGM 与 SFX；再次按下恢复。

### 2.2 音量设置面板（modal.js 扩展 + 入口）

- `Game.Modal.open('settings')` 新增 kind：面板内 ① 音量滑块（拖拽改 `Audio.setVolume`，实时生效）② 静音开关（`Audio.setMuted`）③ 操作说明（WASD/方向键移动、B 背包、S 商店、M 任务、K 静音、T 对话、Esc 关闭——文案取自 PLAN §15 与现有实现，不杜撰按键）。
- 入口：探索场景按 **Q 或设置键**打开设置弹窗；HUD 顶部加"⚙"提示（可选，若 HUD 改动大则只保留键盘入口，在 README 注明）。
- 音量持久化：`localStorage` 读写，游戏启动时恢复；不写存档系统（避免破坏 Player schema）。

### 2.3 约束

- **不改既有音效触发点**（攻击/拾取/升级等 SFX 调用不变），只加 BGM/静音/音量三块。
- 静音与音量作用于同一个主 Gain 节点（音效+BGM 一并控制）。
- 无 AudioContext（浏览器禁用/未交互）时全部静默降级，不抛错。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/systems/audio.js` | 修改：新增 BGM 合成器/场景状态机/静音/音量+持久化 |
| `js/systems/modal.js` | 修改：新增 'settings' kind（音量滑块/静音开关/操作说明） |
| `js/core/main.js` | 修改：场景切换调 `bgmPlay/bgmStop`；K 键静音；Q 键开设置弹窗 |
| `index.html` | 修改：无新增脚本（复用 audio/modal） |
| `README.md` | 修改：功能列表补充"三场景 BGM/K 静音/音量设置" |
| `preflight/verify_m9_4.html` | **新增**：R-01 模板验证页 |

## 四、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源/外部音频文件。
- 不改既有音效触发点与事件频道（`audio:muted` 为纯新增频道）。
- 音量 localStorage 键固定 `aiDungeon_volume`；读取失败（损坏/被清）回退默认 0.7 并覆盖写回。
- K 键静音不得与 Input 既有按键冲突（冲突时改用 Shift+K 并在面板注明）。

## 五、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m9_4.html`，输出必须出现 `audioLoaded:true`、`audioApi:true`、`audioOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 六、验证命令（Start-Process 方案）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m94.out.txt"; $ed="$env:TEMP\m94.err.txt"; $pd="$env:TEMP\edgem94"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m9_4.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载 eventBus → config → audio → modal，与主游戏同序）：
- 模块加载与接口齐备；
- BGM 场景状态机：`bgmPlay('explore')` 后 `getBgmScene()==='explore'`；切 `'battle'` 更新；`bgmStop` 后为 null；非法 scene 忽略；
- 静音：`setMuted(true)` 后 `isMuted()===true` 且不抛错；再 `setMuted(false)` 恢复；
- 音量：`setVolume(0.3)` 后 `getVolume()===0.3`；`setVolume(2)` 钳到 1；`setVolume(-1)` 钳到 0；localStorage 键已写入；
- Modal settings：`open('settings')` 后 isOpen/current 正确，关闭后复位；
- 重复切换不抛错（AudioContext 无真实输出时用 stub 验证逻辑层）；
- title/body 各出现一次 `PASS {...}`。

## 七、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1 / S3-2 / S3-3 / S3-4 / M9-1 / M9-2 / M9-3 验证页复跑 PASS。
