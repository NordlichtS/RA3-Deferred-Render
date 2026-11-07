# 原版 `ingame.scrapeo` 帧流程速览（带行号）

> 目的：给改帧顺序/找插入点用的**紧凑索引**。详细的资源生命周期、Shader 数学与 Stencil 位定义请看 [`diagrams/vanilla-pipeline-reference.md`](../../../../diagrams/vanilla-pipeline-reference.md)（唯一事实基准，本文不重复）。行号均指 [`main/ingame.scrapeo`](../../../../main/ingame.scrapeo)（EA 编译产物，1593 行，CRLF）。整份文件 `✅已实机验证`（原版运行脚本）；语义说明来自注释/IDA 的另行标注。

## 1. 文件布局（顶层声明 + 过程）

| 行 | 内容 | 来源头文件 |
|---|---|---|
| L8 | `var camera Viewer` | InGame.scrape |
| L34–L41 | `FrameBuffer color0`、`DepthBuffer depth`、`FrameRenderTarget edram …`、`FrameDepthBuffer edramdepth …` | Common.scrapeh |
| L48–L72 | `updateFrameRenderTargetToUse`、`setFrameRenderTarget`、`setFrameDepthBuffer` | Common |
| L76–L118 | bin 集合 helper：`renderBinsUnit`（UnitPlayer0..19）、`renderBinsStaticSort`（4→1）、`renderBinsStructureOutline`、`renderBinsUnitOutline` | Common |
| L124–L140 | 7 张 FX 资产纹理 + `initCustomTextures` | Common |
| L159–L242 | `ShadowMapTexture R32F`、`ShadowMapDepthBuffer D24S8`、`camera ShadowMap`、`renderShadowCasters`、`updateShadowTexture` | Shadow |
| L259–L282 | `PostEffectFrameBufferTexture`、`copyFrameBufferToTexture` | PostFX |
| L297–L329 | `PostEffectLookupTable`（最终写 `FrameBuffer`）| PostFX_LookupTable |
| L348–L386 | `DistortionOffsetTexture`、`PostEffectDistortion` | PostFX_Distortion |
| L404–L595 | 6 张 Bloom 纹理、`PostEffectBloom` | PostFX_Bloom |
| L601–L613 | `renderPostEffects` = Distortion → Bloom → LookupTable | PostFX |
| L632–L730 | `DepthTexture`/`DepthTextureLinear R32F`、`renderDepthCasters`、`updateDepthMapReally`、`updateDepthMap` | DepthMap |
| L750–L846 | `WaterReflectionTexture 512²`、`camera Reflection`、`updateWaterReflection`、`updateWaterRefraction` | WaterReflection |
| L876–L960 | `OceanDisplacementTexture(2) 1024² A16B16G16R16F`、`camera OceanDisplacement`、`updateOceanDisplacement` | OceanDisplacement |
| L974–L996 | `renderUnderwaterDeferred`（Tint / Caustics 全屏）| UnderwaterDeferred |
| L1023–L1123 | `OutlineTextureFill`、`OutlineRenderTargetFill`、`OutlineTexture`、`renderOutlines` | Outlines |
| L1147–L1373 | 环境 Cube 源/目标（目标格式 `$WW3D.EnvMapRenderTargetTextureFormat`）、`doRotateEnvironmentMap{Water,Objects}`、`doRotateEnvironmentMaps` | RotateEnvironmentMap* |
| **L1386–L1514** | **`proc InGame`** | InGame.scrape |
| L1519–L1593 | `proc Editor`（WorldBuilder，简化版）| InGame.scrape |

## 2. `proc InGame` 逐步（RT/Depth/Camera/可见集/条件）

| # | 行 | 命令 | RT0 / Depth | Camera / 可见集 | 条件 | 备注 |
|---|---|---|---|---|---|---|
| 0.1 | L1388 | `callproc initCustomTextures` | — | — | 每帧 | 绑定 7 张静态纹理 |
| 0.2 | L1390 | `callproc updateFrameRenderTargetToUse` | — | — | 每帧 | 写 `WW3D.IsUsingFrameRenderTarget` |
| 1 | L1398→L214 | `updateShadowTexture` | `ShadowMapTexture` / `ShadowMapDepthBuffer` | `ShadowMap` / `ShadowMap` | `Sas ShadowMappingEnabled` | `shadowMap.beginUpdate` + `beginShadowOverrideTechnique` … `end…` |
| 0.3 | L1400→L1356 | `doRotateEnvironmentMaps` | Cube 面 0..5 / `NULL` | `Viewer` | `WW3D MustRefreshEnvironment`（读后置 false）| 每帧仅 2 行 `settexture`（L1370–L1371）|
| 2 | L1401→L760 | `updateWaterReflection` | `WaterReflectionTexture` / `DepthBuffer`（左上 512²）| `Reflection` / `Reflection` | `Water IsReflectionVisible` | 临时 `ReallyRenderSoftParticles=false`；画不透明+透明+粒子 |
| 3 | L1403→L897 | `updateOceanDisplacement` | `OceanDisplacementTexture(2)` / `NULL` | `OceanDisplacement`（无 visibleobjects）| `Water IsReflectionVisible` | `renderbin OceanDisplacement 0/1` + 3 次 quad |
| 4 | L1405→L723 | `updateDepthMap` | `DepthTexture`→`DepthTextureLinear` / `DepthBuffer` | `Viewer` / `DepthMap` | `Water IsReflectionVisible` **或** `Particle IsSoftParticlesEnabled` | `beginDepthOverrideTechnique`；结果绑 `WW3D.DepthTexture`（L716）|
| 5.0 | L1408–L1422 | `beginevent UpdateFrameBuffer`、`setFrameRenderTarget`、`setFrameDepthBuffer`、`setcamera Viewer`、`visibleobjects Frame`、clear `0 0 0 1` / `1.0` | `FrameRenderTarget`或`FrameBuffer` / `DepthBuffer`或`FrameDepthBuffer` | `Viewer` / `Frame` | — | **延迟改造起点** |
| 5.1 | L1426–L1444 | 绑阴影图；`renderTerrain` `renderRoads` `renderbin TerrainLikeGroundObject` `renderScorchMarks` `renderTerrainTracks` `renderbin Bridge` `renderProps` | 同上 | 同上 | 阴影绑定受 `ShadowMappingEnabled` | 不透明地表 |
| 5.2 | L1446–L1453 | `renderUnits` `renderbin Solid` `renderStructures` `renderbin StaticSort5` | 同上 | 同上 | — | 不透明物体；**延迟改造终点** |
| 6 | L1457–L1466 | `renderUnderwaterDeferred` + `renderbin Underwater 0/1` | 同上 | 同上 | `DebugToggle RenderUnderwater` | 读 `WW3D.DepthTexture` |
| 7 | L1468–L1469 | `updateWaterRefraction`（stretchrect 主帧→`PostEffectFrameBufferTexture`）、`renderWater` | 同上 | 同上 | `Water IsRefractionVisible` | 折射源 = 此刻的主帧 |
| 8 | L1471–L1483 | `renderDecals` `renderbin Transparent` `renderTransparentOutlineObjects` `renderOutlines` `renderBehindBuildingMarkers` `renderBinsStaticSort` | 描边期间临时切到 `OutlineTexture*` 后恢复（L1106–L1107）| — | `DebugToggle RenderOutlines` | 前向半透明/描边 |
| 9 | L1485–L1494 | `ReallyRenderSoftParticles=true`；`renderParticles` `renderTerrainUI` `renderTracers` `renderLasers` `renderConnectionLines` `renderRain` | 同上 | 同上 | `DebugToggle RenderParticles` | 软粒子读 `WW3D.DepthTexture` |
| 10 | L1500→L601 | `renderPostEffects` | Distortion/Bloom 期间切换，LUT 最终 `settarget 0 FrameBuffer` + `setdepth DepthBuffer`（L305–L306）| — | 各 `PostEffect *.IsEnabled` | 结束后 RT0 = `FrameBuffer`（若 LUT 关且非 HDR/AA 则本来就是）|
| 11 | L1502–L1508 | `renderDebugSystems` `renderTileFeedback` `renderIconLayers` `renderUI` `renderDebugDisplays` | `FrameBuffer` | — | — | HUD 不受后处理影响 |

**一帧最多遍历场景几何 4 次**：Shadow（L231）、Reflection（L778–L813）、DepthMap（L702）、主帧（L1430–L1453）。`doRotateEnvironmentMaps` 只画全屏 Quad。

## 3. 关键状态事实（改造时必须保持）

| 事实 | 证据 | 置信度 |
|---|---|---|
| 主帧 RT 由 `IsUsingFrameRenderTarget` 决定（HDR 或 AA 开 → `FrameRenderTarget`）| L48–L64 | ✅ |
| AA 关时主帧深度就是 `DepthBuffer`（`FrameDepthBuffer` 尺寸 0×0 不分配）| L41, L66–L72 | ✅/📄 |
| `DepthBuffer` 每帧被 Reflection（512² 子区）、DepthMap、主帧依次 clear 复用 | L768–L773, L686–L696, L1411–L1422 | ✅ |
| `PostEffectFrameBufferTexture` 被复用 4 次（折射、Distortion、Bloom、LUT 输入），帧末内容跨帧保留 | L836, L356, L469, L303 | ✅ |
| 后处理结束后 RT0=`FrameBuffer`，深度=`DepthBuffer` | L305–L306, L320–L321 | ✅ |
| 透明/描边依赖主帧深度+Stencil（描边 Stencil 由主帧不透明阶段写入）| L1062, L1107, `vanilla-pipeline-reference.md` Step 5.2/8 | 📄/🔍 |
| Shadow/Depth/Reflection casters 用显式 bin helper，主帧用 `renderUnits`/`renderStructures` 回调 | L193–L205 vs L1446–L1451 | ✅ |

## 4. 延迟改造的推荐切点（仅定位，模板见 [pass-templates.md](pass-templates.md)）

1. **G-Buffer Pass**：替换 L1408–L1453 的不透明段（保留 L1408 `beginevent` 外壳）。可同时取消 L1405 `updateDepthMap`（改由 G-Buffer RT 线性深度绑定 `WW3D.DepthTexture`）。
2. **延迟合成 Pass**：紧随 G-Buffer，写回 `setFrameRenderTarget` 目标，深度保持 `DepthBuffer`（**不再 clear**，保留 Z 与 Stencil 给后续前向阶段）。
3. **局部光体积**：合成之后、L1468 `updateWaterRefraction` 之前（这样水下被照亮的地面会进入折射）。
4. L1457 起的水下/水面/透明/粒子/后处理/UI 保持原顺序不动。
5. `proc Editor`（L1519）可保持原版前向，不必改造。

## 5. 与 `diagrams/vanilla-pipeline-reference.md` 的差异（以 `.scrapeo` 原文为准）

| 位置 | reference 写法 | `.scrapeo` 原文 |
|---|---|---|
| §3 Step 0 引言 | `MustRefreshEnvironment` 在 L1242/L1244 | 实际 **L1359/L1360**（L1242 是 `CubeFace5` 区域）|
| §1.3 表 `EnvironmentDestinationCube` | 格式 `$WW3D.FrameRenderTargetTextureFormat` | 实际 **`$WW3D.EnvMapRenderTargetTextureFormat`**（L1154–L1155）|
| §1.2 / distillation-notes §1.4 | `renderUnits` 内部遍历 `UnitPlayer0..19` **及 `UnitOutline*`** | 官方注释只写 UnitPlayer0..19（`InGame.scrape#L86`）；Outline 部分 ❓ |
