# 官方 RA3 1.12 不透明材质家族清单（G-Buffer 迁移视角）

> **来源**：`D:\PROJECTS\SAGE shader source\RA3_Shaders`（EA 官方源码，📄源码确认，用 `Select-String` 批量盘点）。下文 `[src: X#Ly]` 中 X 省略前缀 `D:/PROJECTS/SAGE shader source/RA3_Shaders/`。
> **用途**：决定"哪些 `.fxo` 要加 G-Buffer technique、按什么顺序、各自坑在哪里"。官方源码**不可直接用 `main\fxc.exe` 编译**（见 [fxc-workflow.md §3](fxc-workflow.md)），本项目实际替换物是 FXFXH 架构下的同名 `.fx`（见 [fxfxh-architecture.md](fxfxh-architecture.md)）。

## 1. 四个核心头与其 technique 骨架

| 核心 | 被谁 include | technique（行号） | Profile | 蒙皮上限 | 表达式求值器 | 关键开关 |
|---|---|---|---|---|---|---|
| `Objects.fxh` | 所有 `Objects*.fx`、`Buildings*.fx`、`NormalMapped.fx` | `Default`@L1070、`Default_M`@L1641、`Default_L`@L2000、`_CreateShadowMap` 或 `_CreateDepthMap`@L2204-2207 | H/M=`vs_3_0/ps_3_0`，L 与阴影=`vs_2_0/ps_2_0` | 1 骨（`MaxSkinningBonesPerVertex 1`@L121；`min(NumJointsPerVertex,1)`） | `"Objects"`；定义 `SUPPORT_DAMAGETEXTURE` 时名为 `"Buildings"` 但 pass 不挂注解（L112-116、L1073） | `SUPPORT_RECOLORING/SPECMAP/DAMAGETEXTURE/LIGHTMAP/JAPANBUILDUP/FROZEN/TESLA/ALTMAPPING/IRONCURTAIN/CHRONORIFT/FORMATIONPREVIEW/TREAD_SCROLLING/SSAO` |
| `BasicW3D.fxh` | `BasicW3D*.fx`、`Infantry*.fx`、`Tree.fx` | `Default`@L829、`_Default_M`@L1062、`_Default_L`@L1115、`_CreateShadowMap`/`_CreateDepthMap`@L1276-1281（`SUPPORT_HOLOGRAPHIC` 时无） | H=`vs_3_0/ps_3_0`，M/L/阴影=2_0 | 2 骨（L69） | `"BasicW3D"`、`"BasicW3D_CreateShadowMap"` | 材质参数 `int BlendMode`：`0 Opaque / 1 Alpha / 2 Additive`（L191-195） |
| `DefaultW3D.fxh` | `DefaultW3D.fx`、`DefaultW3DNoFogNoCloud.fx` | `Default`@L850、`_Default_M`@L1039、`_Default_L`@L1084、`_CreateShadowMap`@L1246 | 同上 | 2 骨（L66） | `"DefaultW3D"`、`"DefaultW3D_CreateShadowMap"` | `BlendMode`（L182-186） |
| `Terrain.fx`（独立） | `renderTerrain` 命令 | `TerrainTile`@L915、`Cliff`@L977、`Road`@L1032、`Scorch`@L1087 及其 `_M`/`_L`；`_CreateShadowMap`@L1845、`_CreateDepthMap`@L1872 | H=3_0，M/L/阴影=2_0 | 无（地形顶点流） | 无 | `TerrainTile` 不透明写深；`Cliff/Road/Scorch` 为 **`AlphaBlendEnable=true, ZWriteEnable=false` 的叠加层**（L998-1004 等） |

独立单文件：`ObjectsTerrain.fx`（`Default`@L409、`Default_M`@L574、`Default_L`@L673、`_CreateShadowMap`@L750；`RenderBin = "TerrainLikeGroundObject"`@L33；1 骨；三档 LOD 均 `AlphaTestEnable = true`）、`TreeSway.fx`（`Default`@L399、`Default_M`@L466、`_CreateShadowMap`@L563；全部 2_0；1 骨；`CullMode = none`；`AlphaTestEnable = true`）。

## 2. 逐文件清单（不透明 / 可能进 G-Buffer 的 wrapper）

图例 —— 迁移优先级：**P1** 主路径必须（Phase 1）；**P2** 次要、可后补；**P3** 多 pass 特效材质，仅基础 pass 进 G-Buffer；**X** 保持前向（半透明/加色/特效）。
"AlphaClip" 列：`param` = 材质参数 `AlphaTestEnable`（前向用固定管线 AlphaTest，阴影 PS 用 `clip`）；`forced` = 恒开；`mask` = 额外 `clip(Mask…)`。

| 文件 | 家族 | wrapper 宏 | 蒙皮 | AlphaClip | RenderBin 注解 | 阴影/深度 technique | 优先级 / 迁移要点 |
|---|---|---|---|---|---|---|---|
| `ObjectsGeneric.fx` | Objects | SPECMAP SSAO | 0/1 | param | 无（引擎按物体类型分 bin ❓） | `_CreateShadowMap` | **P1** 中立单位/道具基线 |
| `ObjectsAllied.fx` `ObjectsSoviet.fx` `ObjectsJapan.fx` | Objects | RECOLORING SPECMAP SSAO MATERIAL_PARAMS_* | 0/1 | param | 无 | `_CreateShadowMap` | **P1** 阵营单位（`renderUnits`→`UnitPlayer0..19`）；阵营色在 G-Buffer 阶段烘进 albedo |
| `ObjectsAlliedTread.fx` | Objects | + TREAD_SCROLLING | 0/1 | param | 无 | `_CreateShadowMap` | **P1** VS 中按骨骼透明度滚动 UV（L604），G-Buffer VS 必须复刻 |
| `BuildingsGeneric.fx` `BuildingsAllied.fx` `BuildingsSoviet.fx` `BuildingsJapan.fx` | Objects | SPECMAP **DAMAGETEXTURE** (+RECOLORING) SSAO | 0/1 | **forced**（`const bool AlphaTestEnable = true`@L410；Default pass `AlphaTestEnable = true`@L1112） | 无 | `_CreateShadowMap`（PS 中 `clip`@L2143，注释"Simulate alpha testing for floating point render target"） | **P1** 建筑（`renderStructures`→`Structure`）。损伤图走 `TEXCOORD1`；G-Buffer PS 必须 `clip` |
| `BuildingsGenericDamageFill.fx` | Objects | + FILLDAMAGETEXTURE | 0/1 | forced | 无 | `_CreateShadowMap` | P2 |
| `BuildingsJapanBuildup.fx` | Objects | + JAPANBUILDUP | 0/1 | mask（`clip(Mask - 0x60/255)`@L954；贴图 `WW3D.FXJapanBuildMask`@L168） | 无 | `_CreateShadowMap`（含 mask clip @L2124） | P2 建造动画 |
| `ObjectsGenericLightmap.fx` | Objects | SPECMAP **LIGHTMAP** | 0/1 | param | 无 | `_CreateShadowMap` | P2 光照图走 `TEXCOORD1`；延迟下需决定是否作为烘焙 AO/irradiance 写入 G-Buffer |
| `ObjectsRoads.fx` | Objects | SPECMAP SSAO | 0/1 | param | 无 | `_CreateShadowMap` | P2（FXFXH 版把它改为 `TerrainLikeGroundObject`） |
| `NormalMapped.fx` | Objects | （无） | 0/1 | param | 无 | `_CreateShadowMap` | P2 |
| `ObjectsTesla.fx` | Objects | TESLA SPECMAP RECOLORING | 0/1 | param | 无 | `_CreateShadowMap` | P3 第二 pass `TESLAPASS` 加色（L1152-1173）留前向 |
| `ObjectsFrozen.fx` `ObjectsFactionFrozen.fx` `BuildingsGenericFrozen.fx` `BuildingsFactionFrozen.fx` | Objects | FROZEN … | 0/1 | param/forced | 无 | `_CreateShadowMap` | P3 第二 pass `FROZENPASS`（L1124-1145）留前向 |
| `ObjectsIronCurtain.fx` | Objects | ALTMAPPING IRONCURTAIN | 0/1 | — | 无 | `_CreateShadowMap` | X 特效覆盖材质 |
| `ObjectsChronoRift.fx` | Objects | ALTMAPPING CHRONORIFT | 0/1 | — | 无 | **`_CreateDepthMap`**（不投影但写深度） | X 加色混合（`SrcBlend=One, DestBlend=One`@L1096-1099） |
| `ObjectsFormationPreview.fx` | Objects | ALTMAPPING FORMATIONPREVIEW | 0/1 | — | **`StaticSort1`**（L45-46） | **`_CreateDepthMap`** | X 编队预览 |
| `ObjectsTerrain.fx` | 独立 | SSAO SPECMAP | 0/1 | forced（三档 `AlphaTestEnable = true`；阴影 PS `clip`@L742） | **`TerrainLikeGroundObject`** | `_CreateShadowMap` | **P1** 悬崖墙等贴地物（Phase 1 `TerrainLikeGroundObject`） |
| `Terrain.fx` | 独立 | SSAO | — | — | （由 `renderTerrain` 驱动） | `_CreateShadowMap` + `_CreateDepthMap` | **P1** 仅 `TerrainTile*` 是不透明写深 pass；`Cliff/Road/Scorch` 是混合叠加层 → MRT 混合问题见 §3 |
| `BasicW3D.fx` | BasicW3D | SSAO | 0/1/2 | param | 无 | `_CreateShadowMap` | **P1（仅 `BlendMode == Opaque` 的实例）**；Alpha/Additive 实例必须留前向 |
| `Infantry.fx` | BasicW3D | RECOLORING SSAO | 0/1/**2** | param | 无 | `_CreateShadowMap` | **P1** 步兵软绑定（2 骨，`POSITION0/1` 双位置流） |
| `Tree.fx` | BasicW3D | （无） | 0/1/2 | param | 无 | `_CreateShadowMap` | P2 植被镂空，`clip` |
| `BasicW3DSupportHDR.fx` | BasicW3D | SSAO HDR | 0/1/2 | param | 无 | `_CreateShadowMap` | P2 |
| `InfantryFrozen.fx` | BasicW3D | FROZEN SPECMAP | 0/1/2 | — | 无 | `_CreateShadowMap` | P3 |
| `InfantryChronoRift.fx` `InfantryFormationPreview.fx` | BasicW3D | CHRONORIFT / FORMATIONPREVIEW | 0/1/2 | — | 无 | `_CreateDepthMap` | X |
| `InfantryRadiation.fx` `BasicW3DHolographic.fx` | BasicW3D | RADIATION / HOLOGRAPHIC | — | — | 无 | Holographic 无阴影 technique | X |
| `DefaultW3D.fx` `DefaultW3DNoFogNoCloud.fx` | DefaultW3D | CLOUDS FOG SSAO (+CAST_SHADOWS) | 0/1/2 | param | 无 | `_CreateShadowMap` | P2（同 BasicW3D 的 BlendMode 规则） |
| `TreeSway.fx` | 独立 | — | 0/1 | forced（`clip`@L534） | 无 | `_CreateShadowMap` | P2 草/摆动树；VS 摆动必须复刻；`CullMode = none` 双面 |
| `TerrainTracks.fx` `Decal.fx` | 贴花 | — | — | — | — | 无 | X → Phase 3 `renderDecals` |
| 其他（`GpuParticle*`、`Ocean*`、`RiverWater`、`Laser*`、`PostFX_*`…） | — | — | — | — | `Distorter`/`Underwater`/`OceanDisplacement` 等 | 部分粒子有 `_CreateShadowMap` | X |

**官方 `RenderBin` 注解全集**（`Select-String 'RenderBin'` 全目录）📄：`Distorter`（`DistortingObject.fx#L14`、`GPUParticleDistortion.fx#L15`）、`OceanDisplacement`（`GPUParticleOceanDisplacement.fx#L15`）、`Underwater`（`GpuParticleUnderwater.fx#L20`）、`TerrainLikeGroundObject`（`ObjectsTerrain.fx#L33`）、`StaticSort1`（`Objects.fxh#L46`，仅 FormationPreview）。**其余不透明材质都不写 `RenderBin`**，所在 bin 由引擎按对象类型决定（单位→`UnitPlayerN`、建筑→`Structure` 等）🔍IDA静态推测 / ❓待实测。注解位置固定在 `int _SasGlobal : SasGlobal < … >` 的注解块内。

## 3. 迁移时必须处理的家族级差异

1. **蒙皮路径数**：Objects/ObjectsTerrain/TreeSway = 2 路（0/1 骨）；BasicW3D/DefaultW3D = 3 路（0/1/2 骨）。G-Buffer technique 的 VS 必须是同样长度的 shader array，下标 `min(NumJointsPerVertex, N)` 📄。
2. **Alpha 镂空**：MRT 下禁用固定管线 AlphaTest（AGENTS.md §3.1-3），统一 `clip(alpha - 0x60/255.0)`（`DEFAULT_ALPHATEST_THRESHOLD = 0x60`@`Common.fxh#L180`）；按 `AlphaTestEnable` 选 PS 数组项（官方阴影 technique 的做法）📄。
3. **BlendMode / OpacityOverride**：BasicW3D/DefaultW3D 的 `BlendMode != Opaque` 或 `OpacityOverride < 0.99` 时前向是混合绘制。G-Buffer technique 无法按材质参数"跳过绘制"，只能：(a) PS `clip(-1)` 丢弃（需把 `BlendMode` 作为 PS 数组下标），或 (b) 由 SCRAPE 层面分 bin 处理 ❓待实测选型。
4. **地形叠加层**：`Cliff/Road/Scorch` 是 `SrcAlpha/InvSrcAlpha` 混合、不写深度的多层叠加。D3D9 MRT 下混合状态对所有 RT 相同（需 `D3DPMISCCAPS_MRTPOSTPIXELSHADERBLENDING`），且必须用 `ColorWriteEnable1..3` 屏蔽深度 RT（需 `D3DPMISCCAPS_INDEPENDENTWRITEMASKS`）❓待实测 —— 这是地形 G-Buffer 的头号风险。
5. **多 pass 特效材质**（Frozen/Tesla）：G-Buffer 只接管 pass 0；特效 pass 保持前向并在光照合成后绘制 ❓待计划确认。
6. **`_CreateDepthMap` 已有语义**：ChronoRift/FormationPreview 用它表达"不投影但写深度"。若走"复用 `_CreateDepthMap` 作 G-Buffer"路线，需要保持这些 X 类材质的行为（例如让它们的 `_CreateDepthMap` 只写深度 RT 或 `clip(-1)`）。

## 4. 推荐迁移顺序（供计划阶段参考）
`ObjectsGeneric` → 阵营 `Objects{Allied,Soviet,Japan}` + `ObjectsAlliedTread` → `Buildings{Generic,Allied,Soviet,Japan}` → `ObjectsTerrain` → `Infantry`/`BasicW3D(Opaque)` → `Terrain.fx TerrainTile` → 其余 P2 → P3 基础 pass。
理由：先验证 1 骨刚体/硬绑定最简单路径，再加强制 clip（建筑），最后处理 2 骨软绑定与地形独立顶点格式。
