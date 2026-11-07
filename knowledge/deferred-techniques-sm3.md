# D3D9 / SM3 兼容的延迟渲染技术知识库（RA3-Deferred-Render 专用）

> **定位**：为 RA3 v1.12 PC（D3D9 · `fx_2_0` · `vs_3_0`/`ps_3_0` · SCRAPE 脚本无 C++ 层）延迟化改造提供**经文献与官方文档核实**的技术选型依据。只收录 SM3 可落地的做法；SM4+/Compute 技术仅作"为何不可用"的对照。
> **读者**：执行具体任务的较小模型。每节结构固定：**是什么 → SM3/D3D9 可行性 → 成本 → 本项目建议 → 参考**。
> **当前设计基线**：[`readonly/docs/03_DEFERRED_RENDERING_ROADMAP.md`](../readonly/docs/03_DEFERRED_RENDERING_ROADMAP.md)（4×32bpp G-Buffer + `A16B16G16R16F` HDR 累积 + 背面 `GREATEREQUAL` 光体积 + `StaticSort_END`）。

**置信度标签**（沿用共享规范并补充一个文献标签）：
| 标签 | 含义 |
|---|---|
| `✅已实机验证` | 本项目实机/抓帧确认 |
| `📄源码确认` | 读自 RA3 官方 shader 源码、`main/ingame.scrapeo`，或微软官方 D3D9 文档（`D:\GITLABS\msdocs-win32-direct3d`） |
| `📚文献` | 公开演讲/书籍章节（GPU Gems、SIGGRAPH/GDC），细节以原文为准 |
| `❓待实测` | 需在 RA3 实机 / PIX / RenderDoc 验证 |

> 本地微软文档路径缩写：`MSD9/` = `D:\GITLABS\msdocs-win32-direct3d\desktop-src\direct3d9\`，`MSHLSL/` = `...\desktop-src\direct3dhlsl\`。

---

## 0. 结论速览（TL;DR）

| # | 结论 | 置信度 |
|---|---|---|
| 1 | 4×32bpp MRT 布局（`A2R10G10B10`/`A2R10G10B10`/`A8R8G8B8`/`R32F`）满足 D3D9 基线"同位深"规则，无需依赖 `D3DPMISCCAPS_MRTINDEPENDENTBITDEPTHS`。**保留**。 | `📄源码确认` [src: MSD9/multiple-render-targets.md#L15] |
| 2 | RT1 世界空间法线原样 xyz 写入 `A2R10G10B10` 与 **Unity 5 延迟管线 RT2 完全同构**（DX9 SM3 已商用验证），无需八面体/球面编码。**保留**。 | `📚文献` |
| 3 | RT3 = `R32F` 线性 `viewPos.z` 必须**逐位等价**于原版 `PostFX_LinearDepth.fx` 的输出，`UnderwaterDeferred.fx` 与 GPU 粒子才能无改动复用。**保留并作为硬约束**。 | `📄源码确认` [src: D:\PROJECTS\SAGE shader source\RA3_Shaders\PostFX_LinearDepth.fx] |
| 4 | INTZ/RAWZ/DF24/RESZ 需要 C++ 以 FOURCC 格式 `CreateTexture`；SCRAPE 只能用引擎格式 token 声明资源 → **脚本层不可行**（除非引擎格式表恰好接受 FOURCC token）。 | `📄源码确认` + `❓待实测`（格式表） |
| 5 | MRT 下 alpha 混合**对所有 RT 使用同一套混合状态**；只能用 `D3DRS_COLORWRITEENABLE1..3` 按 RT 屏蔽写入（需 `D3DPMISCCAPS_INDEPENDENTWRITEMASKS`）。 | `📄源码确认` [src: MSD9/multiple-render-targets.md#L19-L27] |
| 6 | `D3DRS_SRGBWRITEENABLE` 在 MRT 下**只作用于 RT0** → G-Buffer 一律在 HLSL 内手工做 sRGB/线性转换。 | `📄源码确认` [src: MSD9/gamma.md#L26] |
| 7 | 背面 + `ZFunc=GREATEREQUAL` 单 Pass 光体积对俯视 RTS 相机几乎没有浪费像素，双 Pass 模板体积收益很低。**保留**；模板体积列为可选。 | `📚文献` + 本文推导 |
| 8 | Light Pre-Pass（Engel）需要**两次几何遍历**，对 D3D9 单位数量巨大的 RTS 是 CPU/DrawCall 劣势 → **不采用**。 | `📚文献` |
| 9 | 光照 PS 中所有 G-Buffer 采样一律用 `tex2Dlod(s, float4(uv,0,0))`，避免动态分支内的梯度指令问题。 | `📄源码确认` [src: MSHLSL/dx9-graphics-reference-asm-ps-3-0.md#L45-L47] |
| 10 | 延迟路径必须关闭 MSAA；AA 改用 FXAA 3.11（`FXAA_PC=1`,`FXAA_HLSL_3=1`）后处理，插在 LUT 之后、UI 之前。 | `📚文献` |

---

## 1. DX9 时代已出货的延迟引擎先例

| 引擎 / 游戏 | API | G-Buffer 布局（RT 格式与通道） | 位置/深度 | 光照方式 | 对本项目的启示 | 置信度 |
|---|---|---|---|---|---|---|
| **S.T.A.L.K.E.R.**（X-Ray R2，GPU Gems 2 第 9 章） | D3D9 SM2/3 | 3× `A16B16G16R16F`：①视空间位置 xyz + AO/翻译量 ②法线 xyz + 材质/hemi ③漫反射 RGB + gloss | 显式存位置（FP16） | 光体积 + 模板；材质用 2D 查表实现多光照模型 | 全 64bpp FP16 太胖，后来被普遍用"深度重建位置"替代；材质 ID + 查表思路可用于本项目 `RT0.a` 2-bit 分类 | `📚文献` |
| **Killzone 2**（Guerrilla，Valient 2007） | PS3 RSX（D3D9 级） | 4× `RGBA8` + `D24S8`：RT0 光照累积 RGB + 强度；RT1 视空间法线 X/Y（各 FP16 打包进 2×8bit）；RT2 运动矢量 XY + 高光强度 + 高光幂；RT3 漫反射 RGB + 太阳遮蔽 | 从硬件深度重建（PS3 可直接读 D24） | 光体积：相机在外画正面+模板，在内画背面 `GREATER`；阳光全屏 | 720p 下约 36 MB；证明 32bpp×4 足够 AAA 质量；"相机在体积内画背面"即本项目方案 | `📚文献` |
| **StarCraft II**（Blizzard，SIGGRAPH 2008 课程） | D3D9 SM3（低端回退正向） | 4 MRT（课程笔记描述为 FP16 级别）：Unlit/自发光、法线、深度、漫反射 albedo、高光 albedo、AO | 深度写入颜色 RT（DX9 无法读硬件深度） | 延迟光照 + SSAO + DoF，俯视 RTS | **同类 RTS 俯视相机的直接先例**：深度存颜色 RT、SSAO、局部光大量化 | `📚文献`（具体格式需核原文） |
| **Tabula Rasa**（NCsoft，GPU Gems 3 第 19 章） | D3D9 SM3（2007） | 4 MRT，含漫反射、高光、法线、深度；强调用 **accessor/mutator 封装 G-Buffer 编码**，使布局可改 | 深度写入颜色 RT | 光体积 + 模板；全局光全屏；**以法线/深度边缘检测+模糊代替 MSAA** | ① `CommonGBuffer.fxh` 封装编解码函数（与本项目 Phase 2 一致）② 无 MSAA 时的边缘 AA 先例 | `📚文献` |
| **CryEngine 2**（Crysis 1） | D3D9 | 主体正向；**Z-Pass 写线性深度到 `R32F`** 供 SSAO/雾/软粒子 | `R32F` 线性深度 | 正向 + 屏幕空间 SSAO（首创） | RT3 = `R32F` 线性深度的同类先例；Crysis SSAO 可在 SM3 跑 | `📚文献` |
| **CryEngine 3**（Crysis 2 PC DX9/主机） | D3D9 | **Deferred Lighting / Light Pre-Pass**：薄 G-Buffer = `A8R8G8B8` 最佳拟合法线（best-fit normals）+ gloss(A) + 深度 | 线性深度（主机读 D24，PC 写颜色） | 光照累积到 diffuse/specular 缓冲后再正向材质 Pass | best-fit normals 让 8-bit 法线可用；本项目已有 10-bit 法线，**不需要** | `📚文献` |
| **Unreal Engine 3** | D3D9 正向；DX11 才有延迟 | DX9：FP16 `SceneColor` 的 **alpha 存场景深度** | 深度在 SceneColor.a | 正向多 Pass | 证明 DX9 下"深度写进颜色通道"是行业通用解；UE3 DX9 **不是**延迟先例 | `📚文献` |
| **Unity 5 Deferred Shading** | D3D9 SM3 起 | RT0 `ARGB32` 漫反射 + 遮蔽；RT1 `ARGB32` 高光色 + 光滑度；**RT2 `ARGB2101010` 世界法线 xyz**；RT3 `ARGB2101010`(LDR)/`ARGBHalf`(HDR) 自发光+光照累积；Depth+Stencil | 读硬件深度（INTZ，引擎 C++ 可创建） | 光体积 + 模板 | **RT1 世界法线 `A2R10G10B10` 直接 xyz 的直接先例**；HDR 时 RT3 用 64bpp 与其它 32bpp 混用 → 依赖独立位深 cap（本项目已避免） | `📚文献` |
| **Battlefield 3**（Frostbite 2，Andersson GDC 2011） | DX11（PC）/ 360 / PS3 | 4× `RGBA8` + `D24S8` | 硬件深度 | PC：Compute Shader 16×16 Tile 光源剔除；**Xbox 360 回退为传统光体积**；PS3 用 SPU 分块 | Tiled/Clustered 依赖 Compute → SM3 不可用；SM3 的现实替代就是光体积（=本项目方案） | `📚文献` |

**参考**：
- GPU Gems 2 Ch.9 *Deferred Shading in S.T.A.L.K.E.R.* — https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-9-deferred-shading-stalker
- Valient, *Deferred Rendering in Killzone 2* (Develop 2007) — https://www.guerrilla-games.com/read/deferred-rendering-in-killzone-2
- Filion & McNaughton, *StarCraft II: Effects & Techniques* (SIGGRAPH 2008 Advances course) — https://advances.realtimerendering.com/s2008/index.html
- GPU Gems 3 Ch.19 *Deferred Shading in Tabula Rasa* — https://developer.nvidia.com/gpugems/gpugems3/part-iii-rendering/chapter-19-deferred-shading-tabula-rasa
- Mittring, *Finding Next Gen – CryEngine 2* (SIGGRAPH 2007) — https://advances.realtimerendering.com/s2007/index.html
- Kaplanyan, *CryENGINE 3: Reaching the Speed of Light* (SIGGRAPH 2010) — https://advances.realtimerendering.com/s2010/index.html
- Unity Manual, *Deferred Shading rendering path* — https://docs.unity3d.com/Manual/RenderTech-DeferredShading.html
- Andersson, *DirectX 11 Rendering in Battlefield 3* (GDC 2011) — https://www.ea.com/frostbite/news/directx-11-rendering-in-battlefield-3
- Hargreaves & Harris, *Deferred Shading* (NVIDIA, 6800 Leagues Under the Sea, 2004) — https://developer.download.nvidia.com/assets/gamedev/docs/6800_Leagues_Deferred_Shading.pdf

---

## 2. G-Buffer 编码

### 2.1 法线编码对比

| 方案 | 存储 | 编码 ALU | 解码 ALU | 精度（量化步长/角误差） | SM3 可行 | 本项目适用性 |
|---|---|---|---|---|---|---|
| **原样 xyz → `A2R10G10B10`**（`n*0.5+0.5`） | 3×10bit | 1 `mad` | 1 `mad` + `normalize`（`dp3`+`rsq`+`mul`） | 步长 2/1023≈0.002，角误差≈0.1° | ✅ | **推荐（当前设计）**：最省 ALU，RT1 本来就是 32bpp |
| 原样 xyz → `A8R8G8B8` | 3×8bit | 1 | 3 | 步长≈0.008，镜面高光可见色带 | ✅ | ❌ 高光带状 |
| Crytek best-fit normals → `A8R8G8B8` | 3×8bit | 1 次立方体/2D 查表 + 若干 ALU | 同原样 | 接近 10-bit | ✅（需额外静态查找纹理，`initCustomTextures` 可绑） | 不需要（已有 10-bit） |
| 球面映射/Lambert 等面积（视空间 2 通道） | 2×16 或 2×8 | ~8 | ~10 | 16-bit 很好；8-bit 有伪影 | ✅ | 只有在要腾出 1 个通道时才考虑 |
| 八面体编码（2 通道） | 2×16 / 2×10 | ~12（含 `abs`/`sign`） | ~10 | 2×10 已足够 | ✅ | 不需要；仅在 3-MRT 紧凑方案里用 |
| 只存 xy、重建 z（Killzone 2 视空间） | 2 通道 | 1 | `sqrt(1-x²-y²)` | 视空间背面法线 z 符号丢失（透视下会出错） | ✅ | ❌ 世界空间不可用 |

> 世界空间 vs 视空间：俯视 RTS 相机，世界空间法线可让 RT1 直接被 SSAO/贴花/光体积共用，且与原版 shader 的世界空间光照计算一致。**保持世界空间**。`📚文献`（Unity 5 同选择）

### 2.2 MRT 同位深规则与驱动现实

| 项目 | 事实 | 置信度 |
|---|---|---|
| 基线规则 | 同时绑定的 RT **位深必须相同、格式可不同**，除非 `D3DPMISCCAPS_MRTINDEPENDENTBITDEPTHS`(0x00040000) | `📄源码确认` [src: MSD9/multiple-render-targets.md#L15][src: MSD9/d3dpmisccaps.md#L112-L114] |
| 尺寸 | 所有 MRT 宽高应一致 | `📄源码确认` [src: MSD9/multiple-render-targets.md#L16] |
| MSAA | MRT **不支持抗锯齿** | `📄源码确认` [src: MSD9/multiple-render-targets.md#L26] |
| 后像素操作 | 需 `D3DPMISCCAPS_MRTPOSTPIXELSHADERBLENDING` + 按格式 `CheckDeviceFormat(USAGE_QUERY_POSTPIXELSHADER_BLENDING)`；混合状态**对所有 RT 相同**；Alpha Test 只比较 `oC0`；Fog 只保证 RT0 | `📄源码确认` [src: MSD9/multiple-render-targets.md#L17-L24] |
| 现代驱动 | DX10+ 级 GPU 的 D3D9 驱动普遍报告独立位深（Unity 5 HDR 延迟即依赖此能力）；但 RA3 引擎是否会提交混合位深的 `settarget` 组合未知 | `❓待实测`（写入 `engine-ground-truth.md` 的"MRT 等位深限制"行） |
| 本项目策略 | 全 32bpp 布局**不依赖**该 cap → 不需要测试也能工作 | — |

### 2.3 `A2R10G10B10` 作为渲染目标

| 问题 | 结论 | 置信度 |
|---|---|---|
| D3D9 是否允许作 RT | `D3DFMT_A2R10G10B10` 是合法的 D3D9 RT 格式，现代 GPU 均支持（需 `CheckDeviceFormat(D3DUSAGE_RENDERTARGET)`） | `📄源码确认`（D3DFORMAT 文档）/ 硬件 `📚文献` |
| SCRAPE 能否声明 | 原版 `ingame.scrapeo` 只出现 `R32F`/`A8R8G8B8`/`A16B16G16R16F`/`D24S8` token（L41,L159,L348,L632,L876）；**`A2R10G10B10` token 是否被引擎格式解析表接受未知** | `❓待实测`（Phase 0 第一项） |
| 2-bit alpha | 只能取 0、1/3、2/3、1 → 写标志位用 `out.a = flag / 3.0`，读取用 `round(a * 3.0)` | 推导 |
| 回退 | 若 token 不被接受 → RT0 改 `A8R8G8B8`（见 §11 建议 S1），RT1 改 `A8R8G8B8` + best-fit normals 或 `G16R16`（2 通道八面体，仍 32bpp） | — |

### 2.4 sRGB 处理

| 机制 | 在本项目中的可用性 | 置信度 |
|---|---|---|
| `D3DRS_SRGBWRITEENABLE` | MRT 下**仅第一个 RT 被写为 sRGB**；且只对通过 `D3DUSAGE_QUERY_SRGBWRITE` 的 8-bit 无符号格式有效 → 对 `A2R10G10B10` 无意义 | `📄源码确认` [src: MSD9/gamma.md#L24-L26] |
| `D3DSAMP_SRGBTEXTURE` | 只对通过 `D3DUSAGE_QUERY_SRGBREAD` 的格式有效；D3D9 允许在**过滤之后**线性化（不精确） | `📄源码确认` [src: MSD9/gamma.md#L22] |
| **手工转换（推荐）** | 写：精确 `pow(c, 1/2.2)` 或廉价 gamma 2.0 `sqrt(c)`；读：`pow(c,2.2)` 或 `c*c` | — |

ALU 成本（每通道 RGB 合计）：`pow` ≈ `log`+`mul`+`exp` 3 条/通道 → 约 9 slots；gamma 2.0 `sqrt` = `rsq`+`rcp` 约 6 slots，解码 `c*c` 1 条 `mul`。**建议 G-Buffer albedo 用 gamma 2.0 近似**（写 `sqrt`、读 `x*x`），因为只是存储编码、不影响最终显示 gamma。

### 2.5 线性深度与位置重建（原版官方实现可直接复用）

原版 `PostFX_LinearDepth.fx` 输出 `viewPos.z`（`ProjectionInverse` 反投影后除 w，直接 `return float4(viewPos.zzz,1)`）。`📄源码确认` [src: D:\PROJECTS\SAGE shader source\RA3_Shaders\PostFX_LinearDepth.fx]

原版 `UnderwaterDeferred.fx` 已经用"z 归一化视线射线 × 线性深度"重建世界坐标 —— **延迟合成与光体积直接照抄此模式**：`📄源码确认` [src: D:\PROJECTS\SAGE shader source\RA3_Shaders\UnderwaterDeferred.fx#L41-L76]

```hlsl
// VS（全屏 Quad，Position.xy 为 NDC）——摘自 UnderwaterDeferred.fx 思路
float4 farVS4  = mul(float4(Position.xy, 1, 1), ProjectionI);   // ProjectionInverse
float3 farVS   = farVS4.xyz / farVS4.w;
float3 rayVS   = farVS / farVS.z;            // z 分量 = 1：每单位 viewZ 的 xy 步进
Out.WorldEyeDir = mul(rayVS, (float3x3)ViewI); // 世界空间射线（插值线性，安全）

// PS
float  viewZ    = tex2Dlod(DepthSampler, float4(uv, 0, 0)).x;   // RT3 = viewPos.z
float3 worldPos = ViewI[3].xyz + viewZ * In.WorldEyeDir;
```

光体积（非全屏）中：VS 输出世界坐标 `wp` 与 `ViewI[3]`，PS 中 `rayWS = (wp - eye) / dot(wp - eye, camForwardWS)`（使其 view-z 分量为 1），再 `worldPos = eye + viewZ * rayWS`。不要在 VS 中先除再插值（透视插值会错）。`📚文献`（Hargreaves 2004 / 通用做法）

**硬约束**：G-Buffer PS 写 RT3 时用 `mul(float4(worldPos,1), View).z`，数值与符号必须等于原版 `viewPos.z`；否则 `UnderwaterDeferred.fx`、`GpuParticle*.fx`、`CommonGeometryParticle.fxh`（均绑定 `WW3D.DepthTexture`）全部失效。`📄源码确认`

---

## 3. 在 D3D9 上读取硬件深度：FOURCC 黑科技

| FOURCC | 作用 | 硬件 | 前提 | 置信度 |
|---|---|---|---|---|
| `INTZ` | 24-bit 深度+8 模板纹理，可同时做深度/模板测试并采样（不可同时写深度） | NV GeForce 8+、AMD HD4xxx+、Intel G45+ | **必须用 `CreateTexture(..., D3DUSAGE_DEPTHSTENCIL, (D3DFORMAT)MAKEFOURCC('I','N','T','Z'))` 创建并 `SetDepthStencilSurface` 其 level 0** | `📚文献` |
| `RAWZ` | NV GeForce 6/7 原始深度（需手工重组通道） | 已过时 | 同上 | `📚文献` |
| `DF16`/`DF24` | AMD/Intel 可采样深度（无模板） | AMD X1000+ | 同上 | `📚文献` |
| `RESZ` | 把 MSAA 深度 resolve 到 INTZ 纹理（`SetRenderState(D3DRS_POINTSIZE, RESZ_CODE)` 技巧） | AMD HD4xxx+、Intel | 需要额外 API 调用 | `📚文献` |
| `NULL` | 空颜色 RT（只写深度时省带宽） | NV/AMD | `CreateRenderTarget` 用 FOURCC | `📚文献` |
| NV `NVDB`（Depth Bounds） | 深度范围测试，可加速光体积 | NV | `SetRenderState(D3DRS_ADAPTIVETESS_X, 'NVDB')` | `📚文献` |

**对 RA3 的可行性结论**：
1. SCRAPE 只能通过 `var texture/surface <name> <w> <h> <FORMAT>` 由引擎创建资源；`DepthBuffer` 是 `D24S8` **surface**（不是 texture）。`📄源码确认` [src: main/ingame.scrapeo#L41]
2. 引擎是否把未知 token（如 `INTZ`）映射成 FOURCC 并以 `D3DUSAGE_DEPTHSTENCIL` 创建纹理 → 原版脚本从未使用，IDA 未见证据。`engine-ground-truth.md` 已定论"无原生着色器可读路径"。**结论：脚本层不可行，不再投入**。`📄源码确认`
3. 唯一绕路是 D3D9 代理 DLL（ReShade 类工具即用 INTZ 替换深度缓冲）——属于引擎外 C++ 改造，违背本项目"纯 HLSL + SCRAPE"范围与 KISS，**不采用**。
4. 因此"RT3 写 `R32F` 线性深度"是**唯一正确路线**（与 StarCraft II、Tabula Rasa、Crysis 1、UE3 DX9 同解）。

**参考**：Aras Pranckevičius, *Direct3D 9 GPU Hacks* — https://aras-p.info/texts/D3D9GPUHacks.html ；AMD, *Advanced DX9 Capabilities for ATI Radeon Cards*（同页链接）。

---

## 4. 光照：光体积、替代架构与 HDR 累积

### 4.1 局部光体积方案对比

| 方案 | 做法 | 每光 Draw | 相机在体积内 | 浪费像素 | D3D9 需求 | 本项目建议 |
|---|---|---|---|---|---|---|
| **A. 背面 + `GREATEREQUAL`（当前）** | 只画体积"远面"，`ZFunc=GREATEREQUAL`、`ZWriteEnable=FALSE`、`ONE/ONE` 加法 | 1 | ✅ 天然正确 | 体积**前方**有遮挡物的像素（俯视 RTS 很少）+ 体积包围但衰减为 0 的像素 | 无 | ✅ **保留为主路线** |
| B. 正面 + `LESSEQUAL` | 画近面 | 1 | ❌ 相机进入即消失（需 CPU 切换） | 体积**后方**的地面全部通过 → 俯视下浪费大 | 无 | ❌ |
| C. 双 Pass 模板（z-fail 计数） | Pass1：双面、无颜色写、深度失败时背面 `INCR`/正面 `DECR`（`D3DRS_TWOSIDEDSTENCILMODE`）；Pass2：背面 + `STENCILFUNC=NOTEQUAL 0` 着色并清模板 | 2 | ✅ | 仅真正落在体积内的像素 | `D3DSTENCILCAPS_TWOSIDED` | 可选；仅当 PIX 显示光照填充率是瓶颈时 |
| D. 屏幕空间矩形/剪裁矩形 | 每光一个包围矩形 Quad（`ScissorTestEnable`） | 1 | ✅ | 矩形内全部 | `D3DRS_SCISSORTESTENABLE` 需 CPU 设剪裁矩形 | ❌ SCRAPE/HLSL 无法逐光设 scissor |

**推导（为何俯视 RTS 选 A）**：`GREATEREQUAL` 通过条件是"场景深度 ≤ 背面深度"。地面位于体积背面之后（未被体积包住）→ 测试失败被剔除；体积内的地面/单位 → 通过；只有"相机与体积之间的遮挡物"会被多算（PS 中距离衰减为 0）。俯视相机下这类像素极少，C 方案的第二次 Draw 与模板清除反而更贵。`📚文献`（Valient 2007；Hargreaves 2004）+ 推导

**A 方案必须的 PS 早退**：
```hlsl
float3 L    = LightPosWS - worldPos;
float  d2   = dot(L, L);
clip(LightRadiusSq - d2);          // 体积外/衰减为 0 的像素尽早丢弃（clip 无梯度问题）
```

**模板位冲突警告**：原版 `Step 5.2` 在 `DepthBuffer` 模板 **bit 0..1** 写轮廓标记，后续轮廓 Pass 读取。若引入 C 方案或"延迟像素有效位"，必须用 `StencilMask/StencilWriteMask` 限定到 bit 2..7（如 `0x80`），并在用完后清回。`📄源码确认` [src: diagrams/vanilla-pipeline-reference.md#L187]

**剔除方向警告**：FXFXH 原型用 `CullMode = D3DCULL_CCW` 并注释"backface only"。D3D9 默认正面为顺时针、`D3DCULL_CCW` 剔除逆时针面——在标准绕序下画的是**正面**。RA3 的 W3X 网格/视图矩阵若是右手系镜像则绕序相反。由于 PS 衰减会掩盖错误，**必须用 PIX 确认实际光栅化的是背面**。`❓待实测` [src: C:\Desktop01\MYGITHUB\custom-shaders-RedAlert3\FXFXH\FXdeferredpointlight.FX#L244-L250]

**远平面裁切**：背面若超出远平面会被裁掉 → 光消失。RTS 远平面远大于光半径，风险低；如遇到，在 VS 中把 `pos.z = min(pos.z, pos.w*0.9999)` 钳制。`📚文献`

### 4.2 替代架构

| 架构 | 原理 | SM3 可行 | 优点 | 缺点（对 RA3） | 建议 |
|---|---|---|---|---|---|
| **Deferred Shading（当前）** | 完整材质写 G-Buffer，光照 Pass 一次性着色 | ✅ | 几何只画 1 次；可删除原版 `updateDepthMap` 整场重画 | 材质模型须统一；透明物仍走正向 | ✅ |
| Light Pre-Pass / Deferred Lighting（Engel 2008；CryEngine 3） | ①薄 G-Buffer（法线+光泽+深度）②光累积到光照缓冲 ③**再画一遍几何**用原材质 shader 合成 | ✅ | 保留正向材质多样性；MRT 少 | **两次几何遍历**：D3D9 DrawCall/CPU 开销对大规模 RTS 单位不利；所有材质 shader 仍需改写读取光照缓冲 | ❌ |
| Inferred Lighting（Kircher & Lawrance 2009，Red Faction: Armageddon） | 低分辨率 G-Buffer/光照 + DSF 边缘感知上采样，可兼容透明 | ✅ | 光照极省 | 实现复杂，上采样伪影 | ❌（KISS） |
| Tiled Deferred（BF3） | Compute 分块剔除光源 | ❌（无 Compute） | — | — | ❌ |
| Clustered / Forward+ | 需 Compute 或结构化缓冲 | ❌ | — | — | ❌ |
| SM3 "伪 Tiled"：CPU 分块 + 常量数组循环 | 每块一个 Quad，PS 循环 N 盏光（常量寄存器） | 理论可行 | 减少 G-Buffer 重复读取 | **需要 CPU 逐帧分块与常量上传——SCRAPE 无此能力** | ❌ |

**参考**：Engel, *Light Pre-Pass Renderer* (2008) — http://diaryofagraphicsprogrammer.blogspot.com/2008/03/light-pre-pass-renderer.html ；Kircher & Lawrance, *Inferred Lighting* (I3D 2009) — https://dl.acm.org/doi/10.1145/1507149.1507162

### 4.3 光源数量扩展性

| 量 | 估算（1080p，2,073,600 px） |
|---|---|
| 单光像素成本 | G-Buffer 读 16 B（4×32bpp，`tex2Dlod` 点采样）+ FP16 RMW 16 B + PS ~60–90 slots（GGX） |
| 100 盏光，各覆盖 2% 屏幕 | ≈ 4.1 M 像素着色 ≈ 2 次全屏光照，现代 GPU < 1 ms 量级 |
| 最坏情况 | 大半径光叠满全屏（如大爆炸群）→ 成本 ∝ 屏幕覆盖总和；用 `clip()` 早退 + 限制半径 |

### 4.4 HDR 累积格式与 FP16 混合

| 格式 | 混合支持 | 结论 | 置信度 |
|---|---|---|---|
| `A16B16G16R16F` | GeForce 6+/Radeon X1000+ 起支持 FP16 混合；原版 `FrameRenderTarget` HDR 模式即此格式，粒子/透明已在其上做加法与 alpha 混合 | ✅ 光体积 `ONE/ONE` 加法安全 | `📄源码确认` [src: diagrams/vanilla-pipeline-reference.md#L66] + `📚文献` |
| `A32B32G32R32F` | DX9 级硬件不保证 FP32 混合；64→128bpp 带宽翻倍 | ❌ | `📚文献` |
| `A2R10G10B10` 作累积 | 只能 [0,1]，需缩放编码 | ❌ | — |

**注意**：`FrameRenderTarget` 只有在 `WW3D.IsHdrEnabled`（或 AA）时才是离屏 FP16，否则直接画 `A8R8G8B8` 后台缓冲。→ **延迟路径应以 HDR 开启为前提**，HDR 关闭时整体回退原版正向。`📄源码确认` [src: dictionaries/distillation-and-issues-notes.md#L33-L34]

---

## 5. SM3 上的 PBR

### 5.1 直接光 BRDF（Cook-Torrance：GGX D + Smith G + Schlick F）

| 项 | 推荐公式（SM3 写法，禁止 `mad()`/`rcp()` 函数形式） | 近似 slots |
|---|---|---|
| D（GGX/Trowbridge-Reitz） | `a2 = a*a; d = (NoH*a2 - NoH)*NoH + 1; D = a2 / (PI*d*d)` | ~6 |
| V（Smith-GGX 联合近似，Karis/Hammon） | `V = 0.5 / (NoL*(NoV*(1-a)+a) + NoV*(NoL*(1-a)+a))` | ~7 |
| F（Schlick，球面高斯近似） | `Fc = exp2((-5.55473*VoH - 6.98316)*VoH); F = F0 + (1-F0)*Fc` | ~5 |
| 漫反射 | Lambert `albedo*(1-metal)/PI`（能量守恒：`kd = (1-F)*(1-metal)` 可省略 `(1-F)`） | ~3 |
| 合计（含 `normalize`/点积） | | **~40–60 slots**，远低于 `ps_3_0` 512 下限 |

> `a = roughness²`（感知粗糙度平方）。`NoV` 需 `saturate` 并加 1e-4 防除零。`📚文献`（Karis 2013）

### 5.2 IBL：Split-Sum + 预滤波立方体 Mip

| 组件 | 做法 | SM3 可行性 | 本项目资源 | 建议 |
|---|---|---|---|---|
| 预滤波镜面环境 | `texCUBElod(EnvSampler, float4(R, roughness * MaxMip))` | ✅ `texCUBElod` 为 SM3 内建 | 原版 `EnvironmentDestinationCube` 128²×6 + `autogenmipmap`（**盒式滤波，非 GGX 卷积**，128² → 8 级 mip，`MaxMip=7`） | ✅ 先用 autogen mip 近似；粗糙度→mip 可用 `mip = MaxMip * sqrt(roughness)` 补偿盒滤波模糊过快 |
| 环境 BRDF（split-sum 第二项） | (a) 2D LUT 纹理（128²，`A16B16G16R16F` 或 `G16R16`）(b) **Karis/Lazarov 解析近似** | 两者都可 | (a) 需额外静态纹理 + 1 sampler | ✅ **用解析近似**：省 1 次依赖读取与 1 个 sampler |
| 漫反射辐照度 | (a) 辐照度立方体 1 次 `texCUBE` (b) SH9（9 个 RGB 系数 → 7 个 `float4` 常量，Sloan 打包，~15 ALU） | 都可 | 日冕 Mod 已有 `PbrIrradianceTexture`（`GeneratePbrIrradianceMap`） | ✅ **复用 `PbrIrradianceTexture`**；SH9 需 CPU 投影系数，SCRAPE 无法计算 → ❌ |

```hlsl
// Karis "Physically Based Shading on Mobile" (2014)，源自 Lazarov 2013
float3 EnvBRDFApprox(float3 F0, float roughness, float NoV)
{
    const float4 c0 = float4(-1, -0.0275, -0.572, 0.022);
    const float4 c1 = float4( 1,  0.0425,  1.04, -0.04);
    float4 r = roughness * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
    float2 AB = float2(-1.04, 1.04) * a004 + r.zw;
    return F0 * AB.x + AB.y;
}
```

**参考**：Karis, *Real Shading in Unreal Engine 4* (SIGGRAPH 2013) — https://blog.selfshadow.com/publications/s2013-shading-course/ ；Karis, *Physically Based Shading on Mobile* (2014) — https://www.unrealengine.com/blog/physically-based-shading-on-mobile ；Lazarov, *Getting More Physical in Call of Duty: Black Ops II* (SIGGRAPH 2013) — 同 s2013 课程页；Sloan, *Stupid Spherical Harmonics Tricks* (GDC 2008) — https://www.ppsloan.org/publications/StupidSH36.pdf

---

## 6. 延迟管线中的阴影

| 选项 | 说明 | 成本 | 建议 |
|---|---|---|---|
| **直接在 `DeferredComposite` 内采样阴影图（推荐）** | 重建 `worldPos` → `mul(worldPos, ShadowMapWorldToShadow)` → 采样 `R32F` 阴影图（原版 `ShadowMapTexture` 存 z/w） | 0 额外 Pass、0 额外 RT | ✅ KISS |
| 独立屏幕空间阴影遮罩 Pass（FXFXH `FXscreenSpaceShadow.fx`） | 先写阴影遮罩 RT，再模糊/与 SSAO 合并 | +1 全屏 Pass + 1 张 RT（D3D9 无通用 8-bit 单通道 RT，只能用 32bpp） | 仅当需要屏幕空间模糊软阴影或与 SSAO 合并时 |
| 硬件 PCF（NV 深度纹理 + `tex2Dproj` 比较） | 需要 `D24` **深度纹理**作阴影图 | — | ❌ 引擎只给 `R32F` 颜色阴影图 |

**`ps_3_0` 下可负担的手工 PCF**（`R32F` 不保证可过滤 → 一律 Point 采样后手工比较）：

| 变体 | 采样数 | 质量 | 备注 |
|---|---|---|---|
| 2×2 双线性 PCF | 4 `texld` + 4 比较 + `frac` 权重 lerp | 边缘平滑，最小可用 | 原版/FXFXH 4-tap 水平 |
| 3×3 双线性 PCF | 16 `texld` | 柔和 | 现代 GPU 轻松承受，**推荐默认** |
| 旋转泊松 8–12 tap | 8–12 + 噪声 | 软但带噪 | 需屏幕空间旋转噪声（`VPOS` 哈希） |

**级联**：RA3 为俯视/斜俯视 RTS 相机，视锥深度范围小且均匀，原版单张正交阴影图（`1024²`/`2048²`）已适配视锥；**CSM 不需要**。`📄源码确认`（`Sas.Shadow[0].MapSize`）[src: diagrams/vanilla-pipeline-reference.md#L70-L71]

---

## 7. 贴花、透明与粒子

### 7.1 D3D9 MRT 混合能力（核实）

| Cap / 状态 | 作用 | 对延迟贴花的意义 | 置信度 |
|---|---|---|---|
| `D3DPMISCCAPS_MRTPOSTPIXELSHADERBLENDING` (0x80000) | MRT 下可做混合 | 前提 | `📄源码确认` [src: MSD9/d3dpmisccaps.md#L117-L119] |
| 混合状态 | **所有 RT 共用同一 `SrcBlend/DestBlend/BlendOp`**（"the device is expected to apply the same state to all simultaneous render targets"）；D3D9 **没有逐 RT 混合状态** | 无法"RT0 alpha 混合、RT1 覆盖" | `📄源码确认` [src: MSD9/multiple-render-targets.md#L19-L21] |
| `D3DPMISCCAPS_INDEPENDENTWRITEMASKS` (0x4000) + `D3DRS_COLORWRITEENABLE1..3`（= 190..192） | 逐 RT 通道写掩码 | 可让贴花只改 RT0/RT2 某些通道、保护 RT1/RT3 | `📄源码确认` [src: MSD9/d3dpmisccaps.md#L78-L80][src: MSD9/d3drenderstatetype.md#L112] |
| `D3DPMISCCAPS_SEPARATEALPHABLEND` (0x20000) + `D3DRS_SEPARATEALPHABLENDENABLE` | alpha 通道独立混合因子（仍对所有 RT 相同） | 可保护各 RT 的 alpha 标志位 | `📄源码确认` [src: MSD9/d3dpmisccaps.md#L107-L109] |
| `SRCALPHA` 在 RT i 上取 `oC0.a` 还是 `oCi.a` | 文档未明确 | 影响贴花法线混合 | `❓待实测` |

### 7.2 贴花策略

| 策略 | 做法 | 优点 | 缺点 | 建议 |
|---|---|---|---|---|
| **S-A：光照后乘法贴花（推荐首选）** | 焦痕/履带/弹坑在 `DeferredComposite` 之后、在 HDR 上用 `DESTCOLOR/ZERO`（乘法）或 alpha 混合绘制 | 零 G-Buffer 改动；原版 shader 基本可用 | 对镜面高光也会变暗（漫反射下数学等价于乘 albedo，因光照对 albedo 线性） | ✅ Phase 3 首选 |
| S-B：G-Buffer 贴花（只绑 RT0） | SCRAPE 只 `settarget 0 GBufferAlbedo`，贴花 alpha 混合进 albedo | 光照正确 | 需要额外 settarget 切换；RT0 alpha 只有 2-bit（不能用 DESTALPHA） | Phase 6 可选 |
| S-C：带法线的 G-Buffer 贴花 | 同时混合 RT0+RT1 | 弹坑凹凸 | 共享混合状态 + 2-bit alpha + 混合后法线需重新 normalize（读取时已做） | ❌ 除非美术强需求 |

### 7.3 透明 / 粒子 / 软粒子

| 对象 | 路线 | 说明 |
|---|---|---|
| `Transparent`、`StaticSort4..1`、激光、曳光 | 保持正向，画在合成后的 HDR 上，读硬件 `D24S8` 做 Z-Test | 与原版顺序一致 `📄源码确认` |
| 软粒子 | 直接读 `WW3D.DepthTexture`（=RT3） | 原版 `GpuParticle*.fx` 已绑定 `WW3D.DepthTexture` → 只要 RT3 语义一致**零改动** `📄源码确认` |
| 透明物的局部光照 | 正向光照（原版 8 光源上限）或忽略 | KISS：保持原版 |

---

## 8. 后处理

### 8.1 SSAO（SM3 可行变体）

| 变体 | 输入 | 采样数 | 质量 | SM3 | 建议 |
|---|---|---|---|---|---|
| Crysis SSAO（Mittring 2007） | 仅深度 | 8–16 + 随机旋转 | 平面发灰、边缘光晕 | ✅ | 次选 |
| **Alchemy AO（McGuire 2011）** | 深度 + 法线 | 8–12 | 法线感知、无自遮挡灰 | ✅ | ✅ **推荐**：RT1+RT3 现成 |
| SAO（McGuire 2012） | 深度 mip 链 + 法线重建 | 9–11 | 大半径稳定 | ⚠️ 需多级 `R32F` 降采样（SCRAPE 可多张纹理逐级 `renderquad`） | 可选进阶 |
| HBAO（Bavoil 2008） | 深度，沿方向步进 | 4 方向×4–8 步 | 高 | ⚠️ 指令多、循环 | ❌ |

建议：**半分辨率 Alchemy 8–12 tap + 双 Pass 4–6 tap 深度感知模糊，只乘在环境/IBL 漫反射项上**。俯视 RTS 视角 AO 视觉收益有限 → 低优先级。

### 8.2 无 MSAA 的抗锯齿

| 方案 | DX9 路径 | Pass 数 | 额外资源 | 本项目接入点 | 建议 |
|---|---|---|---|---|---|
| **FXAA 3.11** | `#define FXAA_PC 1`、`#define FXAA_HLSL_3 1`、`FXAA_QUALITY__PRESET 12..39` | 1 | 输入需为 LDR（色调映射后），luma 存 alpha 或 shader 内算 | `Step 10.9` LUT 输出改写到一张 `A8R8G8B8` 纹理 → FXAA 全屏 Pass 写 `FrameBuffer` → UI | ✅ 首选 |
| SMAA 1x | `SMAA_HLSL_3 1` | 3（边缘/权重/混合） | 2 张中间 RT + 静态 `AreaTex`/`SearchTex`（可由 `initCustomTextures` 绑定） | 同上 | 可选（质量更好） |
| 法线/深度边缘检测 + 模糊（Tabula Rasa） | 原生 SM3 | 1 | 读 RT1/RT3 | HDR 阶段 | ❌（被 FXAA 取代） |

**参考**：FXAA 3.11 源码（NVIDIA Graphics Samples）— https://github.com/NVIDIAGameWorks/GraphicsSamples/blob/master/samples/es3-kepler/FXAA/FXAA3_11.h ；SMAA — https://github.com/iryoku/smaa

### 8.3 Bloom / 色调映射 / LUT 交互

| 要点 | 说明 | 置信度 |
|---|---|---|
| 顺序不变 | 原版 `Distortion → Bloom → LUT(FilmTonemapping + 3D LUT) → FrameBuffer → UI` 保持 | `📄源码确认` |
| 能量尺度 | PBR 合成输出的 HDR 亮度分布与原版正向输出不同 → Bloom 阈值/曝光需重新标定 | `❓待实测` |
| UI 隔离 | AA 必须插在 LUT 之后、`renderIconLayers`/`renderUI` 之前 | `📄源码确认` [src: dictionaries/distillation-and-issues-notes.md#L37-L38] |

---

## 9. 显存与带宽预算

**每张全屏 32bpp RT**：1080p = 7.91 MiB；1440p = 14.06 MiB；4K = 31.64 MiB。

| 资源 | 格式 | 1080p (MiB) | 1440p (MiB) | 4K (MiB) |
|---|---|---|---|---|
| RT0 Albedo | `A2R10G10B10` | 7.91 | 14.06 | 31.64 |
| RT1 Normal | `A2R10G10B10` | 7.91 | 14.06 | 31.64 |
| RT2 Material | `A8R8G8B8` | 7.91 | 14.06 | 31.64 |
| RT3 Linear Z | `R32F`（复用 `DepthTextureLinear`） | 7.91 | 14.06 | 31.64 |
| `DepthBuffer` | `D24S8` | 7.91 | 14.06 | 31.64 |
| `FrameRenderTarget` | `A16B16G16R16F` | 15.82 | 28.13 | 63.28 |
| **合计** | | **55.37** | **98.44** | **221.48** |
| 可释放：原版 `DepthTexture`（`R32F`，z/w） | 不再需要 `updateDepthMap` | −7.91 | −14.06 | −31.64 |

**每帧带宽（1080p，不含过度绘制）**：
| 阶段 | 每像素字节 | 每帧 |
|---|---|---|
| G-Buffer 写 | 16 B（+ Z/模板） | ≈ 33 MB × 平均过度绘制（RTS 俯视约 1.5–2.5） |
| 合成（阳光+IBL+阴影） | 读 16 B + 写 8 B + 阴影 PCF 读 | ≈ 50 MB |
| 局部光 | 每覆盖像素读 16 B + FP16 RMW 16 B | 取决于覆盖率 |
| 删除 `updateDepthMap` | 省一整次场景几何遍历 + 2 张 `R32F` 全屏写读 | 净收益 |

现代 GPU（>200 GB/s）下即便 60 fps 总计 < 10 GB/s，**带宽不是瓶颈**；D3D9 DrawCall/CPU 才是。

### 9.1 3-MRT 紧凑方案（对照）

| 方案 | RT0 | RT1 | RT2 | 代价 | 节省 |
|---|---|---|---|---|---|
| 当前 4-MRT | Albedo | Normal | R/M/AO/E | — | — |
| 3-MRT-a | `A8R8G8B8` Albedo + AO | `A2R10G10B10` Normal | `G16R16`：R=16-bit unorm 线性深度，G=粗糙度/金属度 8+8 打包（`floor`/`frac` 算术，无位运算） | 深度仅 16-bit（远距 2000 单位时步长≈0.03）→ 软粒子/SSAO 精度下降；自发光无处存放；**`WW3D.DepthTexture` 消费者需要额外解码 Pass** | 7.91 MiB @1080p、25% G-Buffer 写带宽 |

**结论**：3-MRT 破坏了"RT3 = 原版 `DepthTextureLinear` 直接复用"这一最大收益，**不推荐**。

---

## 10. D3D9 专属陷阱清单

| # | 陷阱 | 正确做法 | 置信度 |
|---|---|---|---|
| P1 | 半像素偏移 | 全屏 Quad：`uv = ndc*float2(0.5,-0.5)+0.5 + 0.5/TargetSize`；或用 `VPOS`：`uv = (vpos + 0.5) / FrameBufferSize` | `📄源码确认` [src: MSD9/directly-mapping-texels-to-pixels.md] |
| P2 | `VPOS` 语义 | `ps_3_0` 专有，D3D9 中为整数像素坐标（无 +0.5），光体积 PS 用它求屏幕 UV 最省插值器 | `📄源码确认` [src: ~/.agents/skills/hlsl-directx-reference/references/sm3-intrinsics-and-d3d9-reference.md#L43] |
| P3 | `R32F`/FP16 过滤 | 老硬件 FP32 不可过滤；即使现代可过滤，**G-Buffer 与深度一律 `Point`**（原版 `PostFX_LinearDepth`/`UnderwaterDeferred` 也用 Point） | `📄源码确认` |
| P4 | MRT + Fog | 固定管线雾只保证 RT0，其它 RT 未定义 → G-Buffer Pass `FogEnable = FALSE` | `📄源码确认` [src: MSD9/multiple-render-targets.md#L23] |
| P5 | MRT + Alpha Test | Alpha Test 只比较 `oC0.a`——而 RT0.a 是 2-bit 标志位 → `AlphaTestEnable = FALSE`，镂空用 `clip()` | `📄源码确认` [src: MSD9/multiple-render-targets.md#L22] |
| P6 | MRT + Alpha Blend | G-Buffer Pass `AlphaBlendEnable = FALSE`（混合状态对所有 RT 相同） | `📄源码确认` |
| P7 | sRGB 写 | `SRGBWRITEENABLE` 只作用 RT0 → 手工编码 | `📄源码确认` |
| P8 | 指令槽 | `ps_3_0` 最少 512 slots、32 个 `r#`、`c0..c223`；用 `fxc /T ps_3_0 /E <PS> /Fc` 查看 "approximately N instruction slots used" | `📄源码确认` [src: MSHLSL/dx9-graphics-reference-asm-ps-3-0.md#L63] |
| P9 | 动态分支 | 现代 GPU 分支粒度 32/64 像素；DX9 老卡（G70）约千像素级。适合"天空/背景早退"等大块一致分支，不适合逐像素随机分支 | `📚文献` |
| P10 | 分支内梯度指令 | 动态 `if` 内禁止 `tex2D`（隐式导数）→ G-Buffer 读取一律 `tex2Dlod(s, float4(uv,0,0))`；需要导数时在分支外 `ddx/ddy` 后用 `tex2Dgrad` | `📄源码确认` [src: MSHLSL/dx9-graphics-reference-asm-ps-3-0.md#L45-L47] |
| P11 | SM4+ 语法 | 禁 `mad()`/`rcp()`/`asfloat`/位运算/`Texture2D.Sample`/`SV_*` | `📄源码确认`（AGENTS.md §3.1） |
| P12 | 固化常量寄存器 | 光照 shader 新增 uniform 用 `/Fc` 确认未落入 `c0..c10`、`c89..c127` | `📄源码确认`（AGENTS.md §3.1） |
| P13 | 光体积剔除方向 | D3D9 默认 CW 为正面；`D3DCULL_CCW` 剔除逆时针面 → 实际画哪面取决于网格绕序与视图手性，**PIX 确认** | `❓待实测` |
| P14 | 模板位 | 原版轮廓占用 bit 0..1，新用途限 bit 2..7 并设 `StencilMask/StencilWriteMask` | `📄源码确认` |
| P15 | HDR 关闭 | 无 FP16 `FrameRenderTarget` → 延迟路径不成立，回退正向 | `📄源码确认` |
| P16 | MSAA | 延迟分支内必须强制 `WW3D.AntiAliasingMode` 不生效（MRT 不支持 AA） | `📄源码确认` |

---

## 11. 对 RA3-Deferred-Render 的建议

### 11.1 确认保留的选择

| 项 | 当前设计 | 依据 |
|---|---|---|
| C1 | 4×32bpp MRT（同位深） | §2.2；不依赖独立位深 cap |
| C2 | RT1 世界法线 xyz 原样写 `A2R10G10B10` | §2.1；Unity 5 先例 |
| C3 | RT3 `R32F` = 原版 `viewPos.z`，复用 `DepthTextureLinear` → `WW3D.DepthTexture`，删除 `updateDepthMap` | §2.5、§3 |
| C4 | HDR 累积 `A16B16G16R16F` + `ONE/ONE` 加法 | §4.4 |
| C5 | 背面 + `GREATEREQUAL` 单 Pass 光体积 + `clip()` 早退 | §4.1 |
| C6 | Deferred Shading（不走 Light Pre-Pass） | §4.2 |
| C7 | 透明/粒子/水面保持正向，软粒子读 RT3 | §7.3 |
| C8 | 不启用 MSAA；全部 sRGB 在 HLSL 手工处理 | §2.4、§10 |

### 11.2 建议修改（按重要性）

| # | 修改 | 理由 | 代价 |
|---|---|---|---|
| S1 | **RT0 改为 `A8R8G8B8`**（RGB = gamma 2.0 编码 albedo，A = 8-bit 可用：材质 ID 或高光遮蔽） | 8-bit sRGB 类编码对 albedo 已足够；换来 8-bit alpha 而非 2-bit；`A8R8G8B8` 是原版已用 token，**规避 `A2R10G10B10` token 风险** | 写 `sqrt`、读 `x*x`，~4 slots |
| S2 | 光照 Pass 中 G-Buffer 采样统一 `tex2Dlod(...,0)` + `Point` + `Clamp` | §10 P3/P10 | 无 |
| S3 | 在 `DeferredComposite` 内直接做阴影 PCF（3×3 双线性 16 tap），不另建阴影遮罩 RT | §6；少 1 Pass + 1 RT | 无 |
| S4 | 环境 BRDF 用 `EnvBRDFApprox` 解析近似；漫反射 IBL 复用 `PbrIrradianceTexture`；镜面 `texCUBElod` 用 `mip = MaxMip*sqrt(roughness)` | §5.2 | 无 |
| S5 | 延迟分支以 `WW3D.IsHdrEnabled` 为前置条件 | §4.4 | 1 个 `if` |
| S6 | 焦痕/履带/弹坑先用"光照后乘法贴花"（S-A） | §7.2；零 G-Buffer 改动 | 镜面轻微偏差 |
| S7 | 若使用"已延迟像素"模板标记，限定 bit 7（`0x80`），避开轮廓 bit 0..1 | §4.1、P14 | 无 |
| S8 | `CommonGBuffer.fxh` 中封装 `EncodeGBuffer/DecodeGBuffer`（Tabula Rasa accessor 模式），任何布局变更只改该头文件 | §1 | 无 |

### 11.3 可选升级（按优先级）

| 优先级 | 升级 | 前提 | 预期收益 |
|---|---|---|---|
| 1 | FXAA 3.11（LUT 之后、UI 之前） | LUT 输出改到中间 `A8R8G8B8` 纹理 | 弥补关闭 MSAA 的锯齿 |
| 2 | 半分辨率 Alchemy SSAO + 深度感知模糊（只乘环境项） | Phase 4 稳定 | 单位/建筑接地感 |
| 3 | 双 Pass 模板光体积（`TWOSIDEDSTENCILMODE`） | PIX 显示局部光填充率为瓶颈 | 减少大光源浪费像素 |
| 4 | SMAA 1x 取代 FXAA | 静态 `AreaTex/SearchTex` 可绑定 | 更锐利的 AA |
| 5 | G-Buffer 法线贴花（S-C） | 美术需求 | 弹坑凹凸 |
| ✗ | INTZ、Tiled/Clustered、LPP、Inferred、3-MRT、CSM | — | 不做（§3、§4.2、§9.1、§6） |

### 11.4 需实机验证的问题（输入给 plans/）

| # | 问题 | 验证方法 |
|---|---|---|
| Q1 | SCRAPE `var texture` 是否接受 `A2R10G10B10`（及 `G16R16`、`A2B10G10R10`）token？ | Phase 0：声明后 PIX 查看实际 D3DFORMAT；失败则采用 S1 |
| Q2 | 光体积 `D3DCULL_CCW` 在 RA3 中实际光栅化的是背面还是正面？ | PIX 单光源线框 + 深度测试状态 |
| Q3 | MRT 混合时 RT i 的 `SRCALPHA` 取 `oC0.a` 还是 `oCi.a`？（仅贴花 S-B/S-C 需要） | 双 RT 混合测试图 |
| Q4 | 驱动是否报告 `MRTINDEPENDENTBITDEPTHS`（仅作记录，设计不依赖） | caps 查看工具 / PIX 设备信息 |
| Q5 | PBR 合成后 HDR 亮度尺度与原版差异，Bloom/曝光需如何重标定 | 同场景 A/B 截图 + 直方图 |
| Q6 | RT3 写出的 `viewPos.z` 与原版 `PostFX_LinearDepth` 输出逐像素一致（符号/单位） | Debug 视图差分：两者相减应≈0 |
| Q7 | `EnvironmentDestinationCube` 的 mip 数量与 `texCUBElod` 在 `autogenmipmap` 下是否有效 | Debug 视图按 mip 输出 |
