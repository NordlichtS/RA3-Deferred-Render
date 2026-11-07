---
name: ra3-fx-shader
description: >-
  Author, modify, compile and verify Red Alert 3 v1.12 (PC, D3D9) `.fx` / `.fxh` effect files for the
  RA3-Deferred-Render project: effect-file anatomy (SAS annotations, `SasBindAddress`, `_SasGlobal` /
  `RenderBin`, technique names & LOD variants, `_CreateShadowMap` / `_CreateDepthMap`, shader arrays,
  state blocks), the fixed c0..c255 register contract, the FXFXH layered header architecture, official
  material-family inventory, Corona PBR/IBL references, and the verified `main\fxc.exe` workflow.
  Use whenever adding a G-Buffer technique to a material, writing deferred lighting / full-screen
  shaders, or checking register/SAS bindings. Generic HLSL/SM3 questions go to global skills.
---

# RA3 `.fx` / `.fxh` Effect 编写技能（延迟渲染项目专用）

> **边界**：本技能只写 **RA3 特有** 的 effect 约定。通用 HLSL 语法、SM3 内置函数可用性、寄存器/指令槽官方上限 → 全局技能 `hlsl-directx-reference`（`~/.agents/skills/hlsl-directx-reference/SKILL.md`，含离线微软文档检索脚本）；通用视觉算法（Fresnel、溶解、UV 动画、GLSL↔HLSL）→ 全局技能 `shader-programming`（`~/.agents/skills/shader-programming/SKILL.md`）。SCRAPE 脚本侧 → 工作区技能 [`ra3-scrape-pipeline`](../ra3-scrape-pipeline/SKILL.md)。
>
> 置信标签：`✅已实机验证` / `✅fxc实测`（编译器行为已验证）/ `📄源码确认` / `🔍IDA静态推测` / `❓待实测`。

## 1. 何时读哪份 reference

| 任务 | 先读 |
|---|---|
| 声明任何全局变量 / 采样器，或怀疑寄存器冲突 | [references/register-sas-contract.md](references/register-sas-contract.md)（速查：[`dictionaries/hlsl-register-sas-dict.md`](../../../dictionaries/hlsl-register-sas-dict.md)） |
| 给某个官方材质加 G-Buffer technique、排迁移优先级 | [references/material-family-inventory.md](references/material-family-inventory.md) |
| 在 `main/` 新建/改写 shader 的文件组织、复用 VS/阴影/体积光原型 | [references/fxfxh-architecture.md](references/fxfxh-architecture.md) |
| PBR BRDF、IBL 镜面/漫反射、irradiance cube 生成 | [references/corona-pbr-ibl-notes.md](references/corona-pbr-ibl-notes.md) |
| 编译、反汇编、读寄存器表、排查编译错误 | [references/fxc-workflow.md](references/fxc-workflow.md) |

## 2. RA3 Effect 文件解剖（自上而下的固定顺序）

```hlsl
// (0) 可选功能宏（wrapper 写在 include 之前）
#define DEFERRED_RENDER            // 需要 WW3D.DepthTexture / FrameBufferSize / View / ViewI / Projection / ProjectionI 时
#define SPECIAL_SAS_HEADER         // 要自写 _SasGlobal（例如指定 RenderBin）时
int _SasGlobal : SasGlobal         // (1) 全局 SAS 头：引擎读取的 effect 级元数据
<   int3 SasVersion = int3(1, 0, 0);
    string UIWidget = "None";
    int MaxSupportedInstancingMode = 1;   // INSTANCING_MODE_ONE_PER_DRAW_CALL
    int MaxLocalLights = 8;               // 引擎据此决定写入几路 PointLight
    string RenderBin = "TerrainLikeGroundObject";   // 可选；不写则引擎按对象类型分 bin
> = 0;
#include "COMMON.FXH"          // (2) 硬件寄存器契约 + 引擎 SAS（必须最早 include）
float4 MyMatParam < string UIName = "My Param"; > = 1;   // (3) W3X 材质参数：有 UIName、无 SasBindAddress
texture MyTex < string UIWidget = "None"; string SasBindAddress = "Deferred.MyTex"; >;   // (4) SCRAPE/引擎注入参数
sampler2D MyTexSampler < string Texture = "MyTex"; string SasBindAddress = "Deferred.MyTex"; >
    = sampler_state { Texture = <MyTex>; MinFilter = 1; MagFilter = 1; MipFilter = 0; AddressU = 3; AddressV = 3; };
// (5) VS / PS 函数
// (6) shader 数组 + 选择表达式（D3DX preshader 在 CPU 端按 SAS 值求下标）
VertexShader VS_GB_Array[2] = { compile vs_3_0 VS_GB_00skin(), compile vs_3_0 VS_GB_11skin() };
// (7) technique / pass / 状态块
technique GBuffer
{   pass P0
    {   VertexShader = VS_GB_Array[ clamp(NumJointsPerVertex, 0, 1) ];
        PixelShader  = compile ps_3_0 PS_GB();
        ZEnable = 1; ZFunc = D3DCMP_LESSEQUAL; ZWriteEnable = 1; CullMode = D3DCULL_CW;
        AlphaBlendEnable = 0; AlphaTestEnable = 0;
    }
}
```

要点（📄源码确认，出处见各 reference）：
- **`_SasGlobal` 注解块**是 `RenderBin` 的唯一位置；官方仅 6 个文件使用、共 5 个名字（`TerrainLikeGroundObject`、`StaticSort1`、`Distorter`、`Underwater`、`OceanDisplacement`），其余不透明材质不写。
- **参数分三类**：①固定寄存器（`shared … : register(cN) < bool unmanaged = true; >`，引擎直写，见 §4）；②引擎/SCRAPE SAS（`string SasBindAddress = "Scope.Name"`，或语义如 `float Time : Time;`、`float4x4 View : View;`）；③材质参数（`UIName`，由 W3X 资产导出值）。`string DefaultParameterScopeBlock = "material";` 让无注解变量默认归为材质参数。
- **采样器写法**：`texture` + `sampler2D/samplerCUBE` 成对，二者注解都写同一 `SasBindAddress`；`sampler_state` 内用数值（`1`=POINT、`2`=LINEAR；`AddressU 1`=WRAP、`3`=CLAMP、`4`=BORDER）。
- **shader 数组下标**只能是 SAS 驱动的 uniform 表达式：`NumJointsPerVertex`（蒙皮）、`HasShadow`、`HasRecolorColors`、`AlphaTestEnable`、`BlendMode` 等。
- **pass 注解 `< string ExpressionEvaluator = "Objects"; >`**：挂接引擎 CPU 侧求值器（官方名：`Objects`、`Buildings`、`BasicW3D`、`BasicW3D_CreateShadowMap`、`DefaultW3D`、`DefaultW3D_CreateShadowMap`、`Particle`、`GPUParticle_CreateShadowMap`、`DistortingObject`、`Simplest`）。官方在启用求值器时**不在状态块里写** `AlphaBlendEnable/AlphaTestEnable`（`#if !EXPRESSION_EVALUATOR_ENABLED`），说明求值器会接管这些状态 📄 → **G-Buffer / 全屏 pass 不要挂求值器注解**，状态全部显式写死（求值器确切行为 ❓待实测）。
- 官方源码必须 `/D _WW3D_` 才是游戏版（否则自动 `#define _3DSMAX_`）；本项目 FXFXH 架构改用手动 `_3DSMAX_` 开关，游戏版**不要**定义它。

## 3. Technique 命名、LOD 与引擎查找规则

| 名称 | 角色 | 规则 / 置信 |
|---|---|---|
| `Default` | 高画质（H）前向绘制 | 官方 H 档为 `vs_3_0/ps_3_0` 📄 |
| `Default_M` / `Default_L` | 中 / 低画质 LOD | `_M` 多为 3_0 或 2_0，`_L` 为 2_0 📄；画质→后缀的选择逻辑 🔍/❓ |
| `Default_U`、`Caustics_U` | 疑似"超高"档 | 仅 `RiverReflection.fx`、`UnderwaterDeferred.fx` 出现，日冕将其注释 📄；选择条件 ❓ |
| `_Default_M`、`_Default_L`（前导下划线） | BasicW3D/DefaultW3D 中故意"改名禁用"的 LOD | 引擎精确匹配名字，带 `_` 即查不到，推测回退到 `Default`/technique 0 ❓待实测 |
| `TerrainTile` `Cliff` `Road` `Scorch`（+`_M`/`_L`） | `renderTerrain` 按名调用的地形分层 | 只有 `TerrainTile*` 不透明写深；其余是混合叠加层 📄 |
| `_CreateShadowMap` | `beginShadowOverrideTechnique` 期间使用 | 加载时 `strcmp` 精确、大小写敏感查找 🔍IDA |
| `_CreateDepthMap` | `beginDepthOverrideTechnique` 期间使用 | **缺失时回退为该 shader 的 `_CreateShadowMap`**；Shadow 不反向回退 🔍IDA。官方用它表达"不投影但写深度"（ChronoRift/FormationPreview） 📄 |
| 自定义名（如 `GBuffer`） | `setshaderoverride <Shader> <Technique>` 指定的 technique；或 `setshader` + `renderquad` 全屏 pass | override 作用于整个 shader 资源（所有使用它的物体）🔍IDA；不能把 shader A 换成 shader B |
| `MAXPREV` | 3ds Max 预览专用（`_3DSMAX_` 下） | 游戏版不编译 📄 |

**缺名回退（关键风险）**：override 找不到 technique（索引 `-1`）时，引擎**不会跳过 draw**，而是回退到该 draw 原 technique（必要时 technique 0）🔍IDA；实机表现尚未在 [`engine-ground-truth.md`](../../../dictionaries/engine-ground-truth.md) 中记录 ❓。→ 任何进入 G-Buffer pass 的 RenderBin 中，**每个 shader 都必须提供目标 technique**，否则前向颜色/阴影深度会污染 MRT。

## 4. 寄存器安全硬规则（详见 register-sas-contract.md）
1. 新文件必须（直接或经 `head1-maxui.FXH`/`head3-vsps.FXH`）`#include "COMMON.FXH"`；它声明了 `c0..c10`、`c89..c127`、`vs c128..c255` 全部固定槽位。
2. 严禁给自定义变量写 `register(c0..c10 | c89..c127)` 或 VS `c128..c255`；禁用阵营色时保留 `RecolorColorDummy : register(c0)`（`#define FORBID_FACTION_COLOR`）。
3. ✅fxc实测：include `COMMON.FXH` 后，即使某 shader 未引用固定变量，编译器也会跳过这些槽位，普通 uniform 从 `c11` 起分配；不 include 的独立文件（如 FXFXH `TERRAIN.FX`）必须自行声明全部固定槽位。
4. `NumPointLights`、`HasShadow`、`HasRecolorColors`、`NumJointsPerVertex` 在 Windows 上是 SAS 变量而非固定 `i#/b#` 寄存器 📄。
5. 每次修改后用 `/Fc` 查看 `Registers:` 表复核。

## 5. 编译与验证（命令已实测，详见 fxc-workflow.md）
```powershell
& "main\fxc.exe" /nologo /O2 /T fx_2_0 /I "main" /Fo "<仓库外>\X.fxo" "main\X.fx"
& "main\fxc.exe" /nologo /O2 /T ps_3_0 /E <PS入口> /I "main" /Fc "<仓库外>\ps.asm" "main\X.fx"
& "main\fxc.exe" /nologo /O2 /T vs_3_0 /E <VS入口> /I "main" /Fc "<仓库外>\vs.asm" "main\X.fx"
```
- 不要 `/T fx_2_0` + `/Fc`（无头终端 `Failed to create D3D device`，asm 0 字节）✅fxc实测。
- 源文件不在 `COMMON.FXH` 同目录时必须 `/I` ✅fxc实测。
- 官方 `RA3_Shaders` 的 `Objects*.fx`/`Terrain.fx` 用本编译器会报 `X1516 REGISTER_BIND`，**只读不编** ✅fxc实测。
- `.fxo` 永不写进仓库；游戏从 `Shaders/Compiled/<Name>.fxo` 加载（文件名 = shader 资源名）📄。

## 6. 清单：给现有材质添加 G-Buffer technique

前置：确认管线路线（计划阶段二选一或并用）——
**路线 1** 自定义名 `GBuffer` + SCRAPE `setshaderoverride <Shader> GBuffer`（逐 shader 指定）；
**路线 2** 复用 `_CreateDepthMap` + 全局 `beginDepthOverrideTechnique`（一次覆盖所有 shader，但会改变原版 `updateDepthMap` 与 ChronoRift/FormationPreview 语义）。

1. **定位家族**：查 [material-family-inventory.md](references/material-family-inventory.md) 得到蒙皮路数（Objects=2 路，BasicW3D/DefaultW3D=3 路）、AlphaClip 类型、特殊 VS（履带 UV 滚动、TreeSway 摆动、建筑 `TEXCOORD1` 损伤图、地形独立顶点流）。
2. **VS 数组**：从 FXFXH `head3-vsps.FXH` 复制 `VS_H_00skin/11skin(/22skin)`，追加输出视空间线性深度 `mul(float4(WorldP,1), View).z`（需 `#define DEFERRED_RENDER` 或单独声明 `float4x4 View : View;`）；数组长度与家族一致，下标 `clamp(NumJointsPerVertex, 0, N)`。
3. **PS 数组**：`PS_GB(bool alphaClip)` 两项，下标沿用 `SMPSchooserExpr()` 规则（`AlphaTestEnable`，建筑恒 1，`FORBID_SHADOW_ALPHATEST` 恒 0）；镂空写 `clip(alpha - 0x60/255.0)`；输出 `COLOR0..COLOR3`，不写的 RT 也要给确定值。
4. **阵营色/损伤/建造遮罩**：在 G-Buffer PS 中完成（albedo 中烘入 `RecolorColor`；`IS_BUILDNG` 损伤 `clip`；`IS_NANO_BUILDUP` 遮罩 `clip`），与前向 PS 保持同一判定以免轮廓不一致。
5. **状态块（显式写死，不挂 ExpressionEvaluator）**：`ZEnable=1`、`ZFunc=D3DCMP_LESSEQUAL`(4)、`ZWriteEnable=1`、`CullMode=D3DCULL_CW`(2)（`RENDER_BACKFACE`/`TreeSway` 用 1）、`AlphaBlendEnable=0`、`AlphaTestEnable=0`；需要屏蔽某 RT 时用 `ColorWriteEnable1..3`（硬件 `INDEPENDENTWRITEMASKS` 支持 ❓）。
6. **不可进 G-Buffer 的实例**：`BlendMode != Opaque`、`OpacityOverride < 0.985`、加色/特效材质 → G-Buffer PS 中 `clip(-1)` 丢弃或由 SCRAPE 分流（选型 ❓）；它们保留前向 technique 在光照合成后绘制。
7. **保留原 technique**：`Default/_M/_L/_CreateShadowMap` 一律不删不改名；路线 2 下若材质原本有 `_CreateDepthMap`（ChronoRift/FormationPreview）需保持"只写深度"语义。
8. **编译验证**：`fx_2_0` 全量编译 + 新 PS/VS 各一次 `/Fc`；检查 `Registers:` 无 `c0..c10`/`c89..c127` 冲突、PS 指令槽 ≪ 512、插值器未超 `v0..v9`。
9. **实机验证**：PIX/RenderDoc 抓帧确认 4 个 RT 内容与清屏值；把结论写进 [`engine-ground-truth.md`](../../../dictionaries/engine-ground-truth.md)（AGENTS.md §4：实机优先）。

## 7. 常见坑（速查）
| 坑 | 正确做法 | 置信 |
|---|---|---|
| MRT pass 用固定管线 `AlphaTestEnable` | PS `clip`；官方阴影 PS 早已如此（"Simulate alpha testing for floating point render target"） | 📄 |
| 全屏/VPOS 采样不补半像素 | `(vpos.xy + 0.5) / FrameBufferSize`；`ScreenUV += 0.5 / FrameBufferSize`；勿写死 `/4096` | 📄 |
| 以为 `WW3D.DepthTexture` 是 `z/w` | 它是线性 `viewPos.z`；`z/w` 是 `PostEffect.DepthBufferTexture` | 📄 |
| 在 PS 读 `WorldBones` | 仅 VS 可用（`register(vs, c128)`） | 📄 |
| 地形 `Cliff/Road/Scorch` 当作不透明 | 它们是 `SrcAlpha/InvSrcAlpha` 叠加、`ZWriteEnable=false` | 📄 |
| 使用 SM4+ 写法（`cbuffer`、`Texture2D.Sample`、`SV_Target`、`mad()`） | 只用 SM≤3.0；查 `hlsl-directx-reference` | 📄 |
| 新增 technique 却在 wrapper 里改动 | technique 只加在核心 `.FX`，wrapper 只写 `#define` | 📄 |

## 8. 外部参考库（只读）
- FXFXH：`C:\Desktop01\MYGITHUB\custom-shaders-RedAlert3\FXFXH`（可编译的分层架构与原型）
- 官方 RA3：`D:\PROJECTS\SAGE shader source\RA3_Shaders`（语义权威，不可直接编译）
- 日冕：`D:\PROJECTS\SAGE shader source\CORONA Shaders 240820`（PBR/IBL）
- C&C4：`D:\PROJECTS\SAGE shader source\CC4_Shaders`（仅数学/架构参考，勿照搬引擎侧功能）
