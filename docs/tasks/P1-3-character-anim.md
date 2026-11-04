# P1-3 角色与怪物动画（玩家骑士 4 帧 ×3 态 + 四怪视觉分化 + 战斗帧）

> 阶段：P1 视觉重做 · 第 3 卡
> 状态：待 Trae 实现
> 素材：32 张已由豆包从 0x72 v1.7 裁入 `assets/sprites/`（knight_m idle/run/hit 各 4 帧、imp idle/run 各 4 帧、tiny_slug 4 帧、big_demon idle/run 各 4 帧）

## 一、背景与目标

P1-1/P1-2 场景与 UI 已贴图化并推送（`9acc4a3`/`0810301`）。当前角色层仍落后：玩家单帧 kni 图、slime/bat 共用 monster_chort 图、Boss 单帧。本卡**给玩家与怪物接入真实动画帧**：玩家骑士 idle/run/hit 三态、史莱姆/蝙蝠/骷髅/龙四怪视觉分化（骷髅已 skelet）、战斗界面 Boss 与玩家帧动画。**不改数值/行为/碰撞，纯渲染层。**

## 二、素材清单（已就位，勿重裁）

| 组 | 文件 | 尺寸 | 用途 |
|---|---|---|---|
| 玩家 | `knight_m_idle_anim_f0~f3`、`knight_m_run_anim_f0~f3`、`knight_m_hit_anim_f0~f3` | 16×28 | 玩家三态动画（hit 供战斗攻击帧用，可选） |
| 史莱姆 | `tiny_slug_anim_f0~f3` | 16×16 | 替换 slime 共用 chort 图 |
| 蝙蝠 | `imp_idle_anim_f0~f3`、`imp_run_anim_f0~f3` | 16×16 | 替换 bat |
| Boss/龙 | `big_demon_idle_anim_f0~f3`、`big_demon_run_anim_f0~f3` | 32×36 | 替换 dragon（地图怪与战斗 Boss） |
| 骷髅 | `skelet_*`（P1-1 已有） | 16×16 | 保持不动 |

## 三、实现要点

1. **sprites.js**：
   - NAMES 追加 32 张（勿删现有）。
   - FRAME_SETS 扩展：`knight_m_idle`/`knight_m_run`/`knight_m_hit` 各 4 帧、`imp_idle`/`imp_run` 各 4 帧、`big_demon_idle`/`big_demon_run` 各 4 帧、`tiny_slug`（4 帧单序列，idle/run 共用）。
   - getFrame 机制保持（P1-1 已实现）。

2. **render.js**：
   - **帧计时**：复用 P1-1 的 `skeletonFrameIndex()` 模式，新增通用 `animIndex(key, fps)`（按真实时间取模，同一帧调用内两次取值一致）。玩家/怪物/Boss 共用。
   - **玩家 drawPlayer**：按移动状态切帧——`Game.Motion` 有插值/移动中 → `knight_m_run`，静止 → `knight_m_idle`；fps≈4。**绘制尺寸适配**：knight_m 16×28 高大于 TILE（23px），按高度适配绘制（高=TILE-2≈21px，宽=round(16×21/28)≈12px，水平居中于格，底部贴格底）；imageSmoothing 保持 false。缺失回退现有 player.png。
   - **怪物 drawMap（埋伏+巡逻两路）**：
     - slime → `tiny_slug` 帧（animIndex 循环）
     - bat → 追击 `imp_run` / 未追击 `imp_idle`
     - skeleton → skelet（现状不动）
     - dragon（若作地图怪出现）→ `big_demon_run`/`big_demon_idle`（32×36 按 TILE 高度缩放绘制，同玩家适配逻辑）
     - 其他怪/未知 → monster_chort 现状兜底
   - **战斗 drawBattle**：玩家侧用 `knight_m_idle` 帧（攻击动作期间切 `knight_m_hit`，若有现成 attack 状态标志）；Boss 侧 dragon 用 `big_demon` 帧动画（idle/run 按战斗阶段或固定 idle）。现有攻击偏移/受击动画保持。
   - 所有替换均走 `Sprites.getFrame` 判空，缺失回退现有图。

3. **不改动**：monsters.js 数值、battle.js 逻辑、Motion 插值、地图生成、碰撞。

## 四、硬性约束

- 原生 JS + Canvas，零构建，file:// 可玩；不引新库。
- Sprites.get/getFrame 签名不变；Game.hud.last/update 契约不变。
- 素材不重裁不改名。
- 动画为视觉增强：任何素材缺失或计时异常不得抛错、不得改变移动/战斗判定。

## 五、完成标准

1. 列出改动文件清单。
2. 新建 `preflight/verify_p1_3.html`（R-01 模板 + 包装 drawImage 记录法），断言：
   - t2_playerFrames：knight_m_idle/run/hit 各 4 帧经 getFrame 非 null 且互异
   - t3_playerDraw：drawPlayer 静止时落笔 `knight_m_idle_anim_f*`，模拟移动（Motion 插值态）落笔 `knight_m_run_anim_f*`
   - t4_monsterMap：构造 slime/bat/dragon 各一格的虚拟地图，drawMap 后记录含 `tiny_slug_anim_f*`/`imp_*_anim_f*`/`big_demon_*_anim_f*`
   - t5_battle：drawBattle 玩家侧含 `knight_m_*`、Boss 侧含 `big_demon_*`
   - t6_fallback：素材清空时全部回退（player.png/chort 或色块），不抛错
   - t7_idem：同参两次绘制序列一致（动画帧按时间变化属预期，固定 animIndex 或冻结时间后比对）
   - 输出 `PASS {"animLoaded":true,"animApi":true,"animOk":true}` + 子断言
3. index.html 冒烟无 `Uncaught/TypeError/ReferenceError`；全量回归全 PASS 或说明受影响原因。
4. 说明剩余风险点。

## 六、验证命令

项目根新建 `preflight/verify_p1_3.html`（R-01：加载顺序同 index.html、IIFE try/catch、title+body 各输出一次 PASS JSON）。Edge file:// 打开看 Console。

## 七、风险点（已知）

- 玩家 16×28 适配 TILE 后水平方向只占 ~12px，比原 chort 图（~TILE 宽）窄，视觉重心变化属预期；若太窄可放宽至 14px（卡内可调）。
- big_demon 32×36 缩到 TILE 内细节会变小；战斗界面中可绘至 2×TILE 尺寸（居中偏下），由实现酌情处理并说明。
- 动画 fps 与移动节流 120ms/插值 160ms 并存，可能出现"滑动中换腿"（与 P1-1 骷髅同类，位置插值优先不阻塞）。
