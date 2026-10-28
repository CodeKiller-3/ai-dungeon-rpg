# 任务卡 S3-1：引入 rot.js + FOV 视野迷雾

**状态**：待执行 | **对应规划**：PLAN.md §17.2(6)/§17.3 | **打磨上限**：2 遍

## 前置（已完成，勿重复）
- `js/vendor/rot.min.js` 已由总指挥下载就绪（来源 ondras/rot.js，BSD-3）。**禁止重复下载、禁止从 CDN 引入。**

## 目标
给地牢加"视野迷雾"：玩家周围 5 格可见（亮），远处不可见（暗），走过的格子永久点亮（记忆）。这是可玩性提升的第一项，画面观感直接升档。

## 文件范围
1. **新增** `js/systems/fov.js` —— FOV 模块，基于 `js/vendor/rot.min.js` 的 `ROT.FOV.PreciseShadowcasting` 实现。
2. **修改** `js/core/render.js` —— 绘制地图前先查 FOV：可见格正常绘制，不可见格画暗色覆盖层（半透明黑，可用 `fillRect` 叠加），已点亮但当前不可见格显示较暗（记忆效果）。
3. **修改** `index.html` —— 加载顺序插入 `js/vendor/rot.min.js`（在 systems 之前）与 `js/systems/fov.js`（在 render.js 之后、main.js 之前）。**不改变现有 core→data→vendor→systems→main 顺序框架**。
4. **修改** `README.md` —— 组件来源声明表新增：rot.js（ondras/rot.js，BSD-3，用于 FOV 视野迷雾）。

## 接口契约（必须遵守，改动需写注释并告知）
```js
// 暴露在全局命名空间（保持 window.Game 统一入口）
window.Game.fov = {
  // 计算以 (x,y) 为中心 radius 半径内的可见格子（含自身）
  // isBlocked(x, y) -> boolean：该格是否阻挡视线（墙为 true）
  // 返回 [{x: number, y: number}, ...]
  compute(x, y, radius, isBlocked) -> Array
};
```
- 事件总线新增频道：`map:fovChanged`（探索点亮新格子时触发一次，payload 可空；现有 bus 机制见 `js/core/eventBus.js` 注释）。
- **降级**：`rot.min.js` 加载失败或 `ROT` 未定义时，`compute` 降级为返回"全图可见"（不可用 FOV 时游戏仍可玩，不允许抛错或白屏）。

## 硬约束
- 原生 JS + Canvas，零构建；file:// 双击 index.html 可玩。
- 不引入 npm/构建工具/付费资源。
- 不改动 `window.Game` 既有接口（map/battle/inventory 等）与既有事件频道，只新增。
- 不改变地图生成、移动、碰撞等现有逻辑的行为，只叠加视觉层。

## 完成标准（Trae 输出要求）
1. 改动文件清单（逐个列出，含行数概览）。
2. 用以下命令跑验证页，贴输出（必须出现 `"rotLoaded":true,"fovOk":true`）：
   `& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --user-data-dir="$env:TEMP\trae_s31" --virtual-time-budget=3000 --dump-dom "file:///D:/桌面/工作/人工智能大作业/preflight/verify_s3_1.html" | Select-String "PASS|FAIL"`
3. 剩余风险点说明。

## 效果判据（总指挥验证用）
- file:// 运行：角色周围 5 格亮、墙后与远处暗；走过的路点亮。
- 验证页输出 PASS JSON。
- 回归：原有移动/战斗/存档功能不受影响（总指挥跑全量验证）。
