# HLSL 硬件寄存器与 SAS 绑定速查字典

> **定位**：写/查 RA3 1.12 PC `.fx` 全局变量时的一页速查。详细出处、编译器分配实测与规则解释见 [`ra3-fx-shader/references/register-sas-contract.md`](../.agents/skills/ra3-fx-shader/references/register-sas-contract.md)。
> 置信：`📄`=官方源码 `RegisterMap.fxh`/`GlobalParameters.fxh` 与 [`main/COMMON.FXH`](../main/COMMON.FXH) 一致确认；`✅fxc`=已用 `main\fxc.exe` `/Fc` 验证。

## 1. 固定常量寄存器（引擎直写，`shared … : register(cN) < bool unmanaged = true; >`）

| 寄存器 | 变量 | 类型 | 官方 SAS 名 | 阶段 | 备注 |
|---|---|---|---|---|---|
| `c0` | `RecolorColor` / `RecolorColorDummy` | `float3` | `WW3D.RecolorColor[0]` | VS+PS | 禁用阵营色也必须占位 📄 |
| `c1` | `OpacityOverride` | `float` | `WW3D.OpacityOverride` | VS+PS | `<0.99`(官方)/`<0.985`(FXFXH) 走混合 📄 |
| `c2` | `TintColor` | `float3` | `WW3D.TintColor` | VS+PS | 选中/C4 染色 📄 |
| `c3` | `NoCloudMultiplier` | `float3` | `Terrain.Cloud.NoCloudMultiplier` | VS+PS | 仅粒子 📄 |
| `c4` | `AmbientLightColor` | `float3` | `Sas.AmbientLight[0].Color` | VS+PS | 📄 |
| `c5..c10` | `DirectionalLight[3]` | `{float3 Color; float3 Direction;}` | `Sas.DirectionalLight[*]` | VS+PS | `[0]` 太阳 📄 |
| `c11..c88` | （空闲） | — | — | — | 普通 uniform 自动从 `c11` 分配 ✅fxc |
| `c89..c112` | `PointLight[8]` | `{float3 Color; float3 Position; float2 Range_Inner_Outer;}` | `Sas.PointLight[*]` | VS+PS | 每灯 3 寄存器 📄 |
| `c113..c116` | `ShadowMapWorldToShadow` | `float4x4` | `Sas.Shadow[0].WorldToShadow` | VS+PS | 📄 |
| `c117..c118` | `Cloud` | `{float4 WorldPositionMultiplier_XYZZ; float2 CurrentOffsetUV;}` | `Terrain.Cloud` | VS+PS | 📄 |
| `c119..c122` | `ViewProjection` | `float4x4` | `Sas.Camera.WorldToProjection` | VS+PS | 📄 |
| `c123` | `EyePosition` | `float3` | `Sas.Camera.Position` | VS+PS | 📄 |
| `c124..c127` | `World` | `float4x3` `: World` | — | VS | 列主序实占 3 寄存器 ✅fxc |
| `vs c128..c255` | `WorldBones[128]` | `float4` | `Sas.Skeleton.MeshToJointToWorld[*]` | 仅 VS | `[2i]` 四元数，`[2i+1]` xyz 平移 + w 透明度 📄 |

## 2. 常用 SAS / 语义（编译器自由分配寄存器）

| 地址 / 语义 | 类型 | 含义 |
|---|---|---|
| `Sas.Skeleton.NumJointsPerVertex` | `int` | 0/1/2 骨，VS 数组下标 |
| `Sas.NumPointLights` | `int` | 点光数量（Windows 非 `i0`） |
| `Sas.HasShadow` | `bool` | 阴影开关（Windows 非 `b1`） |
| `WW3D.HasRecolorColors` | `bool` | 有阵营色（Windows 非 `b0`） |
| `Sas.Shadow[0].ShadowMap` | `sampler2D` | 太阳阴影图 `R32F`（`z/w`） |
| `Sas.Shadow[0].Zero_Zero_OneOverMapSize_OneOverMapSize` | `float4` | `.zw`=1/阴影图尺寸 |
| `Terrain.Shroud` / `Terrain.Shroud.Texture` | `float4` / `sampler2D` | 迷雾 UV / 迷雾图 |
| `Terrain.Cloud.Texture` | `sampler2D` | 云影图 |
| `Terrain.EnvironmentTexture` | `samplerCUBE` | 地图原始环境盒 |
| `Objects.LightSpaceEnvironmentMap` / `Water.LightSpaceEnvironmentMap` | `samplerCUBE` | 按太阳旋转后的物体/水面环境盒 |
| `Terrain.Map.CellSize` / `Terrain.MacroTexture` | `float` / `sampler2D` | 宏纹理 |
| `WW3D.DepthTexture` | `sampler2D` `R32F` | **线性**视空间深度 `viewPos.z` |
| `PostEffect.DepthBufferTexture` | `sampler2D` `R32F` | 非线性 `z/w`（`LinearDepth` 输入） |
| `WW3D.FrameBufferSize` | `float2` | 主帧分辨率 |
| `PostEffect.FrameBufferTexture` | `sampler2D` | 后处理输入帧 |
| `Water.DepthLutTexture` / `Water.CausticsTexture` | `sampler2D` | 水下 LUT / 焦散 |
| `Decal.BaseTexture` / `Decal.MaskTexture` | `sampler2D` | 贴花 |
| `WW3D.FXJapanBuildMask` / `FXDistortionFractal` / `FXIronCurtain` / `FXChronoRift` / `FXLightningTeslaHit` / `MiscTexture` | `sampler2D` | 特效辅助图 |
| 语义 `Time` | `float` | 开局秒数 |
| 语义 `View` `ViewInverse` `Projection` `ProjectionInverse` `WorldView` `WorldViewProjection` | 矩阵 | `DEFERRED_RENDER` 用前四个 |
| `Lanyi.PbrIrradianceTexture` / `Lanyi.EnvironmentTexture` | `samplerCUBE` | 日冕自定义（SCRAPE 写入）irradiance / 环境盒 |

## 3. 自定义参数模板（SCRAPE `settexture/setfloat/setbool <Block> <Name>` → HLSL）
```hlsl
float4 MyVec < string UIWidget = "None"; string SasBindAddress = "Deferred.MyVec"; > = 0;
bool   MyFlag < string UIWidget = "None"; string SasBindAddress = "Deferred.MyFlag"; > = false;
texture MyTex < string UIWidget = "None"; string SasBindAddress = "Deferred.MyTex"; >;
sampler2D MyTexSampler < string Texture = "MyTex"; string SasBindAddress = "Deferred.MyTex"; >
  = sampler_state { Texture = <MyTex>; MinFilter = 1; MagFilter = 1; MipFilter = 0; AddressU = 3; AddressV = 3; };
```
- 项目自定义块统一用前缀 `Deferred.*`（建议），避免与日冕 `Lanyi.*` 冲突。

## 4. 常用常量
| 名 | 值 | 出处 |
|---|---|---|
| `DEFAULT_ALPHATEST_THRESHOLD` | `0x60`（96/255 ≈ 0.376） | 官方 `Common.fxh#L180` |
| `D3DCULL_NONE/CW/CCW` | `1/2/3`（RA3 正常剔除 = `CW`） | `main/COMMON.FXH#L711-L713` |
| `D3DCMP_LESSEQUAL/GREATEREQUAL/ALWAYS` | `4/7/8` | `main/COMMON.FXH#L716-L723` |
| `D3DBLEND_ONE/SRCALPHA/INVSRCALPHA` | `2/5/6` | `main/COMMON.FXH#L693-L708` |
| `INSTANCING_MODE_ONE_PER_DRAW_CALL` | `1` | 官方 `Common.fxh#L154` |
