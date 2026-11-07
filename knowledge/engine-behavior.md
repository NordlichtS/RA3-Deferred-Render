# RA3 v1.12 PC 引擎（`ra3_1.12.game`）行为知识库 —— 已核实事实与推测分离

> **定位**：把前代 GPT-5.6 的 IDA 逆向结论、官方 RA3 Shader/SCRAPE 源码、原版与日冕 Mod `.scrapeo` 实机脚本，以及 [`diagrams/vanilla-pipeline-reference.md`](../diagrams/vanilla-pipeline-reference.md) 的最新勘误，去重合并为**一份按主题组织的引擎行为说明**。
> - 紧凑事实账本见 [`dictionaries/engine-ground-truth.md`](../dictionaries/engine-ground-truth.md)（本文各条目的 `GT-xx` 编号与账本一一对应）。
> - 尚未定论、必须实机验证的问题见 [`knowledge/open-questions.md`](./open-questions.md)（`OQ-xx`）。
> - SCRAPE 命令语法细节归 [`ra3-scrape-pipeline`](../.agents/skills/ra3-scrape-pipeline/SKILL.md) 技能；寄存器/SAS 明细归 [`hlsl-register-sas-dict.md`](../dictionaries/hlsl-register-sas-dict.md)。本文只讲**引擎在 C++ 侧怎么做**。

## 0. 置信度标签与来源缩写

| 标签 | 含义 | 使用规则 |
|---|---|---|
| `✅已实机验证` | 游戏内运行过（原版脚本本身每帧在跑，或日冕 Mod / `FXFXH` 原型实测成功） | 可直接作为设计前提 |
| `📄源码确认` | 从 EA 官方 RA3 源码、`main/ingame.scrapeo` 或 `scrapeo rules from asm.txt` 字符串表直接读出 | 可作前提，但运行时细节仍可能有偏差 |
| `🔍IDA静态推测` | 仅来自 `ra3_1.12.game` 反编译（前代模型） | **只能当假设**；被依赖前须有对应 `OQ-xx` 实测 |
| `❓待实测` | 无可靠证据 | 必须先做 `OQ-xx` 实验 |

来源缩写（均为仓库相对路径）：
- `VPR` = `diagrams/vanilla-pipeline-reference.md`（**最高优先级事实源**）；`DIN` = `dictionaries/distillation-and-issues-notes.md`
- `ASM` = `readonly/scrapeo rules from asm.txt`；`D01` = `readonly/docs/01_PROJECT_INDEX_AND_RESOURCES.md`；`D02` = `readonly/docs/02_ENGINE_CONSTRAINTS_AND_FINDINGS.md`；`D03` = `readonly/docs/03_DEFERRED_RENDERING_ROADMAP.md`
- `Q1..Q5` = `readonly/llm-analysis/问题1..5_*.md`；`OVR` = `readonly/llm-analysis/SCRAPE_OVERRIDE与D24S8深度纹理结论.md`；`CMD` = `readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md`；`DISC` = `readonly/llm-analysis/DEFERRED_RENDERING_DISCOVERY_AND_PLAN.txt`；`PLAN` = `readonly/llm-analysis/DEFERRED_RENDERING_PLAN.md`
- `ISO` = `main/ingame.scrapeo`（原版）；`COR` = `readonly/ingame.scrapeo modded corona.txt`（日冕 Mod，实机可运行）
- `RA3S` = `D:\PROJECTS\SAGE shader source\RA3_Shaders\`（官方源码，只读）；`FXFXH` = `C:\Desktop01\MYGITHUB\custom-shaders-RedAlert3\FXFXH\`

---

## 1. 脚本加载、资源分配与跨帧状态

### GT-01 `.scrapeo` 是预处理后的文本，256 字节行缓冲
- **结论**：游戏加载 `Shaders/Compiled/ingame.scrapeo` 后逐行解析；`#` 开头整行当注释，`#define/#include/#if` 不会被执行，宏必须在生成 `.scrapeo` 前展开（如 `BinCommand_RenderParticles` 手写为 `1`）。单行含换行必须 < 256 字节，超长导致加载失败。
- **证据**：`[src: readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md#L49-L68]`（`0x9A6710` 加载、`0x9C5920` 逐行读取）；`[src: readonly/docs/02_ENGINE_CONSTRAINTS_AND_FINDINGS.md#L11-L19]`。
- **置信度**：`🔍IDA静态推测`（行长限制已被项目长期遵守并内置于 `check_scrape.js`，视为工程硬约束）。
- **设计影响**：所有新 `.scrapeo` 行修改后运行 `node "readonly/llm-skill-for-scrape/scripts/check_scrape.js" <文件>`；中文注释单独成行。

### GT-02 资源在加载时一次性分配，帧间不销毁、不别名复用
- **结论**：顶层 `var surface/texture/texturecube` 在脚本加载 / 设备初始化时于 `D3DPOOL_DEFAULT` 创建，仅在 Device Reset（改分辨率、切 AA、最小化）时重建。**没有帧内瞬态显存复用**：总显存 = 所有声明之和。`settexture` 只绑定、不创建。
- **证据**：`[src: diagrams/vanilla-pipeline-reference.md#L84-L91]`；`[src: readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md#L268]`。
- **置信度**：`📄源码确认`（VPR 勘误 + 原版脚本结构）。
- **设计影响**：延迟分支若废弃 `updateDepthMap`，必须**删除/复用** `var texture DepthTexture` 声明才真正省显存（1080p 每张 `R32F` ≈ 7.91 MiB）。

### GT-03 跨帧像素保留（History Buffer 能力）
- **结论**：纹理在本帧被 clear/覆写前，保留上一帧最后写入的内容（`PostEffectFrameBufferTexture` "画中画"现象）。可用于分帧摊销计算。
- **证据**：`[src: diagrams/vanilla-pipeline-reference.md#L92-L100]`；日冕 Mod 每 4 帧才重算一次 `BlurredShroudTexture` `[src: readonly/ingame.scrapeo modded corona.txt#L93-L131]`。
- **置信度**：`✅已实机验证`。
- **设计影响**：IBL 预计算 / 低频贴图可"首帧或每 N 帧"更新；**反之**任何 G-Buffer 目标若某帧不 clear，会残留上一帧数据——每帧 G-Buffer Pass 必须先 `clear`。

### GT-04 自定义 SCOPE 块与跨帧布尔状态
- **结论**：纯 `.scrapeo` 即可凭空创建自定义 SCOPE 块与参数（如 `Lanyi.*`），`setbool/setfloat/settexture` 写入；HLSL 用 `string SasBindAddress = "<Block>.<Parm>";` 读取。`setbool` 值跨帧保持；未初始化的布尔首次 `if` 判为 `false`。
- **证据**：`[src: readonly/ingame.scrapeo modded corona.txt#L15-L33]`、`#L94-L129`；`[src: readonly/docs/02_ENGINE_CONSTRAINTS_AND_FINDINGS.md#L28-L41]`。
- **置信度**：`✅已实机验证`（日冕 Mod）。"未初始化为 false" 为 `🔍`（D02 表述，未见独立实测记录）。
- **设计影响**：延迟管线开关与调试视图统一用 `Deferred.*` 块（如 `setbool Deferred IsEnabled true`、`settexture Deferred GBufferNormal GBufferNormalTex`）。开关建议脚本顶部显式赋初值，不依赖默认 `false`。

### GT-05 `fromscope` 取引擎已填充的 SCOPE 纹理
- **结论**：`var texture|texturecube <Name> fromscope <Block> <Parm>` 可把引擎 C++ 已绑定到 SCOPE 的纹理拿成脚本变量（如 `Terrain Shroud.Texture`、`Terrain EnvironmentTexture`、`WW3D FXOceanCubeMap`）。**CC4 的 `fromscope static` + 引擎静态填充 G-Buffer（`NormalSpec` 等）在 RA3 1.12 不存在**：RA3 引擎不会替你生成任何法线/光照纹理。
- **证据**：`[src: main/ingame.scrapeo#L1147-L1148]`；`[src: readonly/ingame.scrapeo modded corona.txt#L83]`；CC4 差异 `[src: readonly/llm-analysis/DEFERRED_RENDERING_DISCOVERY_AND_PLAN.txt#L49-L69]`。
- **置信度**：`fromscope <Block> <Parm>` = `✅已实机验证`；"CC4 静态纹理/回调不存在" = `🔍IDA静态推测`（未在 RA3 中找到对应注册，前代报告结论）。
- **设计影响**：G-Buffer 全部由我们自己 `var texture` 声明并在几何 Pass 写出；可用 `fromscope` 把 `Terrain.Shroud.Texture` / `Terrain.Cloud.Texture` 等拿来给合成 Shader。

### GT-06 `callproc` 不保存/恢复任何状态
- **结论**：RT 0..3、Depth、Viewport/Scissor、Camera、可见集、当前 quad Shader、SCOPE 绑定与 Shader Override 全是全局可变状态，`proc` 返回不恢复。
- **证据**：`[src: readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md#L87]`；`[src: readonly/llm-analysis/SCRAPE_OVERRIDE与D24S8深度纹理结论.md#L37-L44]`。
- **置信度**：`🔍IDA静态推测`（与官方脚本的"每个 pass 结尾 `callproc setFrameRenderTarget` 恢复"写法一致，可信度高）。
- **设计影响**：G-Buffer Pass 结尾必须 `settarget 1 NULL`..`settarget 3 NULL`（或 `cleartarget 1..3`），再恢复主帧 RT/Depth/Camera。

---

## 2. 渲染目标、纹理格式与深度表面

### GT-07 SCRAPE 可创建的格式：已证实 vs 仅在字符串表中
| 格式 | 作为 RT 写入 + Shader 采样的证据 | 置信度 |
|---|---|---|
| `R32F` | `ShadowMapTexture`、`DepthTexture`、`DepthTextureLinear` `[src: main/ingame.scrapeo#L159]`、`#L632`、`#L638` | `✅已实机验证` |
| `A16B16G16R16F` | `OceanDisplacementTexture` ×2 `[src: main/ingame.scrapeo#L876-L882]`；HDR 时 `FrameRenderTarget` | `✅已实机验证` |
| `A8R8G8B8` | `DistortionOffsetTexture`、`OutlineTexture*` `[src: main/ingame.scrapeo#L348]`、`#L1023-L1026`；日冕 `PbrIrradianceTexture`（cube + `autogenmipmap`） | `✅已实机验证` |
| `L8` | 日冕 `BlurredShroudTexture` 作 `settarget 0` 并被采样 `[src: readonly/ingame.scrapeo modded corona.txt#L29]`、`#L107` | `✅已实机验证` |
| `D24S8`（`var surface ... edramdepth`） | `ShadowMapDepthBuffer`、`FrameDepthBuffer` `[src: main/ingame.scrapeo#L164]`、`#L41` | `✅已实机验证`（仅作深度表面） |
| `$WW3D.FrameRenderTargetTextureFormat` / `$WW3D.FrameRenderTargetSurfaceFormat` / `$WW3D.EnvMapRenderTargetTextureFormat` / `$PostEffect.Bloom.TextureFormat` | 原版大量使用；实际取值随 HDR 开关变化 | `✅` 可用；**具体取值 `❓`**（见 `OQ-10`） |
| `A2R10G10B10`、`G16R16`、`R16F`、`G16R16F`、`A32B32G32R32F`、`L16`、`A16B16G16R16` 等 | 只出现在引擎 D3DFORMAT 名称字符串表 `[src: readonly/scrapeo rules from asm.txt#L151-L204]`；**任何原版/日冕/FXFXH 脚本都未用作 RT** | `📄`（名称可解析）/ 作 RT+采样 `❓待实测`（`OQ-04`） |

- **补充**：字符串表**不完整**——`A8R8G8B8`、`X8R8G8B8` 不在表中却被原版使用（表头自注 "this list may not be complete"）。`Q4` 称格式 parser `0x9B8070` 映射 `D24S8→6, D24FS8→7, G16R16→20, R32F→12`，默认 `depthformat`→`D24S8` `[src: readonly/llm-analysis/问题4_D16S16与深度表面转颜色纹理.md#L33-L53]`（`🔍`）。
- **设计影响**：G-Buffer 首选布局（`RT0/RT1 = A2R10G10B10`, `RT2 = A8R8G8B8`, `RT3 = R32F`）中 `A2R10G10B10` 是**唯一未经实机证实**的格式 → Phase 0 必做 `OQ-04`；失败则 `RT0/RT1` 回退 `A8R8G8B8`（同为 32 bpp，不破坏等位深规则）。

### GT-08 FOURCC 深度纹理（`INTZ`/`RAWZ`/`DF24`/`RESZ`）与 `D16S16`
- **结论**：**没有任何证据支持**。RA3 1.12 映像中未找到这些 FourCC 的字符串、立即数或创建路径；SCRAPE 格式字符串表中也没有。`D16S16` 在标准 D3D9 与 RA3 parser 中都不存在（且即便存在也是 32 bpp，不省显存）。
- **证据**：`[src: readonly/llm-analysis/SCRAPE_OVERRIDE与D24S8深度纹理结论.md#L235-L244]`；`[src: readonly/llm-analysis/问题4_D16S16与深度表面转颜色纹理.md#L5-L12]`；`[src: readonly/scrapeo rules from asm.txt#L151-L204]`（表中无 FourCC）。
- **置信度**：`🔍IDA静态推测` + `📄`（字符串表佐证），按"不可用"处理。
- **设计影响**：不规划任何依赖 FOURCC 的路径；那需要 D3D9 wrapper，超出纯 SCRAPE/HLSL 范围。

### GT-09 `D24S8` 不能被 Shader 采样（已定论）
- **结论**：`setdepth` 只查 surface 表；`settexture`/`casttexture` 只查 texture 表；普通 PC 纹理的 `casttexture` 虚函数 `0x7A8B80` 直接 `return false`（空操作）；`stretchrect` 走 `IDirect3DDevice9::StretchRect`，D3D9 不允许 depth→color 转换。`var texture X ... D24S8` 能创建 `D3DUSAGE_DEPTHSTENCIL` 纹理，但 `setdepth` 不接受 texture，故无用。
- **证据**：`[src: readonly/llm-analysis/SCRAPE_OVERRIDE与D24S8深度纹理结论.md#L149-L233]`；`[src: dictionaries/engine-ground-truth.md]`（旧账本已定论）。
- **置信度**：项目已定论（旧账本标记"实机确认无原生着色器可读路径"）→ `✅`。
- **冲突记录**：`DISC#L296-L303` 与 `PLAN#L230-L251` 曾建议做 "D24S8 `casttexture` 实验"；后续 IDA 专题 `OVR#L167-L184` 证明其为 NoOp，`readonly/docs/01_PROJECT_INDEX_AND_RESOURCES.md#L41` 亦标注该实验已被证伪。**以后者为准，不再实验。**
- **设计影响**：线性深度由 G-Buffer PS 直接写入颜色 MRT（`RT3 = R32F`，写 `viewPos.z`，与 `PostFX_LinearDepth.fx` 输出约定一致）。

### GT-10 MRT 绑定：`settarget 0..3`
- **结论**：`settarget <index> <name> [cubeface]`：`0..3` 为颜色目标，`NULL` 解绑；PC 可绑定 `surface` 或 `texture`（绑定 texture 时取其 level-0 surface，之后同一 texture 可 `settexture` 采样，无需拷贝）；`[cubeface] 0..5` 在 Windows 可用。`cleartarget <i>` 帮助文本称 `4` 为 depth，但 PC 脚本一律用 `setdepth`。
- **证据**：`[src: readonly/scrapeo rules from asm.txt#L10-L21]`、`#L68-L71`；cube face 实机：`[src: readonly/ingame.scrapeo modded corona.txt#L47-L73]`；texture 直绑：原版 `ShadowMapTexture` 即 `var texture` 作 RT0。
- **置信度**：单 RT 绑定 texture / cube face = `✅已实机验证`；**4 路同时绑定 = `❓待实测`**（原版与日冕从未同时绑定 >1 个颜色目标，见 `OQ-05`）。
- **设计影响**：G-Buffer 四张目标一律声明为 `var texture`（不要用 `edram surface`），写完解绑后直接 `settexture Deferred.* ...` 给合成 Pass。

### GT-11 `renderbin` 执行前的 RT 组合合法性检查
- **结论**：执行 `renderbin` 前引擎检查：至少 1 个颜色或深度目标；所有颜色目标 MSAA 一致；颜色与深度 MSAA 一致；深度 surface 不小于颜色 surface。违反时报 `ERROR: SCRAPE Current render targets are not a valid set...`。
- **证据**：`[src: readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md#L188-L195]`。
- **置信度**：`🔍IDA静态推测`。
- **设计影响**：G-Buffer 四张纹理与 `DepthBuffer` 尺寸关系必须核实（`OQ-06`）；所有 G-Buffer 目标非 MSAA。

### GT-12 Viewport 由"最后设置的 RT/Depth"推导
- **结论**：RNA 从最后一次设置的 render target / depth buffer 推导当前 viewport。官方注释要求"先 `setdepth`，再 `settarget 0`"以使 viewport 等于 RT 尺寸。
- **证据**：`[src: diagrams/vanilla-pipeline-reference.md#L113-L120]`（引用 `WaterReflection.scrapeh` L31–L32 官方注释）。
- **置信度**：`📄源码确认`。
- **设计影响**：G-Buffer Pass 顺序固定为 `setdepth DepthBuffer` → `settarget 0..3` → （保险起见）`setviewport GBufferRT0`。

### GT-13 D3D9 MRT 通用硬规则（微软文档）
- **结论**：同时绑定的颜色 MRT 宽高必须一致；无 `D3DPMISCCAPS_MRTINDEPENDENTBITDEPTHS` 时位深必须相同（格式可不同）；MRT 不支持 MSAA；固定管线 AlphaTest/混合在 MRT 下受 caps 限制；sRGB 写仅作用于 RT0。深度表面走独立规则（格式兼容、MSAA 相同、尺寸 ≥ RT）。
- **证据**：`[src: readonly/llm-analysis/DEFERRED_RENDERING_PLAN.md#L48-L65]`、`[src: readonly/llm-analysis/DEFERRED_RENDERING_DISCOVERY_AND_PLAN.txt#L238-L250]`、`#L271-L276`（均引用 Microsoft Learn）。
- **置信度**：`📄源码确认`（官方 API 文档）；RA3 引擎是否额外查询 caps = `❓`（无证据，不依赖）。
- **设计影响**：4×32 bpp 布局；G-Buffer technique 显式 `AlphaBlendEnable = false; AlphaTestEnable = false;`，镂空用 `clip()`；sRGB 在 Shader 内显式编码。

### GT-14 三套深度表面与 MSAA/HDR 路由
- **结论**：
  - `DepthBuffer`（`var surface DepthBuffer depth`）= 引擎默认全屏 1x `D24S8`，一帧内被反射（借左上 512²）、DepthMap、主帧三次 clear 复用。
  - `ShadowMapDepthBuffer` = 阴影专属 `D24S8`（MapSize² 可能大于屏幕）。
  - `FrameDepthBuffer` = 仅 MSAA 时有效；AA 关闭时 `$WW3D.FrameBufferSizeIfAntiAliasing` = `0×0`，`setFrameDepthBuffer` 直接绑 `DepthBuffer`。
  - `WW3D.IsHdrEnabled || WW3D.IsAntiAliasingEnabled` → `IsUsingFrameRenderTarget = true`，主帧画到离屏 `FrameRenderTarget`（`edram surface`，**不可直接采样**，须 `stretchrect` 进纹理）；否则直接画后台缓冲 `FrameBuffer`。HDR 时 `FrameRenderTarget` 为 `A16B16G16R16F`，否则 `A8R8G8B8`（VPR 表述）。
- **证据**：`[src: diagrams/vanilla-pipeline-reference.md#L63-L67]`、`#L104-L126`、`#L227`；`[src: main/ingame.scrapeo#L34-L41]`。
- **置信度**：`📄源码确认`；HDR 关闭时的实际 surface 格式 = `❓`（`OQ-10`）。
- **设计影响**：延迟路径强制 AA 关闭（项目决策），G-Buffer 用 `DepthBuffer` 做硬件 Z/Stencil；合成目标为 `FrameRenderTarget`。HDR 关闭时主帧直写 8-bit 后台缓冲，PBR/HDR 合成精度受限——需决定"延迟分支强制 HDR"或"允许 LDR 降级"（`OQ-10`）。

---

## 3. Shader 选择与 Technique Override

### GT-15 `setshader` 只影响 SCRAPE 自己的全屏 quad
- **结论**：`setshader S [T]` 把 shader/technique 写进 SCRAPE 执行状态，仅 `renderquad`/`renderfullquad` 读取（technique < 0 时用 0）；`renderbin` 与引擎 `render*` 回调从**每个 draw item 自身**取 shader，完全不看它。纯 SCRAPE **无法把场景 shader A 换成 shader B**；二进制中的 `ShaderOverrides` 字样属于资产序列化字段，不是脚本命令。
- **证据**：`[src: readonly/llm-analysis/问题2_SCRAPE能否替换场景FX_Shader.md#L6-L59]`、`#L77-L89`（`0x9BCD20`、`0x9C1080`、`0x99F450`、`0x9CB080`）。
- **置信度**：`🔍IDA静态推测`（与官方用法一致：官方只对后处理 quad 用 `setshader`）。
- **设计影响**：G-Buffer 只能通过"各场景 FX 内部新增 technique + override 切换"实现，HLSL 侧用共享 `CommonGBuffer.fxh` 降低重复。

### GT-16 `_CreateShadowMap` / `_CreateDepthMap` 的加载期索引缓存
- **结论**：每个 `.fxo`（从 `Shaders/Compiled/<Name>.fxo` 加载）加载后，引擎枚举 `D3DXTECHNIQUE_DESC.Name`，用**区分大小写的 `strcmp`** 精确匹配 `_CreateShadowMap`、`_CreateDepthMap`（下划线是名字的一部分），缓存两个索引；若无 `_CreateDepthMap`，Depth 索引回退为 Shadow 索引（Shadow 不反向回退）。**不读任何 annotation**，不依赖 EA 私有编译器元数据——`fxc.exe` 编译的 `.fxo` 同样生效。
- **证据**：`[src: readonly/llm-analysis/问题1_Depth与ShadowOverride的Technique选择机制.md#L17-L62]`（`0x9A7500`、`0x9A3FA0`、`0x9C6380`）；官方 `Objects.fxh` 利用该非对称性：`#if SUPPORT_FORMATIONPREVIEW || SUPPORT_CHRONORIFT technique _CreateDepthMap #else technique _CreateShadowMap` `[src: D:\PROJECTS\SAGE shader source\RA3_Shaders\Objects.fxh#L2205-L2207]`；`TERRAIN.FX` 两者皆有 `[src: C:\Desktop01\MYGITHUB\custom-shaders-RedAlert3\FXFXH\TERRAIN.FX#L1156-L1171]`。
- **置信度**：回退机制 = `🔍` + `📄`（官方源码按此设计，原版 DepthMap Pass 中仅有 `_CreateShadowMap` 的单位照常写深度，软粒子与单位相交正常）；"`fxc` 编译可用" = `✅`（`FXFXH` 自编译 shader 实机投影正常）；"必须带下划线" = `🔍`（曾有用户观察相反现象，见 `OQ-03`）。
- **设计影响**：G-Buffer technique **不要**复用 `_CreateDepthMap` 这个名字，除非接受它同时被原版 DepthMap Pass 选中（`Q3#L127-L143`）；首选独立名 + `setshaderoverride`（见 `OQ-01` 决策）。

### GT-17 全局 Begin/End Override 的真实语义
- **结论**：`beginShadowOverrideTechnique`（`0x5D15C0`）/ `beginDepthOverrideTechnique`（`0x5D1630`）= 遍历全部已注册 shader，把**各自缓存的**索引写入 `overrideTechnique`（`-1` 表示无）。两个 `end*`（共用 `0x5D16A0`）= **无条件把全部 shader 的 override 写成 `-1`**，不是状态栈，会一并清掉此前 `setshaderoverride` 设的值。
- **证据**：`[src: readonly/llm-analysis/SCRAPE_OVERRIDE与D24S8深度纹理结论.md#L46-L95]`、`#L122-L132`；原版成对使用：`[src: D:\PROJECTS\SAGE shader source\RA3_Shaders\Shadow.scrapeh#L77-L88]`、`DepthMap.scrapeh#L70-L86`。
- **置信度**：`🔍IDA静态推测`（成对用法 `📄`）。
- **设计影响**：G-Buffer 的 `setshaderoverride ... clearshaderoverride` 区间**绝不能跨越**任何 Shadow/Depth begin/end；把 `updateShadowTexture` 放在 G-Buffer Pass 之前完成。

### GT-18 `setshaderoverride S T` / `clearshaderoverride S`
- **结论**：作用于**整个 shader 资源 S**（所有使用 S 的 draw，不分物体/材质实例），持续生效直到 `clearshaderoverride S`、再次设置或任一全局 `end*`。只能切到 S **内部**的 technique T。T 不存在时 parser 记录 `-1`，**静默**等效于"不 override"，没有显眼报错。
- **证据**：`[src: readonly/llm-analysis/SCRAPE_OVERRIDE与D24S8深度纹理结论.md#L18-L44]`；`[src: readonly/llm-analysis/问题1_Depth与ShadowOverride的Technique选择机制.md#L128-L134]`（`0x9C1FE0`/`0x9BCDC0`/`0x9BCE50`）。
- **⚠ 关键缺口**：**EA 官方全部 RA3 `.scrape/.scrapeh` 中从未使用过 `setshaderoverride`**（本次 grep `RA3S\*.scrape*` 零命中），日冕 Mod 也没用。"`var shader X foo.fx` 声明出来的 S 是否就是场景材质正在使用的同一个注册 shader 实例"完全未经验证。
- **置信度**：`🔍IDA静态推测`；可用性 `❓待实测`（`OQ-01`，**Phase 1 头号阻塞项**）。
- **设计影响**：路线 1（逐 shader `setshaderoverride`）是否成立取决于 `OQ-01`；不成立则走路线 2（G-Buffer 写进 `_CreateDepthMap` + `beginDepthOverrideTechnique` + Stencil/Valid 过滤）。

### GT-19 Override 索引为 `-1` 时：回退正常 technique，而非跳过
- **结论**：底层 draw 选择（`0x9CB080`/`0x9CAFC0`）：`technique = drawItem->normalTechnique (<0 则 0)；若 shader->overrideTechnique >= 0 则用之`。即缺少目标 technique 的物体**仍会以正向材质 technique 绘制**。
- **证据**：`[src: readonly/llm-analysis/问题1_Depth与ShadowOverride的Technique选择机制.md#L107-L147]`；`[src: readonly/docs/02_ENGINE_CONSTRAINTS_AND_FINDINGS.md#L58-L61]`；`DIN#L59` 亦记录"回退至默认 forward pass 而非必定崩溃"。
- **置信度**：`🔍IDA静态推测`（实机确认见 `OQ-02`）。
- **设计影响**：G-Buffer Pass 中混入未适配 shader 会把正向颜色（可能带混合状态）写进 RT0 污染 G-Buffer；因此 (a) G-Buffer Pass 只提交已知 shader 家族覆盖的回调/队列；(b) 合成 Shader 以 `Valid` 标记或 Stencil 位排除未写像素；(c) Phase 1 先做 shader 覆盖率清单（`OQ-14`）。

### GT-20 场景 draw 的 technique / 着色器变体由谁决定
- **结论**：每个 draw item 自带 `normalTechnique`（官方 `Objects.fxh` 有 `Default`、`Default_M`、`Default_L` 三档 LOD technique）；PC 上 technique 内部再用 **shader 数组 + D3DX preshader 表达式**选 VS/PS 变体（如 `VS_H_Array[min(NumJointsPerVertex,1)]`、PS 数组按 `HasShadow`/`HasRecolorColors` 等），`SUPPORTS_SHADER_ARRAYS = 1`（Windows）。另有 `string ExpressionEvaluator = "Objects"|"Buildings"` 注解（仅当编译时定义 `_WW3D_`），引擎 C++ 借此设置 render state / 常量。
- **证据**：`[src: D:\PROJECTS\SAGE shader source\RA3_Shaders\Objects.fxh#L1001-L1083]`、`#L1641`、`#L2000`；`[src: D:\PROJECTS\SAGE shader source\RA3_Shaders\Common.fxh#L38-L100]`；表达式求值器影响 cull/ZWrite 的说法 `[src: readonly/llm-analysis/问题2_SCRAPE能否替换场景FX_Shader.md#L93-L100]`（`🔍`）。
- **置信度**：shader 数组机制 = `📄源码确认`；ExpressionEvaluator 对 override technique 是否同样生效 = `❓`（`OQ-15`）。
- **设计影响**：override 会把所有 LOD 档统一替换成同一个 G-Buffer technique（可接受）；**G-Buffer technique 必须自己用 `VS_Array[min(NumJointsPerVertex,1)]` 之类的数组处理蒙皮/刚体变体**，否则骨骼单位变形错误。

### GT-21 `.fxo` 加载不依赖 EA 私有元数据
- **结论**：RA3 用标准 `ID3DXEffect` 加载 `.fxo`；`main\fxc.exe /T fx_2_0` 产物可直接被游戏加载与选择 technique。
- **证据**：`[src: readonly/llm-analysis/问题1_Depth与ShadowOverride的Technique选择机制.md#L45-L54]`；`FXFXH\compileALL.bat` 用 `fxc.exe /O2 /T fx_2_0` 编译并在游戏中使用。
- **置信度**：`✅已实机验证`（`FXFXH` 原型）。
- **设计影响**：沿用 `main\fxc.exe` 工具链；`USE_EXPRESSION_EVALUATOR` 依赖 `_WW3D_` 宏，自编译时是否定义需随 `OQ-15` 一并确认。

---

## 4. RenderBin 机制

### GT-22 固定 47 项枚举、区分大小写、未知名 → `NONE`
- **结论**：FX `_SasGlobal` 注解 `string RenderBin = "..."`（`0x9A3DE0` 读取）与 SCRAPE `renderbin <name>`（`0x9A6630` parser，`0x99C470` 解析）共用 `0x401EE0` 的 47 项有序表二分查找（`strcmp`）。未命中 → `0`（`NONE`）。可见对象入队时 **`bin == 0` 的 draw 不进入任何队列**（`0x9B6580`）。队列是固定数组（`0x9B66D0` 初始化 47 槽），**无法注册新名字**（`geobuffer`、`GBuffer` 均无效）。
- **证据**：`[src: readonly/llm-analysis/问题5_RenderBin是否支持自定义与GeoBuffer专用队列.md#L86-L260]`（含完整 0..46 映射表 L116–L143）；官方 `DistortingObject.fx` / `ObjectsTerrain.fx` 注解用法 `#L29-L77`。
- **置信度**：注解→队列→`renderbin` 的对应关系 = `✅`（原版 `Distorter`、`TerrainLikeGroundObject` 每帧在跑）；表长/NONE 回退/不能新增 = `🔍`。
- **设计影响**：自定义名一律无效。`FXFXH\COMMON.FXH#L61` 中的 `"PartiallyTransparentWall"` 不在表内，会解析为 `NONE`——若该分支被编译启用，物体可能完全不入队（新代码禁止使用表外名字）。完整名单见 [`renderbin-dict.md`](../dictionaries/renderbin-dict.md)。

### GT-23 注解是整个 FX 的属性；`StaticSortLevel` 可覆盖
- **结论**：`RenderBin` 在 `_SasGlobal` 上，作用于整个 FX（不分 technique）；改 bin = **重新分类**，不会复制 draw。W3X 网格若带 `StaticSortLevel 1..5`，加载时强制改为 `StaticSort1..5`（`bin = level + 35`），覆盖 FX 注解（`0x9B7380`）。
- **证据**：`[src: readonly/llm-analysis/问题5_RenderBin是否支持自定义与GeoBuffer专用队列.md#L285-L342]`。
- **置信度**：`🔍IDA静态推测`。
- **设计影响**：把物体挪进专用 bin 后，Shadow / Reflection / 主帧前向等所有提交点都要补 `renderbin <新bin>`，否则物体从这些 Pass 消失。

### GT-24 `renderbin X 1` = 该 bin 的粒子，不是 pass 1
- **结论**：第二参数 `0`（`BinCommand_Default`）= 普通几何；`1`（`BinCommand_RenderParticles`）= 交给 `TheFXParticleSystemManager` 画属于同名 bin 的粒子；第三参数保留未用。
- **证据**：`[src: readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md#L162-L186]`；`VPR#L314-L315`、`#L367`（`Underwater 0/1`、`Distorter 0/1`）。
- **置信度**：`📄源码确认`。
- **设计影响**：G-Buffer Pass 只写 `renderbin <Name>`（或 `0`），永不带 `1`。

### GT-25 引擎回调 ≠ RenderBin；回调内含描边队列与 Stencil 写入
- **结论**：`renderTerrain/renderRoads/renderScorchMarks/renderTerrainTracks/renderProps/renderWater/renderDecals/renderParticles/...` 是 RA3 专用无参回调（`0x5FD870` 注册）。`renderUnits` 遍历 `UnitPlayer0..19` 后**紧接着**提交 `UnitOutline*`；`renderStructures` 同理提交 `StructureOutline*`；这些描边队列向 Stencil **bit 0..1** 写 1/2/3。
- **证据**：`[src: diagrams/vanilla-pipeline-reference.md#L46-L47]`、`#L300-L302`；`[src: dictionaries/distillation-and-issues-notes.md#L40-L45]`；`[src: readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md#L344-L361]`。
- **置信度**：`📄源码确认`（VPR 已核实）；回调内部遍历细节为 `🔍`。
- **设计影响**：G-Buffer Pass 调用 `renderUnits`/`renderStructures` 时描边队列也会以 override 后的 technique 被画进 G-Buffer，并写 Stencil bit 0..1——若描边对象 shader 未适配会污染（`OQ-14` 一并检查）；后续 `renderOutlines` 依赖这些 Stencil 位，**G-Buffer 用的 `DepthBuffer` 必须就是主帧后续使用的那一个且不再 clear stencil**。

### GT-26 Stencil 位占用
- **结论**：主帧 `DepthBuffer@v3`：bit 0..1 = 单位/建筑/半透明描边（Outlines.fx `StencilMask = 0x3`）；bit 2（`0x4`）= `Decal.fx` 防跨地块重复叠加。其余 bit 3..7 原版未见使用。
- **证据**：`[src: diagrams/vanilla-pipeline-reference.md#L334]`、`#L343`、`#L457-L464`。
- **置信度**：bit 0..2 用途 = `📄源码确认`；"bit 3..7 空闲" = `❓`（`OQ-13`）。
- **设计影响**：延迟有效像素 / 光体积掩码只用 bit 3..7，G-Buffer technique 写 Stencil 时 `StencilWriteMask` 必须排除 `0x7`。

### GT-27 `StaticSort_END`（编号 41）是唯一候选空闲队列
- **结论**：官方 129 个源码文件中无任何 shader 注解或脚本提交 `StaticSort_END`；引擎为编号 41 初始化了真实队列槽，普通入队/提交路径按编号访问。`StaticSort1..5`（模型排序层，`StaticSort5` 为水下排序）、`LightSource`（引擎内部使用 46）、`TerrainUIRender`、`UnitPlayer_END`、`Distorter`、`Underwater`、`OceanDisplacement` 均不可视为空闲。
- **证据**：`[src: readonly/llm-analysis/问题5_RenderBin是否支持自定义与GeoBuffer专用队列.md#L344-L381]`；本次 grep `RA3S\*.scrape*` 未见 `StaticSort_END`/`LightSource` 提交。
- **置信度**："官方未使用" = `📄`；"运行时可正常入队并提交" = `❓`（`OQ-08`）。
- **设计影响**：局域光体积 Mesh 的 FX 计划注解 `string RenderBin = "StaticSort_END";`，在合成之后、`updateWaterRefraction` 之前 `renderbin StaticSort_END`。`FXFXH\FXdeferredpointlight.FX#L27` 现用 `StaticSort5`（与水下排序共享，迁移时改）。

### GT-28 可见集 `visibleobjects`
- **结论**：仅 4 套：`ShadowMap`(0)、`DepthMap`(1)、`Reflection`(2)、`Frame`(3)。语法允许 `+/-mask`，但 RA3 的 mask 解析回调是返回 0 的 stub，无效。
- **证据**：`[src: readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md#L197-L223]`；`VPR#L42-L44`。
- **置信度**：4 个名字 = `📄`；mask stub = `🔍`。
- **设计影响**：G-Buffer Pass 用 `setcamera Viewer` + `visibleobjects Frame`（与主帧同集合，保证与随后前向/描边的可见对象一致）。

---

## 5. SAS / SCOPE 数据桥

### GT-29 `settexture` / `setfloat` / `setbool` / `settosize` → HLSL `SasBindAddress`
- **结论**：`settexture <Block> <Parm> <textureVar>` 把纹理写入 SCOPE；HLSL `texture X <string SasBindAddress = "<Block>.<Parm>";>` 读取。`setfloat` 分量数决定标量/向量；`settosize` 把资源宽高写入 VECTOR2。参数名可含点号与数组下标（`Bloom.SourceTextureSize`、`Shadow[0].ShadowMap`）。
- **证据**：`[src: readonly/scrapeo rules from asm.txt#L115-L144]`；`[src: main/ingame.scrapeo#L475-L568]`（`settosize` 实例）；`COR#L33`、`#L78`。
- **置信度**：`✅已实机验证`。
- **设计影响**：G-Buffer 输入统一 `settexture Deferred GBuffer0..3 ...`；屏幕尺寸用 `settosize Deferred FrameBufferSize GBuffer0Tex` 喂给半像素偏移计算。

### GT-30 官方 Shader 中出现的 SAS SCOPE 块
- **结论**（`RA3S\*.fx*` 中 `SasBindAddress` 前缀计数）：`Terrain`(59)、`Sas`(57)、`WW3D`(45)、`Particle`(35)、`PostEffect`(22)、`Water`(13)、`Video`(3)、`ConnectionLine`(2)、`Objects`(2)、`Decal`(2)、`Environment`(1)。代表性地址：`Sas.DirectionalLight[*]`、`Sas.PointLight[*]`、`Sas.NumPointLights`、`Sas.AmbientLight[0].Color`、`Sas.Shadow[0].ShadowMap`、`Sas.Shadow[0].WorldToShadow`、`Sas.Camera.Position`、`Sas.Skeleton.MeshToJointToWorld[*]`、`WW3D.DepthTexture`、`WW3D.FrameBufferSize`、`WW3D.IsHdrEnabled`、`WW3D.Fog`、`Terrain.Cloud.Texture`、`Terrain.Shroud.Texture`、`Terrain.EnvironmentTexture`、`Objects.LightSpaceEnvironmentMap`、`PostEffect.FrameBufferTexture`、`PostEffect.DepthBufferTexture`。脚本自定义块（`Lanyi.*`、计划中的 `Deferred.*`）同样可用。
- **证据**：本次 grep `[src: D:\PROJECTS\SAGE shader source\RA3_Shaders\*.fx*]`；`VPR#L15-L28`、`#L53-L55`。
- **置信度**：`📄源码确认`。
- **设计影响**：合成 Shader 可直接绑定 `Sas.DirectionalLight[*]`、`Sas.Shadow[0].*`、`Terrain.Cloud/Shroud.*`、`WW3D.Fog` 等；但全屏 quad 下引擎是否仍填充这些"逐 draw"的 `Sas.*` 值需验证（`OQ-12`）。

### GT-31 `WW3D.DepthTexture` 约定（线性 `viewPos.z`）
- **结论**：原版 `DepthTextureLinear`（`R32F`）= `PostFX_LinearDepth.fx` 用 `ProjectionInverse` 还原的相机空间线性深度，绑定 `WW3D.DepthTexture`；消费者：`UnderwaterDeferred.fx`、软粒子 `GpuParticle*.fx`、`Distorter` 粒子。`updateDepthMap` **仅当** `Water.IsReflectionVisible` 或 `Particle.IsSoftParticlesEnabled` 时执行。
- **证据**：`[src: diagrams/vanilla-pipeline-reference.md#L276-L287]`、`#L389-L409`；`[src: dictionaries/distillation-and-issues-notes.md#L14-L16]`、`#L28-L30`。
- **置信度**：`📄源码确认`。
- **设计影响**：`RT3` 写出同一约定的 `viewPos.z` 并 `settexture WW3D DepthTexture <RT3>`，即可零改动喂给原版水下/软粒子；延迟分支每帧都需要深度（不再受上述条件门控）。

---

## 6. 引擎提供的光照数据

### GT-32 平行光、环境光与逐 draw 点光源
- **结论**：
  - `c4` `AmbientLightColor`（`Sas.AmbientLight[0].Color`）；`c5..c10` `DirectionalLight[3]`（0 = 主太阳，1/2 = 补光，`Sas.DirectionalLight[*]`）。
  - `c89..c112` `PointLight[8]`（每个 `{Color, Position, Range_Inner_Outer}`，`Sas.PointLight[*]`）：引擎**逐 draw** 填充该物体附近最多 8 个点光源；`NumPointLights` 在 Windows 上是普通 SAS int（`Sas.NumPointLights`），不走固定 int 寄存器。官方 `GlobalParameters.fxh` 默认 `MaxNumPointLights 8`，`BasicW3D.fxh`/`DefaultW3D.fxh` 自限为 3。
  - `c113..c116` `ShadowMapWorldToShadow`；`c117..c118` 云 UV；`c119..c122` `ViewProjection`；`c123` `EyePosition`。
- **证据**：`[src: diagrams/vanilla-pipeline-reference.md#L48-L53]`；`[src: D:\PROJECTS\SAGE shader source\RA3_Shaders\GlobalParameters.fxh]`（MaxNumPointLights 默认 8、Windows 下 NumPointLights 非寄存器）；`[src: D:\PROJECTS\SAGE shader source\RA3_Shaders\BasicW3D.fxh#L20]`；`[src: main/COMMON.FXH#L143-L145]`。
- **置信度**：寄存器布局 = `📄源码确认`；"选最近 8 个"的选择规则 = `🔍`（无 IDA 地址佐证，属前代描述）。
- **设计影响**：主光照合成用 `DirectionalLight[0..2]` + `AmbientLight` + 阴影矩阵（需在全屏 quad 下可用，`OQ-12`）；"8 光源/物体"是前向路径的上限，延迟路径通过光体积绕开。

### GT-33 光体积 Mesh 可绕开 8 光源上限；但引擎没有光源列表接口
- **结论**：项目已用"球/柱体 Mesh + 自定义 FX（`FXdeferredpointlight.FX`：`D3DCULL_CCW` + `ZFunc GREATEREQUAL` + 关 ZWrite + `ONE/ONE` 加法 + 线性深度重建）"在游戏内渲染无数量上限的局域光。另一方面，RA3 1.12 **没有** CC4 的 `renderDeferredLights` / `renderDeferredLightsOverdraw` 回调，也没有已知的把引擎动态光源列表交给脚本的途径。
- **证据**：`[src: readonly/llm-analysis/DEFERRED_RENDERING_PLAN.md#L39-L42]`；`[src: readonly/docs/01_PROJECT_INDEX_AND_RESOURCES.md#L69-L70]`；`[src: readonly/llm-analysis/DEFERRED_RENDERING_DISCOVERY_AND_PLAN.txt#L60-L61]`、`#L163-L166`；`CMD#L344-L361`（RA3 回调清单中无 `renderDeferredLights`）。
- **置信度**：光体积方案 = `✅已实机验证`（项目原型）；"无光源列表接口" = `🔍`。
- **设计影响**：局域光 = 美术/INI 放置的光体积物体；引擎原生动态点光源（爆炸闪光等）如何转为延迟光需另行实验（`OQ-11`：光体积 draw 自身能否收到 `Sas.PointLight[*]`）。

---

## 7. 已确认的原版帧结构要点（与延迟改造直接相关）

| 要点 | 结论 | 来源 / 置信度 |
|---|---|---|
| 主帧不透明顺序 | `renderTerrain → renderRoads → renderbin TerrainLikeGroundObject → renderScorchMarks → renderTerrainTracks → renderbin Bridge → renderProps → renderUnits → renderbin Solid → renderStructures → renderbin StaticSort5` | `[src: diagrams/vanilla-pipeline-reference.md#L296-L302]` `📄` |
| 原版 DepthMap 提交包含透明 | `renderDepthCasters` 末尾有 `renderbin Transparent`、`renderTransparentOutlineObjects`；**G-Buffer 不得照搬** | `[src: readonly/docs/02_ENGINE_CONSTRAINTS_AND_FINDINGS.md#L95-L97]` `📄` |
| Shadow Pass 提交透明 | Shadow 也提交 `StaticSort5..1` 与 `Transparent` | `[src: diagrams/vanilla-pipeline-reference.md#L242]` `📄` |
| HUD 在后处理之后 | `renderIconLayers`/`renderUI` 画在 LUT resolve 后的 `FrameBuffer` | `[src: dictionaries/distillation-and-issues-notes.md#L37-L38]` `📄` |
| 水底折射抓屏点 | `updateWaterRefraction` = `stretchrect FrameRenderTarget PostEffectFrameBufferTexture`；局域光须在此之前完成 | `[src: diagrams/vanilla-pipeline-reference.md#L322-L323]` `📄` |
| 水面不采样线性深度 | `renderWater` 只做硬件 Z 测试，不读 `WW3D.DepthTexture` | `[src: diagrams/vanilla-pipeline-reference.md#L325]` `📄` |
| Distortion 复用主帧深度 | `Distorter 0/1` 借 `DepthBuffer@v3` 与 `WW3D.DepthTexture` | `[src: diagrams/vanilla-pipeline-reference.md#L367]` `📄` |

---

## 8. 来源冲突与裁决记录

| # | 冲突 | 裁决 |
|---|---|---|
| C-1 | `DISC#L296-L303`、`PLAN#L230-L251` 建议 D24S8 `casttexture` 实验 vs `OVR#L167-L184` 证明 PC `casttexture` 为 NoOp | 以 IDA 专题 + 旧账本定论为准：**不再实验**，`RT3 R32F` 为唯一深度源（GT-09）。 |
| C-2 | `ASM#L151-L204` 字符串表含 `D16`、`D24X8`、`D32` 等 vs `Q4#L51` 称 parser 无 `D16` 分支 | 字符串表可能是诊断用 D3DFORMAT 名表，不等于声明 parser 接受；本项目只用 `D24S8`，不影响设计，记为 `🔍` 未定。 |
| C-3 | 旧文档称"缺 technique 物体被跳过/无阴影" vs `Q1#L107-L147` 称回退正常 technique | 采用"回退"作为工作假设（GT-19），并列入 `OQ-02` 实测。 |
| C-4 | `PLAN#L35-L38` 称"材质可被强制到命名 technique — Confirmed" vs 官方脚本从未使用 `setshaderoverride` | 仅 `_CreateShadowMap/_CreateDepthMap` 全局路径有实机证据；`setshaderoverride` 降级为 `❓`（GT-18 / `OQ-01`）。 |
| C-5 | 简报称"`fromscope static` 在 RA3 不存在" vs 原版/日冕使用 `fromscope <Block> <Parm>` | 两者不矛盾：`fromscope <Block> <Parm>` 存在且可用；不存在的是 CC4 由引擎静态填充的 G-Buffer/光照纹理（GT-05）。 |
| C-6 | `DIN#L24-L29` 写"最多 4 次"却列出 5 项遍历 | 以 VPR 为准：Shadow、EnvMap（仅首帧/光变）、Reflection、DepthMap（条件）、主帧，共 5 处；常规帧中前者 4 处可能执行。 |
| C-7 | `D03#L55` 方案 B 把 `R32F` 放在 RT0 存 NDC 深度 vs 主路线 `RT3` 存线性深度 | 主路线 A（`RT3 = viewPos.z`）；方案 B 仅在 `OQ-01` 失败、被迫复用 `_CreateDepthMap` 时重新评估。 |
