# 延迟渲染改造必须实机验证的开放问题（Open Questions）

> **用途**：列出所有"静态证据不足、但会决定设计走向"的问题。每条给出：为何重要、阻塞的 Phase（见 `AGENTS.md` §5.3 路线图）、**最便宜的实验步骤**、观察手段、预期结果 → 决策映射。
> - 事实背景见 [`engine-behavior.md`](./engine-behavior.md)（`GT-xx`）与 [`engine-ground-truth.md`](../dictionaries/engine-ground-truth.md)。
> - 实验结论出来后：在 `engine-ground-truth.md` 对应行改置信度为 `✅已实机验证` 并写明日期/截图或抓帧文件名，然后在本文件该条标注 `【已关闭 YYYY-MM-DD → GT-xx】`。
> - 通用约定：所有实验在 **AA 关闭、HDR 开启** 的画质下进行（除非另注）；脚本改动后先跑 `node "readonly/llm-skill-for-scrape/scripts/check_scrape.js" main/ingame.scrapeo`；FX 用 `& "main\fxc.exe" /nologo /O2 /T fx_2_0 /Fo <out>.fxo <src>.fx` 编译；每个实验用 `beginevent OQxx` / `endevent OQxx` 包起来，便于在 PIX/RenderDoc 中定位。

## 优先级总览

| ID | 问题（一句话） | 阻塞 Phase | 优先级 |
|---|---|---|---|
| OQ-01 | `var shader` + `setshaderoverride` 能否切换场景材质的 technique | Phase 1 | **P0** |
| OQ-02 | override 缺失时物体是回退正向 technique 还是不画 | Phase 1 | **P0** |
| OQ-04 | `A2R10G10B10`（及 `G16R16`/`R16F`）能否作 RT 写入并被采样 | Phase 0 | **P0** |
| OQ-05 | `settarget 0..3` 四路 MRT 同时绑定 + `renderbin` 是否正常 | Phase 0 | **P0** |
| OQ-06 | `$PostEffect.FrameBufferSize`、`$WW3D.FrameBufferSize`、`DepthBuffer` 尺寸是否一致 | Phase 0 | **P0** |
| OQ-10 | HDR 关闭时主帧格式/路由；延迟分支能否强制 `FrameRenderTarget` | Phase 2 | P1 |
| OQ-12 | 全屏 `renderquad` 时引擎是否填充 `Sas.DirectionalLight` / 阴影矩阵 / 相机矩阵 | Phase 2 | P1 |
| OQ-13 | Stencil bit 3..7 是否真空闲 | Phase 1–2 | P1 |
| OQ-14 | 主帧不透明提交中实际出现哪些 shader（覆盖率清单） | Phase 1 | P1 |
| OQ-15 | override technique 是否继承材质的 cull/ZWrite/ExpressionEvaluator 状态 | Phase 1 | P1 |
| OQ-08 | `StaticSort_END` 能否正常入队并单独提交 | Phase 2 | P1 |
| OQ-07 | 旧 shader 只写 `COLOR0` 时 RT1..3 的实际内容 | Phase 1 | P2 |
| OQ-11 | 光体积 draw 能否收到引擎 `Sas.PointLight[*]` | Phase 2 | P2 |
| OQ-03 | `_CreateShadowMap` 下划线/大小写是否严格 | Phase 1（仅路线 2） | P2 |
| OQ-09 | `StaticSortLevel` 是否覆盖 FX 的 `RenderBin` 注解 | Phase 2 | P3 |
| OQ-16 | 驱动是否支持 MRT 独立位深 | 仅改布局时 | P3 |
| OQ-17 | `proc Editor`（WorldBuilder）在延迟改造后是否正常 | Phase 5 | P3 |

---

## OQ-01 `setshaderoverride` 能否命中场景材质实例 【P0】
- **为何重要**：决定 G-Buffer 激活路线。路线 1 = 每个 shader 家族加独立 technique（如 `GBuffer`）+ 逐个 `setshaderoverride`；路线 2 = 把 G-Buffer 写进 `_CreateDepthMap` + `beginDepthOverrideTechnique`。EA 官方脚本**从未使用** `setshaderoverride`（GT-18），`var shader X foo.fx` 是否与场景材质共用同一个注册 shader 实例无证据。
- **阻塞**：Phase 1。
- **最便宜实验**：
  1. 在 `main/` 的 `objectsgeneric.fx`（取自 `FXFXH`，`RenderBin = "TerrainLikeGroundObject"`）中新增：
     ```hlsl
     float4 PS_DebugRed() : COLOR { return float4(1, 0, 0, 1); }
     technique DebugRed { pass P0 { VertexShader = compile vs_3_0 <该文件已有的刚体 VS>(); PixelShader = compile ps_3_0 PS_DebugRed(); } }
     ```
  2. `ingame.scrapeo` 顶部声明 `var shader OQ01Shader objectsgeneric.fx`。
  3. 在主帧 `renderbin TerrainLikeGroundObject` 前一行加 `setshaderoverride OQ01Shader DebugRed`，其后一行加 `clearshaderoverride OQ01Shader`。
  4. 进一张有贴地物（悬崖、道路装饰）的地图观察。
- **观察**：屏幕上使用 `objectsgeneric` 的物体是否变纯红；PIX 中该 draw 绑定的 PS 是否为 `PS_DebugRed`；PIX 资源列表中 `objectsgeneric` 的 effect 是否出现**两份**（说明 `var shader` 另建了实例）。
- **结果 → 决策**：
  - 变红且仅该区间内变红 → **路线 1 成立**，G-Buffer technique 用独立名（推荐 `GBuffer`），与原版 Shadow/Depth Pass 解耦。
  - 不变红 → 路线 1 不成立，切 **路线 2**（`_CreateDepthMap`），并强制配套 `OQ-03`、`OQ-07`、Valid/Stencil 过滤。
  - 变红但区间外也红 → `clearshaderoverride` 失效，记录并改用"每帧结尾统一 `endDepthOverrideTechnique` 清零"的兜底。

## OQ-02 override 索引为 `-1` 时 draw 的真实行为 【P0】
- **为何重要**：IDA 称回退正向 technique（GT-19）。若属实，任何未适配 shader 进入 G-Buffer Pass 都会污染 RT0；若实际是"不画"，则可省去大量过滤逻辑。
- **阻塞**：Phase 1。
- **最便宜实验**（与 OQ-01 同一构建）：
  1. 在 OQ-01 的 `setshaderoverride` 行改为一个**不存在**的名字：`setshaderoverride OQ01Shader NoSuchTech`。
  2. 另做一个离屏验证：在 `updateDepthMap` 内，用 PIX 观察 `beginDepthOverrideTechnique` 区间中**既无 `_CreateShadowMap` 也无 `_CreateDepthMap`** 的 shader（从 OQ-14 清单中挑一个，或临时删掉某测试 FX 的这两个 technique）。
- **观察**：物体是否仍以正常材质出现；PIX 中是否存在该物体的 `DrawIndexedPrimitive` 及绑定的是 `Default` technique 的 VS/PS；游戏日志是否有报错。
- **结果 → 决策**：
  - 仍以正常材质绘制 → 确认 GT-19；G-Buffer Pass 必须"只提交已适配家族 + Valid/Stencil 过滤 + Forward 补画"。
  - 不绘制 → 更新 GT-19；未适配物体可在 G-Buffer Pass 之后直接用 Forward 补画，无需污染防护。

## OQ-03 `_CreateShadowMap` 名称匹配是否严格（下划线 / 大小写）【P2】
- **为何重要**：IDA 称 `strcmp` 精确匹配；曾有观察称无下划线也出阴影（`Q1#L149-L167`）。只在走路线 2 或依赖原版 Shadow 回退时重要。
- **阻塞**：Phase 1（仅路线 2）。
- **最便宜实验**：复制一个测试 FX，只保留 `technique CreateShadowMap`（无下划线）编译为 `.fxo`；另一份改成 `_createShadowMap`。各自替换后进图看该物体是否投影。用 `fxc /Fc` 无法看 technique 名，需在 PIX 中确认 Shadow Pass 是否有该物体 draw。**先清空 `Shaders/Compiled` 中的同名旧 `.fxo` 防止缓存误判。**
- **结果 → 决策**：不投影 → 严格匹配确认，规范写入 skill；投影 → 查是否加载了旧 `.fxo` 或宏改名，仍以带下划线精确名为准。

## OQ-04 `A2R10G10B10` 等格式能否作 RT + 采样 【P0】
- **为何重要**：G-Buffer 布局 `RT0/RT1 = A2R10G10B10` 中该格式从未在任何 RA3 脚本中出现（GT-07）。
- **阻塞**：Phase 0。
- **最便宜实验**：
  1. 声明 `var texture OQ04A $PostEffect.FrameBufferSize.x $PostEffect.FrameBufferSize.y A2R10G10B10`，同样声明 `G16R16`、`R16F` 各一张。
  2. 在 `renderPostEffects` 之前：对每张 `settarget 0 OQ04x`、`setdepth NULL`、`setclearcolor 0.25 0.5 0.75 1`、`clearcolor`；再 `callproc setFrameRenderTarget`。
  3. 写一个 `OQ04Debug.fx` 全屏 shader 采样 `Deferred.OQ04Tex`（`settexture Deferred OQ04Tex OQ04A`），把左 1/3 屏显示出来。
- **观察**：游戏能否启动（脚本加载失败会直接报错/崩溃）；PIX 资源格式是否为 `D3DFMT_A2R10G10B10`；画面颜色是否 ≈ (0.25, 0.5, 0.75)。
- **结果 → 决策**：
  - 全部正常 → 保持 `A2R10G10B10` 布局。
  - 声明失败或格式被替换 → `RT0/RT1` 改 `A8R8G8B8`（法线改八面体或接受 8-bit 精度）。

## OQ-05 四路 MRT 同时绑定是否工作 【P0】
- **为何重要**：原版与日冕从未同时绑定 >1 个颜色目标（GT-10）；还要确认 `renderbin` 合法性检查（GT-11）在 4 RT 下通过，以及 PS 的 `COLOR1..3` 能写入。
- **阻塞**：Phase 0。
- **最便宜实验**：
  1. 声明 `GBuffer0..2`（OQ-04 通过的 32 bpp 格式）+ `GBuffer3 R32F`。
  2. 在主帧不透明之前插入：`setdepth DepthBuffer` → `settarget 0..3 GBuffer0..3` → `setviewport GBuffer0` → `setclearcolor 0.1 0.2 0.3 0.4` → `clear` → `setcamera Viewer` → `visibleobjects Frame`。
  3. 用 `setshader OQ05Shader Fill` + `renderquad`：PS 输出 `struct { float4 c0:COLOR0; float4 c1:COLOR1; float4 c2:COLOR2; float4 c3:COLOR3; }` 四种不同纯色。
  4. 再追加一次 `renderTerrain`（用 OQ-01 的 override 或原版 technique 均可）验证几何 draw 在 4 RT 下不报 "not a valid set"。
  5. 结尾 `settarget 1 NULL`..`settarget 3 NULL`，恢复主帧，并用调试 quad 分四象限显示四张纹理。
- **观察**：PIX 中 `SetRenderTarget(0..3)` 调用与四张 RT 内容；游戏日志/屏幕是否出现 SCRAPE 错误。
- **结果 → 决策**：四色正确 → MRT 基线成立；只有 RT0 有色 → 检查 `settarget` 是否只取最后一个/驱动 `NumSimultaneousRTs`，必要时退化为多 Pass G-Buffer（成本高，需重新规划）。

## OQ-06 尺寸一致性：`$PostEffect.FrameBufferSize` vs `$WW3D.FrameBufferSize` vs `DepthBuffer` 【P0】
- **为何重要**：MRT 要求宽高完全一致，深度表面需 ≥ RT（GT-11/GT-13）。原版 `DepthTexture*` 用 `$PostEffect.FrameBufferSize`，`FrameRenderTarget` 用 `$WW3D.FrameBufferSize`，`DepthBuffer` 为引擎默认尺寸。
- **阻塞**：Phase 0。
- **最便宜实验**：`settosize Deferred SizeA DepthTextureLinear`、`settosize Deferred SizeB FrameRenderTarget`、`settosize Deferred SizeC DepthBuffer`（若 `settosize` 不接受 depth surface 则只看 PIX），在调试 shader 中把三者差值可视化（相等显示绿，否则红）；同时在 PIX 读三者实际宽高。测试窗口化与非 16:9 分辨率各一次。
- **结果 → 决策**：全相等 → G-Buffer 统一用 `$PostEffect.FrameBufferSize`；不等 → G-Buffer 改用与 `DepthBuffer` 一致的尺寸变量，并检查原版 `DepthTexture` 是否本就有 viewport 偏差。

## OQ-07 只写 `COLOR0` 的旧 PS 对 RT1..3 的影响 【P2】
- **为何重要**：路线 2 下旧 `_CreateShadowMap` PS 只输出 `COLOR0`；D3D9 对未写 MRT 的结果依赖驱动（`Q3#L95-L109`）。
- **阻塞**：Phase 1（路线 2 时升为 P0）。
- **最便宜实验**：沿用 OQ-05 的 4 RT 设置，把 RT1..3 清为哨兵色 `(1,0,1,1)`，然后在 `beginDepthOverrideTechnique` 下画 `renderTerrain`/`renderUnits`（原版 shader，只写 COLOR0）；PIX 查看 RT1..3 被覆盖区域的值。
- **结果 → 决策**：保持哨兵 → Valid 通道约定（清为 0、已适配 PS 写 1）可行；被写成垃圾/0 → 必须用 Stencil 位（bit 3..7）标记有效像素，而非 MRT 通道。

## OQ-08 `StaticSort_END` 能否作为专用队列 【P1】
- **为何重要**：局域光体积 / 实验物体的专用 bin 唯一候选（GT-27）。
- **阻塞**：Phase 2。
- **最便宜实验**：把 `FXdeferredpointlight.FX` 的注解改为 `string RenderBin = "StaticSort_END";`，在主帧 `renderbin StaticSort5` 之后加 `renderbin StaticSort_END`；先**不加**这一行跑一次（确认光体积消失，即没有别的 C++ 路径在画 41 号队列），再加上跑一次（确认出现）。
- **观察**：光体积是否只在加行后出现；PIX 中 draw 是否只出现一次；Shadow/Reflection Pass 中是否意外出现。
- **结果 → 决策**：符合预期 → 光体积统一用 `StaticSort_END`；不出现/重复出现 → 退回 `StaticSort5`（接受与水下排序共享）并记录副作用。

## OQ-09 `StaticSortLevel` 覆盖 FX 注解 【P3】
- **为何重要**：带排序层的 W3X 会被强制进 `StaticSort1..5`（GT-23），可能使某些"不透明"模型逃出 G-Buffer 队列。
- **阻塞**：Phase 2（覆盖率收尾）。
- **最便宜实验**：在 OQ-14 的 PIX 清单中筛出主帧 `renderbin StaticSort5` / `renderBinsStaticSort` 区间里的不透明 draw，查其模型 `StaticSortLevel`。
- **结果 → 决策**：存在不透明物体 → G-Buffer Pass 需追加对应 `StaticSortN` 提交或保留其 Forward 路径。

## OQ-10 HDR 关闭时的主帧路由与格式 【P1】
- **为何重要**：HDR/AA 都关时主帧直接画 8-bit 后台缓冲（GT-14），延迟合成精度与 `FrameRenderTarget` 依赖需决策。
- **阻塞**：Phase 2。
- **最便宜实验**：分别在 HDR 开/关下抓帧，记录 `FrameRenderTarget`、`PostEffectFrameBufferTexture`、`WaterReflectionTexture` 的实际格式（即 `$WW3D.FrameRenderTarget*Format` 的取值）；再在 HDR 关闭时于 `updateFrameRenderTargetToUse` 后强行 `setbool WW3D IsUsingFrameRenderTarget true`，观察是否仍正常显示（后处理 LUT 是否 resolve 到 `FrameBuffer`）。
- **结果 → 决策**：强制可行 → 延迟分支始终画到 `FrameRenderTarget`；不可行 → 延迟分支要求 HDR 开启（关闭时整体回退原版前向）。

## OQ-11 光体积 draw 能否收到引擎点光源 【P2】
- **为何重要**：引擎没有光源列表接口（GT-33）。若光体积 / 代理 Mesh 的 draw 也被填充 `Sas.PointLight[*]`（附近 ≤8 个），即可把引擎原生动态光转为延迟光。
- **阻塞**：Phase 2（局域光来源设计）。
- **最便宜实验**：在光体积 FX 中声明 `int NumPointLights <string SasBindAddress="Sas.NumPointLights";>` 与 `PointLight[8]`（按 `main/COMMON.FXH` 的 `c89` 布局），PS 输出 `NumPointLights / 8` 灰度与 `PointLight[0].Color`；在有爆炸/路灯的场景观察。
- **结果 → 决策**：有值且随场景变化 → 设计"代理体积读取引擎光"方案；恒为 0 → 局域光只能来自放置的光体积物体。

## OQ-12 全屏 quad 下的 `Sas.*` 全局量是否有效 【P1】
- **为何重要**：延迟合成是 `renderquad`，而 `Sas.DirectionalLight[*]`、`Sas.Shadow[0].WorldToShadow`、`View/ViewInverse/ProjectionInverse` 等原本随场景 draw 提交（GT-30/GT-32）。原版 `PostFX_LinearDepth.fx` 用 `ProjectionInverse`、`UnderwaterDeferred.fx` 用阳光方向，提示至少部分可用，但需逐项确认。
- **阻塞**：Phase 2。
- **最便宜实验**：写 `OQ12Debug.fx`，在 `setcamera Viewer` 后 `renderquad`，把 `DirectionalLight[0].Direction*0.5+0.5`、`DirectionalLight[0].Color`、`ShadowMapWorldToShadow[0]`、`ViewInverse[3].xyz`（相机位置）分别输出到屏幕四象限；与同帧场景 shader 在 PIX 常量面板中的值对比。
- **结果 → 决策**：一致 → 直接绑定；某项为 0/过期 → 改由 SCRAPE `setfloat Deferred ...` 不可得（脚本无法读引擎值），需寻找该值的 SAS 名或在 G-Buffer Pass 中由几何 PS 写入（如阴影可在 G-Buffer 阶段算好存入通道）。

## OQ-13 Stencil bit 3..7 是否空闲 【P1】
- **为何重要**：延迟有效像素 / 光体积掩码要用 Stencil（GT-26），不能干扰描边 bit 0..1 与贴花 bit 2。
- **阻塞**：Phase 1–2。
- **最便宜实验**：grep `RA3S` 与 `FXFXH` 中所有 `StencilEnable/StencilRef/StencilMask/StencilWriteMask`；再在 PIX 中查看主帧结束时 `DepthBuffer` 的 stencil 值分布（应只有 0..7）。
- **结果 → 决策**：仅 0..7 出现且源码无其它写入 → 约定 bit 3 = "延迟有效像素"，bit 4..7 预留；否则重新分配。

## OQ-14 主帧不透明提交的 shader 覆盖率清单 【P1】
- **为何重要**：GT-19 的污染风险与路线选择都依赖"哪些 `.fxo` 在 G-Buffer 区间内出现、各自是否有 G-Buffer/Shadow technique"。
- **阻塞**：Phase 1（其后每扩一个家族重复一次）。
- **最便宜实验**：在一张包含三阵营单位、建筑、树、桥、道路、水的地图上用 PIX/RenderDoc 抓一帧，导出主帧 `renderTerrain … renderbin StaticSort5` 区间（含 `UnitOutline*`/`StructureOutline*`）每个 draw 的 effect 文件名与 technique；整理成表：`shader | 所在回调/bin | 有无 _CreateShadowMap | 有无 _CreateDepthMap | 有无 G-Buffer technique`。
- **结果 → 决策**：该表直接作为 Phase 1 适配顺序与 Forward 补画名单。

## OQ-15 override technique 的渲染状态来源 【P1】
- **为何重要**：官方 technique 带 `string ExpressionEvaluator = "Objects"` 注解，引擎可能据此设置 cull/ZWrite/AlphaRef 等（GT-20）；override 后的 G-Buffer technique 是否仍受影响未知。双面植被、镂空建筑破损需要正确 cull 与 `clip`。
- **阻塞**：Phase 1。
- **最便宜实验**：G-Buffer technique 中**不写** `CullMode`，对双面树叶（`basicw3dTREE.FX` 家族）抓帧看 PIX 中的 `D3DRS_CULLMODE`；再在 technique 中显式写 `CullMode = NONE` 对比。同时比较编译时加/不加 `/D _WW3D_` 的差异。
- **结果 → 决策**：引擎仍设置 → G-Buffer technique 可沿用材质状态；不设置 → 在每个家族的 G-Buffer technique 中显式写全部状态（`CullMode`、`ZEnable`、`ZWriteEnable`、`AlphaBlendEnable=false`、`AlphaTestEnable=false`）。

## OQ-16 MRT 独立位深 【P3】
- **为何重要**：仅当想混用 `R32F` + `A16B16G16R16F` 等不同位深时需要；当前 4×32 bpp 布局不依赖。
- **最便宜实验**：OQ-05 设置中把 RT2 换成 `A16B16G16R16F`，看是否报错/黑屏。
- **结果 → 决策**：失败即维持 4×32 bpp，不作为默认依赖。

## OQ-17 WorldBuilder（`proc Editor`）兼容 【P3】
- **为何重要**：地编执行 `proc Editor` 而非 `InGame`（`D02#L20-L21`），共享同一 `.scrapeo` 资源声明。
- **阻塞**：Phase 5。
- **最便宜实验**：每个 Phase 结束后打开 WorldBuilder 加载一张图，确认不崩溃、视口正常。
- **结果 → 决策**：异常 → `proc Editor` 保持纯原版前向路径并确保新增 `var` 声明不影响它。

---

## 已关闭 / 不再实验的问题

| 问题 | 结论 | 依据 |
|---|---|---|
| `D24S8` 能否经 `casttexture`/`stretchrect` 变成可采样纹理 | 不能；`casttexture` 在 PC 为 NoOp | GT-09 |
| 能否注册新 RenderBin 名（`geobuffer`） | 不能；固定 47 项 | GT-22 |
| `setshader` 能否替换场景 shader | 不能；只影响 `renderquad` | GT-15 |
| FOURCC `INTZ/RESZ` 深度纹理 | 无任何证据，不规划 | GT-08 |
