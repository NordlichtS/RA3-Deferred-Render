# Phase 2：G-Buffer 资源、特性开关与调试视图

> **阶段目标**：在不改变游戏画面的前提下（D14"影子 G-Buffer"），建立 4 张 G-Buffer 目标、`Deferred.*` 开关逻辑、共享编码头 `GBUFFER.FXH`、每帧清屏，以及能在游戏内查看 G-Buffer 各通道的调试视图。并用"以原版线性深度播种"的合成 G-Buffer 验证世界坐标重建与半像素偏移——在写任何材质代码之前就把数学校准好。
> **前置**：DG-1（P1-T13）已定稿 RT 格式（D3）与尺寸变量（OQ-06）。下文 `<FMT1>` = DG-1 选定的 RT1 格式（`A2R10G10B10` 或 `A8R8G8B8`），`<W> <H>` = DG-1 选定的尺寸常量（默认 `$PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y`）。
> **阶段出口**：P2-T06 USER-RUN 全部通过，P2-T07 回写完成。

---

### P2-T01 共享头 `main/fx/GBUFFER.FXH`（编码/解码/重建工具）
- **执行者**：agent　**规模**：M　**依赖**：P1-T13
- **目标**：把 G-Buffer 布局集中在一个头文件中（Tabula Rasa accessor 模式），所有写入者（材质 G-Buffer PS）与读取者（调试、合成、光体积、SSAO）只通过它访问。
- **前置条件**：D3、D19 已为 ✅ 或 🟡（DG-1 后）。
- **必读上下文**：README D3、D4、D19；`knowledge/deferred-techniques-sm3.md` §2.1、§2.4、§2.5（L63–L131）；`main/COMMON.FXH`（`Select-String 'DEFERRED_RENDER' -Context 0,30`）。
- **步骤**：
  1. 新建 `main/fx/GBUFFER.FXH`，带 include guard `#ifndef RA3DR_GBUFFER_FXH`。文件头注释写明布局表（RT0..RT3 格式与通道）与"任何布局变更只改本文件"。
  2. 常量：`#define RA3DR_VALID_ALPHA (128.0/255.0)`、`#define RA3DR_STENCIL_BIT 128`、材质类别 `#define GB_CLASS_STANDARD 0`、`GB_CLASS_SKIN 1`、`GB_CLASS_UNLIT 2`、`GB_CLASS_FWDTERRAIN 3`（仅 DG-T 选 T-D 时使用）。
  3. 写入侧（任何 PS 可用）：
     ```hlsl
     struct GBufferOut { float4 RT0 : COLOR0; float4 RT1 : COLOR1; float4 RT2 : COLOR2; float4 RT3 : COLOR3; };
     GBufferOut GB_Encode(float3 albedoLinear, float3 normalWS, float roughness, float metalness,
                          float ao, float emissive, float viewZ, float matClass)
     {
         GBufferOut o;
         o.RT0 = float4(sqrt(saturate(albedoLinear)), RA3DR_VALID_ALPHA);
         o.RT1 = float4(normalize(normalWS) * 0.5 + 0.5, matClass / 3.0);
         o.RT2 = float4(saturate(roughness), saturate(metalness), saturate(ao), saturate(emissive));
         o.RT3 = float4(viewZ, 0, 0, 0);
         return o;
     }
     ```
     以及 `float GB_ViewZ(float3 worldPos)`（`mul(float4(worldPos, 1), View).z`，需要 `View`：若未定义 `DEFERRED_RENDER` 则在本头内以 `float4x4 View : View;` 声明——先用 `Select-String` 确认 COMMON.FXH 中的确切声明，避免重复定义）。
  4. 读取侧（仅当 `#define GBUFFER_READ`）：声明 `texture RA3DR_GBufferTex0..3`（`SasBindAddress = "Deferred.GBuffer0".."Deferred.GBuffer3"`）与 `sampler2D`（Point/Point/None/Clamp）；`float2 RA3DR_GBufferSize <SasBindAddress = "Deferred.GBufferSize">`；函数：
     - `float2 GB_ScreenUVFromVPos(float2 vpos)` = `(vpos + 0.5) / RA3DR_GBufferSize`
     - `void GB_Load(float2 uv, out float4 rt0, out float4 rt1, out float4 rt2, out float4 rt3)`（全部 `tex2Dlod(s, float4(uv,0,0))`）
     - `float3 GB_DecodeAlbedo(float4 rt0)` = `rt0.rgb * rt0.rgb`；`float3 GB_DecodeNormal(float4 rt1)` = `normalize(rt1.xyz * 2 - 1)`；`float GB_DecodeClass(float4 rt1)` = `round(rt1.a * 3)`；`float GB_ViewZFromRT3(float4 rt3)` = `rt3.x`；`bool GB_IsDeferredPixel(float4 rt0, float4 rt3)` = `abs(rt0.a - RA3DR_VALID_ALPHA) < 0.1 && rt3.x > 0`；`bool GB_HasGeometry(float4 rt3)` = `rt3.x > 0`。
     - 全屏重建（照抄 `UnderwaterDeferred` 模式，见 `deferred-techniques-sm3.md` §2.5）：`float3 GB_FullscreenRayWS(float2 ndc)`（VS 用：`ProjectionI` → `farVS / farVS.z` → `mul(ray, (float3x3)ViewI)`）与 `float3 GB_WorldPos(float3 rayWS, float viewZ)` = `ViewI[3].xyz + viewZ * rayWS`。
     - 体积重建（光体积用）：`float3 GB_RayFromWorldPos(float3 wp)` = `(wp - eye) / dot(wp - eye, camForwardWS)`，`camForwardWS` 取 `ViewI[2].xyz`（先在报告中说明 RA3 视空间前向轴约定，由 P3-T03 实测确认符号）。
  5. 新建编译测试文件 `main/fx/probe/gbuffer_header_test.fx`：`#define DEFERRED_RENDER`、`#define GBUFFER_READ`、include `COMMON.FXH` 与 `GBUFFER.FXH`，一个 VS + 两个 PS（一个调用 `GB_Encode` 输出 MRT，一个调用全部读取函数输出颜色）与一个 technique。不加入 manifest。
- **产出文件**：`main/fx/GBUFFER.FXH`、`main/fx/probe/gbuffer_header_test.fx`。
- **验证**：
  ```powershell
  & main\fxc.exe /nologo /O2 /T fx_2_0 /D _WW3D_ /I main /I main\fx /Fo "$env:RA3DR_OUT\fxcheck\gbtest.fxo" "main\fx\probe\gbuffer_header_test.fx"
  & main\fxc.exe /nologo /O2 /T ps_3_0 /E PS_ReadTest /D _WW3D_ /I main /I main\fx /Fc "$env:RA3DR_OUT\asm\gbtest_ps.asm" "main\fx\probe\gbuffer_header_test.fx"
  ```
- **验收标准**：①编译通过；②`/Fc` 寄存器表中新 uniform（`RA3DR_GBufferSize` 等）不落在 `c0..c10`、`c89..c127`；③采样器为 `s0..s3` 或其它 ≤ `s15`；④只使用 SM3 语法（无 `mad()`/`rcp()`/`Texture2D`）。
- **失败处理 / 决策映射**：`View`/`ViewI` 重复定义 → 只依赖 COMMON.FXH 的 `DEFERRED_RENDER` 分支，在头文件顶部 `#ifndef DEFERRED_RENDER #error ... #endif` 强制使用者先定义。
- **知识回写**：`.agents/skills/ra3-fx-shader/references/fxfxh-architecture.md` §4 第 2 条把"建议名 `main/GBUFFER.FXH`"改为"已建立 `main/fx/GBUFFER.FXH`（P2-T01）"（遵循 PK-T03）。

---

### P2-T02 G-Buffer 资源声明与 `Deferred.IsActive` 判定
- **执行者**：agent　**规模**：S　**依赖**：P1-T13
- **目标**：在 `main/ingame.scrapeo` 中声明 4 张 G-Buffer 纹理，并在 `configureDeferredFlags` 中实现 D5 的激活判定。
- **前置条件**：`proc configureDeferredFlags` 已存在（P1-T01）。
- **必读上下文**：[`pass-templates.md`](../.agents/skills/ra3-scrape-pipeline/references/pass-templates.md) §1.6、§2.1；README D5；[`language-and-syntax.md`](../.agents/skills/ra3-scrape-pipeline/references/language-and-syntax.md) §6（引擎条件名）。
- **步骤**：
  1. 顶层声明区新增标记块 `P2-T02`：
     ```text
     var texture RA3DR_GBuffer0 <W> <H> A8R8G8B8
     var texture RA3DR_GBuffer1 <W> <H> <FMT1>
     var texture RA3DR_GBuffer2 <W> <H> A8R8G8B8
     var texture RA3DR_GBuffer3 <W> <H> R32F
     ```
  2. 在 `proc configureDeferredFlags` 中，于 `setbool Deferred IsEnabled false` 之后插入标记块 `P2-T02b`：
     ```text
     	setbool Deferred DebugEnabled false
     	setfloat Deferred DebugView 1
     	setbool Deferred IsActive false
     	if Deferred IsEnabled
     		if WW3D IsHdrEnabled
     			if WW3D IsAntiAliasingEnabled
     				setbool Deferred IsActive false
     			else
     				setbool Deferred IsActive true
     			endif
     		endif
     	endif
     ```
     （只用 `if/else/endif` 的已证实结构，不用 `ifnot`；嵌套 `if` 表达 AND。）
  3. 确认 `build.ps1 -Flags "IsEnabled=true,DebugEnabled=true,DebugView=6"` 能覆写这三行（`DebugView` 为 `setfloat`）。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 告警；`build.ps1 -Variant p2t02 -Flags "IsEnabled=true"` 成功，暂存副本中该行已变为 `true`。
- **验收标准**：`IsEnabled=false` 时 `IsActive` 恒为 false；4 个 `var` 名与后续卡一致。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P2-T03 影子 G-Buffer Pass 骨架（每帧清屏 + 纹理绑定）
- **执行者**：agent　**规模**：S　**依赖**：P2-T02
- **目标**：在原版主帧之前插入 `renderGBufferPass`（当前只做 MRT 绑定、清屏、解绑与 SCOPE 绑定），后续 Phase 3 在其中加入几何提交。
- **前置条件**：资源已声明。
- **必读上下文**：[`pass-templates.md`](../.agents/skills/ra3-scrape-pipeline/references/pass-templates.md) §2.2、§2.3；[`pitfalls.md`](../.agents/skills/ra3-scrape-pipeline/references/pitfalls.md) §2；README D14。
- **步骤**：
  1. 在 `proc InGame` 之前新增标记块 `P2-T03`：
     ```text
     proc renderGBufferPass
     	beginevent RA3DR_GBuffer
     	setdepth DepthBuffer
     	settarget 0 RA3DR_GBuffer0
     	settarget 1 RA3DR_GBuffer1
     	settarget 2 RA3DR_GBuffer2
     	settarget 3 RA3DR_GBuffer3
     	setclearcolor 0 0 0 0
     	setcleardepth 1.0 0
     	clear
     	setcamera Viewer
     	visibleobjects Frame
     # [RA3DR P3] geometry submission goes here
     	settarget 1 NULL
     	settarget 2 NULL
     	settarget 3 NULL
     	callproc bindGBufferTextures
     	callproc setFrameRenderTarget
     	callproc setFrameDepthBuffer
     	endevent RA3DR_GBuffer
     endproc

     proc bindGBufferTextures
     	settexture Deferred GBuffer0 RA3DR_GBuffer0
     	settexture Deferred GBuffer1 RA3DR_GBuffer1
     	settexture Deferred GBuffer2 RA3DR_GBuffer2
     	settexture Deferred GBuffer3 RA3DR_GBuffer3
     	settosize Deferred GBufferSize RA3DR_GBuffer0
     endproc
     ```
  2. 在 `proc InGame` 中锚点 `\tcallproc probePreFrame` 之后插入标记块 `P2-T03b`：
     ```text
     	if Deferred IsActive
     		callproc renderGBufferPass
     	endif
     ```
     （位置在 `updateDepthMap` 之后、`beginevent UpdateFrameBuffer` 之前；主帧随后会重新 clear `DepthBuffer`，所以 G-Buffer 对原版画面无影响——D14。）
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 告警；`Select-String 'RA3DR_GBuffer[0-3]'` 确认均已声明。
- **验收标准**：`IsActive=false` 时 InGame 行为不变；proc 结束状态 = RT0 主帧目标、Depth `DepthBuffer`、RT1..3 `NULL`。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P2-T04 调试视图 shader `main/fx/DeferredDebug.fx`
- **执行者**：agent　**规模**：M　**依赖**：P2-T01
- **目标**：一个全屏 shader，按 `Deferred.DebugView` 显示 G-Buffer 各通道、深度伪彩、重建世界坐标网格、RT3 与原版线性深度差分、材质类别、污染像素、Stencil 掩码纹理；另含一个"用原版深度播种 G-Buffer"的测试 technique。
- **前置条件**：`GBUFFER.FXH` 编译通过。
- **必读上下文**：`main/fx/GBUFFER.FXH`；`deferred-techniques-sm3.md` §2.5、§10（P1、P3、P10）；FXFXH `FXscreenSpaceShadow.fx` 的 VS（`main/fx/FXscreenSpaceShadow.fx`）。
- **步骤**：
  1. 文件头：`#define DEFERRED_RENDER`、`#define GBUFFER_READ`、include `COMMON.FXH`、`GBUFFER.FXH`。额外声明：`float RA3DR_DebugView <SasBindAddress="Deferred.DebugView">`；`texture RA3DR_VanillaDepth`（`Deferred.VanillaDepth`，Point/Clamp）；`texture RA3DR_StencilMaskTex`（`Deferred.StencilMaskTex`）。
  2. VS：全屏 quad，输出 `Position`、`ScreenUV = ndc*float2(0.5,-0.5)+0.5 + 0.5/RA3DR_GBufferSize`（半像素修正）、`RayWS = GB_FullscreenRayWS(ndc)`。
  3. `technique View`（`ZEnable=0; ZWriteEnable=0; AlphaBlendEnable=0; AlphaTestEnable=0; CullMode=1;` 不写 Stencil 状态）PS 按 `(int)RA3DR_DebugView` 分支（大块一致分支，可接受）：
     | 值 | 显示 |
     |---|---|
     | 1 | 2×2 总览：albedo / normal*0.5+0.5 / RT2.rgb / 深度伪彩 |
     | 2 | albedo（解码后，`sqrt` 回显示空间） |
     | 3 | 世界法线 `n*0.5+0.5` |
     | 4 | RT2：R=roughness G=metalness B=AO；按住屏幕右 1/4 显示 emissive 灰度 |
     | 5 | 深度伪彩：`frac(log2(viewZ))` 彩虹色；`viewZ<=0` 显示纯黑 |
     | 6 | 重建世界坐标网格：`frac(worldPos.xy / 50)` 接近 0 的像素画白线，其余显示 albedo×0.5；`viewZ<=0` 黑 |
     | 7 | RT3 与 `Deferred.VanillaDepth` 差分：`rel = abs(a-b)/max(b,1e-3)`；`<0.001` 绿、`<0.01` 黄、否则红；任一为 0 → 黑 |
     | 8 | 材质类别：0 灰、1 橙、2 青、3 紫；非延迟像素（`!GB_IsDeferredPixel`）黑 |
     | 9 | 污染视图：`RT0` 非零但 `!GB_IsDeferredPixel` → 品红；延迟像素 → albedo×0.5；空 → 黑 |
     | 10 | Stencil 掩码纹理 `Deferred.StencilMaskTex` 原样显示 |
  4. `technique SeedFromVanillaDepth`（G-Buffer 播种测试，输出 MRT，`ZEnable=0`）：读 `RA3DR_VanillaDepth` 得 `viewZ`；`worldPos = GB_WorldPos(RayWS, viewZ)`；法线 = `normalize(cross(ddy(worldPos), ddx(worldPos)))`（仅测试用；方向符号若反了在报告中注明）；`GB_Encode(albedo = checker(worldPos.xy/20) 的灰白格, n, 0.5, 0, 1, 0, viewZ, GB_CLASS_STANDARD)`；`viewZ<=0` → 全 0 输出。
  5. `technique StencilProbe`：输出纯绿 `float4(0,1,0,1)`；状态 `ZEnable=0; ZWriteEnable=0; StencilEnable=1; StencilFunc=3 /*EQUAL*/; StencilRef=128; StencilMask=128; StencilWriteMask=0; StencilPass=1 /*KEEP*/; StencilFail=1; StencilZFail=1;`。（数值枚举以 `main/COMMON.FXH` 中 `D3DCMP_*`/`D3DSTENCILOP_*` 定义为准，优先使用宏名。）
  6. manifest 增加 `main/fx/DeferredDebug.fx,RA3DR_DeferredDebug.fxo,1,P2`。
- **产出文件**：`main/fx/DeferredDebug.fx`、manifest。
- **验证**：`fx_2_0` 编译；对 `View` 与 `SeedFromVanillaDepth` 的 PS 各做一次 `/Fc`（记录指令槽，应 < 300）。
- **验收标准**：编译通过；寄存器复核通过；`tex2Dlod` 用于所有 G-Buffer 读取（`Select-String 'tex2D\(' main\fx\DeferredDebug.fx` 只允许出现在非分支代码中）。
- **失败处理 / 决策映射**：指令超限 → 把视图拆成两个 technique（`View`、`View2`），SCRAPE 用两个 bool 选择。
- **知识回写**：无。

---

### P2-T05 调试视图接入 SCRAPE（播种测试 + 显示过程）
- **执行者**：agent　**规模**：S　**依赖**：P2-T03、P2-T04
- **目标**：在 G-Buffer Pass 中加入可选的"原版深度播种"与"Stencil 掩码采集"，在后处理之后显示调试视图。
- **前置条件**：`renderGBufferPass` 与 `DeferredDebug.fx` 已存在。
- **必读上下文**：`main/ingame.scrapeo` 中 `proc renderGBufferPass`、`proc probeAfterPostFX`（按名称定位）；[`pass-templates.md`](../.agents/skills/ra3-scrape-pipeline/references/pass-templates.md) §1.2。
- **步骤**：
  1. 顶层声明（标记块 `P2-T05`）：`var shader RA3DRDebugShader RA3DR_DeferredDebug.fx`；`var texture RA3DR_StencilMask <W> <H> A8R8G8B8`。
  2. `configureDeferredFlags` 中追加 `setbool Deferred SeedTest false`（标记块 `P2-T05b`）。
  3. `renderGBufferPass` 中，在注释行 `# [RA3DR P3] geometry submission goes here` **之前**插入标记块 `P2-T05c`：
     ```text
     	if Deferred SeedTest
     		settexture Deferred VanillaDepth DepthTextureLinear
     		setshader RA3DRDebugShader SeedFromVanillaDepth
     		renderquad
     	endif
     ```
     在 `settarget 3 NULL` 之后、`callproc bindGBufferTextures` 之前插入标记块 `P2-T05d`（Stencil 掩码采集，必须在 `DepthBuffer` 仍含 G-Buffer stencil 时执行）：
     ```text
     	if Deferred DebugEnabled
     		settarget 0 RA3DR_StencilMask
     		setclearcolor 0 0 0 1
     		clearcolor
     		setshader RA3DRDebugShader StencilProbe
     		renderquad
     	endif
     ```
     （此时 `setdepth DepthBuffer` 仍有效，RT0 换成掩码纹理，二者尺寸一致——OQ-06 已验证。）
  4. 新增 proc（标记块 `P2-T05e`，放在 `proc InGame` 之前）：
     ```text
     proc renderDeferredDebug
     	setdepth NULL
     	settarget 0 FrameBuffer
     	callproc bindGBufferTextures
     	settexture Deferred VanillaDepth DepthTextureLinear
     	settexture Deferred StencilMaskTex RA3DR_StencilMask
     	setshader RA3DRDebugShader View
     	renderquad
     	setdepth DepthBuffer
     	settarget 0 FrameBuffer
     endproc
     ```
  5. `proc InGame` 中锚点 `\tcallproc probeAfterPostFX` 之后插入标记块 `P2-T05f`：
     ```text
     	if Deferred IsActive
     		if Deferred DebugEnabled
     			callproc renderDeferredDebug
     		endif
     	endif
     ```
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 告警；CRLF 行长复核。
- **验收标准**：`DebugEnabled=false` 时不执行任何调试绘制；`SeedTest=false` 时 G-Buffer 只有清屏。
- **失败处理 / 决策映射**：`DepthTextureLinear` 在 `updateDepthMap` 未执行（无水面且软粒子关）时为旧内容 → 测试脚本要求 GS-01（有水）或开启软粒子。
- **知识回写**：无。

---

### P2-T06 USER-RUN：G-Buffer 资源、播种重建与调试视图验证
- **执行者**：agent（打包/记录）+ USER-RUN　**规模**：M　**依赖**：P2-T05
- **目标**：实机确认 4 张 RT 正常创建/清屏，世界坐标重建与半像素偏移正确，开关逻辑与 Device Reset 正常。
- **前置条件**：构建成功。
- **必读上下文**：README §4；`tests/scenes.md`。
- **步骤**：
  1. 构建：`P2-a`：`-Flags "IsEnabled=true,DebugEnabled=true,DebugView=1"`；`P2-b`：`"IsEnabled=true,DebugEnabled=true,SeedTest=true,DebugView=6"`；`P2-c`：同 b 但 `DebugView=7`；`P2-d`：同 b 但 `DebugView=1`；`P2-e`：`"IsEnabled=false"`。（均剥离 Phase 1 探针显示块或保持其开关为 false。）
  2. 写 `tests/user-run/P2-T06.md`，GS-01，观察：
     1. (a) 进入对局；全屏为调试视图；四象限全黑（只清屏）。
     2. (b) 白色网格线是否覆盖地形与物体、随镜头平移/缩放**锁定在世界上**（不滑动、不抖动）？网格是否是正方形（不被拉伸）？
     3. (b) 在屏幕边缘与中心，网格线是否连续、无 1 像素错位（半像素检查：放大截图）？
     4. (c) 绝大多数几何像素为绿色（播种 = 原版深度，差分应≈0）？
     5. (d) 法线象限：平地是否为一致的颜色（向上法线）？
     6. (e) 画面与基准 GS-01 完全一致、无调试视图。
     7. (a) 关闭 HDR → 调试视图应消失（`IsActive=false`），画面正常；开启 AA → 同样消失。
     8. (b) Alt-Tab / 切换分辨率后观察 2 是否仍正确。
     9. (b) 打开 WorldBuilder（GS-06）是否正常。
  3. 结果写 `tests/results/P2-T06.md`。
- **产出文件**：`tests/user-run/P2-T06.md`、`tests/results/P2-T06.md`。
- **验证**：—
- **验收标准**：观察 1–9 全部通过。
- **失败处理 / 决策映射**：
  - 网格随镜头滑动 → `ViewI`/`ProjectionI` 使用错误或行列主序问题：检查 `GB_FullscreenRayWS` 中 `mul` 顺序（RA3 行向量约定，`mul(v, M)`）；对照原版 `UnderwaterDeferred.fx`（只读）重建代码。
  - 网格拉伸 → `ProjectionI` 宽高比问题或 `GBufferSize` 错误（OQ-06 复查）。
  - 1 像素错位 → 半像素偏移符号错误：改 `+0.5/size` 为 `-0.5/size` 之前先确认 VS 输出的 NDC 方向。
  - 观察 4 大面积红 → 播种 shader 读取与写入不一致（R32F 精度不应有问题），检查 `VanillaDepth` 是否为本帧内容。
  - 观察 7 失败 → `configureDeferredFlags` 逻辑错误。
  - 观察 8 失败 → Device Reset 后 RT 未重建：升级 lead（README R14）。
- **知识回写**：`dictionaries/engine-ground-truth.md` 新增 `GT-38 世界坐标重建与半像素约定（实测）`；若 Device Reset 正常，在 GT-02 证据栏补充"自定义 RT 在 Reset 后自动重建（日期）"。

---

### P2-T07 Phase 2 知识回写与清理
- **执行者**：agent　**规模**：S　**依赖**：P2-T06
- **目标**：按 PK-T01 完成阶段回写；把 G-Buffer 资源/过程的约定写入技能。
- **前置条件**：P2-T06 ✅。
- **必读上下文**：[phase-K](phase-K-knowledge-maintenance.md) PK-T01、PK-T03。
- **步骤**：
  1. 在 `.agents/skills/ra3-scrape-pipeline/references/pass-templates.md` §2.1/§2.2 标题后追加"✅ 已实机验证（P2-T06，日期）"标签，资源名改为本项目实际名（`RA3DR_GBuffer0..3`）或注明映射。
  2. 在 `dictionaries/hlsl-register-sas-dict.md` 追加 `Deferred.*` SCOPE 参数表（`GBuffer0..3`、`GBufferSize`、`DebugView`、`VanillaDepth`、`StencilMaskTex`、`GBufferMode`）。
  3. 执行 PK-T01 其余清单项；task-board 更新。
- **产出文件**：上述技能/字典文件。
- **验证**：`Select-String 'Deferred\.' dictionaries\hlsl-register-sas-dict.md` 有结果。
- **验收标准**：PK-T01 清单全部勾选。
- **失败处理 / 决策映射**：无。
- **知识回写**：本卡即回写。
