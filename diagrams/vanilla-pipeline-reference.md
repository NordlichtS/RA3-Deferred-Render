# Red Alert 3 (v1.12 PC) 原版正向渲染管线权威规范 (Ground Truth Reference)

> **文档定位**：本文档基于 [`main/ingame.scrapeo`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo)、[`main/COMMON.FXH`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/COMMON.FXH)、EA 官方 [`RA3_Shaders`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders) 全部 `.fx` / `.fxh` / `.scrapeh` 源码以及 [`ra3_1.12.game` 逆向分析](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md) 编写。  
> **核心目的**：严格区分 **开局/离线初始化资源**、**CPU 每帧输入数据**、**GPU 动态显存资源（含跨帧持久化机制与深度缓冲规则）**，以及**实时资源在跨阶段之间的生产—Shader 转换—原地修改—抓屏拷贝—消费闭环**，作为绘制渲染管线流程图与实施延迟渲染改造的唯一事实基准（Single Source of Truth）。

---

## 1. 四维数据分类与显存跨帧持久化机制总览

原版渲染管线中的所有数据严格划分为以下 **3 类输入/资源（1.1–1.3）**，并受 **D3D9 显存常驻与跨帧保留铁律（1.4）** 与 **三套硬件深度表面规则（1.5）** 支配：

### 1.1 游戏启动 / 地图加载期初始化的静态与首帧烘焙资源 (Startup / Offline Resources)
这类资源**不在每帧动态重绘**，而是从硬盘资产加载，或仅在开局首帧 (`MustRefreshEnvironment == true`) 预渲染一次，后续每帧仅通过 `settexture` 绑定到 SCOPE 字典供各着色器只读采样：

| 资源名称 (SCRAPE 变量 / 引擎内置) | 绑定的 SAS / SCOPE 地址 | 资源类型与来源 | 消费该资源的步骤与 Shader |
|---|---|---|---|
| `FXOceanCubeMap` | `WW3D.FXOceanCubeMap` | 静态 CubeMap 资产 (`initCustomTextures` 绑定) | `Step 0.3 (doRotateEnvironmentMapWater)` 作为水面天空源贴图 |
| *Engine Map Skybox* | `Terrain.EnvironmentTexture` | 地图配置静态 CubeMap（引擎 C++ 注入） | `Step 0.3 (doRotateEnvironmentMapObjects)` 作为物体环境源贴图；`RiverWater.fx` |
| `EnvironmentDestinationTextureWater` | `Water.LightSpaceEnvironmentMap` | `128×128` CubeMap (`autogenmipmap`)，**仅当 `MustRefreshEnvironment` 为真（开局首帧/光变）时由 GPU 将 `FXOceanCubeMap` 旋转至阳光空间** | `Step 7.2 (renderWater)`：`Ocean.fx` 采样作为水面高光反射 |
| `EnvironmentDestinationTextureObjects` | `Objects.LightSpaceEnvironmentMap` | `128×128` CubeMap (`autogenmipmap`)，**仅当 `MustRefreshEnvironment` 为真（开局首帧/光变）时由 GPU 将 `Terrain.EnvironmentTexture` 旋转至阳光空间** | `Step 2.1 (updateWaterReflection)`、`Step 5.1/5.2 (主帧不透明)`、`Step 8.1 (半透明)`：`Objects.fxh`、`BasicW3D.fxh` 单位与建筑环境反射 |
| `FXDistortionFractal` | `WW3D.FXDistortionFractal` | 静态 2D 贴图 `FXDistortionFractal01` (`initCustomTextures`) | `Step 5.1/5.2`、`Step 9.2`：`Objects.fxh`、`BasicW3D.fxh`、`LineRenderers.fx`（材质特效扰动） |
| `FXJapanBuildMask` | `WW3D.FXJapanBuildMask` | 静态 2D 贴图 (`initCustomTextures`) | `Step 5.1/5.2`：`Objects.fxh`（帝国纳米建造网格遮罩） |
| `FXChronoRift` / `FXIronCurtain` / `FXLightningTeslaHit` | `WW3D.FXChronoRift` 等 | 静态 2D 贴图 (`initCustomTextures`) | `Step 5.1/5.2`：`Objects.fxh`、`BasicW3D.fxh`（超时空、铁幕、磁暴外壳特效） |
| `FXFilmLut` | `PostEffect.LookupTable.FilmTonemapping` | 静态 2D 调色曲线贴图 (`initCustomTextures`) | `Step 10.9 (PostEffectLookupTable)`：`PostFX_LookupTable.fx` |
| *Engine Volume LUT* | `PostEffect.LookupTable.LookupTexture` | 地图 3D 体积调色表 (`sampler3D`，引擎 C++ 注入) | `Step 10.9 (PostEffectLookupTable)`：`PostFX_LookupTable.fx` (`tex3D` 色彩分级) |
| `StaticOceanDisplacementTexture` | `Water.StaticDisplacementTexture` | 静态 2D 法线高度图 `Octave3_NRM` (`updateOceanDisplacement` 绑定) | `Step 3.1 (OceanDisplacement.fx StaticDisplacement)` 与 `Step 7.2 (Ocean.fx)` |
| `DepthLutTexture` / `CausticsTexture` | `Water.DepthLutTexture` / `Water.CausticsTexture` | 静态 2D 贴图 `FXDepthLut`、`FXCaustics` (`renderUnderwaterDeferred` 绑定) | `Step 6.1 (UnderwaterDeferred.fx)`（水深衰减颜色查表与焦散） |
| *Engine Cloud Texture* | `Terrain.Cloud.Texture` | 全局动态云影贴图（引擎 C++ 绑定，UV 随 `Time` 滚动） | `Step 5.1/5.2`：`Terrain.fx`、`Objects.fxh`、`BasicW3D.fxh` |

---

### 1.2 每一帧从 CPU 发送至 GPU 的动态数据 (Per-Frame CPU $\rightarrow$ GPU Inputs)
每一帧 CPU（`ra3_1.12.game` 渲染线程）通过 SCRAPE 命令触发与 D3D9 常量/顶点流提交向 GPU 输入以下四类数据：

1. **相机与投影矩阵 (`setcamera <CameraVar>`)**：
   - 更新固定寄存器 `c119..c122` (`ViewProjection`)、`c123` (`EyePosition`) 以及 SAS 矩阵语义 (`View`, `ViewInverse`, `Projection`, `ProjectionInverse`, `WorldView`)。
   - 全帧共切换 **4 个虚拟相机**：
     - `camera ShadowMap`：太阳平行光正交投影相机（用于 `Step 1 updateShadowTexture`）。
     - `camera Reflection`：以水面高度 $Z = \text{WaterLevel}$ 镜像翻转的反射相机（用于 `Step 2 updateWaterReflection`）。
     - `camera OceanDisplacement`：垂直向下俯视海面交互区域的顶视正交相机（用于 `Step 3 updateOceanDisplacement`）。
     - `camera Viewer`：玩家主视角透视相机（用于 `Step 0.3`、`Step 4 updateDepthMap`、主帧 `Step 5..10`）。
2. **视锥剔除与可见对象集 (`visibleobjects <Set>`)**：
   - CPU 根据指定相机做视锥与遮挡剔除，填充各 `RenderBin` 的当前可见绘制列表。
   - 共 **4 套独立可见集**：`ShadowMap` (0)、`DepthMap` (1)、`Reflection` (2)、`Frame` (3)。
3. **场景几何体顶点/索引流与逐物体常量 (`render*` 回调与 `renderbin <Name> [0|1]`)**：
   - **地形/道路/水面/特效专用网格**：`renderTerrain`、`renderRoads`、`renderScorchMarks`、`renderTerrainTracks`、`renderWater`、`renderWaterDisplacement`、`renderDecals`、`renderParticles`、`renderTracers`、`renderLasers`、`renderDistortionLasers`、`renderConnectionLines`、`renderRain`、`renderBehindBuildingMarkers`、`renderTerrainUI`、`renderIconLayers`、`renderUI`。
   - **47 个固定 `RenderBin` 队列**：通过 `renderProps`、`renderUnits`（内部遍历 `UnitPlayer0..19` 及 `UnitOutline*`）、`renderStructures`（内部遍历 `Structure` 及 `StructureOutline*`）或显式 `renderbin <Name> 0`（普通模型）与 `renderbin <Name> 1`（归属该队列的 GPU 粒子）提交。
   - **逐 DrawCall 硬件寄存器注入**（定义见 [`main/COMMON.FXH`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/COMMON.FXH)）：
     - `c0` (`RecolorColor` 阵营色)、`c1` (`OpacityOverride` 透明度)、`c2` (`TintColor` 染色)、`c3` (`NoCloudMultiplier` 粒子云乘子)；
     - `c89..c112` (`PointLight[8]` 距该物体最近的最多 8 个前向点光源参数) 与 `i0` (`NumPointLights`)；
     - `c124..c127` (`World` 刚体世界矩阵) 或 `vs, c128..c255` (`WorldBones[128]` 64 骨骼四元数旋转+位移)。
4. **帧级全局光照、迷雾与画质状态开关**：
   - **全局光照常量**：`c4` (`AmbientLightColor` 地编环境光)、`c5..c10` (`DirectionalLight[3]`：0 号主太阳光 + 1/2 号补光)、`c113..c116` (`ShadowMapWorldToShadow` 阴影投射矩阵)、`c117..c118` (`Cloud` 云层 UV 偏移)。
   - **战争迷雾 (`Terrain.Shroud.Texture` & `Terrain.Shroud`)**：CPU 根据视野实时更新的迷雾灰度纹理与 UV 缩放参数。
   - **SCOPE 条件控制布尔量**：`WW3D.IsHdrEnabled`、`WW3D.IsAntiAliasingEnabled`、`Sas.ShadowMappingEnabled`、`Water.IsReflectionVisible`、`Water.IsRefractionVisible`、`Particle.IsSoftParticlesEnabled`、`PostEffect.Distortion.IsEnabled`、`PostEffect.Bloom.IsEnabled`、`PostEffect.LookupTable.IsEnabled`、`WW3D.Outline.IsEnabled` 及各类 `DebugToggle.*`。

---

### 1.3 GPU 显存池中的 14 组核心动态资源清单 (GPU VRAM Pool Resources)

下表按核心重要性顺序列出 [`main/ingame.scrapeo`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo) 中声明并由 GPU 动态读写的 **14 组显存资源**（不设任何虚构编号，直接以真实 SCRAPE 变量名标识）：

| 显存资源变量名 (SCRAPE Identifier) | 类型 | 分辨率 | 像素格式 | 写入步骤 (`Step`) | 绑定的 SAS 消费地址 / 核心职责 |
|---|---|---|---|---|---|
| **`FrameBuffer`** | `surface` (`color0`) | 屏幕原生分辨率 `$WW3D.FrameBufferSize` | `X8R8G8B8` / `A8R8G8B8` | `Step 10.9` Tonemap Resolve 覆写；`Step 11` UI 叠加 | 显卡最终 Present 显示的 8-bit LDR 硬件后缓冲 (BackBuffer)；未开 HDR/AA 时亦直接作为主帧 RT |
| **`FrameRenderTarget`** | `surface` (`edram`) | `$WW3D.FrameBufferSize` | `$WW3D.FrameRenderTargetSurfaceFormat` (HDR `A16B16G16R16F` 或 `A8R8G8B8`) | `Step 5.1` 清屏写入；`Step 5.2..10.7` 历次叠加/覆写 | 开启 HDR 或 AA 时的主场景离屏颜色表面（不能直接被 Shader `tex2D` 采样，需经 `stretchrect` 拷入纹理） |
| **`DepthBuffer`** *(及 `FrameDepthBuffer`)* | `surface` (`depth`) | `$WW3D.FrameBufferSize` (`1x` 全屏；无 AA 时 `FrameDepthBuffer` 为 `0×0`) | `D24S8` (24位深度 + 8位模板) | `Step 2.1` (借左上 `512²`) $\rightarrow$ `Step 4.1` $\rightarrow$ `Step 5.1` 三次清屏分时复用 | 主硬件 Z-Test、Early-Z 及 8-bit Stencil 缓冲（**D3D9 下 Shader 无法直接采样此表面**） |
| **`DepthTexture`** | `texture` | `$PostEffect.FrameBufferSize` (全屏) | `R32F` | `Step 4.1` (`_CreateDepthMap` 几何重绘) | `PostEffect.DepthBufferTexture`（记录主相机视角下的非线性透视深度 `z/w`） |
| **`DepthTextureLinear`** | `texture` | `$PostEffect.FrameBufferSize` (全屏) | `R32F` | `Step 4.2` (`PostFX_LinearDepth.fx` 全屏 Shader 计算) | **`WW3D.DepthTexture`**（经 `ProjectionInverse` 像素着色器计算还原的**相机空间线性深度 `viewPos.z`**） |
| **`ShadowMapTexture`** | `texture` | `$Sas.Shadow[0].MapSize`² (`1024²` / `2048²`) | `R32F` | `Step 1` (`updateShadowTexture`) | `Sas.Shadow[0].ShadowMap`（记录太阳正交投影空间下的归一化深度 `z/w`） |
| **`ShadowMapDepthBuffer`** | `surface` (`edramdepth`) | `$Sas.Shadow[0].MapSize`² (`1024²` / `2048²`) | `D24S8` | `Step 1` (`updateShadowTexture`) | **太阳阴影贴图专属硬件深度缓冲**（因阴影分辨率可大于低分辨率屏幕，不可与主 `DepthBuffer` 混用） |
| **`WaterReflectionTexture`** | `texture` | `512 × 512` | `$WW3D.FrameRenderTargetTextureFormat` | `Step 2.1` & `2.2` (`updateWaterReflection`) | `Water.ReflectionTexture`（水面对称翻转视角下的镜像场景颜色图） |
| **`OceanDisplacementTexture` (×2)** | `texture` × 2 | `1024 × 1024` | `A16B16G16R16F` | `Step 3.1` 叠加 $\rightarrow$ `3.2` `BlurU` (`Texture2`) $\rightarrow$ `3.3` `BlurV` | `Water.DisplacementTexture`（记录海面波浪与船只划水波纹的 XYZ 位移向量，含乒乓滤波纹理 `OceanDisplacementTexture2`） |
| **`PostEffectFrameBufferTexture`** | `texture` | `$PostEffect.FrameBufferSize` (全屏) | `$WW3D.FrameRenderTargetTextureFormat` | `Step 7.1`、`10.1`、`10.5`、`10.8` 共 4 次 `stretchrect` 抓屏 | **四次抓屏复用中转站**：先后充当 **`Water.RefractionTexture`**（水底折射）与 **`PostEffect.FrameBufferTexture`**（Distortion/Bloom/LUT 输入） |
| **`DistortionOffsetTexture`** | `texture` | `$PostEffect.FrameBufferSize` (全屏) | `A8R8G8B8` | `Step 10.3` (`stretchrect` 从主帧抓取) | `PostEffect.Distortion.DistortionOffsetTexture`（记录扭曲网格、软粒子与激光的屏幕 UV 偏移量） |
| **`BloomTextures` (×6)** | `texture` × 6 | `High0/1` ($1/4$ 宽) · `Med0/1` ($1/8$ 宽) · `Low0/1` ($1/16$ 宽) | `$PostEffect.Bloom.TextureFormat` | `Step 10.6` (`PostEffectBloom` 降采样与 11×11 高斯乒乓模糊) | Bloom 三级金字塔 Ping-Pong 缓冲组，最终由 `BloomTextureHigh1` 喂给 `Step 10.7 AccumulateFinal` |
| **`OutlineTextureFill` $\rightarrow$ `OutlineTexture`** | `texture` × 2 (+ AA `surface`) | `FullRes` $\rightarrow$ `$WW3D.Outline.TextureSize` | `A8R8G8B8` | `Step 8.2` (`Fill*`) $\rightarrow$ `Step 8.3` (`BlurBox`) | `WW3D.Outline.Texture`（Stencil 选中/悬停剪影提取与 4-tap 膨胀模糊双纹理组） |
| **`EnvironmentDestinationCube` (×2)** | `texturecube` × 2 | `128 × 128 × 6` (`autogenmipmap`) | `$WW3D.FrameRenderTargetTextureFormat` | `Step 0.3` (`doRotateEnvironmentMaps` 首帧烘焙) | `Objects.LightSpaceEnvironmentMap` & `Water.LightSpaceEnvironmentMap`（首帧/光变时旋转烘焙并常驻显存） |

---

### 1.4 显存分配生命周期、跨帧像素保留（`Frame N-1 ➔ Frame N`）与“画中画”嵌套成因

根据 [`ra3_1.12.game` 逆向工程](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md)（`0x9C42F0` 脚本解析器与 `0x00C6F45C` `Scrape::Process::AllocateTexture` / [`SCRAPE_OVERRIDE与D24S8深度纹理结论.md`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/readonly/llm-analysis/SCRAPE_OVERRIDE%E4%B8%8ED24S8%E6%B7%B1%E5%BA%A6%E7%BA%B9%E7%90%86%E7%BB%93%E8%AE%BA.md)），RA3 的 GPU 显存管理遵循以下三条关键物理定律：

1. **载入时一次性分配，帧间绝不销毁（Allocated at Load, Persistent Across Frames）**：
   - `ingame.scrapeo` 顶层声明的所有 `var surface`、`var texture` 与 `var texturecube` 均在**地图/脚本加载或 D3D9 设备初始化时一次性在 `D3DPOOL_DEFAULT` 显存中创建完毕**。
   - 在整个游戏对局运行期间，**没有任何 Render Target 或 Texture 会在单帧结束时被销毁或释放**（仅在修改分辨率、切换抗锯齿或最小化触发 `DeviceReset` 时才会统一重建）。
2. **显存预算铁律（VRAM Budget Rule）**：
   - D3D9 SCRAPEO 执行器**不存在帧内临时显存别名复用（Transient Memory Aliasing）**。某张纹理在帧内某一步之后“不再被本帧后续步骤读取”，**绝不代表其显存槽位被释放或可被其他变量自动借用**。
   - **总显存占用 = 脚本中所有 `var surface` + `var texture` 声明的字节数之和**。在延迟渲染改造中，若跳过 `updateDepthMap` 但不在 `.scrapeo` 中删改 `var texture DepthTexture` 声明，这两张全屏 `R32F` 纹理依然会白白占用显存。
3. **跨帧像素保留与“画中画（Picture-in-Picture）”多层嵌套现象的物理真相**：
   - 因为显存表面在帧末既不销毁也不自动清零，**任何 `var texture` 在第 $N$ 帧被首次 `clear` 或覆写之前，其显存中完好无损地保留着第 $N-1$ 帧最后一次写入的画面**！
   - **实例 1（原版 `PostEffectFrameBufferTexture` 的跨帧画中画）**：
     - 在第 $N-1$ 帧末尾的 `Step 10.8 (PostEffectLookupTable)` 中，`copyFrameBufferToTexture` 将包含完整 3D 场景、热浪扭曲和泛光的最终 HDR 画面 `stretchrect` 拷入了 `PostEffectFrameBufferTexture`。
     - 进入第 $N$ 帧后，`PostEffectFrameBufferTexture` 在 `Step 1` 至 `Step 6`（乃至无水地图的 `Step 7`）中**完全未被触碰**，一直携带着第 $N-1$ 帧的完整成片！
     - 因此，只要在 `Step 5`（主场景物体）或 `Step 7.1` 抓屏之前的任意 Shader 中绑定并采样 `PostEffectFrameBufferTexture`（或任何在帧末写入、帧初读取的纹理），当前第 $N$ 帧的物体表面就会直接显示出第 $N-1$ 帧的屏幕画面；到了第 $N$ 帧末尾该画面又被连同物体一起拷入 `PostEffectFrameBufferTexture` 供第 $N+1$ 帧采样——从而形成**每一层延迟 1 帧的无限递归“画中画（テレビ in テレビ）”嵌套效果**！
   - **实例 2（分帧更新与跨帧时序特效能力）**：
     - 同样基于该跨帧保留机制，`Step 0.3` 烘焙的 `EnvironmentDestinationTexture*` 可以在首帧渲染后跨数千帧长期只读复用；日冕 Mod（见 [`readonly/ingame.scrapeo modded corona.txt` L93–L131](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/readonly/ingame.scrapeo%20modded%20corona.txt#L93-L131)）利用 `setbool` 状态机让 `BlurredShroudTexture` 每 4 帧才重算一次高斯模糊，其余 3 帧直接读取上一帧保留在显存中的模糊结果。
     - **对本项目的重大工程价值**：这证明在不修改 C++ 引擎的前提下，仅凭 SCRAPEO 原生 `var texture` 即可实现**跨帧历史缓冲（History Buffer）**——只要遵循**“在本帧前半段先作为 Texture 只读采样上一帧残留数据，在本帧后半段再通过 `settarget` 或 `stretchrect` 覆写本帧新数据”**的读写时序，即可原生支持分帧摊销计算或跨帧时序特效！

---

### 1.5 三个硬件深度缓冲 (`ShadowMapDepthBuffer` vs `DepthBuffer` vs `FrameDepthBuffer`) 的尺寸与借用规则

Direct3D 9 硬件铁律规定：**绑定的硬件深度表面 (`D24S8`) 宽高必须 $\ge$ 当前颜色 Render Target (`RT0`) 的宽高，且两者的多重采样阶数 (`MultiSampleType`) 必须严格一致**。原版 [`Common.scrapeh`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/readonly/SCRAPE-RA3/Common.scrapeh) 与 [`Shadow.scrapeh`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/readonly/SCRAPE-RA3/Shadow.scrapeh) 据此设计了 3 个深度表面变量：

1. **`ShadowMapDepthBuffer`（阴影专属深度缓冲 · 独立分配）**：
   - 声明：`var surface ShadowMapDepthBuffer edramdepth $Sas.Shadow[0].MapSize $Sas.Shadow[0].MapSize D24S8`。
   - **为何不能复用主 `DepthBuffer`？** 因为高画质下 `ShadowMapTexture` 分辨率可达 `1024×1024` 或 `2048×2048`，而玩家屏幕分辨率可能低至 `800×600` 或 `1024×768`（此时主 `DepthBuffer` 高仅 `600` 或 `768`）。若绑定主 `DepthBuffer` 渲染阴影，在低分辨率下会直接违反 D3D9 `Depth.Size >= RT.Size` 导致 `SetRenderTarget` 失败。因此阴影 Pass 拥有专属的 `ShadowMapDepthBuffer`。
2. **`DepthBuffer`（默认非抗锯齿 `1x` 全屏硬件深度/模板表面 · 三次分时复用）**：
   - 声明：`var surface DepthBuffer depth`（引擎默认创建的 `1x` 非 MSAA 全屏 `D24S8` 表面）。
   - **为何 `512×512` 的水面反射 (`updateWaterReflection`) 可以复用它？**
     - RA3 最低支持屏幕分辨率为 `800×600`，始终大于 `WaterReflectionTexture` 的固定尺寸 `512×512`，且两者均为非 MSAA (`1x`)。
     - 在 [`WaterReflection.scrapeh` L31–L32](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/readonly/SCRAPE-RA3/WaterReflection.scrapeh#L31-L32) 中，EA 工程师专门写下了注释：
       ```scrape
       setdepth DepthBuffer // Set depth buffer before render target, as RNA derives the current viewport size from the last render target/depth buffer set, and we want to use the RT size as viewport
       settarget 0 WaterReflectionRenderTarget
       ```
     - 先绑定全屏 `DepthBuffer`，再绑定 `512×512` 的 `WaterReflectionTexture`，RNA 引擎便将 D3D9 视口设为 `512×512`，**仅借用全屏 `DepthBuffer` 左上角的 `512×512` 像素子区域**完成反射深度测试！
   - 随后在 `Step 4.1 (updateDepthMapReally)` 中第二次 `clear(1.0)` 借用全屏 `DepthBuffer`；最后在关闭 MSAA 的主场景 `Step 5.1 (UpdateFrameBuffer)` 中第三次 `clear(depth=1.0, stencil=0)` 作为主场景全屏深度与 Stencil 缓冲。
3. **`FrameDepthBuffer`（仅开启 MSAA 时分配的主场景深度缓冲）**：
   - 声明：`var surface FrameDepthBuffer edramdepth $WW3D.FrameBufferSizeIfAntiAliasing.x $WW3D.FrameBufferSizeIfAntiAliasing.y D24S8 $WW3D.AntiAliasingMode`。
   - **当关闭硬件抗锯齿时（本项目延迟渲染的强制模式）**：`$WW3D.FrameBufferSizeIfAntiAliasing` 为 **`0×0`（不分配显存）**，`setFrameDepthBuffer` 直接绑定上面的 `DepthBuffer`。
   - **当原版开启硬件 MSAA 时**：主场景 `FrameRenderTarget` 带有 MSAA，不能与 `1x` 的 `DepthBuffer` 混绑，故主场景使用带 MSAA 的 `FrameDepthBuffer`；而离屏的 `WaterReflectionTexture` 与 `DepthTexture` 仍是 `1x` 纹理，继续使用 `1x` 的 `DepthBuffer`。

---

## 2. 渲染步骤的八大功能机制分类、复合子步骤与六维辅助标志规范

为同时保证**时序绝对真实**与**渲染机制一目了然**，管线不再使用任何人为虚构的分类字母代号（如 `C1..C8`）或轨道编号（如 `T01..T13`），而是直接采用 **语义化主分类名称 + 统一层级步骤编号（`Step 0` 开局准备 + `Step 1..11` 每帧循环，内含 `X.1, X.2` 原子子步骤）+ 六维可共存辅助状态标志**。

### 2.1 八大主功能分类（Semantic Step Categories）

| 主分类语义名称 | 建议色系角色 | 核心硬件与管线机制特征 | 归属的步骤 (`Step`) |
|---|---|---|---|
| **开局静态绑定与低频预烘焙**<br>*(Startup Binding & On-Demand Baking)* | 冷青灰 / 钢蓝系 | 不参与每帧动态场景几何重绘：仅在开局/首帧绑定静态纹理贴图、决策 RT 路由，并在 `MustRefreshEnvironment == true` 时用 GPU 预烘焙一次光照空间环境立方盒，后续帧仅做指针级绑定。 | `Step 0` (`0.1`, `0.2`, `0.3`) |
| **非主相机离屏预绘制**<br>*(Non-Viewer Camera Offscreen Passes)* | 琥珀金 / 暖橙系 | 切换至**非玩家主视角**的专用虚拟相机（太阳正交 `ShadowMap`、水面镜像翻转 `Reflection`、海面顶视正交 `OceanDisplacement`）与独立可见剔除组，在离屏纹理中预生成阴影、平面反射或波浪位移场。 | `Step 1`、`Step 2` (`2.1`, `2.2`)、`Step 3` (`3.1`–`3.3`) |
| **主相机离屏深度预通道**<br>*(Main-Viewer Offscreen Depth Pre-Pass)* | 玫瑰红 / 品红系 | 使用**玩家主视角相机 `Viewer`**（配合独立 `visibleobjects DepthMap` 剔除组与离屏 `R32F` 目标），预先重画一次场景投射物 `z/w` 深度（`4.1`），再通过全屏 Pixel Shader 逆投影计算相机空间线性深度 `WW3D.DepthTexture`（`4.2`）。 | `Step 4` (`4.1`, `4.2`) |
| **主视角正向不透明几何 · 写深度与模板**<br>*(Main-View Forward Opaque · Z & Stencil Writer)* | 亮青 / 电光蓝系 | 主相机 `Viewer` 下的正向多光源着色主体；开启 `ZEnable = true, ZWriteEnable = true` 建立主场景真实遮挡深度缓冲（`5.1`），并在绘制单位/建筑时向硬件 Stencil 低 2 位写入轮廓掩码（`5.2`）。 | `Step 5` (`5.1`, `5.2`) |
| **读线性深度的延迟与软粒子着色 · 不写深度**<br>*(Linear-Depth-Reading Deferred & Soft Shading · No Z-Write)* | 翡翠绿 / 亮绿系 | **不写入硬件深度缓冲 (`ZWriteEnable = false`)**，且在 Pixel Shader 中**显式采样线性深度纹理 `WW3D.DepthTexture` (`viewPos.z`)** 进行屏幕空间 3D 世界坐标重建（`6.1` 水下染色/焦散）或视图空间深度差软消融（`6.2` 水下软粒子、`9.1` 主场景软粒子）。 | `Step 6` (`6.1`, `6.2`)、`Step 9` (`9.1`, `9.2`) |
| **主视角正向水面、半透明与模板描边叠加 · 不写深度**<br>*(Main-View Forward Water, Transparents & Outlines · No Z-Write)* | 皇家蓝 / 蔚蓝系 | **不写入硬件深度缓冲 (`ZWriteEnable = false`)**，也**不读取 `WW3D.DepthTexture`**；仅依赖 `Step 5` 留下的硬件 `D24S8` 做只读 `Z-Test` 或 `Stencil` 掩码测试，完成水底折射抓屏与水面绘制（`7.1`–`7.2`）、贴花/半透明/Stencil 外发光描边与静态排序层（`8.1`–`8.5`）。 | `Step 7` (`7.1`, `7.2`)、`Step 8` (`8.1`–`8.5`) |
| **3D 画面全屏滤镜后处理链**<br>*(Fullscreen 3D Post-Processing Filters)* | 霓虹紫 / 紫罗兰系 | 基于 `stretchrect` 抓屏纹理与全屏 `renderquad` 像素着色器对完整 3D 场景执行屏幕空间图像滤波（`10.1`–`10.4` 热浪扭曲、`10.5`–`10.7` 高斯泛光金字塔、`10.8`–`10.9` 曝光/色调映射/3D LUT 并 Resolve 至 8-bit LDR `FrameBuffer`）。 | `Step 10` (`10.1`–`10.9`) |
| **终态 2D HUD 与战术界面叠层**<br>*(Final 2D HUD & UI Overlays)* | 柠檬黄 / 亮金系 | 在 3D 画面经色调映射转为 LDR 并切入硬件 `FrameBuffer` (BackBuffer) 之后，关闭深度测试直接绘制头顶血条图标、建造栏、雷达与鼠标，确保 UI 锐利且不受扭曲、泛光与 LUT 调色污染。 | `Step 11` |

---

### 2.2 六维可共存辅助状态标志（Auxiliary Legend Badges：`🕒` `☀️` `💧` `📷` `👁️` `🎞️`）

每个父步骤或原子子步骤可同时挂载以下 **6 种正交的辅助图例标志**（同一行上多个标志可并排共存）：

| 辅助标志 | 图例名称 | 精确判定标准与物理含义 | 挂载该标志的步骤（支持多标志共存） |
|---|---|---|---|
| **`🕒`** | **开局准备 / 低频烘焙**<br>*(Clock: Startup Init / On-Demand Bake)* | **不需要每帧执行 GPU 重绘**的步骤：包括静态贴图绑定 (`0.1`)、RT 模式布尔决策 (`0.2`) 以及仅在首帧/光变 (`MustRefreshEnvironment == true`) 时烘焙一次、后续帧仅做指针绑定的环境立方盒旋转 (`0.3`)。因此统一归入 **`Step 0`**。 | **`Step 0` (`0.1`, `0.2`, `0.3`) 🕒** |
| **`☀️`** | **阳光阴影专属**<br>*(Sun: Sunlight Shadow Conditional)* | 依赖**太阳平行光投射方向**生成阴影深度图的步骤：受 `if Sas ShadowMappingEnabled` 门控，在**关闭阴影设置或无太阳光投影的场景中会被引擎彻底跳过**。 | **`Step 1` 📷☀️** |
| **`💧`** | **仅供水体**<br>*(Water Drop: Water-Only Conditional)* | 在**完全无水的纯陆地场景**（`Water.IsReflectionVisible == false`、`Water.IsRefractionVisible == false` 且无水体网格）中**会被引擎彻底跳过**的步骤。*（注：`Step 4` 深度图在开启软粒子时无水场景仍会运行，故不标 `💧`）*。 | **`Step 2` (`2.1`, `2.2`) 📷💧**、**`Step 3` (`3.1`–`3.3`) 📷💧**、**`Step 6` (`6.1`, `6.2`) 👁️💧**、**`Step 7.1` 💧**、**`Step 7.2` 👁️💧** |
| **`📷`** | **特殊虚拟相机与独立剔除组**<br>*(Camera: Non-Main Camera & Culling Set)* | 切换了**非主相机的特殊 `camera` 变量**（`ShadowMap`、`Reflection`、`OceanDisplacement`）并更新独立 `visibleobjects` 剔除组的步骤，用于**与玩家主视角相机 `Viewer` 明确区分**。 | **`Step 1` 📷☀️**、**`Step 2` (`2.1`, `2.2`) 📷💧**、**`Step 3.1` 📷💧** |
| **`👁️`** | **主相机玩家直视画面**<br>*(Eye: Player-Visible Main Frame)* | 采用**主相机 `Viewer`、直接改写玩家肉眼可见的主帧颜色目标 (`FrameRenderTarget` / `FrameBuffer`)** 的步骤。*（注：后台 `stretchrect` 抓屏子步骤 `7.1, 10.1, 10.3, 10.5, 10.8`、离屏轮廓提取/模糊 `8.2, 8.3`、离屏扭曲偏移绘制 `10.2`、离屏 Bloom 金字塔 `10.6` 不标 `👁️`）*。 | **`Step 5` (`5.1`, `5.2`) 👁️**、**`Step 6` (`6.1`, `6.2`) 👁️💧**、**`Step 7.2` 👁️💧**、**`Step 8.1` 👁️**、**`Step 8.4` 👁️**、**`Step 8.5` 👁️**、**`Step 9` (`9.1`, `9.2`) 👁️**、**`Step 10.4` 👁️**、**`Step 10.7` 👁️**、**`Step 10.9` 👁️🎞️**、**`Step 11` 👁️🎞️** |
| **`🎞️`** | **LDR 胶卷定影画片**<br>*(Film Frame: Clamped LDR Frame Space)* | 屏幕主画面经过曝光、色调映射（`FXFilmLut` Tonemapping）与 3D LUT 冲印转为 **8-bit 低动态范围（LDR `FrameBuffer` `X8R8G8B8`）** 之后的步骤，警示**此处画面已冲印定影为胶卷画片，不再是可以随意叠加高动态线性光能量的 HDR 缓冲**。 | **`Step 10.9` 👁️🎞️** *(HDR→LDR 胶卷定影点)*、**`Step 11` 👁️🎞️** *(在已定影的 LDR 胶卷画片上叠画 2D UI)* |

---

### 2.3 全管线 12 个父步骤 / 28 个原子子步骤速查总表 (`Step 0` – `Step 11`)

> **为什么拆分为 28 个原子子步骤？**  
> 在原版脚本中，诸如 `updateOceanDisplacement`、`updateDepthMap`、`renderOutlines`、`PostEffectDistortion`、`PostEffectBloom` 等过程内部包含多次**有严格因果先后顺序的读写切换**（例如：先 `stretchrect` 备份主帧 $\rightarrow$ 再清屏主帧画偏移 $\rightarrow$ 再 `stretchrect` 抓偏移图 $\rightarrow$ 最后全屏 Shader 采样两张图写回主帧）。将它们拆分为独立的原子子步骤行，可确保**每一个子步骤在任意显存列上最多只有一次原子操作**，彻底消除同一单元格内多个算子芯片堆叠或先后顺序不清的问题。

| 步骤编号 | 子步骤名称 / SCRAPE 核心操作 | 所属主分类 | 辅助标志 | 相机 (`VisibleSet`) | 写入目标 (Write / Copy Dst) | 读取/测试依赖 (Read / Z-Test) |
|---|---|---|---|---|---|---|
| **`Step 0`** | **开局准备、静态贴图绑定与首帧环境预烘焙** *(可折叠父步)* | **开局静态绑定与低频预烘焙** | **🕒** | — | — | — |
| `Step 0.1` | `initCustomTextures`：绑定 7 张全局静态特效/LUT 贴图 | 开局静态绑定与低频预烘焙 | 🕒 | — | SCOPE 静态纹理表 | 硬盘静态资产 |
| `Step 0.2` | `updateFrameRenderTargetToUse`：决策主帧颜色目标路由 | 开局静态绑定与低频预烘焙 | 🕒 | — | `WW3D.IsUsingFrameRenderTarget` | `IsHdrEnabled`, `IsAntiAliasingEnabled` |
| `Step 0.3` | `doRotateEnvironmentMaps`：首帧/光变 `6×2` Quad 旋转烘焙天空盒 + 每帧绑定 | 开局静态绑定与低频预烘焙 | 🕒 | `Viewer` | `EnvironmentDestinationCube (×2)` (`●W` 首帧烘焙) | `FXOceanCubeMap`, `Terrain.EnvironmentTexture` |
| **`Step 1`** | **`updateShadowTexture`：太阳平行光阴影深度图生成** *(单行步)* | **非主相机离屏预绘制** | **📷 ☀️** | `ShadowMap` (`ShadowMap`) | `ShadowMapTexture` (`●C/W`), `ShadowMapDepthBuffer` (`●C/W`) | 阴影投射物几何流 (`_CreateShadowMap`) |
| **`Step 2`** | **`updateWaterReflection`：水面镜像反射离屏重绘** *(可折叠父步)* | **非主相机离屏预绘制** | **📷 💧** | `Reflection` (`Reflection`) | `WaterReflectionTexture` | — |
| `Step 2.1` | 反射通道不透明几何重绘（借用 `DepthBuffer` 左上 `512²` 子区域清屏写 Z） | 非主相机离屏预绘制 | 📷 💧 | `Reflection` (`Reflection`) | `WaterReflectionTexture` (`●C/W`), `DepthBuffer` (`●C/W @v1` 左上 `512²`) | `EnvironmentDestinationCube (Objects)` (`◇R`) |
| `Step 2.2` | 反射通道半透明物体、非软粒子与武器线束叠加（只读测 Z，不写 Z） | 非主相机离屏预绘制 | 📷 💧 | `Reflection` (`Reflection`) | `WaterReflectionTexture` (`◐M`) | `DepthBuffer` (`▣Z` 左上 `512²` 只读测试) |
| **`Step 3`** | **`updateOceanDisplacement`：海面动态波浪位移与双向滤波** *(可折叠父步)* | **非主相机离屏预绘制** | **📷 💧** | `OceanDisplacement` | `OceanDisplacementTexture (×2)` | — |
| `Step 3.1` | 顶视船只尾流/波纹粒子绘制 + `StaticDisplacement` 基础海浪叠加 | 非主相机离屏预绘制 | 📷 💧 | `OceanDisplacement` | `OceanDisplacementTexture` (`●C/W`) | 静态 `Octave3_NRM` (`Water.StaticDisplacementTexture`) |
| `Step 3.2` | `OceanDisplacement.fx (BlurU)`：21-tap 横向波峰/水平位移卷积 | 非主相机离屏预绘制 | 💧 | 全屏 Quad | `OceanDisplacementTexture2` (`●W`) | `OceanDisplacementTexture` (`◇R` Shader 采样) |
| `Step 3.3` | `OceanDisplacement.fx (BlurV)`：21-tap 纵向波峰/水平位移卷积并绑定 | 非主相机离屏预绘制 | 💧 | 全屏 Quad | `OceanDisplacementTexture` (`●W` $\rightarrow$ `Water.DisplacementTexture`) | `OceanDisplacementTexture2` (`◇R` Shader 采样) |
| **`Step 4`** | **`updateDepthMap`：主相机离屏深度预通道与线性化** *(可折叠父步)* | **主相机离屏深度预通道** | — | `Viewer` (`DepthMap`) | `DepthTexture` $\rightarrow$ `DepthTextureLinear` | — |
| `Step 4.1` | `updateDepthMapReally (Pass 1)`：主视角 `_CreateDepthMap` 几何重绘写非线性 `z/w` | 主相机离屏深度预通道 | — | `Viewer` (`DepthMap`) | `DepthTexture` (`●C/W`), `DepthBuffer` (`●C/W @v2` 全屏清屏写 Z) | 全场不透明/半透明深度投射物 |
| `Step 4.2` | `PostFX_LinearDepth.fx (Pass 2)`：**全屏 Shader 逆投影计算**相机空间线性深度 `viewPos.z` | 主相机离屏深度预通道 | — | 全屏 Quad | `DepthTextureLinear` (`●W` $\rightarrow$ **`WW3D.DepthTexture`**) | `DepthTexture` (`◇R` **Shader 采样计算，绝非直接 Copy！**) |
| **`Step 5`** | **`UpdateFrameBuffer (Opaque)`：主场景不透明几何与轮廓 Stencil 建立** *(可折叠父步)* | **主视角正向不透明几何 · 写深度与模板** | **👁️** | `Viewer` (`Frame`) | `FrameRenderTarget`, `DepthBuffer` | — |
| `Step 5.1` | 主场景清屏 + 地形、道路、海墙、焦痕、履带、桥梁、树木道具正向绘制 | 主视角正向不透明几何 · 写深度与模板 | 👁️ | `Viewer` (`Frame`) | `FrameRenderTarget` (`●C/W @v1`), `DepthBuffer` (`●C/W @v3` 写 Z，Stencil 清 0) | `ShadowMapTexture` (`◇R`), `EnvironmentDestinationCube (Objects)` (`◇R`) |
| `Step 5.2` | 玩家单位 (`renderUnits`)、通用实体 (`Solid`)、建筑 (`renderStructures`) 与 `StaticSort5` 绘制 + 轮廓 Stencil 写入 | 主视角正向不透明几何 · 写深度与模板 | 👁️ | `Viewer` (`Frame`) | `FrameRenderTarget` (`◐M`), `DepthBuffer` (`◐M` 写 Z + **写 Stencil `bit 0..1` = 1/2/3**) | `ShadowMapTexture` (`◇R`), `EnvironmentDestinationCube (Objects)` (`◇R`) |
| **`Step 6`** | **`RenderUnderwater`：水下全屏延迟染色/焦散与水下软粒子** *(可折叠父步)* | **读线性深度的延迟与软粒子着色 · 不写深度** | **👁️ 💧** | `Viewer` (`Frame`) | `FrameRenderTarget` | `DepthTextureLinear (WW3D.DepthTexture)` |
| `Step 6.1` | `renderUnderwaterDeferred`：全屏 Quad 读线性深度重建水底 3D 坐标做 `Tint` 染色与偏导法线 `Caustics` 焦散 | 读线性深度的延迟与软粒子着色 · 不写深度 | 👁️ 💧 | 全屏 Quad | `FrameRenderTarget` (`◐M @v2` 正片叠底 + 加法混合) | **`DepthTextureLinear (WW3D.DepthTexture)` (`◇R`)**, 静态 `FXDepthLut`, `FXCaustics` |
| `Step 6.2` | `renderbin Underwater 0 & 1`：水下专属透明网格与水下软粒子绘制 | 读线性深度的延迟与软粒子着色 · 不写深度 | 👁️ 💧 | `Viewer` (`Frame`) | `FrameRenderTarget` (`◐M`) | **`DepthTextureLinear` (`◇R` 软粒子)**, `DepthBuffer` (`▣Z` 只读测试) |
| **`Step 7`** | **`Water Surface`：水底折射抓屏与水面网格综合着色** *(可折叠父步)* | **主视角正向水面、半透明与模板描边叠加 · 不写深度** | **👁️ 💧** | `Viewer` (`Frame`) | `PostEffectFrameBufferTexture` $\rightarrow$ `FrameRenderTarget` | — |
| `Step 7.1` | `updateWaterRefraction`：`StretchRect #1` 抓取已染色的水底主帧画面作为折射图 | 主视角正向水面、半透明与模板描边叠加 · 不写深度 | 💧 | — (`StretchRect`) | `PostEffectFrameBufferTexture` (`●W @v1: Water.RefractionTexture`) | `FrameRenderTarget (@v2)` (`⇉S` 硬件表面块拷贝) |
| `Step 7.2` | `renderWater`：`Ocean.fx` / `RiverWater.fx` 汇聚 5 路离屏纹理绘制水面网格（测试水底 Z，不写 Z） | 主视角正向水面、半透明与模板描边叠加 · 不写深度 | 👁️ 💧 | `Viewer` (`Frame`) | `FrameRenderTarget` (`◐M @v3: Water Surface`) | `ShadowMapTexture` (`◇R`), `WaterReflectionTexture` (`◇R`), `OceanDisplacementTexture` (`◇R`), `PostEffectFrameBufferTexture (@v1)` (`◇R`), `EnvironmentDestinationCube (Water)` (`◇R`), `DepthBuffer` (`▣Z` 只读) |
| **`Step 8`** | **`Transparencies & Outlines`：贴花、半透明、Stencil 发光描边与静态排序** *(可折叠父步)* | **主视角正向水面、半透明与模板描边叠加 · 不写深度** | **👁️** | `Viewer` (`Frame`) | `FrameRenderTarget`, `OutlineTextureFill`, `OutlineTexture` | — |
| `Step 8.1` | `renderDecals` (读写 Stencil `bit 2`)、`renderbin Transparent` 与 `renderTransparentOutlineObjects` (追加写 Stencil `bit 0..1`) | 主视角正向水面、半透明与模板描边叠加 · 不写深度 | 👁️ | `Viewer` (`Frame`) | `FrameRenderTarget` (`◐M`), `DepthBuffer` (`▣Z/St` 只读 Z + 读写 Stencil `bit 0..2`) | `EnvironmentDestinationCube (Objects)` (`◇R`) |
| `Step 8.2` | `renderOutlines (Pass A)`：绑定 `OutlineTextureFill`，按 `Stencil == 1/2/3` 绘制全屏 Quad 提取纯色单位剪影 | 主视角正向水面、半透明与模板描边叠加 · 不写深度 | — | `Viewer` (Quad) | `OutlineTextureFill` (`●C/W`) | `DepthBuffer` (`▣St` 只读测试 `Stencil bit 0..1 == 1, 2, 3`) |
| `Step 8.3` | `renderOutlines (Pass B)`：`Outlines.fx (BlurBox)` 全屏 Shader 4-tap 盒式膨胀模糊 | 主视角正向水面、半透明与模板描边叠加 · 不写深度 | — | 全屏 Quad | `OutlineTexture` (`●W`) | `OutlineTextureFill` (`◇R` Shader 采样) |
| `Step 8.4` | `renderOutlines (Pass C)`：`Outlines.fx (DrawWithStencil)` 仅在 `Stencil == 0` 单位外圈背景处将发光轮廓合成回主帧 | 主视角正向水面、半透明与模板描边叠加 · 不写深度 | 👁️ | 全屏 Quad | `FrameRenderTarget` (`◐M @v4: Outlines Added`) | `OutlineTexture` (`◇R`), `DepthBuffer` (`▣St` 只读测试 `Stencil bit 0..1 == 0`) |
| `Step 8.5` | `renderBehindBuildingMarkers` (`ZFunc=Greater` 建筑遮挡透视剪影) 与 `renderBinsStaticSort (4..1)` | 主视角正向水面、半透明与模板描边叠加 · 不写深度 | 👁️ | `Viewer` (`Frame`) | `FrameRenderTarget` (`◐M`) | `DepthBuffer` (`▣Z/St` 只读测试) |
| **`Step 9`** | **`Soft Particles & World VFX`：主场景软粒子与世界空间线束/天气** *(可折叠父步)* | **读线性深度的延迟与软粒子着色 · 不写深度** | **👁️** | `Viewer` (`Frame`) | `FrameRenderTarget` | `DepthTextureLinear (WW3D.DepthTexture)` |
| `Step 9.1` | `renderParticles`：开启 `ReallyRenderSoftParticles = true`，绘制全场景烟火/爆炸/水花 GPU 软粒子 | 读线性深度的延迟与软粒子着色 · 不写深度 | 👁️ | `Viewer` (`Frame`) | `FrameRenderTarget` (`◐M`) | **`DepthTextureLinear (WW3D.DepthTexture)` (`◇R` 软粒子深度差消融)**, `DepthBuffer` (`▣Z` 只读) |
| `Step 9.2` | `renderTerrainUI`、`renderTracers`、`renderLasers`、`renderConnectionLines`、`renderRain` 绘制 | 读线性深度的延迟与软粒子着色 · 不写深度 | 👁️ | `Viewer` (`Frame`) | `FrameRenderTarget` (`◐M @v5: Full 3D Scene`) | `DepthBuffer` (`▣Z` 只读测试), 静态 `FXDistortionFractal` |
| **`Step 10`** | **`renderPostEffects`：3D 画面全屏滤镜后处理三部曲 (Distortion $\rightarrow$ Bloom $\rightarrow$ LUT Resolve)** *(可折叠父步)* | **3D 画面全屏滤镜后处理链** | **👁️ 🎞️** | 全屏 Quad / `Viewer` | `FrameRenderTarget` $\rightarrow$ `FrameBuffer` | — |
| `Step 10.1` | `PostEffectDistortion (1)`：`StretchRect #2` 将完整 3D 主帧画面备份至 `PostEffectFrameBufferTexture` | 3D 画面全屏滤镜后处理链 | — | — (`StretchRect`) | `PostEffectFrameBufferTexture` (`●W @v2: Pre-Distort Backup`) | `FrameRenderTarget (@v5)` (`⇉S` 硬件表面块拷贝) |
| `Step 10.2` | `PostEffectDistortion (2)`：主帧 RT **只清颜色** `(0.5,0.5,1,1)` 保留 `DepthBuffer` 深度，绘制 `Distorter 0/1` (含软粒子) 与扭曲激光 | 3D 画面全屏滤镜后处理链 | — | `Viewer` (`Frame`) | `FrameRenderTarget` (`●C/W Temp: UV Offset Field`) | `DepthBuffer` (`▣Z` 只读遮挡测试), **`DepthTextureLinear (WW3D.DepthTexture)` (`◇R` 扭曲软粒子)** |
| `Step 10.3` | `PostEffectDistortion (3)`：`StretchRect` 将主帧 RT 上的 UV 偏移场拷入 `DistortionOffsetTexture` | 3D 画面全屏滤镜后处理链 | — | — (`StretchRect`) | `DistortionOffsetTexture` (`●W`) | `FrameRenderTarget (Temp Offset)` (`⇉S` 硬件表面块拷贝) |
| `Step 10.4` | `PostEffectDistortion (4)`：`PostFX_Distortion.fx` 全屏 Quad 按偏移图扰动 UV 采样备份原图，覆写回主帧 RT | 3D 画面全屏滤镜后处理链 | 👁️ | 全屏 Quad | `FrameRenderTarget` (`●W @v6: Distorted Scene`) | `PostEffectFrameBufferTexture (@v2)` (`◇R`), `DistortionOffsetTexture` (`◇R`) |
| `Step 10.5` | `PostEffectBloom (1)`：`StretchRect #3` 将扭曲后的主帧画面备份至 `PostEffectFrameBufferTexture` | 3D 画面全屏滤镜后处理链 | — | — (`StretchRect`) | `PostEffectFrameBufferTexture` (`●W @v3: Pre-Bloom Backup`) | `FrameRenderTarget (@v6)` (`⇉S` 硬件表面块拷贝) |
| `Step 10.6` | `PostEffectBloom (2)`：`PostFX_Bloom.fx` 在 6 张 `BloomTextures` (`High/Med/Low 0..1`) 上执行三级降采样与 11×11 高斯乒乓模糊累加 | 3D 画面全屏滤镜后处理链 | — | 全屏 Quad (×10) | `BloomTextures (×6)` (`●W / Ping-Pong` $\rightarrow$ `BloomTextureHigh1`) | `PostEffectFrameBufferTexture (@v3)` (`◇R`) |
| `Step 10.7` | `PostEffectBloom (3)`：`PostFX_Bloom.fx (AccumulateFinal)` 全屏 Quad 将备份原图与 `BloomTextureHigh1` 叠加写回主帧 RT | 3D 画面全屏滤镜后处理链 | 👁️ | 全屏 Quad | `FrameRenderTarget` (`●W @v7: Bloomed HDR Scene`) | `PostEffectFrameBufferTexture (@v3)` (`◇R`), `BloomTextures (High1)` (`◇R`) |
| `Step 10.8` | `PostEffectLookupTable (1)`：`StretchRect #4` 将泛光后的最终 HDR 画面拷入 `PostEffectFrameBufferTexture` *(跨帧保留至下帧 `Step 7.1`！)* | 3D 画面全屏滤镜后处理链 | — | — (`StretchRect`) | `PostEffectFrameBufferTexture` (`●W @v4: Pre-LUT HDR Snapshot`) | `FrameRenderTarget (@v7)` (`⇉S` 硬件表面块拷贝) |
| `Step 10.9` | `PostEffectLookupTable (2)`：**切换目标至硬件 `FrameBuffer`**，执行曝光、色调映射 (`FXFilmLut`) 与 3D LUT 冲印定影为 8-bit LDR 画片 | 3D 画面全屏滤镜后处理链 | **👁️ 🎞️** | 全屏 Quad | **`FrameBuffer (BackBuffer color0)` (`●W @v1: Tonemapped LDR 🎞️`)** | `PostEffectFrameBufferTexture (@v4)` (`◇R`), 静态 `FXFilmLut` & 3D `LookupTexture` |
| **`Step 11`** | **`2D HUD, IconLayers & Present`：在已定影的 LDR 胶卷画片上直绘血条图标与 UI 并输出显示** *(单行步)* | **终态 2D HUD 与战术界面叠层** | **👁️ 🎞️** | 2D 屏幕空间 | **`FrameBuffer (BackBuffer color0)` (`◐M @v2: Final LDR + UI` $\rightarrow$ `Present`)** | CPU 2D 图标与 UI 顶点/贴图流（禁 Z-Test，不受 PostFX 污染） |

---

## 3. 各阶段详细硬件状态、Shader 计算与数据流拆解

### 阶段 0：开局准备、静态贴图绑定与首帧环境预烘焙 (`Step 0`)

> **为什么将 `doRotateEnvironmentMaps` 归入 `Step 0`？**  
> 尽管在 [`main/ingame.scrapeo`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1400) 文本顺序中 `callproc doRotateEnvironmentMaps` 写在 `updateShadowTexture` 之后，但逆向与脚本逻辑（[L1242 `if WW3D MustRefreshEnvironment`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1242) $\rightarrow$ [L1244 `setbool WW3D MustRefreshEnvironment false`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1244)）证明：**其 12 次 CubeFace 全屏 Quad 渲染仅在地图载入首帧执行一次**，游戏正式开始后的每一帧仅执行两行零开销的 `settexture` 指针绑定，与 `initCustomTextures` 完全同属开局准备阶段。将其集中归入 `Step 0` 的子步骤，可避免误导读者以为每帧都在重绘环境立方体贴图。

- **`Step 0.1`：`initCustomTextures`（全局静态特效贴图绑定，[L132–L140](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L132-L140)）`🕒`**
  - 将 `FXDistortionFractal01`、`FXOceanCubeMap`、`FXJapanBuildMask`、`FXChronoRift`、`FXIronCurtain`、`FXLightningTeslaHit` 绑定至 `WW3D.*` 命名空间；将 `FXFilmLut` 绑定至 `PostEffect.LookupTable.FilmTonemapping`。
- **`Step 0.2`：`updateFrameRenderTargetToUse`（主帧 RT 路由决策，[L48–L56](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L48-L56)）`🕒`**
  - 若 `WW3D.IsHdrEnabled` 或 `WW3D.IsAntiAliasingEnabled` 为真，设置 `WW3D.IsUsingFrameRenderTarget = true`（主场景渲染至离屏 `FrameRenderTarget`）；否则为 `false`（直接渲染至 `FrameBuffer`）。
- **`Step 0.3`：`doRotateEnvironmentMaps`（光照空间环境立方盒首帧烘焙与绑定，[L1128–L1374](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1128-L1374)）`🕒`**
  - **首帧 GPU 烘焙（`if WW3D MustRefreshEnvironment`）**：`setdepth NULL`，调用 [`RotateEnvironmentMap.fx`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders/RotateEnvironmentMap.fx) 的 `CubeFace0..5` 共 6 个 Technique，将静态源 `WW3D.FXOceanCubeMap` 与 `Terrain.EnvironmentTexture` 旋转对齐至主太阳光 (`DirectionalLight[0]`) 方向坐标系，分别写入 `EnvironmentDestinationTextureWater` (`128×128×6`, `autogenmipmap`) 与 `EnvironmentDestinationTextureObjects` (`128×128×6`, `autogenmipmap`)，随后立即将 `MustRefreshEnvironment` 置为 `false`。两张 CubeMap 此后常驻显存跨帧复用。
  - **每帧绑定**：将两张旋转后的 CubeMap 分别绑定至 **`Water.LightSpaceEnvironmentMap`**（供 `Step 7.2` 水面采样）与 **`Objects.LightSpaceEnvironmentMap`**（供 `Step 2.1`、`Step 5.1/5.2`、`Step 8.1` 物体采样）。

---

### 第一部分：帧前离屏预渲染阶段 (`Step 1` – `Step 4`)

#### `Step 1`：太阳平行光阴影深度图生成 (`updateShadowTexture`) `📷` `☀️`
- **代码位置**：[`ingame.scrapeo` L214–L242](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L214-L242)，调用自 [L1398](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1398)。
- **执行条件**：`if Sas ShadowMappingEnabled`（关闭阴影或无阳光场景彻底跳过）。
- **绑定目标**：Color RT0 = `ShadowMapTexture` (`R32F`, `$Sas.Shadow[0].MapSize²`)；Depth = **`ShadowMapDepthBuffer` (`D24S8`，阴影专属深度表面)**；Clear 颜色为 `1, 1, 1, 1`，深度为 `1.0`。
- **执行操作**：
  - `shadowMap.beginUpdate`（C++ 计算太阳正交包围盒与 `ShadowMapWorldToShadow` 矩阵）+ `setcamera ShadowMap` + `visibleobjects ShadowMap`。
  - `beginShadowOverrideTechnique`：强制全场材质切换至 `_CreateShadowMap` Technique，依次提交 `Terrain`、`TerrainLikeGroundObject`、`Bridge`、`Props`、`Units + UnitOutline*`、`Solid`、`Structure + StructureOutline*`、`StaticSort5..1`、`Transparent + TransparentOutline*`，在 PS 中将归一化深度 `z/w` 写入 `ShadowMapTexture.r`。
  - `endShadowOverrideTechnique` + `shadowMap.endUpdate`。

---

#### `Step 2`：水面镜像反射离屏重绘 (`updateWaterReflection`) `📷` `💧`
- **代码位置**：[`ingame.scrapeo` L760–L827](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L760-L827)，调用自 [L1401](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1401)。
- **执行条件**：`if Water IsReflectionVisible`（无水场景彻底跳过）。
- **内部 2 个原子子步骤**：
  - **`Step 2.1`（反射通道不透明几何重绘 · 借用 `DepthBuffer` 左上 `512×512` 清屏写 Z）**：
    - 临时设 `Particle.ReallyRenderSoftParticles = false`。
    - 先绑定全屏 `1x` `setdepth DepthBuffer`，再绑定 `settarget 0 WaterReflectionTexture` (`512×512`)，使引擎视口自动收缩为 `512×512`，**仅借用全屏 `DepthBuffer` 左上角 `512×512` 子矩形区域**（定义为世代 `DepthBuffer@v1`）。
    - 清屏颜色为 `0, 0, 0, 1`、深度为 `1.0`；切换 `setcamera Reflection` + `visibleobjects Reflection`。
    - 采样 `Objects.LightSpaceEnvironmentMap`，正向绘制镜像视锥内的 `Terrain`、`TerrainLikeGroundObject`、`Bridge`、`Units + UnitOutline*`、`Solid`、`Structure + StructureOutline*`、`StaticSort5`（开启 `ZWriteEnable = true`）。
  - **`Step 2.2`（反射通道半透明、非软粒子与武器线束叠加 · 只读测 Z 不写 Z）**：
    - 保持 `WaterReflectionTexture` 与 `DepthBuffer`（左上 `512²` 只读 `Z-Test`，`ZWriteEnable = false`），依次叠加 `StaticSort4..1`、`Transparent`、`renderParticles`（非软粒子模式）、`Tracers`、`Lasers`、`ConnectionLines`。
    - 绑定 `WaterReflectionTexture` 至 **`Water.ReflectionTexture`**，恢复 `ReallyRenderSoftParticles = true`。

---

#### `Step 3`：海面动态波浪位移与双向滤波 (`updateOceanDisplacement`) `📷` `💧`
- **代码位置**：[`ingame.scrapeo` L897–L960](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L897-L960)，调用自 [L1403](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1403)；Shader 为 [`OceanDisplacement.fx`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders/OceanDisplacement.fx)。
- **执行条件**：静态 `Octave3_NRM` 绑定每帧执行；动态渲染受 `if Water IsReflectionVisible` 控制。全程 `setdepth NULL`。
- **内部 3 个原子子步骤（消除同格乒乓读写冲突）**：
  - **`Step 3.1`（顶视波浪源网格/粒子绘制 + 基础海浪叠加）`📷` `💧`**：
    - 绑定 RT0 = `OceanDisplacementTexture` (`1024×1024`, `A16B16G16R16F`)，`clearcolor(0, 0, 0, 0)`，切换 `setcamera OceanDisplacement`。
    - 绘制 `renderWaterDisplacement`、`renderbin OceanDisplacement 0 & 1`（舰船尾流与交互波纹粒子），再以全屏 Quad (`StaticDisplacement`) 采样静态 `Octave3_NRM` 加法混合双角度滚动基础海浪。
  - **`Step 3.2`（横向 21-tap 波峰/水平位移卷积 `BlurU`）`💧`**：
    - 绑定 `OceanDisplacementTexture` 为输入纹理，切换 RT0 = `OceanDisplacementTexture2`，执行全屏 Shader `OceanDisplacement.fx (BlurU)`：通过像素着色器 21-tap 余弦/正弦卷积计算横向水平位移 `.x` 与平滑高度 `.z`（**绝非直接显存拷贝**）。
  - **`Step 3.3`（纵向 21-tap 波峰/水平位移卷积 `BlurV`）`💧`**：
    - 绑定 `OceanDisplacementTexture2` 为输入纹理，切换 RT0 回 `OceanDisplacementTexture`，执行全屏 Shader `OceanDisplacement.fx (BlurV)`：计算纵向水平位移 `.y` 与最终波浪高度 `.z`，并绑定至 **`Water.DisplacementTexture`**。

---

#### `Step 4`：主相机离屏深度预通道与线性化 (`updateDepthMap`)
- **代码位置**：[`ingame.scrapeo` L678–L730](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L678-L730)，调用自 [L1405](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1405)。
- **执行条件**：`if Water IsReflectionVisible elif Particle IsSoftParticlesEnabled`（只要可见水面或开启了软粒子即执行；无水陆地战开启软粒子时照常运行，故**不标 `💧`**）。
- **内部 2 个原子子步骤**：
  - **`Step 4.1`（主视角非线性 NDC 深度重绘 `_CreateDepthMap`）**：
    - 绑定 Color RT0 = `DepthTexture` (`R32F`, 全屏)；Depth = **`DepthBuffer` (`D24S8`，第 2 次清屏借用，定义为世代 `DepthBuffer@v2`)**。
    - 清屏颜色为 `1, 1, 1, 1`、深度为 `1.0`；切换 `setcamera Viewer` + `visibleobjects DepthMap`。
    - 开启 `beginDepthOverrideTechnique`（调用 `_CreateDepthMap` 或回退 `_CreateShadowMap`），重画全场投射物并将非线性透视深度 `z/w` 写入 `DepthTexture.r`，随后关闭 Override。
  - **`Step 4.2`（全屏 Shader 逆投影计算线性深度 `PostFX_LinearDepth.fx`）**：
    - 绑定 Color RT0 = `DepthTextureLinear` (`R32F`, 全屏)，将 `DepthTexture` 绑定至 `PostEffect.DepthBufferTexture`。
    - 执行 [`PostFX_LinearDepth.fx`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders/PostFX_LinearDepth.fx) (`LinearDepth` Technique) 全屏 `renderquad`：**在 Pixel Shader 中采样 `DepthTexture` 的非线性 `z/w`，构造裁剪空间坐标乘以 CPU 逆投影矩阵 `ProjectionInverse` 并除以 `w`，逐像素重新计算出相机空间线性深度 `viewPos.z`** 写入 `DepthTextureLinear`，最后绑定至全局 **`WW3D.DepthTexture`**。
    - > **重要勘误警示**：`Step 4.2` 是标准的 **Shader 只读采样 (`◇R DepthTexture`) $\rightarrow$ PS 矩阵数学运算 $\rightarrow$ Shader 全屏覆写 (`●W DepthTextureLinear`)**，**绝不是 `stretchrect` 显存直接 Copy**！

---

### 第二部分：主场景帧缓冲 3D 合成阶段 (`Step 5` – `Step 9`)

#### `Step 5`：主场景不透明几何正向绘制与轮廓 Stencil 建立 (`UpdateFrameBuffer Opaque`) `👁️`
- **代码位置**：[`InGame` L1408–L1454](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1408-L1454)。
- **内部 2 个原子子步骤**：
  - **`Step 5.1`（主场景目标清屏 + 地形、道路、贴地物、焦痕、履带、桥梁、树木道具绘制）`👁️`**：
    - `callproc setFrameRenderTarget`（绑定 `FrameRenderTarget` 或 `FrameBuffer`）+ `callproc setFrameDepthBuffer`（无 AA 时绑定 `DepthBuffer`，开启第 3 个深度世代 **`DepthBuffer@v3`**）。
    - `setcamera Viewer` + `visibleobjects Frame`；执行 `clear` 将主帧颜色清为 `0, 0, 0, 1`（世代 **`FrameRenderTarget@v1`**）、硬件深度清为 `1.0`、**8-bit Stencil 清为 `0`**。
    - 绑定 `ShadowMapTexture` 至 `Sas.Shadow[0].ShadowMap`，依次正向绘制（`ZEnable=true, ZWriteEnable=true`）：`renderTerrain` $\rightarrow$ `renderRoads` $\rightarrow$ `renderbin TerrainLikeGroundObject` $\rightarrow$ `renderScorchMarks` $\rightarrow$ `renderTerrainTracks` $\rightarrow$ `renderbin Bridge` $\rightarrow$ `renderProps`。
  - **`Step 5.2`（玩家单位、通用实体、建筑与 `StaticSort5` 绘制 + 选中/悬停轮廓 Stencil 写入）`👁️`**：
    - 继续在 `FrameRenderTarget` 与 `DepthBuffer@v3` 上绘制：`renderUnits`（遍历 `UnitPlayer0..19`）$\rightarrow$ `renderbin Solid` $\rightarrow$ `renderStructures`（遍历 `Structure`）$\rightarrow$ `renderbin StaticSort5`。
    - **硬件 Stencil 副作用**：`renderUnits` 与 `renderStructures` C++ 回调在绘制完普通队列后，会紧接着提交 `UnitOutlineSelected / HoverSelect / HoverAttack` 与 `StructureOutline*` 队列，**向硬件 `DepthBuffer@v3` 的 Stencil 低 2 位 (`bit 0..1`) 写入掩码值 `1`（选中）、`2`（悬停选择）或 `3`（悬停攻击）**，供 `Step 8.2–8.4` 提取外发光轮廓。

---

#### `Step 6`：水下全屏延迟染色/焦散与水下软粒子 (`RenderUnderwater`) `👁️` `💧`
- **代码位置**：[`InGame` L1457–L1466](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1457-L1466) 及 `renderUnderwaterDeferred` ([L979–L996](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L979-L996))。
- **内部 2 个原子子步骤**：
  - **`Step 6.1`（`renderUnderwaterDeferred`：全屏 Quad 屏幕空间水下延迟染色与偏导法线焦散）`👁️` `💧`**：
    - **触发条件**：`if Water IsReflectionVisible`。
    - **输入**：显式采样 **`WW3D.DepthTexture` (`DepthTextureLinear`，第 1 次消费线性深度！)** 以及静态贴图 `FXDepthLut`、`FXCaustics`；关闭深度测试与深度写入 (`ZEnable = false, ZWriteEnable = false`)。
    - **Pass 1 (`Tint`)**：由 `viewPos.z` 乘以视线射线重建水底像素的 3D 世界坐标 `worldPosition`，裁剪水面以上像素 (`WaterLevel - worldPosition.z < 0`)，按水深查表 `FXDepthLut` 并以正片叠底 (`DestColor / Zero`) 将水底海床、潜艇、水下基地染成深海蓝绿色。
    - **Pass 2 (`Caustics`)**：对 `worldPosition` 求屏幕偏导 `ddy × ddx` 重建水底面法线 `worldNormal`，沿阳光方向投射双层滚动焦散并以加法混合 (`One / One`) 叠加至 `FrameRenderTarget`（演进为 **`FrameRenderTarget@v2`**）。
  - **`Step 6.2`（`renderbin Underwater 0 & 1`：水下专属透明网格与水下气泡软粒子）`👁️` `💧`**：
    - 开启硬件深度只读测试 (`ZEnable = true, ZWriteEnable = false`)，绘制 `Underwater 0` 网格与 `Underwater 1` 粒子（`GpuParticleUnderwater.fx` 采样 **`WW3D.DepthTexture`** 做软粒子消融）。

---

#### `Step 7`：水底折射抓屏与水面网格综合着色 (`Water Surface`) `👁️` `💧`
- **代码位置**：[`InGame` L1468–L1470](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1468-L1470) 及 `updateWaterRefraction` ([L829–L846](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L829-L846))。
- **内部 2 个原子子步骤（严格分离抓屏写纹理与水面读纹理）**：
  - **`Step 7.1`（`updateWaterRefraction`：`StretchRect #1` 抓取水底折射底图）`💧`**：
    - 执行 `stretchrect FrameRenderTarget PostEffectFrameBufferTexture`，将已完成水下染色与焦散的 `FrameRenderTarget@v2` 完整拷贝到 `PostEffectFrameBufferTexture`（开启本帧第 1 个抓屏世代 **`@v1: Water.RefractionTexture`**，此时覆盖掉上一帧残留的画面）。
  - **`Step 7.2`（`renderWater`：水面网格 5 路离屏纹理汇聚着色）`👁️` `💧`**：
    - 保持 `FrameRenderTarget` 与 `DepthBuffer@v3`（`ZEnable = true, ZWriteEnable = false`：水面测试水底深度但**不写硬件深度，也不采样 `WW3D.DepthTexture`**）。
    - [`Ocean.fx`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders/Ocean.fx) / [`RiverWater.fx`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders/RiverWater.fx) 同时采样 **5 路 GPU 动态纹理**：① `Water.DisplacementTexture`（VS `tex2Dlod` 掀起 3D 波浪顶点 + PS 法线差分）、② `Water.RefractionTexture`（`PostEffectFrameBufferTexture@v1` 水底折射）、③ `Water.ReflectionTexture`（`512²` 水面反射）、④ `Water.LightSpaceEnvironmentMap`（水面环境盒）、⑤ `Sas.Shadow[0].ShadowMap`（太阳阴影），连同静态 `Octave3_NRM`、`FoamMap` 与 `Terrain.Shroud` 覆写水面像素（演进为 **`FrameRenderTarget@v3`**）。

---

#### `Step 8`：地面贴花、半透明物体、Stencil 单位发光描边与静态排序层 (`Transparencies & Outlines`) `👁️`
- **代码位置**：[`InGame` L1471–L1484](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1471-L1484) 及 `renderOutlines` ([L1034–L1123](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1034-L1123))。全程 `ZWriteEnable = false`，不读取 `WW3D.DepthTexture`。
- **内部 5 个原子子步骤**：
  - **`Step 8.1`（地面贴花 `renderDecals`、通用半透明 `Transparent` 与半透明轮廓写入 `renderTransparentOutlineObjects`）`👁️`**：
    - `renderDecals` (`Decal.fx`)：利用 `DepthBuffer@v3` 的只读深度测试与 **Stencil `bit 2 (0x4)`** 防止同一贴花跨地形块接缝重复混合。
    - `renderbin Transparent`：正向 AlphaBlend 绘制玻璃、护盾等半透明网格（采样 `Objects.LightSpaceEnvironmentMap`）。
    - `renderTransparentOutlineObjects`：绘制带轮廓的半透明单位，并将掩码追加写入 `DepthBuffer@v3` 的 **Stencil `bit 0..1`**。
  - **`Step 8.2`（`renderOutlines Pass A`：离屏 Stencil 剪影提取 $\rightarrow$ `OutlineTextureFill`）**：
    - 切换 Color RT0 = `OutlineTextureFill`（开 AA 时先绑 `OutlineRenderTargetFill` 再 `stretchrect`），保持 `DepthBuffer@v3`，清屏为 `0, 0, 0, 0`。
    - 使用 [`Outlines.fx`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders/Outlines.fx) 的 `FillSelected` (`StencilRef=1`)、`FillHoverSelect` (`StencilRef=2`)、`FillHoverAttack` (`StencilRef=3`) 绘制全屏 Quad，仅 Stencil 匹配的单位内部像素被填上橙黄/白/红纯色。
  - **`Step 8.3`（`renderOutlines Pass B`：全屏 Shader 4-tap 盒式膨胀模糊 $\rightarrow$ `OutlineTexture`）**：
    - 切换 Color RT0 = `OutlineTexture`，`setdepth NULL`，绑定 `OutlineTextureFill` 至 `WW3D.Outline.Texture`，执行 `Outlines.fx (BlurBox)` 全屏 Quad 向四周偏移 `±1.5` 像素采样均值并乘以强度 `5.0`。
  - **`Step 8.4`（`renderOutlines Pass C`：`Stencil == 0` 反向抠图合成回主帧）`👁️`**：
    - 切回主帧 `FrameRenderTarget` 与 `DepthBuffer@v3`，绑定 `OutlineTexture`，执行 `Outlines.fx (DrawWithStencil)` 全屏 Quad：设置 `StencilMask = 0x3, StencilRef = 0, StencilFunc = Equal`（**仅单位外部背景像素通过测试，单位内部像素被硬件 Stencil 拦截**），将发光外轮廓精准合成到主帧上（演进为 **`FrameRenderTarget@v4`**）。
  - **`Step 8.5`（建筑遮挡透视轮廓 `renderBehindBuildingMarkers` 与静态排序层 `StaticSort 4..1`）`👁️`**：
    - `renderBehindBuildingMarkers` (`Occlusion.fx`) 利用 `ZFunc = Greater` 绘制被建筑挡住的单位剪影；随后按 `StaticSort4 -> 3 -> 2 -> 1` 降序提交静态排序半透明层。

---

#### `Step 9`：主场景软粒子与世界空间线束/天气视效 (`Soft Particles & World VFX`) `👁️`
- **代码位置**：[`InGame` L1485–L1495](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1485-L1495)。
- **内部 2 个原子子步骤**：
  - **`Step 9.1`（`renderParticles`：主场景 GPU 软粒子绘制）`👁️`**：
    - 设 `Particle.ReallyRenderSoftParticles = true`，保持 `FrameRenderTarget` 与 `DepthBuffer@v3`（只读 `Z-Test`，`ZWriteEnable = false`）。
    - 绘制全场景烟雾、火焰、爆炸、水花粒子（`GpuParticle.fx` 等），在 PS 中采样 **`WW3D.DepthTexture` (`DepthTextureLinear`，第 2 次消费线性深度！)**，比较粒子与背景几何体的视图空间距离差以平滑消融相交硬边。
  - **`Step 9.2`（世界空间地面 UI、曳光、激光、连线与降雨绘制）`👁️`**：
    - 保持只读 `Z-Test`（不采样线性深度图），依次绘制 `renderTerrainUI`、`renderTracers`、`renderLasers`（采样 `FXDistortionFractal`）、`renderConnectionLines`、`renderRain`。至此完整 3D 场景合成完毕（演进为 **`FrameRenderTarget@v5`**）。

---

### 第三部分：3D 全屏滤镜后处理链与终态 2D HUD (`Step 10` – `Step 11`)

#### `Step 10`：全屏滤镜后处理三部曲 (`renderPostEffects`) `👁️` `🎞️`
- **代码位置**：`renderPostEffects` ([L601–L613](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L601-L613))，调用自 [`InGame` L1500](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1500)。
- **内部拆分为 9 个严格按因果顺序执行的原子子步骤**：
  - **第一幕：屏幕空间热浪/冲击波扭曲 (`PostEffectDistortion`, [L352–L386](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L352-L386), [`PostFX_Distortion.fx`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders/PostFX_Distortion.fx))**
    - **`Step 10.1`（备份扭曲前主帧：`StretchRect #2`）**：执行 `stretchrect FrameRenderTarget PostEffectFrameBufferTexture`，将完整 3D 场景 `FrameRenderTarget@v5` 备份至 `PostEffectFrameBufferTexture`（世代 **`@v2: Pre-Distort`**）。
    - **`Step 10.2`（借用主帧 RT 与硬件 `DepthBuffer@v3` 渲染 3D 扭曲偏移场）**：保持 `FrameRenderTarget` 与 **`DepthBuffer@v3`** 不变，执行 `setclearcolor 0.5 0.5 1 1; clearcolor`（**只清颜色为中性偏移 `(0.5, 0.5)`，绝不清深度！**），依次提交 `renderbin Distorter 0`（扭曲网格）、`renderbin Distorter 1`（冲击波扭曲软粒子，**第 3 次采样 `WW3D.DepthTexture` 线性深度**）与 `renderDistortionLasers`。`DepthBuffer@v3` 与 `WW3D.DepthTexture` 的本帧使命在此子步彻底完成。
    - **`Step 10.3`（抓取扭曲偏移图：`StretchRect`）**：执行 `stretchrect FrameRenderTarget DistortionOffsetTexture`，将刚才画在主帧 RT 上的 UV 偏移场拷入 `DistortionOffsetTexture` (`A8R8G8B8`)。
    - **`Step 10.4`（全屏 Shader UV 扰动合成回主帧）`👁️`**：执行 `PostFX_Distortion.fx` 全屏 `renderquad`，同时采样备份原图 `PostEffectFrameBufferTexture (@v2)` 与偏移图 `DistortionOffsetTexture`，按 `(offset * 2 - 1 + 1/255) * 0.08` 扰动 UV 后**全屏覆写回 `FrameRenderTarget`（世代 `@v6: Distorted`）**。
  - **第二幕：多级高斯泛光金字塔 (`PostEffectBloom`, [L460–L595](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L460-L595), [`PostFX_Bloom.fx`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders/PostFX_Bloom.fx))**
    - **`Step 10.5`（备份扭曲后主帧：`StretchRect #3`）**：执行 `stretchrect FrameRenderTarget PostEffectFrameBufferTexture`（世代 **`@v3: Pre-Bloom`**），随后 `setdepth NULL`。
    - **`Step 10.6`（离屏 6 张 `BloomTextures` 三级降采样与 11×11 高斯乒乓模糊累加）**：采样 `PostEffectFrameBufferTexture (@v3)`，依次通过全屏 Shader 执行：`DownsampleInitial` $\rightarrow$ `High0` $\rightarrow$ `Downsample4x4` $\rightarrow$ `Medium0` $\rightarrow$ `Downsample4x4` $\rightarrow$ `Low0`；随后从 `Low` $\rightarrow$ `Medium` $\rightarrow$ `High` 逐级执行横向 `BlurGaussian11x11U`、纵向 `BlurGaussian11x11V` 与 `Accumulate`，最终在 `BloomTextureHigh1` 中产出完整泛光图。
    - **`Step 10.7`（`AccumulateFinal` 泛光合成回主帧）`👁️`**：切回 `FrameRenderTarget`，同时采样备份原图 `PostEffectFrameBufferTexture (@v3)` 与 `BloomTextureHigh1`，执行 `AccumulateFinal` (`color + bloomColor * BloomIntensity`) **全屏覆写回 `FrameRenderTarget`（世代 `@v7: Bloomed HDR`）**，并恢复 `setFrameDepthBuffer`。
  - **第三幕：曝光、色调映射、3D LUT 冲印定影与后缓冲 Resolve (`PostEffectLookupTable`, [L299–L329](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L299-L329), [`PostFX_LookupTable.fx`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders/PostFX_LookupTable.fx))**
    - **`Step 10.8`（备份泛光后最终 HDR 主帧：`StretchRect #4`）**：执行 `stretchrect FrameRenderTarget PostEffectFrameBufferTexture`（世代 **`@v4: Pre-LUT HDR Snapshot`**——**注：此画面在帧末保留在 `PostEffectFrameBufferTexture` 中，跨帧留存至下一帧 `Step 7.1` 被覆写前！**）。
    - **`Step 10.9`（切换至硬件后缓冲 `FrameBuffer` 并执行 HDR $\rightarrow$ LDR 胶卷冲印定影）`👁️` `🎞️`**：执行 **`settarget 0 FrameBuffer`** + `setdepth DepthBuffer`，采样 `PostEffectFrameBufferTexture (@v4)`、静态 `FXFilmLut` 与 3D 体积调色表 `LookupTexture`，运行 `PostFX_LookupTable.fx (Default / ResolveOnly)` 全屏 `renderquad`，将浮点 HDR 颜色经曝光与色调映射冲印定影为 **8-bit LDR 胶卷画片写入硬件后缓冲 `FrameBuffer` (`@v1: Tonemapped LDR`)**。

---

#### `Step 11`：终态 2D 战术图标、HUD 界面与显示器 Present (`2D HUD & UI Overlays`) `👁️` `🎞️`
- **代码位置**：[`InGame` L1502–L1513](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/main/ingame.scrapeo#L1502-L1513)。
- **绑定目标**：直接绘制在 `Step 10.9` 已切换并完成 HDR $\rightarrow$ LDR 定影的硬件后缓冲 **`FrameBuffer` (`color0`)** 上（关闭 Z-Test 与 Z-Write）。
- **执行操作**：依次调用 `renderIconLayers`（单位头顶血条、老兵星级、小队编号）$\rightarrow$ `renderUI`（[`Render2D.fx`](file:///d:/PROJECTS/SAGE%20shader%20source/RA3_Shaders/Render2D.fx) 绘制右侧建造栏、雷达、技能栏、鼠标光标）$\rightarrow$ `renderDebugDisplays`，演进为 **`FrameBuffer@v2 (Final LDR + UI)`**，最终通过 D3D9 `Present` 输出至玩家显示器。

---

## 4. 核心 GPU 动态资源的跨阶段生命周期流向图（文字版拓扑）

### 链路 1：线性深度图生命周期（`DepthTexture` $\xrightarrow{\text{Shader 逆投影}}$ `DepthTextureLinear` / `WW3D.DepthTexture`）
```text
[Step 4.1: updateDepthMapReally (Pass 1)]
   主相机 Viewer 重画全场投射物 (_CreateDepthMap / _CreateShadowMap)
   ├── 借用硬件 DepthBuffer@v2 (D24S8) 做全屏 Z-Test
   └── 写出非线性 NDC 深度 (z/w) ──► DepthTexture (R32F)
                                          │
                                          ▼ ◇ Read (PostEffect.DepthBufferTexture)
[Step 4.2: PostFX_LinearDepth.fx (LinearDepth Fullscreen Shader Quad)]
   Pixel Shader 采样 z/w 乘以 ProjectionInverse 还原相机空间 Z (绝非直接 Copy!)
   └── ● Overwrite 写出线性视图深度 (viewPos.z) ──► DepthTextureLinear (R32F)
                                                         │
                                                         ══► 绑定至全局 【WW3D.DepthTexture】
                                                                │
          ┌─────────────────────────────────────────────────────┼──────────────────────────────────────────────┐
          ▼ ◇ Read #1                                           ▼ ◇ Read #2                                    ▼ ◇ Read #3
[Step 6.1 & 6.2: RenderUnderwater]                    [Step 9.1: Soft Particles]                     [Step 10.2: Distorter Particles]
 - 6.1 UnderwaterDeferred.fx (Tint & Caustics):        - renderParticles (GpuParticle*.fx):           - renderbin Distorter 1
   重建水底 3D 世界坐标与偏导面法线                      比较粒子与背景线性深度差消融硬边               (GpuParticleDistort.fx) 软化扭曲边缘
 - 6.2 renderbin Underwater 1 (水下软粒子)
```

---

### 链路 2：主帧颜色、4 次抓屏中转纹理与跨帧保留闭环（`FrameRenderTarget` $\leftrightarrow$ `PostEffectFrameBufferTexture` $\rightarrow$ `FrameBuffer`）
```text
(上一帧 Frame N-1 末尾残留): PostEffectFrameBufferTexture 完好保留着 Frame N-1 Step 10.8 的最终 HDR 画面 (若在 Step 7.1 前采样即触发“画中画”!)
                                       :
[Step 5.1 & 5.2: 主场景不透明几何] ──► ●C/W & ◐M 写入 FrameRenderTarget@v1 (海床 + 陆地 + 单位 + 建筑)
                                       │
[Step 6.1 & 6.2: 水下染色/焦散/粒子] ─► ◐M 原地混合修改 FrameRenderTarget@v2 (水底变蓝绿 + 焦散 + 水下物)
                                       │
[Step 7.1: updateWaterRefraction]      ├── ⇉ StretchRect #1 ──► ●W PostEffectFrameBufferTexture@v1 (= Water.RefractionTexture，覆盖上帧残留)
[Step 7.2: renderWater (Ocean.fx)]   ◄─┴── ◇ 采样折射图(@v1) + 反射图 + 位移图 + 环境盒 + 阴影 ──► ◐M 覆写水面像素至 FrameRenderTarget@v3
                                       │
[Step 8.1..8.5 & 9.1..9.2]           ──► ◐M 原地叠加贴花/半透明/Stencil外发光轮廓(@v4)/软粒子/线束 ──► FrameRenderTarget@v5 (完整3D场景)
                                       │
[Step 10.1: Distortion Backup]         ├── ⇉ StretchRect #2 ──► ●W PostEffectFrameBufferTexture@v2 (备份扭曲前 3D 场景)
[Step 10.2: Distortion Offset Draw]    ├── ●C/W FrameRenderTarget 只清颜色(0.5,0.5,1,1)，借 DepthBuffer@v3 绘制 Distorter 0/1 与扭曲激光
[Step 10.3: Distortion Offset Grab]    ├── ⇉ StretchRect    ──► ●W DistortionOffsetTexture
[Step 10.4: Distortion Composite]    ◄─┴── ◇ PostFX_Distortion Quad 采样备份图(@v2) + 偏移图 ──► ●W 覆写回 FrameRenderTarget@v6
                                       │
[Step 10.5: Bloom Backup]              ├── ⇉ StretchRect #3 ──► ●W PostEffectFrameBufferTexture@v3 (备份扭曲后场景)
[Step 10.6: Bloom Pyramid ×6]          ├── ◇ 经 High0/1, Med0/1, Low0/1 三级降采样与 11×11 高斯乒乓模糊 ──► ●W BloomTextureHigh1
[Step 10.7: Bloom AccumulateFinal]   ◄─┴── ◇ PostFX_Bloom Quad 采样备份图(@v3) + BloomTextureHigh1 ──► ●W 覆写回 FrameRenderTarget@v7
                                       │
[Step 10.8: LUT Backup]                ├── ⇉ StretchRect #4 ──► ●W PostEffectFrameBufferTexture@v4 (备份泛光后最终 HDR 场景 ──► ↻ 跨帧保留至 Frame N+1!)
[Step 10.9: LUT & Tonemap Resolve]     └── 切换 RT0 = FrameBuffer (硬件 BackBuffer!)
                                           ◇ PostFX_LookupTable Quad 采样备份图(@v4) + FXFilmLut + 3D LUT ──► ●W 写入 FrameBuffer@v1 (8-bit LDR 🎞️)
                                                                                                                  │
[Step 11: 2D HUD & UI]                 ───────────────────────────────────────────────────────────────────────────┴─► ◐M 叠加血条与 UI (@v2) ──► Present
```

---

### 链路 3：三套硬件深度与模板表面生命周期（`ShadowMapDepthBuffer` vs `DepthBuffer`）
```text
1. ShadowMapDepthBuffer ($Sas.Shadow[0].MapSize² · D24S8 · 阴影专属独立分配):
   └── [Step 1: updateShadowTexture] : ●C/W clear(1.0) ──► 太阳正交阴影投射物硬件 Z-Test (因 MapSize 可达 2048² > 低分辨率屏幕，独立分配)

2. DepthBuffer (FullRes · D24S8 · 1x 非 MSAA 主深度与 8-bit Stencil 表面 · 单帧三次清屏分时复用):
   ├── [世代 @v1 — Step 2.1 & 2.2: updateWaterReflection] :
   │     ●C/W clear(1.0) ──► 仅借用左上角 512×512 子矩形区域做反射不透明写 Z (2.1) 与反射半透明/粒子只读测 Z (2.2)
   ├── [世代 @v2 — Step 4.1: updateDepthMapReally] :
   │     ●C/W clear(1.0) ──► 全屏借用做主视角 _CreateDepthMap 几何深度预通道硬件 Z-Test
   └── [世代 @v3 — Step 5.1..10.2: UpdateFrameBuffer 主场景 (无 AA 时 FrameDepthBuffer 为 0×0)] :
         ●C/W clear(depth=1.0, stencil=0)
         ├── 24-bit Z-Buffer 写入: Step 5.1 (地形/道路/桥/道具) & Step 5.2 (单位/实体/建筑/StaticSort5)
         ├── 8-bit Stencil bit 0..1 (值 1,2,3) 写入:
         │     ├── Step 5.2: renderUnits (UnitOutline*) & renderStructures (StructureOutline*)
         │     └── Step 8.1: renderTransparentOutlineObjects (TransparentOutline*)
         ├── 8-bit Stencil bit 2 (值 0x4) 读写:
         │     └── Step 8.1: renderDecals (Decal.fx 防跨块贴花重复叠加)
         ├── 8-bit Stencil bit 0..1 只读测试消费:
         │     ├── Step 8.2: renderOutlines Pass A (Fill* 测试 Stencil == 1/2/3 提取纯色剪影至 OutlineTextureFill)
         │     └── Step 8.4: renderOutlines Pass C (DrawWithStencil 测试 Stencil == 0 反向抠图将发光轮廓画在单位外圈)
         └── 24-bit Z-Buffer 只读遮挡测试 (ZWriteEnable = false):
               ├── Step 6.2 (Underwater 0/1) · Step 7.2 (renderWater 水面) · Step 8.1 (Decals/Transparent)
               ├── Step 8.5 (BehindBuildingMarkers ZFunc=Greater & StaticSort4..1) · Step 9.1 & 9.2 (Particles & Lines)
               └── Step 10.2 (PostEffectDistortion 借用主场景深度遮挡 Distorter 0/1 与扭曲激光!)
```
