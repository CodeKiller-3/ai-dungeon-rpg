# D-01b D-01 收口补丁（纯文档 + 验证产物入库）

- 卡片编号：D-01b
- 依据：D-01（cf153e4）交付后接轨审计，2026-11-09
- 目标：消除 README 内部口径冲突、修正基线备注与增量表述，并把刷新过的验证产物入库，清空工作区。

## 改动范围（4 处，均为 md + 2 个既有的 result json）

| 文件 | 改什么 |
|---|---|
| `README.md` | 功能列表行「Q-learning 寻宝鼠，实时训练 AI 学会在迷宫中找到金币」改为「Q-learning 寻宝鼠，实时训练演示：成功率随地图与训练轮次波动，实测口径见下方 AI 亮点说明表」；不新增数字，数字只保留在 AI 亮点表一处 |
| `规划-对标补齐.md` | §八 备注改为「基线随卡更新，最后一次刷新（2026-11-09，D-01，代码基线 b754ce0 / 文档刷新 cf153e4）」 |
| `对标自检报告.md` | §九 精灵行改为「精灵注册 194 → 197（S-02a 补 barrel / torch / vine）→ 198（S-05 增 room_chest）」，其余不动 |
| `preflight/selfcheck/regression-result.json`、`selfcheck-result.json` | 直接提交当前刷新版（39/39 与 32/1/0），目的：清掉工作区 M 状态，让验证物证入库 |

## 不许动
- 不改 js / png / 其他 preflight 文件。
- 不改报告 §一~§八 任何历史数字。
- 不改 S-04 / S-05 / D-01 已定口径。
- 不在 README 里再添第二个成功率数字。

## 断言
| 编号 | 断言 |
|---|---|
| B1 | README 全文只出现一组成功率数字（2%~26%、中位数 9%），「学会找金币」不再出现 |
| B2 | 规划 §八 备注同时含 b754ce0 与 cf153e4 |
| B3 | 报告 §九 精灵行含 197 与 198 两个中间值 |
| B4 | 提交包含 `preflight/selfcheck/regression-result.json` 与 `selfcheck-result.json` 两个 json |
| B5 | 提交后 `git status --porcelain` 为空 |
| B6 | 静态自检仍 32/1/0（XC-01 会校验 README 数字），回归仍 39/39 |

## 完成定义
- [ ] B1~B6 全过
- [ ] 一个 commit `D-01b 文档收口补丁`
- [ ] 推送后核验线上 README 那句已改（用 pages 域名，不用 raw）
