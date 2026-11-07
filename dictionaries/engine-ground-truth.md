# 引擎实机真理账本（Engine Ground Truth Ledger）

> **定位**：RA3 v1.12 PC（`ra3_1.12.game`）C++ 侧行为的**紧凑事实表**。叙述与完整证据见 [`knowledge/engine-behavior.md`](../knowledge/engine-behavior.md)（同号 `GT-xx`）；未定论问题见 [`knowledge/open-questions.md`](../knowledge/open-questions.md)（`OQ-xx`）。
> **优先级**：`✅已实机验证` > `📄源码确认` > `🔍IDA静态推测` > `❓待实测`。实机 / PIX / RenderDoc / `main\fxc.exe` 实测结果永远覆盖静态推测（`AGENTS.md` §4）。
> **维护规则**：实验关闭某个 `OQ` 后，在此表更新对应行的置信度与证据（写明日期、抓帧或截图文件名），不要另起新文件。来源缩写见 `engine-behavior.md` §0。

## 1. 脚本与资源

| ID | 主题 | 结论 | 置信度 | 证据/来源 | 设计影响 |
|---|---|---|---|---|---|
| GT-01 | `.scrapeo` 解析 | 预处理后文本逐行解析；`#` 行为注释，宏须预先展开；单行（含换行）< 256 字节 | 🔍 | `CMD#L49-L68`、`D02#L11-L19` | 每次改脚本跑 `check_scrape.js` |
| GT-02 | 显存分配 | `var` 资源加载时一次性创建，帧间不销毁、无瞬态别名；总显存 = 声明之和 | 📄 | `VPR#L84-L91` | 废弃 Pass 必须删声明才省显存 |
| GT-03 | 跨帧保留 | 纹理未被 clear 前保留上一帧内容 | ✅ | `VPR#L92-L100`、`COR#L93-L131` | 可做分帧摊销；G-Buffer 每帧必须 `clear` |
| GT-04 | 自定义 SCOPE | 脚本可新建 SCOPE 块；`setbool` 跨帧保持 | ✅ | `COR#L15-L33` | 统一用 `Deferred.*`；开关显式赋初值 |
| GT-05 | `fromscope` | `var texture/texturecube X fromscope <Block> <Parm>` 可用；CC4 引擎静态填充的 G-Buffer/光照纹理与 `renderDeferredLights` 在 RA3 不存在 | ✅ / 🔍 | `ISO#L1147-L1148`、`COR#L83`、`DISC#L49-L69` | G-Buffer 全部自建；可 `fromscope` 取 Shroud/Cloud |
| GT-06 | `callproc` | 不保存/恢复任何 RT、Depth、Camera、Override、SCOPE 状态 | 🔍 | `CMD#L87`、`OVR#L37-L44` | Pass 结尾显式解绑 RT1..3 并恢复主帧 |

## 2. 渲染目标、格式与深度

| ID | 主题 | 结论 | 置信度 | 证据/来源 | 设计影响 |
|---|---|---|---|---|---|
| GT-07a | 已证实 RT 格式 | `R32F`、`A16B16G16R16F`、`A8R8G8B8`、`L8`（作 RT 写入并被采样）；`D24S8`（仅深度表面） | ✅ | `ISO#L159/L632/L638/L876/L348`、`COR#L29/L107` | G-Buffer 只用这些即零风险 |
| GT-07b | 未证实 RT 格式 | `A2R10G10B10`、`G16R16`、`R16F`、`G16R16F`、`A32B32G32R32F` 仅见于引擎格式字符串表，任何脚本未用作 RT | 📄（名称）/ ❓（RT） | `ASM#L151-L204` | `OQ-04`；失败回退 `A8R8G8B8` |
| GT-07c | 格式表完整性 | `ASM` 字符串表不完整（缺 `A8R8G8B8`/`X8R8G8B8` 却被原版使用） | 📄 | `ASM#L151` | 不能以"表中无"判定格式不可用 |
| GT-08 | FOURCC 深度 | `INTZ`/`RAWZ`/`DF24`/`RESZ` 无任何证据（映像与格式表中均无）；`D16S16` 不存在 | 🔍 + 📄 | `OVR#L235-L244`、`Q4#L5-L12` | 不规划，需 wrapper 才可能 |
| GT-09 | `D24S8` 采样 | 无 Shader 可读路径：`setdepth` 只收 surface，`settexture`/`casttexture` 只收 texture，PC `casttexture` = NoOp（`0x7A8B80`），`stretchrect` 不能 depth→color | ✅（已彻底定论，无需重复实验） | `OVR#L149-L233`、旧账本 | 线性深度由 G-Buffer PS 写入 `RT3 R32F` |
| GT-10 | MRT 绑定 | `settarget 0..3 <surface|texture|NULL> [cubeface]`；PC 可直绑 `var texture` 再采样；cube face 0..5 可用 | ✅（单 RT / cube）/ ❓（4 RT 同绑） | `ASM#L10-L21`、`COR#L47-L73` | G-Buffer 用 `var texture`；`OQ-05` |
| GT-11 | RT 组合检查 | `renderbin` 前检查：颜色/深度 MSAA 一致、深度 ≥ 颜色，否则 `ERROR: SCRAPE Current render targets are not a valid set` | 🔍 | `CMD#L188-L195` | `OQ-06` 核对尺寸 |
| GT-12 | Viewport 推导 | 引擎由最后设置的 RT/Depth 推导 viewport；官方要求先 `setdepth` 后 `settarget` | 📄 | `VPR#L113-L120` | 顺序：`setdepth` → `settarget 0..3` → `setviewport` |
| GT-13 | D3D9 MRT 规则 | 同尺寸；无 caps 时同位深；不支持 MSAA；sRGB 写只作用 RT0；MRT 下固定 AlphaTest/混合受限 | 📄（MS 文档） | `PLAN#L48-L65`、`DISC#L238-L276` | 4×32 bpp；`clip()` 代替 AlphaTest；Shader 内显式 sRGB |
| GT-13b | MRT 独立位深 | 驱动 `MRTINDEPENDENTBITDEPTHS` 支持情况未测 | ❓ | — | 不依赖（`OQ-16`） |
| GT-14 | 深度表面 / HDR 路由 | `DepthBuffer`=引擎默认 1x 全屏 `D24S8`（一帧三次复用）；`ShadowMapDepthBuffer` 独立；AA 关时 `FrameDepthBuffer`=0×0；HDR 或 AA 开 → 主帧画 `FrameRenderTarget`（surface，不可采样），否则画 `FrameBuffer` | 📄 | `VPR#L63-L67`、`#L104-L126`、`#L227` | 延迟强制 AA 关；HDR 关时策略见 `OQ-10` |

## 3. Shader / Technique

| ID | 主题 | 结论 | 置信度 | 证据/来源 | 设计影响 |
|---|---|---|---|---|---|
| GT-15 | `setshader` | 只影响 `renderquad`/`renderfullquad`；场景 draw 用 draw item 自带 shader；无 A→B 替换 | 🔍 | `Q2#L6-L59` | G-Buffer 必须是各场景 FX 内的 technique |
| GT-16 | 特殊 technique 识别 | 加载时 `strcmp`（区分大小写，含下划线）匹配 `_CreateShadowMap`/`_CreateDepthMap`；Depth 缺失回退 Shadow，反之不回退；不读 annotation | 🔍 + 📄（官方 `Objects.fxh#L2205-L2207` 按此设计） | `Q1#L17-L85` | 不复用 `_CreateDepthMap` 作 G-Buffer（除非走路线 2） |
| GT-16b | 下划线是否必须 | 曾有反例观察，未复核 | ❓ | `Q1#L149-L167` | `OQ-03` |
| GT-17 | 全局 Begin/End | `begin*` 遍历全 shader 写各自缓存索引；两个 `end*` 共用 `0x5D16A0`，无条件全写 `-1`（会清掉手动 override），非状态栈 | 🔍（成对用法 📄） | `OVR#L46-L132`、`RA3S\Shadow.scrapeh#L77-L88` | G-Buffer override 区间不得跨越 Shadow/Depth begin/end |
| GT-18 | `setshaderoverride` | 作用于整个 shader 资源，持续到 `clearshaderoverride`/全局 end；T 不存在时静默 `-1`；**官方 RA3 脚本从未使用** | 🔍 / ❓（可用性） | `OVR#L18-L44`、`RA3S\*.scrape*` grep 零命中 | `OQ-01` 决定路线 1 / 路线 2 |
| GT-19 | 缺 technique 行为 | override = `-1` 时回退 draw 原 technique（<0 用 0），**不跳过绘制** | 🔍 | `Q1#L107-L147`、`D02#L58-L61`、`DIN#L59` | G-Buffer Pass 须防污染：只提交已适配家族 + Valid/Stencil 过滤；`OQ-02` |
| GT-20 | 变体选择 | draw 自带 LOD technique（`Default`/`Default_M`/`Default_L`）；PC 用 shader 数组 + D3DX 表达式选 VS/PS（`min(NumJointsPerVertex,1)` 等）；`ExpressionEvaluator` 注解需 `_WW3D_` | 📄 | `RA3S\Objects.fxh#L1001-L1083`、`RA3S\Common.fxh#L38-L100` | G-Buffer technique 自带蒙皮 VS 数组；状态继承见 `OQ-15` |
| GT-21 | `.fxo` 兼容 | `main\fxc.exe /T fx_2_0` 产物可被引擎加载并参与 technique 匹配 | ✅ | `FXFXH\compileALL.bat`、`Q1#L45-L54` | 沿用 `fxc` 工具链 |

## 4. RenderBin 与可见集

| ID | 主题 | 结论 | 置信度 | 证据/来源 | 设计影响 |
|---|---|---|---|---|---|
| GT-22 | Bin 解析 | FX `_SasGlobal` 的 `string RenderBin` 与 `renderbin <name>` 共用 47 项固定表（`strcmp`）；未知名 → `NONE`(0) 且不入队；不可新增 | ✅（注解→队列对应）/ 🔍（表长、NONE 不入队） | `Q5#L86-L260` | 只用 [`renderbin-dict.md`](./renderbin-dict.md) 中的名字；`FXFXH\COMMON.FXH#L61` 的 `PartiallyTransparentWall` 无效 |
| GT-23 | 注解作用域 / 覆盖 | 注解属整个 FX；改 bin = 重新分类不复制；W3X `StaticSortLevel 1..5` 强制改入 `StaticSort1..5` | 🔍 | `Q5#L285-L342` | 换 bin 后所有 Pass 都要补提交；`OQ-09` |
| GT-24 | `renderbin X 1` | 第二参数 `1` = 同名 bin 的粒子，不是 pass 1；第三参数保留 | 📄 | `CMD#L162-L186` | G-Buffer 只用 `renderbin X` |
| GT-25 | 引擎回调 | `renderUnits`/`renderStructures` 内含描边队列并写 Stencil bit 0..1；`render*` 回调 ≠ bin | 📄 | `VPR#L46-L47`、`#L300-L302` | G-Buffer 与主帧共用同一 `DepthBuffer`，之后不再清 stencil |
| GT-26 | Stencil 占用 | bit 0..1 描边，bit 2 贴花；bit 3..7 未见使用 | 📄 / ❓（3..7） | `VPR#L334`、`#L343`、`#L457-L464` | 延迟掩码只用 bit 3..7；`OQ-13` |
| GT-27 | 空闲队列 | `StaticSort_END`(41) 官方从未使用，引擎有队列槽；`StaticSort1..5`、`LightSource`、`TerrainUIRender`、`UnitPlayer_END` 不可借 | 📄 / ❓（运行时） | `Q5#L344-L381` | 光体积计划用 `StaticSort_END`；`OQ-08` |
| GT-28 | 可见集 | 仅 `ShadowMap`/`DepthMap`/`Reflection`/`Frame`；`+/-mask` 为 stub | 📄 / 🔍 | `CMD#L197-L223` | G-Buffer 用 `setcamera Viewer` + `visibleobjects Frame` |

## 5. SAS / SCOPE 与光照数据

| ID | 主题 | 结论 | 置信度 | 证据/来源 | 设计影响 |
|---|---|---|---|---|---|
| GT-29 | SCOPE 绑定 | `settexture/setfloat/setbool/setint/settosize <Block> <Parm> ...` ↔ HLSL `SasBindAddress = "<Block>.<Parm>"`；参数名可含点号/下标 | ✅ | `ASM#L115-L144`、`ISO#L475-L568`、`COR#L33` | `settexture Deferred GBufferN ...`；`settosize` 提供屏幕尺寸 |
| GT-30 | 官方 SCOPE 块 | `Terrain`、`Sas`、`WW3D`、`Particle`、`PostEffect`、`Water`、`Objects`、`Decal`、`Video`、`ConnectionLine`、`Environment` | 📄 | `RA3S\*.fx*` grep | 合成 Shader 可直接绑定；全屏 quad 下有效性见 `OQ-12` |
| GT-31 | 线性深度约定 | `WW3D.DepthTexture` = `R32F` 相机空间 `viewPos.z`；供水下、软粒子、`Distorter` 粒子；原版 `updateDepthMap` 仅在可见水面或软粒子开启时执行 | 📄 | `VPR#L276-L287`、`#L389-L409` | `RT3` 写同约定并绑定 `WW3D.DepthTexture`，删除 `DepthTexture` 与 `PostFX_LinearDepth` Pass |
| GT-32 | 引擎光照常量 | `c4` 环境光；`c5..c10` 3 盏平行光；`c89..c112` `PointLight[8]` 逐 draw 填充（Windows 下 `NumPointLights` 为 SAS int）；官方默认 `MaxNumPointLights 8`，`BasicW3D`/`DefaultW3D` 限 3 | 📄（布局）/ 🔍（"最近 8 盏"选择规则） | `VPR#L48-L53`、`RA3S\GlobalParameters.fxh`、`RA3S\BasicW3D.fxh#L20` | 8 光源/物体是前向上限；延迟用光体积绕开 |
| GT-33 | 局域光来源 | 球/柱体光体积 Mesh + 自定义 FX 已在游戏内工作并突破 8 光源限制；RA3 无 `renderDeferredLights`，无引擎光源列表接口 | ✅ / 🔍 | `PLAN#L39-L42`、`D01#L69-L70`、`CMD#L344-L361` | 局域光 = 放置的光体积物体；引擎动态光转换见 `OQ-11` |

## 6. 前代假设 vs 实机/新证据对照（保留的历史条目）

| 主题 | 静态反编译推测（旧） | 当前状态 | 实战准则 |
|---|---|---|---|
| Technique 缺名时的 Draw 行为 | 旧说法"缺名会被忽略/跳过或导致黑屏" | IDA 专题改判为"回退正常 technique"（GT-19），实机待测 `OQ-02` | 不要假设缺名 = 不画；以 PIX 抓帧为准 |
| 下划线 `_CreateShadowMap` 命名 | 必须带前导下划线、区分大小写 | 仍为 🔍，见 `OQ-03` | 新代码一律写精确名 `_CreateShadowMap` |
| MRT 等位深限制 | 严格 32 bpp 等位深 | 默认布局已满足；驱动独立位深能力未测（`OQ-16`） | 坚持 4×32 bpp |
| `D24S8` 采样支持 | 官方未暴露 | 已彻底定论，无原生可读路径（GT-09） | 直接写颜色 MRT 线性深度，无需重复实验 |
| `casttexture` D24S8 实验 | 早期计划建议实验 | PC 上为 NoOp（GT-09），实验已取消 | 不再实验 |
