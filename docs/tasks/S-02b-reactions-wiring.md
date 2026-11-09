# S-02b 离线反应库接线（reactions.js → npc.js）

- 卡号：S-02b
- 前置：S-02a 已提交（`9c36b86`）
- 目标：把磁盘上已存在但未接线的 240 条 L1 反应库真正接入 NPC 对话，消除静态自检 SC-03（孤儿 JS）与 SC-06（数据无消费方）两条 WARN，让守门人的离线回复不再是 5 条固定模板。

## 改动范围

1. `index.html`：data 段 `dialogue.js` 之后加载 `js/data/reactions.js`。
2. `js/systems/npc.js`：
   - `pickTag(text)` 关键词 → tag（kill_boss 先于 kill、low_hp 先于 hurt、shop 先于买卖）。
   - `pickReaction(role, tag)` 取句 + 同 role+tag 的 bag 去重（抽完一轮重置）。
   - `replyFor(text)`：商店场景用 `merchant` 语料，否则 `guard`；无对应 tag 时回落 `Game.Data.NPC.fallback` 关键词表。
   - `ask()` / `doAsk()` 离线与异常路径统一走 `replyFor`。
3. `preflight/verify_selfcheck.html`：加载 reactions.js；`npcUsesReactions` 改为行为断言（返回句是否真的出自库），新增 `p7_bagDedupe`（同 tag 连抽 8 次不重复）。

## 不许动

- 不许改 `reactions.js` 的文案与 tag 结构（内容归内容装配阶段）。
- 不许删 `dialogue.js` 的关键词表：它是兜底，且 5 条旧回复仍要能命中。
- 不许把 `verify_selfcheck` 的既有 12 项断言降级。

## 验收断言

| 断言 | 判据 |
|---|---|
| reactionsLoaded | `Game.Data.REACTIONS` 存在 |
| npcUsesReactions | `NPC.ask('攻略')` 返回句能在库中逐字命中 |
| npcReplyLen | > 0 |
| p7_bagDedupe | 同一 tag 连抽 8 次无重复 |
| SC-03 / SC-06 | 静态自检由 WARN 转 PASS |

## 完成定义

- 运行时自检 13/13 PASS（新增 p7_bagDedupe）
- 静态自检 0 FAIL、WARN 由 3 降至 1（仅剩 QF-01 体积）
- 全量回归 36/36 PASS
- 一个 commit：`S-02b 反应库接线（tag 抽取+bag 去重+场景过滤）`

## 风险

| 风险 | 说明 |
|---|---|
| 关键词粗糙 | 靠正则硬判意图，非关键词句落到 idle；属 L1 规则层预期 |
| 商店场景判定依赖 `Main._scene` | 私有字段；主循环未启动时为空串，按 guard 走 |
| bag 用 Math.random | 不可复现序列；只断言"不重复"，不断言具体句子 |

## 七、落地口径

- `js/data/reactions.js` 实测 240 条：guard 78 + merchant 84 + guide 78。
- tag 结构：10 类基础 tag（greeting / idle / kill / kill_boss / hurt / low_hp / gold / pickup_item / death / victory）；merchant 另含 shop 专属 tag（共 11 类）。
- `js/systems/npc.js` 按 `pickTag` → `pickReaction` 取句，同 role+tag 做 bag 去重；无 Key / 断网 / 请求异常统一降级到 `replyFor()` 的离线规则。
- 静态自检 SC-03 已为「无未加载文件」，DC-07（结构/去重）与 DC-08（tag 语义）覆盖 reactions 接线。
