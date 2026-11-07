# Phase 1：引擎探针（Engine Probes）

> **阶段目标**：用最小、可回退的改动在实机上回答决定架构走向的开放问题（D1）。所有探针**不改变原版画面**（默认开关全关），只在开关打开时生效；每个探针都有**游戏内可见指示**（不依赖抓帧，README R3）。
> **组织方式**：先建基础设施（P1-T01），再分别编写探针代码（只编译、不部署），最后打包成 **构建 A**（渲染目标类：OQ-04/05/06/12）与 **构建 B**（technique 路由类：OQ-01/02/15/18/19）两次 USER-RUN，加一次 **抓帧会话 C**（OQ-09/13/14/21）。阶段结束于两个决策门 **DG-1**（P1-T13）与 **DG-T**（P1-T14）。
> **新增开放问题**（由本阶段负责写入 `knowledge/open-questions.md`，见 P1-T01 步骤 6）：
> - **OQ-18**：SCRAPE 在帧内多次 `setfloat Deferred GBufferMode` 时，场景材质中以该 SAS 为下标的 shader 数组是否**逐段**生效（路线 3 可行性）。
> - **OQ-19**：4-MRT 下 alpha 混合是否生效；RT i 的 `SRCALPHA` 取 `oC0.a` 还是 `oCi.a`；`R32F` 目标是否参与混合；technique 写 `ColorWriteEnable1` 是否触发引擎报错。
> - **OQ-20**：FXFXH 光体积 `CullMode = D3DCULL_CCW` 在 RA3 中实际光栅化的是背面还是正面（Phase 6 处理，此处仅登记）。
> - **OQ-21**：`renderTerrain` / `renderRoads` / `renderScorchMarks` / `renderTerrainTracks` 各自提交哪些 draw、用哪个 shader 的哪个 technique、各层混合状态（地形 G-Buffer 方案输入）。

**本阶段通用约定**
- 探针 shader 放 `main/fx/probe/`，资源/变量名一律前缀 `RA3DR_`；`main/ingame.scrapeo` 中每个探针代码块用 `# [RA3DR P1-Txx] begin/end` 包裹，且全部位于 `if Deferred Probe<名称>` 分支内。
- 探针显示统一画在**后处理之后、HUD 之前**（LUT 已完成，颜色不受色调映射影响），每个探针占屏幕的一个固定区域（见 P1-T01 区域表），一次部署可同时观察多个探针。
- 期望颜色用"纯色 + 判定色"表达：绿 = 符合预期 A，黄 = 符合预期 B，蓝 = 符合预期 C，红 = 都不符合。

---

### P1-T01 探针基础设施：`ProbeView.fx`、开关过程、钩子过程、`build.ps1 -Strip`
- **执行者**：agent　**规模**：M　**依赖**：P0-T09
- **目标**：提供所有探针共用的显示 shader、`Deferred.*` 开关初始化过程、两个插入钩子，以及构建时按标记块剥离代码的能力。
- **前置条件**：`main/tools/build.ps1` 可用；`RA3DR_Canary` 金丝雀已在 `renderUI` 后（P0-T06）。
- **必读上下文**：[`pass-templates.md`](../.agents/skills/ra3-scrape-pipeline/references/pass-templates.md) §1.2、§1.6；[`language-and-syntax.md`](../.agents/skills/ra3-scrape-pipeline/references/language-and-syntax.md)（只查 `setfloat`/`setbool`/`settexture` 语法段）；[`vanilla-frame-walkthrough.md`](../.agents/skills/ra3-scrape-pipeline/references/vanilla-frame-walkthrough.md) §2 第 4、5.0、10、11 行；`main/fx/FXscreenSpaceShadow.fx`（VS 结构与 technique 段）。
- **步骤**：
  1. 新建 `main/fx/probe/ProbeView.fx`：
     - `#include "COMMON.FXH"`；声明 `texture RA3DR_ProbeTex0..3`（`SasBindAddress = "Deferred.ProbeTex0".."Deferred.ProbeTex3"`）与对应 `sampler2D`（`MinFilter = 1; MagFilter = 1; MipFilter = 0; AddressU = 3; AddressV = 3;`）。
     - 声明 `float4 RA3DR_ProbeRect <string UIWidget="None"; string SasBindAddress="Deferred.ProbeRect";> = float4(0,0,1,1);`（屏幕归一化矩形 x0,y0,x1,y1，左上为原点）、`float4 RA3DR_ProbeScale`（`Deferred.ProbeScale`，四张纹理各自的显示缩放）、`float4 RA3DR_ProbeColor0..3`（`Deferred.ProbeColor0..3`）。
     - VS：全屏 quad，输出 `Position` 与 `ScreenUV = Position.xy * float2(0.5, -0.5) + 0.5`（只用于区域判定，不需要半像素修正）。
     - `technique Show4`：区域外 `clip(-1)`；区域内按 2×2 子格分别显示 `ProbeTex0..3`（`tex2Dlod(s, float4(localUV,0,0)) * RA3DR_ProbeScale[i]`），子格间留 2 像素黑边。
     - `technique FillMRT`：区域外 `clip(-1)`；输出 `struct { float4 c0:COLOR0; float4 c1:COLOR1; float4 c2:COLOR2; float4 c3:COLOR3; }` = `ProbeColor0..3`。状态：`ZEnable=0; ZWriteEnable=0; AlphaBlendEnable=0; AlphaTestEnable=0; CullMode=1;`。
     - `technique FillMRTBlend`：同 `FillMRT`，但 `AlphaBlendEnable=1; SrcBlend=5; DestBlend=6;`（SrcAlpha / InvSrcAlpha）。
     - 所有 technique 只用 `vs_3_0/ps_3_0`，不写 `ColorWriteEnable1..3`，不挂 `ExpressionEvaluator`。
  2. manifest 增加 `main/fx/probe/ProbeView.fx,RA3DR_ProbeView.fxo,1,P1 probes`。
  3. `main/ingame.scrapeo` 顶层声明区（与 P0-T06 的 `var shader RA3DRCanaryShader` 相邻）插入 `var shader RA3DRProbeShader RA3DR_ProbeView.fx`（标记块 `P1-T01`）。
  4. 在 `proc InGame` **之前**（锚点：`proc InGame` 行的上一行空行）插入三个新 proc（标记块 `P1-T01`）：
     ```text
     proc configureDeferredFlags
     	setbool Deferred IsEnabled false
     	setbool Deferred ProbeOQ04 false
     	setbool Deferred ProbeOQ05 false
     	setbool Deferred ProbeOQ06 false
     	setbool Deferred ProbeOQ12 false
     	setbool Deferred ProbeOQ01 false
     	setbool Deferred ProbeOQ01lc false
     	setbool Deferred ProbeOQ02 false
     	setbool Deferred ProbeOQ15a false
     	setbool Deferred ProbeOQ15b false
     	setbool Deferred ProbeOQ18 false
     	setbool Deferred ProbeOQ19 false
     	setfloat Deferred GBufferMode 0
     endproc

     proc probePreFrame
     endproc

     proc probeAfterPostFX
     	setdepth NULL
     	settarget 0 FrameBuffer
     # (probe display blocks are inserted here by P1-T02c/T03c/T04a/T04b/T08b)
     	setdepth DepthBuffer
     	settarget 0 FrameBuffer
     endproc
     ```
     说明：原版 `renderPostEffects` 结束时状态为 RT0=`FrameBuffer`、深度=`DepthBuffer`（vanilla-frame-walkthrough §2 #10），本过程开头解绑深度供全屏 quad 使用，结尾按"先 `setdepth` 后 `settarget`"恢复同一状态。各探针显示块插在注释行处（注释行可保留）。
  5. 在 `proc InGame` 中插入调用（各自一个标记块）：
     - 锚点 `\tcallproc updateFrameRenderTargetToUse`（InGame 内第一处）之后：`\tcallproc configureDeferredFlags`
     - 锚点 `\tcallproc updateDepthMap`（InGame 内）之后：`\tcallproc probePreFrame`
     - 锚点 `\tcallproc renderPostEffects`（InGame 内）之后：`\tcallproc probeAfterPostFX`
  6. 扩展 `main/tools/build.ps1`：新增参数 `-Strip <TaskID,...>`，在暂存副本中删除 `# [RA3DR <TaskID>] begin` 到对应 `end` 之间（含标记行）的全部行；找不到标记 → 失败。
  7. 在 `knowledge/open-questions.md` 优先级表追加 OQ-18（P0）、OQ-19（P1）、OQ-20（P2）、OQ-21（P1）四行，并按该文件现有格式各写一个小节（为何重要 / 阻塞 / 最便宜实验 = 指向本计划对应卡 / 结果→决策 = 指向 DG-1、DG-T、DG-5）。
  8. 屏幕区域分配表（写进 `main/fx/probe/README.md`，≤ 30 行）：

     | 区域 | `ProbeRect` | 探针 |
     |---|---|---|
     | 左上 | `0.00 0.10 0.45 0.50` | OQ-05（4-MRT） |
     | 右上 | `0.55 0.10 1.00 0.50` | OQ-04（格式）/ OQ-19（混合判定） |
     | 左下 | `0.00 0.55 0.45 0.95` | OQ-12（全屏 SAS） |
     | 右下 | `0.55 0.55 1.00 0.95` | OQ-06（尺寸） |
     （`y` 从 0.10 开始，避开左上角 96×96 金丝雀。）
- **产出文件**：`main/fx/probe/ProbeView.fx`、`main/fx/probe/README.md`、`main/ingame.scrapeo`（4 个标记块）、`main/tools/build.ps1`（`-Strip`）、`main/tools/fx-manifest.csv`、`knowledge/open-questions.md`（OQ-18..21）。
- **验证**：
  ```powershell
  node ".agents/skills/ra3-scrape-pipeline/scripts/check_scrape.js" "main/ingame.scrapeo"
  & main\fxc.exe /nologo /O2 /T fx_2_0 /D _WW3D_ /I main /I main\fx /Fo "$env:RA3DR_OUT\fxcheck\RA3DR_ProbeView.fxo" "main\fx\probe\ProbeView.fx"
  powershell -ExecutionPolicy Bypass -File main\tools\build.ps1 -Variant p1t01 -Strip "P1-T01"   # 应成功且副本中无 P1-T01 块
  ```
- **验收标准**：①检查器 0 告警；②`ProbeView.fx` 编译成功，各 PS `/Fc` 无固化寄存器冲突；③全部开关默认 false 时，`proc InGame` 的绘制行为与 P0-T06 版本相同（新增的只有空 proc 调用与 `probeAfterPostFX` 中的 `setdepth/settarget` 恢复序列）；④`-Strip` 工作。
- **失败处理 / 决策映射**：检查器报 `missing-definition` 对 `probe*` proc → 确认 proc 名拼写；担心 `probeAfterPostFX` 的 `settarget 0 FrameBuffer` 改变原版状态 → 该过程在开关全关时也可以只保留空体（把恢复序列移入各探针 `if` 分支内），由执行者在报告中说明选择。
- **知识回写**：`knowledge/open-questions.md`（OQ-18..21 新增）。

---

### P1-T02 探针 OQ-04：`A2R10G10B10` / `G16R16` / `R16F` 能否作 RT 写入并被采样
- **执行者**：agent　**规模**：S　**依赖**：P1-T01
- **目标**：准备 OQ-04 的 SCRAPE + 显示代码（随构建 A 部署）。
- **前置条件**：`ProbeView.fx` 存在。
- **必读上下文**：[`open-questions.md`](../knowledge/open-questions.md) OQ-04 小节；`main/fx/probe/README.md` 区域表；`deferred-techniques-sm3.md` §2.3（只读表格）。
- **步骤**：
  1. 顶层声明区新增标记块 `P1-T02`（**单独一个块，便于 `-Strip`**，因为未知格式 token 可能导致整个脚本加载失败）：
     ```text
     var texture RA3DR_OQ04_A2R10 $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A2R10G10B10
     var texture RA3DR_OQ04_G16R16 $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y G16R16
     var texture RA3DR_OQ04_R16F $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y R16F
     var texture RA3DR_OQ04_REF $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A8R8G8B8
     ```
  2. 在 `proc probePreFrame` 内新增标记块 `P1-T02b`（同样可剥离）：对 4 张纹理依次执行
     ```text
     	if Deferred ProbeOQ04
     		setdepth NULL
     		settarget 0 RA3DR_OQ04_A2R10
     		setclearcolor 0.25 0.5 0.75 1
     		clearcolor
     		setfloat Deferred ProbeRect 0 0 0.5 1
     		setfloat Deferred ProbeColor0 0.75 0.5 0.25 1
     		setshader RA3DRProbeShader FillMRT
     		renderquad
     		... 其余 3 张同理（每张：settarget 0 → clearcolor → renderquad）...
     		callproc setFrameRenderTarget
     		callproc setFrameDepthBuffer
     	endif
     ```
     （`FillMRT` 只绑定了 RT0，因此只写 `COLOR0`；左半屏 = 绘制色 (0.75,0.5,0.25)，右半屏 = 清屏色 (0.25,0.5,0.75)。）
  3. 在 `proc probeAfterPostFX` 内新增标记块 `P1-T02c`：
     ```text
     	if Deferred ProbeOQ04
     		settexture Deferred ProbeTex0 RA3DR_OQ04_A2R10
     		settexture Deferred ProbeTex1 RA3DR_OQ04_G16R16
     		settexture Deferred ProbeTex2 RA3DR_OQ04_R16F
     		settexture Deferred ProbeTex3 RA3DR_OQ04_REF
     		setfloat Deferred ProbeScale 1 1 1 1
     		setfloat Deferred ProbeRect 0.55 0.10 1.00 0.50
     		setshader RA3DRProbeShader Show4
     		renderquad
     	endif
     ```
  4. 写出期望表（放进报告，供 P1-T05 测试脚本引用）：子格顺序 左上=A2R10、右上=G16R16、左下=R16F、右下=REF。每格左半应为 (0.75,0.5,0.25) 橙褐、右半 (0.25,0.5,0.75) 天蓝；`G16R16` 无 B 通道 → 预期 B=1（左半 (0.75,0.5,1)、右半 (0.25,0.5,1)）；`R16F` 只有 R → 预期 (r,1,1)。以 REF 为参照比较。
- **产出文件**：`main/ingame.scrapeo`（3 个标记块）。
- **验证**：检查器 0 告警；`build.ps1 -Variant chk -Strip "P1-T02,P1-T02b,P1-T02c"` 成功（证明可剥离）。
- **验收标准**：代码只在 `ProbeOQ04` 为 true 时执行；可完整剥离。
- **失败处理 / 决策映射**：见 P1-T05 汇总映射。
- **知识回写**：无（结果在 P1-T05 回写）。

---

### P1-T03 探针 OQ-05：4 路 MRT 同时绑定 + `renderbin`/`renderTerrain` 合法性（附带 OQ-07 观察）
- **执行者**：agent　**规模**：M　**依赖**：P1-T01
- **目标**：准备 OQ-05 代码：同时绑定 RT0..3，`clear`、几何绘制、`COLOR0..3` 写入、解绑恢复，并在屏幕上显示四张 RT。
- **前置条件**：`FillMRT` technique 可用。
- **必读上下文**：OQ-05、OQ-07 小节；[`pass-templates.md`](../.agents/skills/ra3-scrape-pipeline/references/pass-templates.md) §2.1–§2.2；[`pitfalls.md`](../.agents/skills/ra3-scrape-pipeline/references/pitfalls.md) §2.2、§5。
- **步骤**：
  1. 顶层声明标记块 `P1-T03`：
     ```text
     var texture RA3DR_P05_RT0 $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A8R8G8B8
     var texture RA3DR_P05_RT1 $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A8R8G8B8
     var texture RA3DR_P05_RT2 $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A8R8G8B8
     var texture RA3DR_P05_RT3 $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y R32F
     ```
  2. `proc probePreFrame` 内标记块 `P1-T03b`（位于 `P1-T02b` 之后）：
     ```text
     	if Deferred ProbeOQ05
     		beginevent RA3DR_OQ05
     		setdepth DepthBuffer
     		settarget 0 RA3DR_P05_RT0
     		settarget 1 RA3DR_P05_RT1
     		settarget 2 RA3DR_P05_RT2
     		settarget 3 RA3DR_P05_RT3
     		setclearcolor 0.1 0.2 0.3 0.4
     		setcleardepth 1.0 0
     		clear
     		setcamera Viewer
     		visibleobjects Frame
     		renderTerrain
     		setfloat Deferred ProbeRect 0 0 0.5 1
     		setfloat Deferred ProbeColor0 1 0 0 1
     		setfloat Deferred ProbeColor1 0 1 0 1
     		setfloat Deferred ProbeColor2 0 0 1 1
     		setfloat Deferred ProbeColor3 0.9 0 0 1
     		setshader RA3DRProbeShader FillMRT
     		renderquad
     		settarget 1 NULL
     		settarget 2 NULL
     		settarget 3 NULL
     		callproc setFrameRenderTarget
     		callproc setFrameDepthBuffer
     		endevent RA3DR_OQ05
     	endif
     ```
     说明：此处在主帧 `clear` 之前执行，`DepthBuffer` 随后会被主帧重新清除，不影响原版画面。`renderTerrain` 用原版 technique（只写 `COLOR0`）——右半屏的 RT1..3 是否仍为清屏哨兵色即 OQ-07 的观察。
  3. `proc probeAfterPostFX` 内标记块 `P1-T03c`：`settexture Deferred ProbeTex0..3 RA3DR_P05_RT0..3`；`setfloat Deferred ProbeScale 1 1 1 1`；`setfloat Deferred ProbeRect 0.00 0.10 0.45 0.50`；`setshader RA3DRProbeShader Show4`；`renderquad`（包在 `if Deferred ProbeOQ05` 内）。
  4. 期望表（写进报告）：子格 左上=RT0：左半纯红、右半为地形图像（未光照/光照均可）；右上=RT1：左半纯绿、右半 = 哨兵 (0.1,0.2,0.3) 或其它（记录）；左下=RT2：左半纯蓝、右半同上；右下=RT3（R32F 只显示 R）：左半 0.9 灰红、右半 0.1 或其它。游戏不得出现 `not a valid set` 报错或崩溃。
- **产出文件**：`main/ingame.scrapeo`（3 个标记块）。
- **验证**：检查器 0 告警。
- **验收标准**：所有新增 RT 名都已 `var` 声明（`Select-String 'RA3DR_P05_RT' main\ingame.scrapeo` 逐一确认）；块内 `settarget 1..3 NULL` 存在。
- **失败处理 / 决策映射**：见 P1-T05。
- **知识回写**：无。

---

### P1-T04 探针 OQ-06 + OQ-12：尺寸一致性与全屏 quad 下的引擎 SAS 值
- **执行者**：agent　**规模**：M　**依赖**：P1-T01
- **目标**：在屏幕上可视化 (a) `DepthTextureLinear`、`FrameRenderTarget`、`DepthBuffer` 与 `WW3D.FrameBufferSize` 的尺寸关系；(b) 全屏 quad 中 `DirectionalLight[0]`、阴影矩阵、相机矩阵、云 UV 寄存器是否被引擎填充。
- **前置条件**：`ProbeView.fx` 存在。
- **必读上下文**：OQ-06、OQ-12 小节；[`register-sas-contract.md`](../.agents/skills/ra3-fx-shader/references/register-sas-contract.md)（只查 c4..c10、c113..c123 与 `DEFERRED_RENDER` 段）；`main/COMMON.FXH`（`Select-String 'DEFERRED_RENDER|FrameBufferSize|ViewI|ProjectionI|DirectionalLight|ShadowMapWorldToShadow|EyePosition'`）。若存在，可参考 `D:\PROJECTS\SAGE shader source\CORONA Shaders 240820\DebugDigitsDisplayer.fxh`（只读）在屏幕上打印数字。
- **步骤**：
  1. 新建 `main/fx/probe/ProbeSas.fx`：`#define DEFERRED_RENDER` 后 `#include "COMMON.FXH"`；复用 `ProbeView.fx` 的 VS（复制代码即可）。声明 `float2 RA3DR_SizeA <string SasBindAddress="Deferred.SizeA";>`、`SizeB`、`SizeC`。
  2. `technique ShowSizes`（区域 = `ProbeRect`）：四条横条，长度分别 = `SizeA.x/4096`、`SizeB.x/4096`、`SizeC.x/4096`、`FrameBufferSize.x/4096`（`WW3D.FrameBufferSize`，来自 COMMON.FXH）；横条下方一个指示块：`all(SizeA==SizeB) && all(SizeA==FrameBufferSize)` → 绿，否则红。若引入数字显示器，则直接打印四组 `x×y`。
  3. `technique ShowSas`（区域 = `ProbeRect`，2×2 子格）：①`DirectionalLight[0].Direction * 0.5 + 0.5`；②`DirectionalLight[0].Color` 除以 `max(1, max3(color))`；③`frac(abs(ShadowMapWorldToShadow[0].xyz))`（任意非零即说明已填充）；④`frac(abs(ViewI[3].xyz) / 100)`（相机位置；移动镜头应变化）。每个子格右下角 8×8 像素加一个"全零检测"：该项向量全为 0 → 红，否则绿。字段名以 `main/COMMON.FXH` 实际声明为准。
  4. manifest 增加 `main/fx/probe/ProbeSas.fx,RA3DR_ProbeSas.fxo,1,P1 probes`；顶层 `var shader RA3DRProbeSasShader RA3DR_ProbeSas.fx`（标记块 `P1-T04`）。
  5. `proc probeAfterPostFX` 内两个标记块：
     - `P1-T04a`（OQ-12，安全）：`if Deferred ProbeOQ12` → `setcamera Viewer` → `setfloat Deferred ProbeRect 0.00 0.55 0.45 0.95` → `setshader RA3DRProbeSasShader ShowSas` → `renderquad` → `endif`。
     - `P1-T04b`（OQ-06，`settosize` 对 surface 可能导致加载失败，故独立成块）：`if Deferred ProbeOQ06` → `settosize Deferred SizeA DepthTextureLinear` → `settosize Deferred SizeB FrameRenderTarget` → `settosize Deferred SizeC DepthBuffer` → `setfloat Deferred ProbeRect 0.55 0.55 1.00 0.95` → `setshader RA3DRProbeSasShader ShowSizes` → `renderquad` → `endif`。
     - 另建可选块 `P1-T04c`：只含 `settosize Deferred SizeA DepthTextureLinear` 的版本（当 `P1-T04b` 导致加载失败时，用 `-Strip P1-T04b` 改用它，只比较 texture 与 `WW3D.FrameBufferSize`）。默认把 `P1-T04c` 的内容注释掉（`#` 前缀），由 P1-T05 视需要启用。
  6. 编译并 `/Fc` 复核 `ShowSas` PS：确认 `DirectionalLight`、`ShadowMapWorldToShadow`、`ViewI` 分别读取的是 COMMON.FXH 指定的寄存器/SAS（记录在报告中）。
- **产出文件**：`main/fx/probe/ProbeSas.fx`、`main/ingame.scrapeo`（标记块）、manifest。
- **验证**：编译 + `/Fc` + 检查器。
- **验收标准**：两 technique 编译通过；`ShowSas` 读取的寄存器与契约一致。
- **失败处理 / 决策映射**：见 P1-T05。
- **知识回写**：无。

---

### P1-T05 构建 A 打包 + USER-RUN（OQ-04 / OQ-05 / OQ-06 / OQ-07 / OQ-12）
- **执行者**：agent（打包/记录）+ USER-RUN　**规模**：M　**依赖**：P1-T02、P1-T03、P1-T04
- **目标**：用至多 3 次部署回答渲染目标类问题，并关闭对应 OQ。
- **前置条件**：P1-T02..T04 代码已合入且检查器 0 告警。
- **必读上下文**：README §4；P1-T02/T03/T04 的期望表；`tests/scenes.md`（GS-01）。
- **步骤**：
  1. 构建三个变体：
     - `P1-A1`：`-Flags "ProbeOQ05=true,ProbeOQ12=true" -Strip "P1-T02,P1-T02b,P1-T02c,P1-T04b"`（最安全：只用已证实格式）。
     - `P1-A2`：在 A1 基础上保留 P1-T02 块：`-Flags "ProbeOQ05=true,ProbeOQ12=true,ProbeOQ04=true" -Strip "P1-T04b"`。
     - `P1-A3`：`-Flags "ProbeOQ05=true,ProbeOQ12=true,ProbeOQ06=true" -Strip "P1-T02,P1-T02b,P1-T02c"`。
  2. 写 `tests/user-run/P1-T05.md`：按 A1 → A2 → A3 顺序部署（每次只换 `ingame.scrapeo` 与 `.fxo`），GS-01，HDR 开、AA 关。观察项：
     1. (A1) 游戏能否进入对局？左上金丝雀是否出现？
     2. (A1) 左上区域四个子格的颜色（按期望表逐格描述/截图）。
     3. (A1) 有无 SCRAPE 报错、画面其它部分是否与基准 GS-01 一致？
     4. (A1) 左下区域四个子格：各是什么颜色？右下角小方块绿/红？移动镜头时第④格是否变化？
     5. (A1) 抓帧（若可用）：`RA3DR_OQ05` 事件中 `SetRenderTarget` 0..3 是否都出现；RT1..3 在地形区域的实际值。
     6. (A2) 能否进入对局？右上区域四个子格的颜色（与 REF 格对比）。
     7. (A2) 抓帧：`RA3DR_OQ04_A2R10` 的实际 D3DFORMAT。
     8. (A3) 能否进入对局？右下横条长度与指示块颜色。
     9. (A3) 改为窗口化非 16:9 分辨率（如 1280×1024）再看一次第 8 项。
     10. (A1) Alt-Tab 切出再切回 / 改分辨率后，左上区域是否仍正确（Device Reset 检查）。
  3. 用户回报后写 `tests/results/P1-T05.md`，并逐条应用下列决策映射：

     | 观察 | 结论 | 后续 |
     |---|---|---|
     | A1 左上：RT0..3 左半为红/绿/蓝/0.9 | OQ-05 ✅ 4-MRT 可用 | 继续 |
     | 只有 RT0 有色 | OQ-05 ✘ | **立即升级 lead（R2）**，暂停 Phase 2 |
     | A1 崩溃/报 invalid set | OQ-05 ✘（绑定组合非法） | 记录报错原文，升级 |
     | RT1..3 右半保持 (0.1,0.2,0.3) | OQ-07：旧 PS 不写 MRT 时保持原值 | 路线 2 下"Valid 通道"可行 |
     | RT1..3 右半被改写 | OQ-07：未写 RT 被污染 | 路线 2 必须用 Stencil bit 7 标记 |
     | A2 右上 A2R10 格与 REF 一致 | OQ-04 ✅ | RT1 采用 `A2R10G10B10`（D3） |
     | A2 崩溃或 A2R10 格异常 | OQ-04 ✘ | RT1 改 `A8R8G8B8`（D3 回退） |
     | G16R16/R16F 格正确 | 记录可用（供 Phase 8 参考） | — |
     | A3 指示块绿（含非 16:9） | OQ-06 ✅ 尺寸一致 | G-Buffer 统一 `$PostEffect.FrameBufferSize` |
     | A3 指示块红 | OQ-06 ✘ | 记录差异；DG-1 改用与 `DepthBuffer` 一致的尺寸变量 |
     | A3 加载失败 | `settosize` 不接受 surface | 改用 `P1-T04c` 重测（只比较 texture 与 `WW3D.FrameBufferSize`）+ 抓帧读尺寸 |
     | A1 左下四格均"非零绿"且第④格随镜头变化 | OQ-12 ✅ 全屏 quad 可读引擎 SAS | 合成直接绑定（P5-T02/T03） |
     | 某格"全零红"或不随镜头变化 | OQ-12 部分 ✘ | 记录哪一项；DG-1 决定该项改为 G-Buffer 阶段预计算（README R5） |
     | 第 10 项异常 | Device Reset 问题 | 记录，P2-T06 重点复测 |
- **产出文件**：`tests/user-run/P1-T05.md`、`tests/results/P1-T05.md`。
- **验证**：三个变体 `build.ps1` 均成功。
- **验收标准**：OQ-04、OQ-05、OQ-06、OQ-12 各得到明确结论（✅/✘/部分）；OQ-07 有观察记录。
- **失败处理 / 决策映射**：见上表；A1 都无法进入对局 → 用 `-Strip` 逐块剥离二分定位。
- **知识回写**：`dictionaries/engine-ground-truth.md`：GT-07b（OQ-04）、GT-10（OQ-05 4 RT）、GT-11（OQ-06）、新增 GT-35（OQ-12 全屏 SAS 可用性逐项）；`knowledge/open-questions.md` 把已定论条目移入"已关闭"表并标注 `【已关闭 日期 → GT-xx】`；`knowledge/engine-behavior.md` 对应 GT 小节的置信度标签同步更新。

---

### P1-T06 探针 OQ-01 / OQ-02 / OQ-15：`setshaderoverride` 是否命中场景材质、缺名回退、状态继承
- **执行者**：agent　**规模**：M　**依赖**：P1-T01
- **目标**：准备路线 1 / 缺名回退 / override technique 状态来源的探针代码（随构建 B 部署）。
- **前置条件**：`main/fx/PBR5-10-objects-ARPBR.FX` 与 `main/fx/objectsallied.fx` 已导入（P0-T05）。
- **必读上下文**：OQ-01、OQ-02、OQ-15 小节；`main/fx/PBR5-10-objects-ARPBR.FX` L620–L775（VS/PS 选择表达式与 technique 段，按锚点 `VSchooserExpr`、`technique Default` 定位）；[`ra3-fx-shader` SKILL.md](../.agents/skills/ra3-fx-shader/SKILL.md) §3（缺名回退）。
- **步骤**：
  1. 在 `PBR5-10-objects-ARPBR.FX` 的 `technique Default` **之前**新增（`// [RA3DR P1-T06] begin/end` 注释包裹）：
     ```hlsl
     float4 PS_RA3DR_Red(float4 c : COLOR0) : COLOR0 { return float4(1, 0, 0, 1); }
     float4 PS_RA3DR_RedA0(float4 c : COLOR0) : COLOR0 { return float4(1, 0, 0, 0); }
     technique RA3DR_DebugRed
     {   pass P0
         {   VertexShader = VS_H_Array[ VSchooserExpr() ];   // 与 Default 相同的 VS 选择（按文件实际名称）
             PixelShader  = compile ps_3_0 PS_RA3DR_Red();
             ZEnable = 1; ZFunc = 4; ZWriteEnable = 1; CullMode = 2;
             AlphaBlendEnable = 0; AlphaTestEnable = 0;
         }
     }
     technique RA3DR_DebugRedA0      // OQ-15a：不写任何 Alpha/Cull 状态，PS alpha=0
     {   pass P0 { VertexShader = VS_H_Array[ VSchooserExpr() ]; PixelShader = compile ps_3_0 PS_RA3DR_RedA0(); } }
     technique RA3DR_DebugRedCullCCW // OQ-15b：显式只画背面
     {   pass P0
         {   VertexShader = VS_H_Array[ VSchooserExpr() ]; PixelShader = compile ps_3_0 PS_RA3DR_Red();
             ZEnable = 1; ZFunc = 4; ZWriteEnable = 1; CullMode = 3; AlphaBlendEnable = 0; AlphaTestEnable = 0;
         }
     }
     ```
     `VS_H_Array`/`VSchooserExpr` 以文件中 `technique Default` 实际使用的写法为准（复制同一行）。PS 输入签名若与 VS 输出不兼容导致编译错误，改为无参 `float4 PS_RA3DR_Red() : COLOR0`。
  2. manifest：`main/fx/objectsallied.fx,ObjectsAllied.fxo` 设 `enabled=1`（注：这会让盟军单位使用 FXFXH ARPBR 外观，属预期；D13）。
  3. `main/ingame.scrapeo` 顶层（标记块 `P1-T06`）：
     ```text
     var shader RA3DROQ01Shader ObjectsAllied.fx
     var shader RA3DROQ01ShaderLC objectsallied.fx
     ```
     （两种大小写各一个，检验 shader 注册名是否大小写敏感；若检查器或加载对重复文件有异议，由 P1-T09 用 `-Strip` 分开测试——为此第二行单独放在标记块 `P1-T06lc`。）
  4. `proc InGame` 中，锚点 `\tclear`（位于 `beginevent UpdateFrameBuffer` 之后的第一处 `clear`）之后插入标记块 `P1-T06a`：
     ```text
     	if Deferred ProbeOQ01
     		setshaderoverride RA3DROQ01Shader RA3DR_DebugRed
     	endif
     	if Deferred ProbeOQ01lc
     		setshaderoverride RA3DROQ01ShaderLC RA3DR_DebugRed
     	endif
     	if Deferred ProbeOQ02
     		setshaderoverride RA3DROQ01Shader RA3DR_NoSuchTech
     	endif
     	if Deferred ProbeOQ15a
     		setshaderoverride RA3DROQ01Shader RA3DR_DebugRedA0
     	endif
     	if Deferred ProbeOQ15b
     		setshaderoverride RA3DROQ01Shader RA3DR_DebugRedCullCCW
     	endif
     ```
     锚点 `\trenderbin StaticSort5`（InGame 内）之后插入标记块 `P1-T06b`：对 `ProbeOQ01`、`ProbeOQ02`、`ProbeOQ15a`、`ProbeOQ15b` 各写 `if … clearshaderoverride RA3DROQ01Shader endif`，对 `ProbeOQ01lc` 写 `clearshaderoverride RA3DROQ01ShaderLC`。
  5. 写出期望/判定表（交 P1-T09 使用）：
     - OQ-01：盟军载具（矿车、MCV）在主画面纯红；**水面倒影中的同一载具**与**阴影**保持正常 → 路线 1 成立且 clear 有效。
     - OQ-02：载具以正常材质出现 → 回退正向（GT-19 ✅）；消失 → "不画"。
     - OQ-15a：载具纯红且完整 → override technique 未继承 AlphaTest（状态由 technique 决定/默认关）；载具部分或全部消失 → 材质的 AlphaTest/求值器状态泄漏进 override technique。
     - OQ-15b：载具看起来"内外翻转/空心" → technique 的 `CullMode` 生效；看起来正常 → 引擎覆盖了 cull。
- **产出文件**：`main/fx/PBR5-10-objects-ARPBR.FX`、`main/ingame.scrapeo`、manifest。
- **验证**：`fx_2_0` 编译 `main/fx/objectsallied.fx` 成功；检查器 0 告警。
- **验收标准**：新增 technique 不改变 `Default`/`Default_M`/`_CreateShadowMap`（`git diff` 只显示新增行）；开关全关时 SCRAPE 行为不变。
- **失败处理 / 决策映射**：编译失败于 VS 数组引用 → 改为与 `_CreateShadowMap` 相同的 VS 选择写法并在报告中注明。
- **知识回写**：无（P1-T09 回写）。

---

### P1-T07 探针 OQ-18：SAS 驱动的 shader 数组在帧内逐段切换（路线 3）
- **执行者**：agent　**规模**：M　**依赖**：P1-T06
- **目标**：验证在材质原有 `Default` technique 内，以 `Deferred.GBufferMode` 为下标的 PS 数组能否被 SCRAPE 在主帧不透明段内切换、段外恢复。
- **前置条件**：P1-T06 已合入（共用 `PS_RA3DR_Red`）。
- **必读上下文**：本卡；`main/fx/PBR5-10-objects-ARPBR.FX` 的 `technique Default`（锚点 `technique Default`，约 L716–L740）；[`corona-pbr-ibl-notes.md`](../.agents/skills/ra3-fx-shader/references/corona-pbr-ibl-notes.md) §1 `CoronaPostEffects.fx` 行（shader 数组 + SAS 下标先例）。
- **步骤**：
  1. 在 ARPBR 核心中（`// [RA3DR P1-T07]` 注释包裹）声明：
     ```hlsl
     float RA3DR_GBufferMode < string UIWidget = "None"; string SasBindAddress = "Deferred.GBufferMode"; > = 0;
     ```
  2. 读取 `technique Default` 的 `PixelShader = …` 行：
     - 若为 `compile ps_3_0 PS_X(args)` 单一形式：新增 `PixelShader PS_RA3DR_DefaultArr[2] = { compile ps_3_0 PS_X(args), compile ps_3_0 PS_RA3DR_Red() };`，把该行改为 `PixelShader = PS_RA3DR_DefaultArr[ (int)clamp(RA3DR_GBufferMode, 0, 1) ];`。
     - 若已是 `PS_Y_Array[ expr ]`（K 项）：新增长度 2K 的数组（前 K 项照抄原数组元素，后 K 项全为 `compile ps_3_0 PS_RA3DR_Red()`），下标改为 `expr + K * (int)clamp(RA3DR_GBufferMode, 0, 1)`。
     - 原行以注释保留：`// [RA3DR P1-T07] was: PixelShader = ...`。
     - **只改 `Default`**（`Default_M` 不改；测试时画质用高）。
  3. `main/ingame.scrapeo`：在 P1-T06a 块之后追加标记块 `P1-T07a`：`if Deferred ProbeOQ18` / `setfloat Deferred GBufferMode 1` / `endif`；在 P1-T06b 块之后追加 `P1-T07b`：`if Deferred ProbeOQ18` / `setfloat Deferred GBufferMode 0` / `endif`。（`configureDeferredFlags` 每帧开头已有 `setfloat Deferred GBufferMode 0`。）
  4. 判定表（交 P1-T09）：
     - 主画面盟军载具纯红，**倒影正常**，阴影正常 → OQ-18 ✅（逐段生效）。
     - 主画面与倒影**都红** → 值按帧锁存或最后一次写入覆盖全帧 → OQ-18 ✘（路线 3 不可用于逐段切换）。
     - 都不红 → SAS 未传入场景材质或 preshader 不重算 → OQ-18 ✘。
     - 画质设为"中"时（`Default_M`）载具不红 → 预期（证明 LOD technique 需分别改造，P4-T14）。
- **产出文件**：`main/fx/PBR5-10-objects-ARPBR.FX`、`main/ingame.scrapeo`。
- **验证**：编译 `objectsallied.fx`；`/T ps_3_0 /E PS_RA3DR_Red` `/Fc` 无冲突；检查器 0 告警；确认 `ProbeOQ18=false` 时 `GBufferMode` 恒为 0（下标 = 原表达式）。
- **验收标准**：`RA3DR_GBufferMode=0` 时选择的 PS 与修改前逐项相同（在报告中列出数组映射）。
- **失败处理 / 决策映射**：fxc 不接受 `(int)` 浮点转换作数组下标 → 改用 `bool RA3DR_GBufferPass`（`SasBindAddress = "Deferred.GBufferPass"`，SCRAPE 用 `setbool`），并在报告中记录。
- **知识回写**：无（P1-T09 回写）。

---

### P1-T08 探针 OQ-19：MRT 混合（alpha 来源 / `R32F` 是否混合 / `ColorWriteEnable1` 是否被拒）
- **执行者**：agent　**规模**：M　**依赖**：P1-T03
- **目标**：为地形叠加层与 G-Buffer 贴花方案提供依据。
- **前置条件**：OQ-05 的 4 张 RT 声明（`RA3DR_P05_RT0..3`）已存在。
- **必读上下文**：`deferred-techniques-sm3.md` §7.1（表格）；[`pitfalls.md`](../.agents/skills/ra3-scrape-pipeline/references/pitfalls.md) §3.7；`main/fx/probe/ProbeView.fx`。
- **步骤**：
  1. 在 `ProbeView.fx` 新增 `technique ClassifyOQ19`（区域 = `ProbeRect`，2×2 子格对应 RT0..3）：从 `ProbeTex0..3` 读取左半区域中心的值 `v`，按下表输出判定色：
     - RT0（期望 alpha 0.5 混合）：`v.r≈0.5` → 绿；`v.r≈1` → 蓝（未混合）；其它 → 红。
     - RT1：`v.r≈0.5` → 绿（使用 `oC0.a`）；`v.r≈0.25` → 黄（使用 `oC1.a`）；`v.r≈1` → 蓝（未混合）；其它 → 红。
     - RT2：`v.r≈0.5` → 绿（`oC0.a`）；`v.r≈1` → 黄或蓝（`oC2.a=1` 与未混合不可区分，记为"黄"）；其它 → 红。
     - RT3（`R32F`）：`v.r≈15` → 绿（`oC0.a`）；`≈17.5` → 黄（`oC3.a`）；`≈20` → 蓝（未混合）；其它 → 红。
     容差 ±0.02（RT3 ±0.05）。
  2. SCRAPE（`proc probePreFrame` 内，标记块 `P1-T08a`，放在 `P1-T03b` 之后、使用同一组 RT）：
     ```text
     	if Deferred ProbeOQ19
     		beginevent RA3DR_OQ19
     		setdepth NULL
     		settarget 0 RA3DR_P05_RT0
     		settarget 1 RA3DR_P05_RT1
     		settarget 2 RA3DR_P05_RT2
     		settarget 3 RA3DR_P05_RT3
     		setfloat Deferred ProbeRect 0 0 1 1
     		setfloat Deferred ProbeColor0 0 0 0 1
     		setfloat Deferred ProbeColor1 0 0 0 1
     		setfloat Deferred ProbeColor2 0 0 0 1
     		setfloat Deferred ProbeColor3 10 0 0 1
     		setshader RA3DRProbeShader FillMRT
     		renderquad
     		setfloat Deferred ProbeRect 0 0 0.5 1
     		setfloat Deferred ProbeColor0 1 1 1 0.5
     		setfloat Deferred ProbeColor1 1 1 1 0.25
     		setfloat Deferred ProbeColor2 1 1 1 1
     		setfloat Deferred ProbeColor3 20 0 0 0.75
     		setshader RA3DRProbeShader FillMRTBlend
     		renderquad
     		settarget 1 NULL
     		settarget 2 NULL
     		settarget 3 NULL
     		callproc setFrameRenderTarget
     		callproc setFrameDepthBuffer
     		endevent RA3DR_OQ19
     	endif
     ```
     注：OQ-19 与 OQ-05 共用 RT，**两者不能同时开启**（P1-T09 的变体保证这一点）。
  3. `proc probeAfterPostFX` 标记块 `P1-T08b`：`if Deferred ProbeOQ19` → 绑定 `ProbeTex0..3 = RA3DR_P05_RT0..3` → `setfloat Deferred ProbeRect 0.55 0.10 1.00 0.50` → `setshader RA3DRProbeShader ClassifyOQ19` → `renderquad` → `endif`。
  4. 可选（默认剥离）标记块 `P1-T08cw`：在 `ProbeView.fx` 新增 `technique FillMRT_CW1`（同 `FillMRT` 但 `ColorWriteEnable1 = 0;`），SCRAPE 中 `if Deferred ProbeOQ19` 内再画一次。用于检验 D16 的引擎黑名单（可能报错或崩溃，所以单独变体测试）。
- **产出文件**：`main/fx/probe/ProbeView.fx`、`main/ingame.scrapeo`。
- **验证**：编译 + 检查器。
- **验收标准**：判定色逻辑在报告中给出伪代码；`P1-T08cw` 可被 `-Strip`。
- **失败处理 / 决策映射**：见 P1-T09。
- **知识回写**：无。

---

### P1-T09 构建 B 打包 + USER-RUN（OQ-01 / OQ-02 / OQ-15 / OQ-18 / OQ-19）
- **执行者**：agent（打包/记录）+ USER-RUN　**规模**：M　**依赖**：P1-T06、P1-T07、P1-T08
- **目标**：用 6 个"只换 `ingame.scrapeo` 开关"的变体回答 technique 路由类问题。
- **前置条件**：P1-T06..T08 已合入。
- **必读上下文**：README §4；P1-T06/T07/T08 判定表；`tests/scenes.md`。
- **步骤**：
  1. 构建变体（同一套 `.fxo`，仅 `-Flags`/`-Strip` 不同）：
     - `P1-B1`：`ProbeOQ01=true,ProbeOQ19=true`，`-Strip "P1-T06lc,P1-T08cw"`
     - `P1-B2`：`ProbeOQ01lc=true`（不剥离 `P1-T06lc`），`-Strip "P1-T08cw"`
     - `P1-B3`：`ProbeOQ02=true`，`-Strip "P1-T06lc,P1-T08cw"`
     - `P1-B4`：`ProbeOQ15a=true`，`-Strip "P1-T06lc,P1-T08cw"`
     - `P1-B5`：`ProbeOQ15b=true`，`-Strip "P1-T06lc,P1-T08cw"`
     - `P1-B6`：`ProbeOQ18=true`，`-Strip "P1-T06lc,P1-T08cw"`
     - （可选）`P1-B7`：`ProbeOQ19=true`，不剥离 `P1-T08cw`
  2. 写 `tests/user-run/P1-T09.md`：场景 = 遭遇战，玩家选盟军，地图有水面（GS-01）；造出矿车并让其停在水边（倒影可见）。每个变体观察：
     1. 能否进入对局？金丝雀是否出现？
     2. 主画面盟军载具颜色（红 / 正常 / 消失 / 部分消失 / 空心翻转）。
     3. 水面倒影中同一载具的颜色。
     4. 载具阴影是否正常。
     5. （B1）右上区域四子格的判定色。
     6. （B6）把画质改为"中"后载具颜色。
     7. （B7）游戏是否报错/崩溃，右上判定色。
     8. 抓帧（若可用，B1/B4/B5）：被红色绘制的 draw 的 `D3DRS_CULLMODE`、`ALPHATESTENABLE`、`ALPHABLENDENABLE` 实际值。
  3. 结果写 `tests/results/P1-T09.md`，按判定表关闭：
     - OQ-01：B1 主画面红 + 倒影正常 → ✅；B1 不红但 B2 红 → ✅（注册名大小写敏感，记录正确大小写）；都不红 → ✘；倒影也红 → `clearshaderoverride` 失效（记录，DG-1 考虑"帧尾统一 `endDepthOverrideTechnique`"兜底）。
     - OQ-02：B3 正常显示 → GT-19 ✅（回退）；消失 → GT-19 改写为"不绘制"。
     - OQ-15：B4/B5 结论 → 写入 GT-20 补充"override technique 状态来源"。
     - OQ-18：B6 按 P1-T07 判定表。
     - OQ-19：B1 第 5 项按 P1-T08 判定表；B7 → D16 是否成立。
- **产出文件**：`tests/user-run/P1-T09.md`、`tests/results/P1-T09.md`。
- **验证**：各变体 `build.ps1` 成功。
- **验收标准**：OQ-01、OQ-02、OQ-15、OQ-18、OQ-19 均有明确结论。
- **失败处理 / 决策映射**：B2 加载失败（重复 `var shader` 同文件）→ 记录"同一 `.fx` 不能被两个 `var shader` 声明"，OQ-01 只以 B1 为准。
- **知识回写**：`dictionaries/engine-ground-truth.md` GT-18、GT-19、GT-20 更新置信度；新增 GT-36（OQ-18）、GT-37（OQ-19 MRT 混合）；`knowledge/open-questions.md` 关闭对应条目；`.agents/skills/ra3-fx-shader/SKILL.md` §3"缺名回退"段与 `ra3-scrape-pipeline/references/pitfalls.md` §3.4 的置信度标签按 PK-T03 规则更新。

---

### P1-T10 OQ-13 静态部分：Stencil 写入者全量盘点
- **执行者**：agent　**规模**：S　**依赖**：无
- **目标**：确认 bit 7 未被任何官方/FXFXH/日冕 shader 写入，为 D4 提供静态证据，并列出抓帧会话 C 需核对的项。
- **前置条件**：无。
- **必读上下文**：OQ-13 小节；GT-26。
- **步骤**：
  1. 执行：
     ```powershell
     Select-String -Path "D:\PROJECTS\SAGE shader source\RA3_Shaders\*.fx*","C:\Desktop01\MYGITHUB\custom-shaders-RedAlert3\FXFXH\*.f*","D:\PROJECTS\SAGE shader source\CORONA Shaders 240820\*.fx*" -Pattern 'Stencil(Enable|Ref|Mask|WriteMask|Func|Pass|Fail|ZFail)' | % { "$(Split-Path $_.Path -Leaf):$($_.LineNumber): $($_.Line.Trim())" }
     ```
  2. 整理为表：文件 | technique | StencilRef | Mask | WriteMask | Func/Pass | 推断用途 | 占用位。
  3. 结论写入 `knowledge/open-questions.md` OQ-13 小节"静态结果"段；明确 `FXcutDepthBuffer.FX` 占用 bit 7（与 D4 冲突），给出处理建议（同一构建中不同时部署，或改其为 bit 6）。
  4. 列出 P1-T12 抓帧时需核对：主帧结束时 `DepthBuffer` stencil 值分布（应只含 0..7）。
- **产出文件**：`knowledge/open-questions.md`（OQ-13 小节补充）。
- **验证**：命令输出贴进报告。
- **验收标准**：所有写 stencil 的 technique 已列出。
- **失败处理 / 决策映射**：发现 bit 7 已被官方使用 → 升级 lead 修订 D4（候选 bit 6/5）。
- **知识回写**：`dictionaries/engine-ground-truth.md` GT-26 证据栏追加"静态盘点（日期）"。

---

### P1-T11 设置矩阵与地编冒烟（OQ-10 记录 / OQ-17）
- **执行者**：USER-RUN（可与 P1-T05 同一会话）　**规模**：S　**依赖**：P1-T05
- **目标**：记录 HDR 关 / AA 开时的主帧路由与格式；确认探针构建不破坏 WorldBuilder。
- **前置条件**：`P1-A1` 构建可用。
- **必读上下文**：OQ-10、OQ-17 小节；README D5。
- **步骤**：
  1. 在 `tests/user-run/P1-T05.md` 末尾追加（或单独 `tests/user-run/P1-T11.md`）观察项：
     1. HDR 关、AA 关：游戏是否正常？金丝雀是否出现？（抓帧：`FrameRenderTarget` 是否使用、`FrameBuffer` 格式。）
     2. HDR 开、AA 开：同上；左上 OQ-05 区域是否仍正常（AA 下 `DepthBuffer` 仍为 1x，探针不受影响则正常）。
     3. 用 `P1-A1` 构建启动 WorldBuilder，打开 GS-06 地图：是否崩溃、视口是否正常？
  2. 结果写 `tests/results/P1-T11.md`。
- **产出文件**：`tests/results/P1-T11.md`。
- **验证**：—
- **验收标准**：三项均有记录。
- **失败处理 / 决策映射**：WorldBuilder 崩溃 → 新增 `var` 或 `proc` 与 `proc Editor` 冲突：二分剥离定位；结论写 OQ-17，并在 DG-1 中要求"所有新增资源必须可被 Editor 容忍"。
- **知识回写**：GT-14（HDR 关格式）、OQ-17 状态更新。

---

### P1-T12 抓帧会话 C：shader 覆盖率（OQ-14）、排序层（OQ-09）、Stencil（OQ-13）、地形分层（OQ-21）
- **执行者**：USER-RUN（抓帧）+ agent（整理）　**规模**：L　**依赖**：P0-T03、P1-T10
- **目标**：得到"主帧不透明段每个 draw 使用哪个 shader/technique"的清单，以及地形各回调的 draw 结构。
- **前置条件**：抓帧工具可用（否则本卡降级为静态分析，见失败处理）。
- **必读上下文**：OQ-09、OQ-14、OQ-21 小节；[`material-family-inventory.md`](../.agents/skills/ra3-fx-shader/references/material-family-inventory.md) §2；[`renderbin-dict.md`](../dictionaries/renderbin-dict.md)。
- **步骤**：
  1. 写 `tests/user-run/P1-T12.md`：使用**原版主线构建**（开关全关，`P1-A1` 去掉 flags 即可）分别在 GS-01、GS-04 抓帧；在 `UpdateFrameBuffer` 事件中，从 `renderTerrain` 到 `renderbin StaticSort5`，对每个 draw 记录：调用所在回调/bin（按顺序推断）、绑定的 VS/PS（若工具显示 effect/technique 名则记录名称，否则记录 shader 哈希 + 指令数）、`ALPHABLENDENABLE`/`SRCBLEND`/`DESTBLEND`/`ZWRITEENABLE`/`CULLMODE`/`STENCILENABLE`/`STENCILREF`/`STENCILWRITEMASK`、绑定的纹理名。另外记录帧末 `DepthBuffer` stencil 值直方图。
  2. 地形专项（OQ-21）：`renderTerrain` 内 draw 数量与各自混合状态（区分 TerrainTile 不透明 / Cliff / Road / Scorch 叠加）；`renderRoads`、`renderScorchMarks`、`renderTerrainTracks` 各自 draw 的 shader 与混合状态。
  3. 代理把用户导出的数据整理为 `tests/coverage/oq14-shader-coverage.md`：表 `shader(资源名) | 所在回调/bin | draw 数 | 混合? | 写 stencil? | 有 _CreateShadowMap | 有 _CreateDepthMap | FXFXH 是否有对应源 | 迁移优先级(P1/P2/P3/X)`；以及 `tests/coverage/oq21-terrain-draws.md`。
  4. OQ-09：标出 `StaticSort5`/`renderBinsStaticSort` 中的**不透明** draw。
- **产出文件**：`tests/user-run/P1-T12.md`、`tests/coverage/oq14-shader-coverage.md`、`tests/coverage/oq21-terrain-draws.md`、`tests/results/P1-T12.md`。
- **验证**：覆盖率表行数与抓帧 draw 数对得上（允许合并同 shader 的 draw）。
- **验收标准**：①OQ-14 表覆盖主帧不透明段所有 draw；②OQ-21 明确每个地形回调的 technique/混合状态；③stencil 直方图已记录。
- **失败处理 / 决策映射**：抓帧不可用 → 降级：用 `material-family-inventory.md` + `renderbin-dict.md` 写"推断覆盖率表"（全部标 `❓`），OQ-21 改为在 P4-T11 中用游戏内调试视图逐步排查；DG-1/DG-T 仍可进行，但风险栏注明。
- **知识回写**：OQ-09、OQ-13、OQ-14、OQ-21 状态；GT-25/GT-26 证据栏；[`material-family-inventory.md`](../.agents/skills/ra3-fx-shader/references/material-family-inventory.md) 中"引擎按物体类型分 bin ❓"若被证实则更新标签。

---

### P1-T13 DG-1：G-Buffer 激活路线、格式与尺寸决策
- **执行者**：lead-review　**规模**：S　**依赖**：P1-T05、P1-T09、P1-T11、P1-T12
- **目标**：基于实测结论定稿 D2/D3/D11，并标记后续卡片的分支。
- **前置条件**：上述结果文件齐全。
- **必读上下文**：`tests/results/P1-T05.md`、`P1-T09.md`、`P1-T11.md`、`P1-T12.md`；README §7。
- **步骤**：
  1. 按下表决定激活路线：

     | OQ-05 | OQ-18 | OQ-01 | 决定 |
     |---|---|---|---|
     | ✘ | — | — | **停止**：升级重规划（R2） |
     | ✅ | ✅ | 任意 | **路线 3**（推荐全家族统一；地形必须用路线 3）。若 OQ-01 也 ✅，允许个别家族用路线 1，但须在 D2 中逐家族列出 |
     | ✅ | ✘ | ✅ | **路线 1**；地形方案由 DG-T 从"非路线 3"选项中选 |
     | ✅ | ✘ | ✘ | **路线 2**（`_CreateDepthMap` + Stencil bit 7 + 前向补画）；追加执行 OQ-03 探针（复用 P1-T06 结构，写一张临时卡 P1-T06x） |
  2. 格式：OQ-04 ✅ → RT1 `A2R10G10B10`；✘ → `A8R8G8B8`。尺寸变量：OQ-06 结论。
  3. 合成数据来源：OQ-12 每项 ✅/✘ → P5-T02/T03/T04 使用"直接 SAS"或"G-Buffer 预计算"分支。
  4. 状态策略：OQ-15 → G-Buffer technique 必须显式写全部状态（默认如此）；若 AlphaTest 会泄漏，确认 D3 中"RT0.a 固定 1"。
  5. OQ-19 → 记录 D16 是否成立；把结论转交 DG-T。
  6. 更新 README §7（D2、D3、D11、D16 状态改为 ✅ 并写依据）；在 task-board 中把不适用的分支卡标 `⏭️`（例如路线 1 被选中时，P4 各卡中"路线 3 子步骤"不执行——卡片本身不跳过）。
- **产出文件**：README §7、task-board。
- **验证**：决策日志新行存在且引用结果文件。
- **验收标准**：D2、D3 状态为 ✅。
- **失败处理 / 决策映射**：见表。
- **知识回写**：PK-T01。

---

### P1-T14 DG-T：地形叠加层（`Cliff/Road/Scorch`）G-Buffer 策略
- **执行者**：lead-review　**规模**：S　**依赖**：P1-T09、P1-T12、P1-T13
- **目标**：为 P4-T11 选定地形方案。
- **前置条件**：OQ-18、OQ-19、OQ-21 已有结论。
- **必读上下文**：`tests/coverage/oq21-terrain-draws.md`；`tests/results/P1-T09.md`；[`material-family-inventory.md`](../.agents/skills/ra3-fx-shader/references/material-family-inventory.md) §3.4；`main/fx/TERRAIN.FX` technique 段（L856–L1185，按锚点 `technique TerrainTile` 定位）。
- **步骤**：从下列方案中选择一个写入 README §7（新增 `D18 地形方案`）：

  | 方案 | 条件 | 做法 | 代价 |
  |---|---|---|---|
  | **T-B 单遍 MRT 混合** | OQ-18 ✅ 且 OQ-19：4 RT 混合生效（RT0..2 绿或黄、RT3 任意非红） | 路线 3：`TerrainTile` 在 G-Buffer 模式输出 MRT 不混合；`Cliff/Road/Scorch` 在 G-Buffer 模式输出 MRT 并保留 `SrcAlpha/InvSrcAlpha`，**所有 RT 写相同 alpha**；RT3 写本像素同一 `viewZ`（与底层相同→混合/覆盖结果不变）；RT1 混合后的法线在解码时 `normalize` | 1 遍；依赖驱动 MRT 混合 |
  | **T-A 双遍** | OQ-18 ✅，OQ-19 ✘ | 第 1 遍 4-MRT、`GBufferMode=1`：`TerrainTile` 写全部 RT，叠加层 `clip(-1)`；第 2 遍只绑 RT0（必要时第 3 遍只绑 RT2）、`GBufferMode=3`：`TerrainTile` `clip(-1)`，叠加层把 albedo 混合进 RT0；叠加层法线沿用底层 | 地形 2–3 遍 |
  | **T-D 地形保持前向** | OQ-18 ✘（路线 1/2，technique 被折叠） | G-Buffer 段只用深度类 override 写 RT3 + 硬件深度 + RT1（由深度导数重建几何法线），RT1.a 类别 = "前向地形"；合成跳过该类像素；合成后用原 technique 前向绘制 `renderTerrain`（`ZFunc LESSEQUAL`）；局域光对地形用 G-Buffer 几何法线 + 常量 albedo 近似 | 地形光照与物体不一致；局域光对地形不准 |
  | **T-C 混合方案** | OQ-18 ✅ 但项目选路线 1 | 物体路线 1，地形单独路线 3（T-A 或 T-B） | 两套机制 |

  决策后在 P4-T11 卡的"前置条件"中标注所选方案编号。
- **产出文件**：README §7（D18）。
- **验证**：—
- **验收标准**：D18 为 ✅，并写明依据。
- **失败处理 / 决策映射**：OQ-21 不清楚（无抓帧）→ 暂定 T-A（最保守的路线 3 方案）或 T-D，并在 P4-T11 中加入游戏内验证步骤。
- **知识回写**：PK-T01。
