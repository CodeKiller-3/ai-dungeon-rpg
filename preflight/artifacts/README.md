# preflight/artifacts — 证据截图

**来源说明**：`shots_resize/` 原位于 `preflight/` 根下，2026-11-12 由 D-32（阶段 B1 目录归位）整体迁入此处。12 张 PNG 的文件名、字节数与哈希均未改变，搬家前快照见 `preflight/selfcheck/d32-before.json`，`preflight/verify_d32.html` 会逐张复核。

## shots_resize/（12 张）

响应式布局回归截图，覆盖 320×568 / 768×1024 / 1280×720 / 1920×1080 / 2560×1440 五档视口，含背包、任务图鉴、NPC 对话、通关结算四类界面状态。截图用于人工回看布局边界（窄屏紧凑版、双栏装备栏、面板不截断），不参与自动化断言。

## D-35 贴图逻辑对照（8 张）

- `d35-old.png` / `d35-new.png`：改前 / 改后对照。左侧为玩家所在 5×5 格放大 **8 倍**（格线为辅助线），右侧为 1280×800 实机画面。
  改前用 `_render_old.js`（HEAD 版 `js/core/render.js` 原样快照）绘制，改后用工作区版本，同场景、同相机、同素材。
- `d35-map-old.png` / `d35-map-new.png`：从上面两张里裁出的 1280×800 实机画面（1:1，未缩放）。
- 复现：`preflight/_shot_d35.html?v=old|new`（Edge headless `--screenshot`，见 `docs/tasks/D-35-贴图逻辑修复.md`）。

## D-56 交付截图（3 张，1280×800）

- `d56-menu.png`：首屏菜单（直接打开 `index.html`）。
- `d56-guide.png`：接取「探路」后的一帧，右侧边缘可见「下行梯 N 步」箭头小条（D-55）。
- `d56-ending.png`：通关结局页（真实 `_commitVictory` 计算评级与统计）。

三张都由游戏真实渲染循环绘制，未做后期合成或改字。复现页 `preflight/_shot_d56.html?view=guide|ending`，命令见 `docs/运行说明.md` 第五节。

