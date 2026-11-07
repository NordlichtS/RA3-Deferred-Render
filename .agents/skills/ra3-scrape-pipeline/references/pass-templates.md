# Pass 模板（可直接复制的 SCRAPEO 骨架）

> **状态**：§1 的四个基础模板全部由原版 `main/ingame.scrapeo` 已运行的写法拼成（`✅` 语法）。§2 的 G-Buffer / 合成模板 **`❓未实机测试`**——语法只用 RA3 已知命令，但 MRT 槽 1..3 与 `setshaderoverride` 在任何可运行 RA3 脚本中都没出现过。
> 规则：所有模板按**已预处理的 `.scrapeo`** 写（无宏、字面数字）。粘贴后运行 `node .agents/skills/ra3-scrape-pipeline/scripts/check_scrape.js main/ingame.scrapeo`。（§1.1、§1.2、§1.6、§2.1–§2.4 已拼接到原版副本中通过检查器：0 warning——仅证明结构/行长合法，不代表实机可用。）
> 资源名、SCOPE 名（`Deferred.*`）、technique 名（`_GBuffer`、`Directional`）为**建议命名**，需与 B2 的 HLSL 一致。

## 1. 基础模板（原版写法）

### 1.1 场景几何 Pass（离屏单 RT）
```text
var texture MySceneTex $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A8R8G8B8

proc renderMyScenePass
	beginevent MyScenePass
	setdepth DepthBuffer
	settarget 0 MySceneTex
	setclearcolor 0 0 0 1
	setcleardepth 1.0
	clear
	setcamera Viewer
	visibleobjects Frame
	renderTerrain
	renderbin Solid
	callproc setFrameRenderTarget
	callproc setFrameDepthBuffer
	endevent MyScenePass
endproc
```
- 依据：`updateDepthMapReally` L678–L720、`updateWaterReflection` L768–L776。先 `setdepth` 后 `settarget`：视口取最后设置者尺寸（`📄 readonly/SCRAPE-RA3/WaterReflection.scrapeh#L33`）。
- 若在主帧内部调用，`clear` 会清掉主帧共用的 `DepthBuffer`——要么放在主帧 clear 之前，要么换独立深度。

### 1.2 全屏 Quad Pass
```text
var shader MyPostShader MyPost.fx
var texture MyDstTex $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A8R8G8B8

proc renderMyQuadPass
	beginevent MyQuadPass
	setdepth NULL
	settarget 0 MyDstTex
	settexture PostEffect FrameBufferTexture PostEffectFrameBufferTexture
	setshader MyPostShader Default
	renderquad
	callproc setFrameRenderTarget
	callproc setFrameDepthBuffer
	endevent MyQuadPass
endproc
```
- 依据：Bloom L471–L481、OceanDisplacement L907–L925。输入纹理不得等于当前 RT；多级处理用乒乓纹理（Bloom 的 `*0/*1`）。

### 1.3 抓屏 / 拷贝 / MSAA Resolve
```text
callproc copyFrameBufferToTexture
settexture PostEffect FrameBufferTexture PostEffectFrameBufferTexture
```
- `copyFrameBufferToTexture`（L272–L282）自动在 `FrameRenderTarget`/`FrameBuffer` 间二选一；也可直接 `stretchrect <srcSurfaceOrTex> <dstTex>`（L277、L1089 MSAA resolve）。
- 注意：`PostEffectFrameBufferTexture` 被原版复用 4 次，若你要保存一份长期结果，声明自己的纹理。

### 1.4 Cube 逐面渲染（6 次 quad）
```text
setdepth NULL
settarget 0 MyCube 0
setshader MyShader CubeFace0
renderquad
// … 面 1..5 同理
```
- 依据：L1204–L1245；日冕 PBR Irradiance 用同一 technique + `setfloat` 传面方向（日冕 L41–L75）。

### 1.5 全局 Shadow/Depth Override Pass（原版唯一用过的 override 形式）
```text
settarget 0 ShadowMapTexture
setdepth ShadowMapDepthBuffer
shadowMap.beginUpdate
beginShadowOverrideTechnique
setclearcolor 1 1 1 1
setcleardepth 1.0
clear
setcamera ShadowMap
visibleobjects ShadowMap
callproc renderShadowCasters
endShadowOverrideTechnique
shadowMap.endUpdate
```
- 依据：L214–L242。`end*` 会清空**所有** shader 的 override。

### 1.6 自定义开关与首帧/分帧执行
```text
proc configureDeferredFlags
	setbool Deferred IsEnabled true
	if WW3D IsAntiAliasingEnabled
		setbool Deferred IsActive false
	elif Deferred IsEnabled
		setbool Deferred IsActive true
	else
		setbool Deferred IsActive false
	endif
endproc
```
- 依据：原版 `updateFrameRenderTargetToUse` L48–L56 的 if/elif/else 结构；自定义块 `Lanyi.*` 日冕实机可用。只用 `✅` 结构（不用 `ifnot`）。
- 延迟路径强制无 MSAA：AA 开启时回落原版前向（AGENTS.md §1）。

## 2. 延迟渲染模板（`❓未实机测试`）

### 2.1 资源声明（4 路 MRT，全部 32-bit 等位深）
```text
var texture GBuffer0 $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A8R8G8B8
var texture GBuffer1 $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A2R10G10B10
var texture GBuffer2 $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A8R8G8B8
var texture GBuffer3 $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y R32F
var shader DeferredCompositeShader DeferredComposite.fx
```
- 尺寸用 `$PostEffect.FrameBufferSize`：原版 `DepthTexture`（同尺寸 `R32F`）与 `DepthBuffer` 同绑已运行（L632/L684–L686）。
- 通道语义（Albedo/Normal/Material/LinearDepth）由 B2/C 定，此处只保证**等位深**（D3D9 MRT 规则，除非 `D3DPMISCCAPS_MRTINDEPENDENTBITDEPTHS`）。
- 4 张 1080p 32-bit ≈ 31.6 MiB 常驻；声明即占用（不可帧内复用）。

### 2.2 Phase 0：MRT 绑定 + 清屏 + 解绑（最小验证用）
```text
proc renderGBufferClearTest
	beginevent GBufferClearTest
	setdepth DepthBuffer
	settarget 0 GBuffer0
	settarget 1 GBuffer1
	settarget 2 GBuffer2
	settarget 3 GBuffer3
	setclearcolor 0 0 0 0
	setcleardepth 1.0 0
	clear
	settarget 1 NULL
	settarget 2 NULL
	settarget 3 NULL
	endevent GBufferClearTest
endproc
```
- `clear` 对**所有已绑定 RT** 使用同一颜色（D3D9 `Clear` 规则）；约定 `GBuffer3 = 0` 表示"无几何"（天空/无效像素）。若某 RT 需不同清屏值：单独把它绑为唯一 RT 先 `clearcolor`，或用全屏 quad 写清屏值。
- 验证：PIX 中 `GBufferClearTest` 区段应出现 4 个 RT 的 Clear；随后用 1.2 模板把各 RT 画到屏幕观察。

### 2.3 Phase 1：G-Buffer 几何 Pass（替换原版 L1410–L1453）
```text
proc renderGBuffer
	beginevent RenderGBuffer
	setdepth DepthBuffer
	settarget 0 GBuffer0
	settarget 1 GBuffer1
	settarget 2 GBuffer2
	settarget 3 GBuffer3
	setclearcolor 0 0 0 0
	setcleardepth 1.0 0
	clear
	setcamera Viewer
	visibleobjects Frame
	if Sas ShadowMappingEnabled
		settexture Sas Shadow[0].ShadowMap ShadowMapTexture
	endif
	setshaderoverride TerrainShader _GBuffer
	setshaderoverride ObjectsShader _GBuffer
	renderTerrain
	renderRoads
	renderbin TerrainLikeGroundObject
	renderScorchMarks
	renderTerrainTracks
	renderbin Bridge
	renderProps
	renderUnits
	renderbin Solid
	renderStructures
	renderbin StaticSort5
	clearshaderoverride TerrainShader
	clearshaderoverride ObjectsShader
	settarget 1 NULL
	settarget 2 NULL
	settarget 3 NULL
	settexture WW3D DepthTexture GBuffer3
	endevent RenderGBuffer
endproc
```
**未决点（必须实测，见 [pitfalls.md §5](pitfalls.md)）**
1. `setshaderoverride <X>` 的 `<X>` 如何指向场景材质 shader：候选是在顶层 `var shader TerrainShader Terrain.fx` / `var shader ObjectsShader Objects.fx` 并期望与材质共享同一运行时对象 ❓。每个参与的 shader 家族都要单独一行 set/clear。
2. 未适配（无 `_GBuffer`）的材质会以前向 technique 写进 RT0 并污染 G-Buffer——要么全部适配，要么把它们留到合成后的前向补画阶段。
3. `renderScorchMarks`/`renderTerrainTracks` 是否属于不透明（可能是混合贴花）待定；若为 alpha 混合，应移出 G-Buffer 段放到合成之后。
4. `StaticSort5` 原版注释为水下排序层，是否应进 G-Buffer 待定。
5. 不要包含 `renderbin Transparent` / `renderTransparentOutlineObjects`（原版 `renderDepthCasters` 有，G-Buffer 不能抄）。
6. `settexture WW3D DepthTexture GBuffer3` 要求 RT3 编码与原版 `DepthTextureLinear`（相机空间线性 z）完全一致，水下与软粒子才可直接复用；此时可删去 L1405 `callproc updateDepthMap`（但 `DepthTexture`/`DepthTextureLinear` 声明仍占显存，确认无用后再删）。

**备选方案（无需 `setshaderoverride`）**：复用全局 `beginDepthOverrideTechnique`/`endDepthOverrideTechnique` 包住几何提交，并把各 FX 的 `_CreateDepthMap` technique 改写为 MRT G-Buffer 输出。代价：只有 `_CreateShadowMap` 的 shader 会回退到阴影 technique 写错数据；原版 `updateDepthMap` 必须删除。`🔍❓`

### 2.4 Phase 2：延迟合成全屏 Pass（紧接 2.3）
```text
proc renderDeferredComposite
	beginevent DeferredComposite
	callproc setFrameDepthBuffer
	callproc setFrameRenderTarget
	settexture Deferred GBuffer0 GBuffer0
	settexture Deferred GBuffer1 GBuffer1
	settexture Deferred GBuffer2 GBuffer2
	settexture Deferred GBuffer3 GBuffer3
	setshader DeferredCompositeShader Directional
	renderquad
	endevent DeferredComposite
endproc
```
- RT0 = 原版主帧目标（`FrameRenderTarget` 或 `FrameBuffer`），深度 = `DepthBuffer`（AA 已被 1.6 排除）。**不 clear**：保留 G-Buffer 阶段写入的 Z 与 Stencil 给水面/透明/描边/软粒子测试使用；合成 shader 必须覆盖每个像素（含天空：`GBuffer3==0` 输出背景色/雾色），否则残留上一帧画面。
- 合成 technique 应 `ZEnable=false`、`ZWriteEnable=false`（由 B2 实现）。
- 阴影图、环境 Cube 已由原版绑定到 `Sas.Shadow[0].ShadowMap`、`Objects.LightSpaceEnvironmentMap`，HLSL 直接按原 SAS 地址读取即可。

### 2.5 局部光体积（Phase 2 后半）
```text
	renderbin StaticSort_END
```
- 放在 2.4 之后、`callproc updateWaterRefraction` 之前；光体积 FX 声明 `string RenderBin = "StaticSort_END";`。`StaticSort_END`（编号 41）在 RA3 全部 129 个官方源码与原版/日冕脚本中均未使用。`🔍❓`

### 2.6 拼装进 `proc InGame`（功能开关保留原版路径）
```text
	callproc configureDeferredFlags
	// …原版 L1388–L1403 不变…
	ifnot Deferred IsActive
		callproc updateDepthMap
	endif
	beginevent UpdateFrameBuffer
	if Deferred IsActive
		callproc renderGBuffer
		callproc renderDeferredComposite
		renderbin StaticSort_END
	else
		callproc setFrameRenderTarget
		callproc setFrameDepthBuffer
		setcamera Viewer
		visibleobjects Frame
		setclearcolor 0 0 0 1
		setcleardepth 1.0
		clear
		// …原版 L1426–L1453 不透明段原样…
	endif
	// …原版 L1457–L1513 共用后半段（含 endevent UpdateFrameBuffer）…
```
- `beginevent UpdateFrameBuffer` 放在 `if` 之外，保证 `beginevent/endevent` 词法嵌套正确（检查器按词法栈校验）。
- `ifnot` 只有帮助文本证据（`🔍`）；若想只用 `✅` 结构，改写为 `if Deferred IsActive` + 空分支 `else` + `callproc updateDepthMap` + `endif`（空 `if` 分支在原版 L824–L826 的 `else` 空分支已证明可行）。
- 两条分支结束时状态必须一致：RT0=主帧目标、Depth=`DepthBuffer`、Camera=`Viewer`、可见集=`Frame`、RT1..3=NULL。
