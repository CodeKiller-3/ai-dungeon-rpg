# M9-1 任务卡：精修像素·地图细节（tile 细节化 + 装饰物数据化）

> 阶段：S4 精修像素期（路线 1，用户 2026-10-28 定稿），PLAN.md §16.6 A-1/A-2 项
> 目标：把"简陋像素"做成"SPD 完成度"——地图出现细节 tile（草丛/水洼/碎骨/苔藓）与装饰物（宝箱/木桶/火把/藤蔓）
> 打磨上限：2-3 遍（判据是 PASS，不是遍数）

## 一、背景

现有地图 `js/data/maps.js` 生成地板/墙两种 tile，纯色块观感简陋。本任务引入**数据驱动的细节层**：同一格 tile 按权重出现细节变体（不影响通行与寻路），并新增独立 **decor 层**（装饰物：不阻挡移动的视觉物件 + 可拾取宝箱）。

## 二、契约（新增数据字段与接口，不改既有行为）

### 2.1 maps.js 数据扩展（保持旧字段兼容）

- 新增 `Game.Data.TILE_DETAILS`：`{ floor: [ {type:'grass'|'puddle'|'bones'|'moss', weight}, ... ], wall: [...], boss: [...] }`——tile 细节候选池。
- 新增 `Game.Data.DECOR`：`{ chest: {name, desc, loot:'gold'|'item'}, barrel, torch, vine }`——装饰物定义。
- `Map.gen(floor)` 输出新增字段（不改变 `Map.getAt` 语义）：
  - `details[x][y]`：该格 tile 细节类型（可空）——**纯视觉**，不影响移动/碰撞/寻路。
  - `decor[x][y]`：装饰物 id（可空）；`decor[x][y]` 所在格**不阻挡移动**；`chest` 在玩家站上或按键交互时可拾取。
- 装饰物权重与层数相关（越深火把越多/宝箱越少），`Map.getFloor()` 语义不变。

### 2.2 新增接口（纯新增）

```
Game.Systems.Map = 原接口 + {
  getDetail: function (x, y) -> string | null,
  getDecor: function (x, y) -> id | null,
  takeDecor: function (x, y) -> bool   // 拾取宝箱，返回是否成功；成功后 decor 置空并 emit 'decor:taken'
};
```

- `chest` 拾取逻辑：调用既有 `Inventory.add` / `Shop` 卖价逻辑（不新增金币字段），emit 新频道 `decor:taken`（纯新增，不改旧频道）。
- 装饰物不参与 FOV 遮挡判定（fov.js 的 isBlocked 保持只看墙）。

### 2.3 渲染（render.js）

- `drawMap` 增加两层：先画细节 tile（草地色块/水洼蓝/碎骨/苔藓，可用半透明叠加或替换色，素材就绪后换贴图），再画 decor 格（宝箱/木桶/火把/藤蔓）。
- 细节与装饰绘制放在迷雾判定之后（FOV 外不画细节/装饰），与怪物隐藏规则一致。
- 火把**本任务只做静态绘制**（M9-2 才加光晕动画）。

## 三、文件范围

| 文件 | 动作 |
|---|---|
| `js/data/maps.js` | 修改：新增 `TILE_DETAILS` / `DECOR` 数据 + `gen` 输出 details/decor 字段 |
| `js/systems/map.js` | 修改：新增 `getDetail/getDecor/takeDecor`；宝箱拾取 emit `decor:taken` |
| `js/core/render.js` | 修改：`drawMap` 画细节 tile + 装饰物（迷雾外不画） |
| `js/core/main.js` | 修改：与装饰物交互的按键/靠近触发（宝箱拾取，可选"站上自动拾取"） |
| `assets/sprites/` | 新增：装饰物与细节素材（优先 kenney/0x72 CC0，见素材通道） |
| `index.html` | 修改：无新增脚本则不加；如新增素材加载器配置则同步 |
| `README.md` | 修改：功能列表补充"地图细节与装饰物" |
| `preflight/verify_m9_1.html` | **新增**：R-01 模板验证页 |

## 四、素材通道（优先级从高到低，失败必须降级不阻塞）

1. 代理（`http://127.0.0.1:31181`）从 GitHub 拉 kenney/0x72 CC0 装饰物与细节贴图 → 放入 `assets/sprites/` 并记录来源。
2. 拉取失败：**程序化绘制兜底**——细节用半透明色叠加（草地 `#3a7d2c` 块、水洼 `#4a7bd0` 块、碎骨 `#cfd2d6` 点、苔藓 `#4f7a3f` 块），装饰物用简单矩形+轮廓（宝箱黄框、木桶棕框、火把橙色火苗三角、藤蔓绿条）。
3. 素材就绪后自动替换程序化绘制（加载器失败静默降级，保持零构建）。

## 五、硬性约束

- 原生 JS + Canvas 零构建；file:// 双击 index.html 可玩；不引入 npm/构建工具/付费资源。
- **不改变**：移动/碰撞/寻路/FOV/战斗逻辑；`Map.getAt` 语义；既有事件频道。
- 细节与装饰纯视觉增量，除非拾取宝箱，不得产生新数值系统（金币走既有 Player.gold）。
- 每格只允许 1 个 decor；宝箱拾取后不可再生（换层重置由 gen 天然处理）。

## 六、完成标准

1. 列出改动文件清单（文件 + 行数概览）。
2. 用下方验证命令跑 `preflight/verify_m9_1.html`，输出必须出现 `mapDetailLoaded:true`、`detailApi:true`、`detailOk:true`。
3. 说明剩余风险点。
4. 实现不了的直接说卡点与尝试，不绕过不改方案。

## 七、验证命令（Start-Process 方案，本机已确认可靠）

```
$env:PATH="C:\Windows\System32;C:\Windows;$env:PATH"
$edge="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$od="$env:TEMP\m91.out.txt"; $ed="$env:TEMP\m91.err.txt"; $pd="$env:TEMP\edgem91"+(Get-Random)
Start-Process -FilePath $edge -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--user-data-dir=$pd","--virtual-time-budget=3500","--dump-dom","file:///D:/桌面/工作/人工智能大作业/preflight/verify_m9_1.html" -Wait -PassThru -RedirectStandardOutput $od -RedirectStandardError $ed | Out-Null
Get-Content $od -Raw
```

验证页要求（加载 eventBus → map → render，与主游戏同序）：
- `gen` 后 details/decor 字段存在，且部分格有细节/装饰（抽样 ≥1 个）；
- `getDetail/getDecor` 返回正确；`takeDecor` 对宝箱成功、对无装饰失败；
- 细节/装饰格 `Map.getAt` 通行语义不变（墙仍是墙、地板仍可走）；
- title/body 各出现一次 `PASS {...}`。

## 八、回归要求

- 主游戏 `index.html` headless 冒烟：无 `Uncaught/TypeError/ReferenceError/SyntaxError`。
- S3-1 / S3-2 / S3-3 / S3-4 验证页复跑 PASS（细节/装饰层与 FOV、HUD、弹窗、战斗反馈共存）。
