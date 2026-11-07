# RenderBin 队列字典（RA3 1.12 PC）

> **规则**：脚本中一律用**字符串名**（区分大小写）。名称→编号由引擎 `0x401EE0` 的固定 47 项有序表（`strcmp` 二分查找）解析，编号直接作为固定 47 槽数组索引；**不能新增名字**，未知名（如 `geobuffer`）→ `0 = NONE`，`NONE` 不入队，因此 `renderbin geobuffer` 什么也不画。`🔍` [src: readonly/llm-analysis/问题5_RenderBin是否支持自定义与GeoBuffer专用队列.md#L86-L145]
> 置信度：✅已实机验证 / 📄源码确认 / 🔍IDA静态推测 / ❓待实测。行号默认指 `main/ingame.scrapeo`。"FX 注解" = 某 `.fx` 的 `_SasGlobal` 中 `string RenderBin = "…";`（扫描 `D:\PROJECTS\SAGE shader source\RA3_Shaders` 全部 129 个文件）。

## 1. 机制

| 事实 | 置信度 |
|---|---|
| `renderbin <Bin>` / `renderbin <Bin> 0` 提交该 bin 的普通可见对象；`renderbin <Bin> 1` 改由粒子系统绘制属于该 bin 的粒子；第 3 参数保留未用 | ✅（L361/L363 用法）🔍（语义）|
| bin 内容由当前 `visibleobjects` 可见集决定；不按 shader 再筛选 | 🔍 |
| 物体进入哪个 bin：FX 注解 `RenderBin`（整个 FX，而非某 technique），缺省 0；模型 `StaticSortLevel 1..5` 会强制覆盖为 `StaticSort1..5`（`bin = level + 35`）| 🔍 |
| 地形、道路、水、贴花、粒子、UI 等走**专用回调**（`renderTerrain` 等），不是 bin | ✅ |
| `renderUnits`/`renderStructures` 是回调，官方注释说明内部包含 `UnitPlayer0..19` / `Structure`；是否也提交各 `*Outline*` bin 与写描边 Stencil 未证实 | 📄（`readonly/SCRAPE-RA3/InGame.scrape#L86,L91`）❓ |

## 2. 47 项完整表

| 编号 | 名称 | FX 注解来源 | 原版显式 `renderbin` 位置 | 隐式提交者 / 备注 | 延迟改造用途 |
|---:|---|---|---|---|---|
| 0 | `NONE` | — | — | 未知名的回退值；不入队 | — |
| 1 | `Solid` | 无（官方 FX 均未注解；"普通未分类物体"如何落入此 bin 由引擎/模型逻辑决定 ❓）| L198 Shadow · L665 Depth · L795 Refl · **L1449 主帧** · L1562 Editor | — | G-Buffer |
| 2 | `Transparent` | — | L209 · L674 · L809 · **L1473** · L1580 | — | 合成后前向 |
| 3 | `TransparentOutlineHoverAttack` | — | — | 推测 `renderTransparentOutlineObjects`（L1475）🔍 | 前向 |
| 4 | `TransparentOutlineHoverSelect` | — | — | 同上 🔍 | 前向 |
| 5 | `TransparentOutlineSelected` | — | — | 同上 🔍 | 前向 |
| 6 | `Structure` | — | L202 · L668 · L801 | 主帧由 `renderStructures`（L1451）📄 | G-Buffer |
| 7 | `StructureOutlineHoverAttack` | — | L110（`renderBinsStructureOutline`，用于 L203/L669/L802）| 主帧：`renderStructures`？❓ | G-Buffer（需保留 Stencil）|
| 8 | `StructureOutlineHoverSelect` | — | L111 | 同上 | 同上 |
| 9 | `StructureOutlineSelected` | — | L109 | 同上 | 同上 |
| 10–29 | `UnitPlayer0`…`UnitPlayer19` | — | L77–L96（`renderBinsUnit`，用于 L194/L661/L790）| 主帧由 `renderUnits`（L1446）📄 | G-Buffer |
| 30 | `UnitPlayer_END` | — | — | 范围结束标记；**不要借用** | — |
| 31 | `UnitOutlineHoverAttack` | — | L116（`renderBinsUnitOutline`，用于 L195/L662/L791）| 主帧：`renderUnits`？❓ | G-Buffer（需保留 Stencil）|
| 32 | `UnitOutlineHoverSelect` | — | L117 | 同上 | 同上 |
| 33 | `UnitOutlineSelected` | — | L115 | 同上 | 同上 |
| 34 | `Bridge` | — | L187 · L657 · L787 · **L1442** · L1555 | — | G-Buffer |
| 35 | `TerrainLikeGroundObject` | `ObjectsTerrain.fx#L33` | L185 · L656 · L784 · **L1435** · L1550 | 悬崖/海墙/道路段 | G-Buffer |
| 36 | `StaticSort1` | `Objects.fxh#L46`（仅 `SUPPORT_FORMATIONPREVIEW` 编译变体）| L105（`renderBinsStaticSort`，主帧 **L1483**）| 模型 `StaticSortLevel=1` | 前向（排序敏感）|
| 37 | `StaticSort2` | — | L104 | `StaticSortLevel=2` | 前向 |
| 38 | `StaticSort3` | — | L103 | `StaticSortLevel=3` | 前向 |
| 39 | `StaticSort4` | — | L102 | `StaticSortLevel=4`；提交顺序 4→1 | 前向 |
| 40 | `StaticSort5` | — | L207 · L672 · L807 · **L1453** · L1566 | 官方注释"Underwater Sorting"（不透明段末尾）| 待定 ❓ |
| 41 | **`StaticSort_END`** | **无**（129 个官方文件、原版与日冕脚本均未出现，本次 grep 复核）| — | 引擎为其初始化真实队列槽 🔍 | **候选：局部光体积 / 隔离实验专用队列** ❓ |
| 42 | `Distorter` | `DistortingObject.fx#L14`、`GPUParticleDistortion.fx#L15` | L361（0）· L363（1）| 在 `PostEffectDistortion` 内画 UV 偏移场 | 保持 |
| 43 | `Underwater` | `GpuParticleUnderwater.fx#L20` | **L1463**（0）· **L1464**（1）· L1572 Editor | 水下透明物/粒子 | 保持 |
| 44 | `OceanDisplacement` | `GPUParticleOceanDisplacement.fx#L15` | L921（0）· L922（1）| 海浪位移贴图源 | 保持 |
| 45 | `TerrainUIRender` | — | — | 推测由 `renderTerrainUI` 使用；**不要借用** 🔍 | — |
| 46 | `LightSource` | — | — | 引擎内部明确使用编号 46；**不要借用** 🔍 | — |

（FX 注解路径相对 `D:\PROJECTS\SAGE shader source\RA3_Shaders\`。）

## 3. 借用空闲槽的规则

1. 唯一推荐候选：`StaticSort_END`。FX：`string RenderBin = "StaticSort_END";`；SCRAPE：`renderbin StaticSort_END`（光体积放在延迟合成之后、`updateWaterRefraction`（L1468）之前）。`🔍❓`
2. 物体被重新分类后会**离开原 bin**：若仍需投影/反射，须在 `renderShadowCasters`（L177）、`renderDepthCasters`（L653）、`updateWaterReflection`（L760）中补交该 bin。
3. 源码层可写 `#define GeoBuffer StaticSort_END`（仅 `.scrape(h)`；`.scrapeo` 与 FX 运行时看到的仍是 `StaticSort_END`）。
4. 真正新增第 48 个 bin 需要修改可执行文件中的名称表 + 47 槽数组循环，超出本项目范围。
