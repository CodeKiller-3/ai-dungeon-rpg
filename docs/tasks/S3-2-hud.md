# 任务卡 S3-2：顶部常驻 HUD（HP/MP/金币/楼层/击杀进度）

**状态**：待执行 | **对应规划**：PLAN.md §17.2(1) | **打磨上限**：2-3 遍

## 前置
- S3-1 FOV 已上线（远程 HEAD 9d548b5）。本任务在现有结构上叠加 HUD，不改 FOV。

## 目标
顶部常驻信息栏（参考 Shattered Pixel Dungeon）：**HP（数字+短血条）/ MP / 金币 / 当前楼层 / 当前层击杀进度**，任何状态下都看得见，不随战斗/背包界面消失。

## 文件范围
1. **新增** `js/systems/hud.js` —— HUD 模块：绘制 + 数据刷新 + 显示/隐藏。
2. **修改** `js/core/render.js` —— 每帧渲染末尾调用 `Game.hud.draw()`（HUD 画在画布顶部条带，不遮挡地图操作区）。
3. **修改** `index.html` —— `hud.js` 加入 systems 组（fov.js 之后、quest.js 之前）。
4. **修改** `README.md` —— 功能描述补充顶部 HUD。

## 接口契约（必须遵守）
```js
window.Game.hud = {
  // 刷新 HUD 数据并重绘（调用方：main.js 在角色数据/金币/楼层/击杀变化时调用）
  update(stats),   // stats: { hp, hpMax, mp, mpMax, gold, floor, kills, killTarget }
  last,            // 最近一次 update 收到的 stats 快照（供验证页断言，必须维护）
  draw(),          // 画布顶部绘制（render 每帧调用）
  show() / hide()  // 显示/隐藏（默认显示）
};
```
- 数据来源：现有事件频道与游戏状态——**先读 `js/core/eventBus.js` 与 `js/core/main.js`**，找到角色 HP/MP/金币/楼层的现有更新点（如战斗结算、拾取、换层），在对应位置调用 `Game.hud.update(...)`；若某些数据无现成事件，可在 `update` 内提供默认值并注明。
- **新增事件**（如需要）：`hud:update`（payload = stats 对象），仅在确有广播需求时新增，避免频道膨胀。
- **降级**：hud.js 缺失或 stats 字段缺失时，主游戏不得报错（渲染层 try/catch 兜底，缺字段显示 `--`）。

## 硬约束
- 原生 JS + Canvas 零构建；file:// 双击可玩。
- 不引入 npm/构建工具/付费资源；不改动既有接口与频道（只新增 hud.* 与可选 hud:update）。
- HUD 不遮挡地图主要操作区（顶部约 22px 条带，地图 y 坐标不受影响）。

## 完成标准（Trae 输出要求）
1. 改动文件清单（含行数概览）。
2. 跑验证页并贴输出，必须出现 `"hudLoaded":true,"hudOk":true`：
   `& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-first-run --user-data-dir="$env:TEMP\trae_s32" --virtual-time-budget=3000 --dump-dom "file:///D:/桌面/工作/人工智能大作业/preflight/verify_s3_2.html" > "$env:TEMP\s32_out.txt" 2>&1`（输出在 s32_out.txt 里，用 Get-Content 查看）
3. 剩余风险点说明。
4. 主游戏 `index.html` headless 冒烟无 `Uncaught`。

## 效果判据（总指挥验证用）
- file:// 运行：顶部常驻 HP/MP/金币/楼层/击杀进度，数值随战斗扣血、拾取金币、换层实时变化。
- 验证页输出 PASS JSON；主游戏冒烟无报错；S3-1 迷雾回归正常。
