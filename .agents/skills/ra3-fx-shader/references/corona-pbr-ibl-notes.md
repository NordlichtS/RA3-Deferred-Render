# 日冕（Corona）Mod PBR / IBL / Irradiance 可复用技术笔记

> **来源**：`D:\PROJECTS\SAGE shader source\CORONA Shaders 240820`（作者 岚依，2021-2024；只读）。下文 `[src: X#Ly]` 中 X 相对该目录。全部 📄源码确认；日冕本身是已发布并在 RA3 1.12 上运行的 Mod，故"能在原版引擎上跑"可视为间接实机证据，但**本项目内尚未复测** ❓。
> 用途：Phase 2（IBL 环境光）与 Phase 4（GGX/Smith PBR）的公式与管线参考。通用 PBR 理论不在此展开（可查全局 `shader-programming` 或文献）。

## 1. 文件速览

| 文件 | 作用 | 对本项目价值 |
|---|---|---|
| `IrradianceMapGenerator.fx` | 每张地图首帧把环境 Cube 卷积成 128² 漫反射 irradiance Cube | **高**：Phase 2 IBL 漫反射直接复用 |
| `ObjectsPBR.fx`（及 `_Mirage`、`_Preview`） | 前向 PBR 物体：GGX + Smith-Schlick + Schlick Fresnel(球面高斯近似) + 解析 EnvDFG + 粗糙度→mip 镜面 IBL | **高**：光照合成 PS 的 BRDF 与 IBL 公式 |
| `ingame.scrapeo` | 生成/绑定 irradiance、模糊迷雾、天空盒等 SCRAPE 过程 | 中：SCRAPE 写法参考（归 `ra3-scrape-pipeline`） |
| `Sky.fx` | 用 `WW3D.DepthTexture` 判定天空像素绘制天空盒 / 迷雾→天空 | 中：延迟合成中"无几何像素"处理参考 |
| `CoronaPostEffects.fx` | 用 `PixelShader PixelShaders[8]` + `Lanyi.PostEffectIndices[Step]` 选择后处理 | 低：shader 数组 + SAS 下标选择的范例 |
| `Common.fxh` | 日冕版公共头：`SHADER_ARRAY_SELECT(arr, expr)` 宏、`ENVMAP_NAME = "Lanyi.EnvironmentTexture"` | 低 |

## 2. Irradiance Cube 生成管线

SCRAPE 侧 `[src: ingame.scrapeo#L3, #L34-L75, #L958-L974]`：
```text
var texturecube MapEnvironment fromscope Terrain EnvironmentTexture   # 地图原始环境盒
var texturecube PbrIrradianceTexture 128 128 A8R8G8B8 autogenmipmap
var shader IrradianceMapGenerator IrradianceMapGenerator.fx
proc GeneratePbrIrradianceMap
    settexture Lanyi EnvironmentTexture MapEnvironment
    setshader IrradianceMapGenerator Default
    settarget 0 PbrIrradianceTexture 0     # +X（面序号 0..5 = +X -X +Y -Y +Z -Z）
    setfloat Lanyi IrradianceMapGenerator.FaceDirection 1 0 0
    renderquad
    ...（其余 5 面同理）
endproc
# 在 doRotateEnvironmentMaps 的 `if WW3D MustRefreshEnvironment` 内 callproc（每图一次）
proc SetupPbrEnvironmentTexture             # 每帧绑定
    settexture Lanyi PbrIrradianceTexture PbrIrradianceTexture
    settexture Lanyi EnvironmentTexture MapEnvironment
endproc
```
要点：
- `settarget 0 <cube> <face>` 可直接渲染到 Cube 单面；`fromscope Terrain EnvironmentTexture`/`fromscope Terrain Shroud.Texture` 在 RA3 1.12 可用（日冕实证）📄。→ 与 AGENTS.md "不可照搬 C&C4 `fromscope static`" 不冲突：被禁止的是 C&C4 的 `static` 作用域，RA3 自有作用域（`Terrain`）可用（交给 `ra3-scrape-pipeline` 子代理最终裁定）。
- 日冕 irradiance 用的是**未旋转**的地图环境盒（`MapEnvironment`），而原版物体反射用的是**按太阳方向旋转后**的 `Objects.LightSpaceEnvironmentMap`（`EnvironmentDestinationTextureObjects`）。复用时两者必须保持同一坐标系 ❓待实测。

HLSL 侧 `[src: IrradianceMapGenerator.fx#L12-L108]`：
- VS：全屏 quad `float2 Position` → `Direction = mul(GetRotation(FaceDirection), float3(Position, 1))`（只用绕 X / 绕 Y 的正交旋转构造 6 面）。
- PS：LearnOpenGL 半球暴力积分，`sampleDelta = 0.025`（约 63×252 ≈ 1.6 万次 `texCUBE`/像素，仅因每图一次才可接受），环境色先 `pow(…, 2.2)` 转线性，结果 `PI * sum / n`，再加 `(AmbientLightColor*0.1 + DirectionalLight[2] 余弦项) * 0.5` 作为补光。
- technique：`vs_3_0/ps_3_0`，`ZEnable=false`、`AlphaBlendEnable=false`。
- 输出格式 `A8R8G8B8`（LDR，线性值直接存）→ 高亮环境会截断；本项目若需要 HDR irradiance 可考虑 `A16B16G16R16F` ❓待实测格式支持。

## 3. ObjectsPBR 光照公式（可原样搬进延迟光照合成 PS）

| 项 | 实现 | 出处 |
|---|---|---|
| SPM 通道约定 | `spm.x` = 光滑度（`roughness = max(1 - spm.x, 0.02)`）、`spm.y` = 金属度、`spm.z` = 阵营色强度、`spm.w` = 自发光强度 | `ObjectsPBR.fx#L412-L416` |
| Albedo 线性化 | `pow(albedo, 2.2)`（阵营色先在 gamma 空间混合：`lerp(albedo, saturate(albedo*RecolorColor*2), spm.z)`） | `#L418-L427` |
| 法线 | `tex2D(NormalMap)*2-1`，`xy *= NormalStrength`，乘切线空间→世界 3 行矩阵 | `#L431-L439` |
| NDF | GGX：`a² = roughness⁴`，`D = a² / (π (NdotH²(a²-1)+1)²)` | `#L282-L287` |
| 几何项 | Smith-Schlick-GGX：`k = (roughness+1)²/8` | `#L289-L297` |
| Fresnel | Schlick 球面高斯近似：`F0 + (1-F0)·2^((-5.55473·VdotH - 6.98316)·VdotH)` | `#L299-L303` |
| F0 | `lerp(0.04, albedo, metallic)` | `#L459` |
| 直接光 | `DirectionalLight[0]`（乘阴影×云影）+ `DirectionalLight[1]`（不乘阴影） | `#L462-L482` |
| IBL 漫反射 | `kD = lerp(1 - F(NdotV), 0, metallic)`；`irradiance = texCUBE(Lanyi.PbrIrradianceTexture, N)`；`kD * albedo * irradiance` | `#L491-L499` |
| IBL 镜面 | `pow(texCUBElod(EnvironmentTexture, float4(R, roughness * MipLevels)), ReflectionGamma)`，`MipLevels = 8`，`ReflectionGamma = 1.3`（材质参数）；乘 `EnvDFGPolynomial(F0, roughness, NdotV)`（Narkowicz 2014 解析拟合，免 BRDF LUT） | `#L62-L65, #L124-L128, #L308-L335, #L502-L507` |
| 点光 | 仍为 Lambert × `CalculatePointLightAttenuation(Range_Inner_Outer, dist)`，未做 PBR（作者 TODO） | `#L515-L533` |
| Technique 结构 | `Default`/`Default_M`/`Default_L` 均 `< string ExpressionEvaluator = "Objects"; >`，`SHADER_ARRAY_SELECT(VS_*_Array, NumJointsPerVertex > 0)`，`ZWriteEnable = (DepthWriteEnable)`、`CullMode = (CullingEnable ? D3DCULL_CW : D3DCULL_NONE)`、`AlphaTestEnable = (AlphaTestEnable)`；`Default_U` 被整段注释 | `#L957-L1066` |

## 4. 迁移到延迟管线时的取舍（建议，均 ❓待实测）
1. G-Buffer 需存下 PBR 所需最少参数：albedo（线性或 sRGB 编码）、世界/视空间法线、`roughness`、`metallic`、（可选）自发光强度/AO；线性深度在 RT3。
2. 光照合成 PS 直接复用 §3 的 `GGX/Smith/Schlick/EnvDFGPolynomial`，镜面 IBL 用 `texCUBElod` + mip；`autogenmipmap` 生成的盒式 mip 并非 GGX 预滤波，日冕以 `ReflectionGamma` 经验补偿——可接受（KISS）。
3. Irradiance 生成过程可整体照搬到 `main/ingame.scrapeo`，但自定义 SAS 块改名（如 `Deferred.*`）以免与日冕冲突；生成时机挂在 `WW3D MustRefreshEnvironment` 分支内。
4. 天空像素（RT3 深度为清屏值）在合成时跳过光照，参考 `Sky.fx` 用 `WW3D.DepthTexture` 判定的做法 `[src: Sky.fx#L17-L22, #L143]`。
