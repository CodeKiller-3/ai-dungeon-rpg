# S-02c 版本收口（提交 + 推送 + 线上核验）

- 卡号：S-02c
- 前置：S-02a（`9c36b86`）、S-02b 已提交
- 目标：工作区不留未提交的功能改动；线上 Pages 与本地一致，避免出现"本地改了、线上是旧版"的双版本。

## 收口范围

1. 既有功能改动：`PLAN.md`、`README.md`、`docs/答辩讲稿.md`、`js/data/items.js`、`js/systems/modal.js`、`js/systems/shop.js`、`preflight/verify_p2_2.html`、删除 `assets/sprites/atlas_walls.png`。
2. 自检套件：`preflight/selfcheck/`（selfcheck.js / run-all.ps1 / 结果 JSON / 截图）、`preflight/verify_selfcheck.html`、`preflight/verify_smoke.html`、`preflight/verify_s01_shop.html`。
3. 报告与规划：`对标自检报告.md`、`规划-对标补齐.md`。

## 不纳入提交

- `自检报告.md`：第一轮产物，口径已被 `对标自检报告.md` 取代，保留在工作区不提交（避免线上出现两个互相矛盾的结论）。
- `.screenshots/`、`preflight/shots_resize/`：本地临时截图目录。

## 验收

- `git status` 只剩上述"不纳入"项。
- push 后 `gh api` 的 Pages 构建状态为 `built`。
- 线上 `index.html` 含 `js/data/reactions.js`（S-02b 生效的可核验证据）。
- 线上 `assets/sprites/barrel.png`、`torch.png`、`vine.png` 返回 200。

## 风险

- 进 Pages 构建队列需要时间，推送后不能立即判定；必须以构建状态而非"push 成功"作为完成依据。
- 工作区仍有临时目录，`git status` 不会全空；这是有意保留，不是遗漏。

## 七、落地口径

- `dbb37a4` 时点遗留的 9 个未提交改动，已在 `a3dc688` 一并入库（同 commit 还包含自检套件与 S-02b 接线）。
- 推送后 Pages 构建状态为 built，线上与本地为同一版本；完成依据是构建状态，不是 push 成功。
- 此后固定「一卡一 commit」：每张卡的改动单独提交，不再把多轮改动累积在工作区。
