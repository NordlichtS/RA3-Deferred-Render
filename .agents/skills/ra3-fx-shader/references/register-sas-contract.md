# RA3 1.12 硬件寄存器与 SAS 绑定契约（详版）

> **定位**：`.fx` 中所有"引擎注入"的全局变量的完整契约：固定寄存器、SAS 地址、语义（Semantic）、在 Windows 上是否走寄存器、以及编译器自动分配规则。紧凑速查见 [`dictionaries/hlsl-register-sas-dict.md`](../../../../dictionaries/hlsl-register-sas-dict.md)。
>
> 置信标签：`✅已实机验证` / `📄源码确认` / `🔍IDA静态推测` / `❓待实测`。本文中 `✅fxc实测` 指已用 `main\fxc.exe` 9.29.952.3111 编译并读取 `/Fc` 寄存器表验证（编译器行为已证实，但"引擎是否按此写入"仍属源码/逆向结论）。

---

## 1. 两条注入通道（必须先理解）

| 通道 | 声明方式 | 引擎写入方式 | 典型变量 |
|---|---|---|---|
| **A. 间接常量（Indirect Constant / 固定寄存器）** | `shared <type> X : register(cN) < bool unmanaged = true; >` | 引擎 C++ 直接 `SetVertex/PixelShaderConstantF(N, …)` 写固定槽位，**不经过 D3DX 参数表** | `RecolorColor`、`DirectionalLight[3]`、`ViewProjection`、`World`、`WorldBones[]` |
| **B. SAS / 语义绑定** | `X < string SasBindAddress = "Scope.Name"; >` 或 `X : Semantic` | 引擎按名字查 effect 参数并 `ID3DXEffect::SetXXX`，编译器自由分配寄存器 | `NumJointsPerVertex`、`HasShadow`、`ShadowMap`、`View : View`、自定义 SCRAPE 参数 |

- 官方逻辑：`RegisterMap.fxh` 在 `!EA_PLATFORM_PS3 && !_3DSMAX_` 时定义 `USE_INDIRECT_CONSTANT`，`REGISTER_BIND(...)` 宏随之展开为通道 A 的 `shared … : register(c#) < bool unmanaged = true; >` 形式 `[src: D:/PROJECTS/SAGE shader source/RA3_Shaders/RegisterMap.fxh#L13-L15, #L96-L102]` 📄源码确认。
- 3ds Max 预览（`_3DSMAX_`）下同一变量退化为通道 B（SAS 地址仍保留在注解中）`[src: .../RegisterMap.fxh#L103-L109]` 📄源码确认。因此通道 A 变量的 SAS 名称仍值得记录（见 §2 第 4 列）。
- 本项目统一用 [`main/COMMON.FXH`](../../../../main/COMMON.FXH) 手写通道 A 声明（不再走 `REGISTER_BIND` 宏），两者槽位一一对应 📄源码确认。

## 2. 通道 A：固定常量寄存器全表

| 寄存器 | 变量 | 类型 | 官方 SAS 名（Max 预览/C++ 侧） | 阶段 | 说明 | 出处 |
|---|---|---|---|---|---|---|
| `c0` | `RecolorColor`（禁用阵营色时 `RecolorColorDummy`） | `float3` | `WW3D.RecolorColor[0]` | VS+PS | 阵营色 | `main/COMMON.FXH#L71-L91`；`GlobalParameters.fxh#L153-L158` 📄 |
| `c1` | `OpacityOverride` | `float` | `WW3D.OpacityOverride` | VS+PS | 隐身/淡出；官方 `< 0.99` 开混合，FXFXH 用 `< 0.985` | `main/COMMON.FXH#L94-L100`；`GlobalParameters.fxh#L207-L210` 📄 |
| `c2` | `TintColor` | `float3` | `WW3D.TintColor` | VS+PS | 选中高亮 / C4 染色 | `main/COMMON.FXH#L104-L107` 📄 |
| `c3` | `NoCloudMultiplier` | `float3` | `Terrain.Cloud.NoCloudMultiplier` | VS+PS | 仅粒子使用，物体 shader 禁止读取 | `main/COMMON.FXH#L110-L113`；`GlobalParameters.fxh#L106-L110` 📄 |
| `c4` | `AmbientLightColor` | `float3` | `Sas.AmbientLight[0].Color` | VS+PS | 地图环境光 | `main/COMMON.FXH#L116-L128`；`GlobalParameters.fxh#L22-L26` 📄 |
| `c5..c10` | `DirectionalLight[3]` | `{float3 Color; float3 Direction;}` ×3 | `Sas.DirectionalLight[*]` | VS+PS | `[0]` 太阳，`[1..2]` 氛围光；每灯占 2 寄存器 | `main/COMMON.FXH#L131-L137`；`RegisterMap.fxh#L53-L55` 📄 |
| `c11..c88` | —— | —— | —— | —— | **未被引擎占用**；编译器为普通 uniform 自动分配从 `c11` 开始 | ✅fxc实测（见 §4） |
| `c89..c112` | `PointLight[8]` | `{float3 Color; float3 Position; float2 Range_Inner_Outer;}` ×8 | `Sas.PointLight[*]` | VS+PS(SM3) | 前向 8 路点光，每灯 3 寄存器 | `main/COMMON.FXH#L143-L146`；`RegisterMap.fxh#L56-L57` 📄 |
| `c113..c116` | `ShadowMapWorldToShadow` | `float4x4` | `Sas.Shadow[0].WorldToShadow` | VS+PS | 世界→阴影图投影 | `main/COMMON.FXH#L149-L151`；`GlobalParameters.fxh#L201-L204` 📄 |
| `c117..c118` | `Cloud` | `{float4 WorldPositionMultiplier_XYZZ; float2 CurrentOffsetUV;}` | `Terrain.Cloud` | VS+PS | 云影 UV | `main/COMMON.FXH#L154-L156` 📄 |
| `c119..c122` | `ViewProjection` | `float4x4` | `Sas.Camera.WorldToProjection` | VS+PS | 世界→裁剪 | `main/COMMON.FXH#L159-L161` 📄 |
| `c123` | `EyePosition` | `float3` | `Sas.Camera.Position` | VS+PS | 相机世界坐标 | `main/COMMON.FXH#L164-L166` 📄 |
| `c124..c127` | `World` | `float4x3`（语义 `World`） | —— | VS | 非蒙皮刚体世界矩阵；默认列主序打包下实际只占 `c124..c126` 三个寄存器 | `main/COMMON.FXH#L169-L170`；`Skinning.fxh#L97`；✅fxc实测 |
| `vs c128..c255` | `WorldBones[128]` | `float4[128]` | `Sas.Skeleton.MeshToJointToWorld[*]` | **仅 VS** | 64 骨骼 × 2：`[2i]`=四元数旋转，`[2i+1]`=`xyz` 平移 + `w` 骨骼透明度 | `main/COMMON.FXH#L175-L176`；`RegisterMap.fxh#L30-L31` 📄 |

**整数/布尔寄存器**（官方 `RegisterMap.fxh#L62-L69`）📄源码确认：`i0`=`NumPointLights`、`i1`=NumShadows、`b0`=`HasRecolorColors`、`b1`=`HasShadow`。
**但在 Windows 上这些都不走固定寄存器**：`NumPointLights` 明确注释"不要在 Windows 上做成间接常量" `[src: GlobalParameters.fxh#L61-L70]`；`HasRecolorColors` 因用于 shader array 表达式而在 Windows 上走 SAS `[src: GlobalParameters.fxh#L133-L142]`；`HasShadow` 的 `REGISTER_BIND_BOOL` 仅 `!EA_PLATFORM_WINDOWS` `[src: GlobalParameters.fxh#L189-L194]` 📄源码确认。→ 本项目在 HLSL 中把这三个声明为普通 SAS 变量（`main/COMMON.FXH#L194-L207` 已如此）。

> 设计原因（官方注释）：PS 2.0 只有 32 个常量寄存器，故 PS2.0 需要的常量放在 `c0..c31` 段，其余从 `c255` 向下排，中间留出最大空洞 `[src: RegisterMap.fxh#L21-L26]` 📄。

## 3. 通道 B：SAS 地址 / 语义总表

### 3.1 引擎内置（只读，由引擎每帧/每物体写入）
| SAS 地址 / 语义 | 典型 HLSL 声明 | 类型 | 含义 | 出处 / 置信 |
|---|---|---|---|---|
| `Sas.Skeleton.NumJointsPerVertex` | `int NumJointsPerVertex` | `int` | 0=刚体 1=硬绑定 2=软绑定；用作 VS 数组下标 | `Skinning.fxh#L88-L92` 📄 |
| `Sas.NumPointLights` | `int NumPointLights` | `int` | 当前物体接收的点光数 | `GlobalParameters.fxh#L66-L70` 📄 |
| `Sas.HasShadow` | `bool HasShadow` | `bool` | 全局阴影开关 × 物体接收阴影 | `ShadowMap.fxh#L20` 📄 |
| `WW3D.HasRecolorColors` | `bool HasRecolorColors` | `bool` | 物体是否有阵营色 | `GlobalParameters.fxh#L137-L142` 📄 |
| `Sas.Shadow[0].ShadowMap` | `texture` + `sampler2D` | `R32F` | 太阳阴影图（存 `z/w`） | `ShadowMap.fxh#L36` 📄；格式见 `dictionaries/distillation-and-issues-notes.md` §1.1 |
| `Sas.Shadow[0].Zero_Zero_OneOverMapSize_OneOverMapSize` | `float4` | `float4` | `.zw` = 1/阴影图尺寸 | `ShadowMap_win32.fxh#L16` 📄 |
| `Terrain.Shroud` | `struct {float4 ScaleUV_OffsetUV;}` | — | 迷雾 UV 变换 | `Objects.fxh#L421-L425` 📄 |
| `Terrain.Shroud.Texture` / `Terrain.Cloud.Texture` | `texture` | 2D | 迷雾图 / 云影图 | `Objects.fxh#L136, #L429` 📄 |
| `Terrain.Map.CellSize` / `Terrain.MacroTexture` | `float` / `texture` | — | 宏纹理 | `MacroTexture.fxh#L10-L15` 📄 |
| `Terrain.BaseTexture` / `Terrain.NormalTexture` / `Terrain.IsTerrainAtlasEnabled` | — | — | 地形图集（仅 `Terrain.fx`） | `Terrain.fx#L134-L263` 📄 |
| `Terrain.Map.Size` / `Terrain.Map.BorderWidth` | `float2`/`float` | — | 地图尺寸（日冕 `Sky.fx` 使用） | `CORONA Shaders 240820/Sky.fx#L53-L57` 📄 |
| `Terrain.EnvironmentTexture` | `textureCUBE` | Cube | 地图原始环境盒（日冕在 SCRAPE 中 `fromscope Terrain EnvironmentTexture` 读取） | `CORONA .../ingame.scrapeo#L3` 📄 |
| `Objects.LightSpaceEnvironmentMap` / `Water.LightSpaceEnvironmentMap` | `textureCUBE` | Cube 128² | 按太阳方向旋转后的物体/水面环境盒 | `Objects.fxh#L151`；`diagrams/vanilla-pipeline-reference.md` 环境盒烘焙段 📄 |
| `WW3D.DepthTexture` | `texture` + `sampler2D` | `R32F` | **线性视空间深度 `viewPos.z`**（原版为 `DepthTextureLinear` 绑定而来） | `UnderwaterDeferred.fx#L16`；`main/COMMON.FXH#L316-L332` 📄 |
| `PostEffect.DepthBufferTexture` | `texture` | `R32F` | 原版 Depth Pass 写出的**非线性 `z/w`**（`LinearDepth` 的输入） | `PostFX_LinearDepth.fx#L16` 📄 |
| `WW3D.FrameBufferSize` | `float2` | — | 主帧分辨率（宽,高） | `main/COMMON.FXH#L335-L339`；`CORONA .../CoronaPostEffects.fx#L39` 📄 |
| `PostEffect.FrameBufferTexture` | `texture` | — | 后处理输入帧 | `CORONA .../CoronaPostEffects.fx#L25` 📄 |
| `Water.DepthLutTexture` / `Water.CausticsTexture` | `texture` | — | 水下染色 LUT / 焦散 | `CommonUnderwater.fxh#L23-L34` 📄 |
| `Decal.BaseTexture` / `Decal.MaskTexture` | `texture` | — | 贴花 | `Decal.fx#L16-L27` 📄 |
| `WW3D.FXJapanBuildMask` `WW3D.FXDistortionFractal` `WW3D.FXIronCurtain` `WW3D.FXChronoRift` `WW3D.FXLightningTeslaHit` `WW3D.MiscTexture` | `texture` | — | 特效辅助贴图 | `Objects.fxh#L168-L233`；`TerrainTracks.fx#L44` 📄 |
| 语义 `Time` | `float Time : Time;` | `float` | 开局秒数 | `BasicW3D.fxh#L116` 📄 |
| 语义 `View` / `ViewInverse` / `Projection` / `ProjectionInverse` / `WorldView` / `WorldViewProjection` | `float4x4 View : View;` 等 | 矩阵 | 引擎按语义注入（`DEFERRED_RENDER` 依赖其中四个） | `BasicW3D.fxh#L101-L103`；`CommonGeometryParticle.fxh#L66-L70`；`PostFX_LinearDepth.fx#L12` 📄 |

### 3.2 自定义（由 SCRAPE `settexture/setfloat/setbool` 写入）
- 机制：SCRAPE 写 `<Block> <Name>`，HLSL 用 `SasBindAddress = "<Block>.<Name>"` 读取（名字可含 `.` 子路径，如 `Lanyi.IrradianceMapGenerator.FaceDirection`）📄源码确认 `[src: CORONA Shaders 240820/ingame.scrapeo#L34-L74；IrradianceMapGenerator.fx#L14]`。
- 日冕已用地址（可借鉴命名风格，本项目自定义块建议用独立前缀如 `Deferred.*` 避免与日冕冲突）：`Lanyi.PbrIrradianceTexture`、`Lanyi.EnvironmentTexture`、`Lanyi.IrradianceMapGenerator.FaceDirection`、`Lanyi.BlurredShroudTexture`、`Lanyi.ShroudToSky`、`Lanyi.UnderWaterBackgroundColor`、`Lanyi.PostEffectStep/Strengths/Indices` 📄。
- 声明模板：
  ```hlsl
  texture GBufferNormalTex < string UIWidget = "None"; string SasBindAddress = "Deferred.GBufferNormal"; >;
  sampler2D GBufferNormalSampler < string Texture = "GBufferNormalTex"; string SasBindAddress = "Deferred.GBufferNormal"; >
  = sampler_state { Texture = <GBufferNormalTex>; MinFilter = 1; MagFilter = 1; MipFilter = 0; AddressU = 3; AddressV = 3; };
  float4 DeferredParams < string UIWidget = "None"; string SasBindAddress = "Deferred.Params"; > = float4(0,0,0,0);
  ```
  （采样器注解中重复 `SasBindAddress` 是官方/FXFXH 一贯写法 `[src: main/COMMON.FXH#L251-L267]` 📄）

## 4. 编译器自动分配规则（✅fxc实测）

探针文件：[fxc-workflow.md §5](fxc-workflow.md) 中的 G-Buffer 探针（`#include "COMMON.FXH"` + 两个材质 `float4`），`/T ps_3_0 /Fc` 结果：

| 场景 | `Registers:` 表 |
|---|---|
| PS 仅用材质参数，不引用 `RecolorColor` | `MatParamA c11`、`MatParamB c12`、`DiffuseTextureSampler s0` |
| PS 额外引用 `RecolorColor` | `RecolorColor c0`、`MatParamA c11`、`MatParamB c12` |
| VS（`DEFERRED_RENDER`，用 `View`/`ViewProjection`/`World`） | `View c11 (3)`、`ViewProjection c119 (4)`、`World c124 (3)` |
| FXFXH `PS_H_ARPBR`（objectsgeneric） | `c2,c4,c5(2)` 固定；`NumPointLights c11`、`HasShadow c12`、`AlphaTestEnable c13`…；`PointLight c89(24)`、`EyePosition c123` |

结论：
1. 只要 `#include "COMMON.FXH"`，**所有带显式 `register(cN)` 的声明即使未被该 shader 引用也会阻止编译器把普通 uniform 放进这些槽位**，自动分配从 `c11` 起 ✅fxc实测。
2. 因此"禁用阵营色也必须声明 `RecolorColorDummy : register(c0)`"的作用是**防止 c0 被材质参数占用后被引擎覆盖**（官方注释 "Need to declare these dummy variables to block the registers" `[src: GlobalParameters.fxh#L165]` 📄）。
3. **不 include `COMMON.FXH` 的独立 shader（如 FXFXH `TERRAIN.FX` 自行声明常量）必须自行声明全部固定槽位**，否则材质参数会落入 `c0..c10` 被引擎覆写 ❓待实测（风险推论）。
4. 普通 uniform 段 `c11..c88` 共 78 个 float4；超出后编译器行为（跳过 `c89+` 已占段）未测 ❓。
5. `float4x3 World` 在默认列主序打包下占 3 寄存器，配合 `mul(float4(pos,1), World)` 行向量写法；与 COMMON.FXH 注释中"行/列主序"疑问的答案一致 ✅fxc实测。

## 5. 硬规则（写 HLSL 时逐条自检）
1. 每个新 `.fx` 第一行有效代码前 `#include "COMMON.FXH"`（或经 `head1-maxui.FXH`/`head3-vsps.FXH` 间接 include）。
2. 永不为自定义变量写 `register(c0..c10)`、`register(c89..c127)`、`register(vs, c128..c255)`。
3. 需要显式绑定时只用 `c11..c88`，并在 `/Fc` 中复核。
4. `WorldBones` 只在 VS 使用；PS 需要骨骼透明度时经插值器传递。
5. 改动后用 `fxc /T ps_3_0 /E <PS> /Fc` 与 `/T vs_3_0 /E <VS> /Fc` 查看 `Registers:` 表（命令见 [fxc-workflow.md](fxc-workflow.md)）。
