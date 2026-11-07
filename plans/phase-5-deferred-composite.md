# Phase 5：全屏延迟主光照合成（太阳、阴影、IBL 与前向残余兼容）

> **阶段目标**：编写全屏光照合成着色器 `DeferredComposite.fx`，在 `FrameRenderTarget`（FP16 HDR `A16B16G16R16F`）上对 G-Buffer 中标记为延迟着色的像素执行单次完整 PBR 计算：主太阳光 Cook-Torrance/GGX 高光与漫反射、4-tap PCF 屏幕空间软阴影、动态云影、战争迷雾、自发光叠加，以及环境漫反射 IBL（辐照度立方体）与镜面反射 IBL（预滤波环境 Cube）；正式将主渲染输出切换至延迟分支，对未迁移材质保留安全的前向残余兼容；通过实机验证后定稿决策门 DG-4（环境图空间裁定）。
> **前置**：DG-3（P4-T15 ✅）已确认全场景不透明覆盖率达标，RT3 深度已接管。
> **阶段出口**：P5-T11 USER-RUN 通过，DG-4 裁定定稿，P5-T12 知识回写完成。

---

### P5-T01 全屏延迟光照合成框架与 Quad 流程
- **执行者**：agent　**规模**：M　**依赖**：P4-T15
- **目标**：创建 `main/fx/DeferredComposite.fx` 并配置 `main/ingame.scrapeo` 中的全屏 Quad 调度过程 `renderDeferredComposite`。
- **前置条件**：G-Buffer 4 份 MRT 与深度正常更新。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §2.5、§4.4；`plans/README.md` D10；`pass-templates.md` §2.3。
- **步骤**：
  1. 新建 `main/fx/DeferredComposite.fx`，引入 `#define GBUFFER_READ` 与 `#include "GBUFFER.FXH"`。
  2. 实现 VS：输出全屏 Quad 顶点，并计算视空间/世界空间视线角向量 `GB_FullscreenRayWS`。
  3. 实现基础 PS 框架：采样 G-Buffer，使用 `GB_IsDeferredPixel` 判断：
     - 若为延迟像素，根据 RT3 深度与视线重建世界坐标 `worldPos`，解码世界法线、反照率、粗糙度与金属度；
     - 若非延迟像素（前向残余），直接透传 `rt0.rgb`（依据 D19，已是前向光照结果）或输出黑色。
  4. 在 `main/ingame.scrapeo` 中编写 `renderDeferredComposite`：
     - `setdepth NULL`
     - `settarget 0 FrameRenderTarget`
     - `setshader DeferredComposite CompositeDefault`
     - `renderquad`
     - 恢复状态。
  5. 将 `renderDeferredComposite` 挂载在主帧原版不透明绘制之后、`updateWaterRefraction` 之前。
- **产出文件**：`main/fx/DeferredComposite.fx`、`main/ingame.scrapeo`。
- **验证**：检查器 0 警告；Shader 编译通过。
- **验收标准**：全屏 Quad 能够稳定渲染至 FP16 主缓冲；世界坐标重建无拉伸。
- **失败处理 / 决策映射**：若画面出现全屏黑屏，检查当前绑定的深度缓冲是否正确置空（全屏 Quad 必须 `setdepth NULL`）。
- **知识回写**：无。

---

### P5-T02 屏幕空间软阴影与云影整合
- **执行者**：agent　**规模**：M　**依赖**：P5-T01
- **目标**：在 `DeferredComposite.fx` 中整合软阴影计算，利用从 G-Buffer 重建的世界坐标计算太阳投影与 4-tap PCF 软阴影，并叠加密度动态云影。
- **前置条件**：P5-T01 框架跑通；太阳阴影贴图正常更新。
- **必读上下文**：`FXFXH/FXscreenSpaceShadow.fx`；`COMMON.FXH`（`ShadowMapWorldToShadow` 矩阵与 `ShadowMapTexture` 采样器）。
- **步骤**：
  1. 引入太阳阴影矩阵 `ShadowMapWorldToShadow` 与阴影贴图采样器（`s0` / `ShadowMapSampler`）。
  2. 实现 4-tap PCF 软阴影函数：将重建的世界坐标投影至阴影坐标系，计算 4 邻域深度对比平均值（`shadowTerm`）。
  3. 引入云影贴图 `Terrain.Cloud.Texture`，使用 `worldPos.xz * CloudScale + Time * CloudSpeed` 计算云影遮罩 `cloudTerm`。
  4. 综合阴影因子：`finalShadow = shadowTerm * cloudTerm`，作用于后续直射光计算。
- **产出文件**：`main/fx/DeferredComposite.fx`。
- **验证**：编译并反汇编，检查采样指令与循环展开。
- **验收标准**：阴影边缘平滑柔和，云影随时间平移无抖动。
- **失败处理 / 决策映射**：若阴影产生自遮挡粉刺（Shadow Acne），增加微小的深度偏移量（Depth Bias）。
- **知识回写**：无。

---

### P5-T03 主太阳光 PBR（Cook-Torrance / GGX 直接光照）
- **执行者**：agent　**规模**：M　**依赖**：P5-T02
- **目标**：实现物理精确的主太阳平行光直接光照计算（GGX 法线分布、Smith-Schlick 几何遮蔽、Schlick 菲涅尔）。
- **前置条件**：P5-T02 完成。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §5；`corona-pbr-ibl-notes.md` §3。
- **步骤**：
  1. 引入太阳光方向与颜色（`DirectionalLight[0]`）。
  2. 计算半角向量 $H = \text{normalize}(L + V)$，计算 $N \cdot L$, $N \cdot V$, $N \cdot H$, $V \cdot H$。
  3. 实现 GGX 分布项 $D$ 与 Smith 几何遮蔽项 $G$。
  4. 实现菲涅尔项 $F$：基础反射率 $F_0 = \text{lerp}(0.04, \text{albedo}, \text{metalness})$。
  5. 计算镜面高光 $Specular = \frac{D \cdot G \cdot F}{4(N \cdot L)(N \cdot V) + 0.001}$。
  6. 计算漫反射 $Diffuse = (1 - F) \cdot (1 - \text{metalness}) \cdot \frac{\text{albedo}}{\pi}$。
  7. 太阳直接光贡献：$(Diffuse + Specular) \cdot \text{SunColor} \cdot (N \cdot L) \cdot finalShadow$。
- **产出文件**：`main/fx/DeferredComposite.fx`。
- **验证**：反编译汇编，确认未超 ps_3_0 指令槽（GGX 在 SM3 下约需 35–45 槽）。
- **验收标准**：金属与非金属在阳光照射下的高光与漫反射表现符合 PBR 能量守恒定律。
- **失败处理 / 决策映射**：若高光出现白色亮点过曝或 NaN，在分母中加入极小保护量 $\epsilon = 1e-4$。
- **知识回写**：无。

---

### P5-T04 漫反射 IBL 与辐照度立方体整合
- **执行者**：agent　**规模**：M　**依赖**：P5-T03
- **目标**：为延迟着色像素叠加环境漫反射 IBL（采用日冕 Mod 验证成熟的辐照度立方体 `PbrIrradianceTexture` 或环境图低频球谐）。
- **前置条件**：P5-T03 就绪。
- **必读上下文**：`corona-pbr-ibl-notes.md` §2；`COMMON.FXH`。
- **步骤**：
  1. 引入辐照度立方体采样器 `PbrIrradianceSampler`（或原版 `LightSpaceEnvironmentMap`）。
  2. 根据世界法线向量 $N$ 采样辐照度立方体，获取环境漫反射光强 $E_{diff}$。
  3. 漫反射环境贡献：$AmbientDiffuse = E_{diff} \cdot \text{albedo} \cdot (1 - \text{metalness}) \cdot AO$。
  4. 保持与原版补光（`DirectionalLight[1..2]` 与 `AmbientLightColor`）平滑过渡。
- **产出文件**：`main/fx/DeferredComposite.fx`。
- **验证**：编译通过无报错。
- **验收标准**：背阴面拥有来自天空与地面的环境漫反射冷暖天光，不再是死黑。
- **失败处理 / 决策映射**：若辐照度立方体未开启，回退使用环境光三色梯度（Sky/Equator/Ground）估算。
- **知识回写**：无。

---

### P5-T05 镜面反射 IBL 与预滤波环境图
- **执行者**：agent　**规模**：M　**依赖**：P5-T04
- **目标**：实现基于粗糙度的镜面反射 IBL 计算（Split-Sum 近似：`texCUBElod` 粗糙度 Mip 采样 + Karis/EnvDFG 烘焙多项式拟合）。
- **前置条件**：P5-T04 完成。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §5.2；`corona-pbr-ibl-notes.md` §3.3。
- **步骤**：
  1. 计算世界反射向量 $R = \text{reflect}(-V, N)$。
  2. 根据粗糙度计算 Mip 级别：`mipLevel = roughness * 7.0`。
  3. 使用 `texCUBElod` 采样预滤波环境图（`EnvironmentSampler`），获得预滤波环境颜色 $PrefilteredColor$。
  4. 计算环境 BRDF 拟合因子（Karis 移动端解析多项式或日冕 `EnvDFGPolynomial`）：
     $EnvBRDF = F_0 \cdot scale + bias$。
  5. 镜面环境贡献：$AmbientSpecular = PrefilteredColor \cdot EnvBRDF \cdot AO$。
- **产出文件**：`main/fx/DeferredComposite.fx`。
- **验证**：汇编检查 `texldl` 采样器指令格式。
- **验收标准**：光滑金属呈现清晰天空反射，粗糙非金属呈现漫散模糊高光。
- **失败处理 / 决策映射**：若部分旧显卡不支持 CubeLod，使用三线性插值采样相邻 Mip 模拟。
- **知识回写**：无。

---

### P5-T06 战争迷雾、自发光与阵营色重着色
- **执行者**：agent　**规模**：S　**依赖**：P5-T05
- **目标**：将战争迷雾（黑雾与半透明探路迷雾）、自发光通道（`RT2.a`）以及特殊阵营重着色叠加至主光照结果中。
- **前置条件**：P5-T05 完成。
- **必读上下文**：`main/COMMON.FXH`（`Terrain.Shroud.Texture`）；`plans/README.md` D3。
- **步骤**：
  1. 引入迷雾纹理 `Terrain.Shroud.Texture`，使用 `worldPos.xz` 采样获取迷雾因子 `shroudAlpha`。
  2. 提取 `RT2.a` 自发光强度，乘以反照率恢复彩色自发光：`emissiveColor = albedo * rt2.a * EmissiveBoost`。
  3. 总输出颜色：`finalColor = (DirectLight + AmbientIBL + emissiveColor) * shroudAlpha`。
  4. 输出至 `FrameRenderTarget`（FP16 HDR）。
- **产出文件**：`main/fx/DeferredComposite.fx`。
- **验证**：编译通过。
- **验收标准**：未探索区域呈现漆黑迷雾；单位指示灯在黑暗中亮起自发光。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P5-T07 材质特殊类别分支与前向降级显示
- **执行者**：agent　**规模**：S　**依赖**：P5-T06
- **目标**：根据 `RT1.a` 解码的材质类别（Class 0 标准 PBR、Class 1 皮肤次表面、Class 2 无光照、Class 3 前向降级），在合成阶段执行精确分支着色。
- **前置条件**：P5-T06 完成。
- **必读上下文**：`plans/README.md` D19；`GBUFFER.FXH`。
- **步骤**：
  1. 解码类别：`float matClass = GB_DecodeClass(rt1)`。
  2. Class 1（皮肤次表面）：在漫反射中加入微量环形光（Wrap Lighting）模拟步兵透光。
  3. Class 2（无光照）：直接输出 `albedo`，跳过所有太阳与 IBL。
  4. Class 3 或未移植标记像素：直接透传 `rt0.rgb`（降级保持原版前向光照），保证视觉不崩。
- **产出文件**：`main/fx/DeferredComposite.fx`。
- **验证**：编译通过。
- **验收标准**：各类别材质呈现对应着色特性；未移植物体平滑过渡。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P5-T08 决策门 DG-4：环境图空间裁定
- **执行者**：lead-review　**规模**：S　**依赖**：P5-T07
- **目标**：在实机中对比原版太阳旋转空间（`Objects.LightSpaceEnvironmentMap`）与日冕未旋转空间（`MapEnvironment`），最终裁定全管线环境图基准。
- **前置条件**：合成 Shader 已具备两套环境空间采样能力。
- **必读上下文**：`corona-pbr-ibl-notes.md` §4；`knowledge/open-questions.md` OQ-12。
- **步骤**：
  1. 编译两套配置并在相同场景下测试。
  2. 观察相机旋转与阳光变动时，车辆表面反射天空盒是否产生异常翻转或偏角。
  3. 签署决策：若原版太阳旋转坐标在全屏 Quad 下矩阵正确，采纳原版空间以维持原画风；否则采纳日冕未旋转空间。
- **产出文件**：更新 `plans/README.md` 中的 DG-4 状态为 ✅。
- **验证**：决策记录完整。
- **验收标准**：DG-4 状态更新为 ✅。
- **失败处理 / 决策映射**：无。
- **知识回写**：更新 `dictionaries/engine-ground-truth.md`。

---

### P5-T09 前向残余 Pass 隔离与 Stencil 剔除
- **执行者**：agent　**规模**：M　**依赖**：P5-T08
- **目标**：在原版前向主帧绘制中开启 Stencil 过滤，跳过已在延迟阶段完成光照的几何像素，消除 Overdraw。
- **前置条件**：DG-4 ✅。
- **必读上下文**：`plans/README.md` D4；`pitfalls.md` §4。
- **步骤**：
  1. 在 `main/ingame.scrapeo` 的主前向绘制段（原版 `UpdateFrameBuffer` 内部）：
  2. 设置 Stencil 测试状态：仅允许 `StencilRef != 128` 的像素通过深度与颜色写入。
  3. 使得已写入 Stencil bit 7 的不透明像素在后续前向 Pass 中被硬件直接剔除（Early-Z / Early-Stencil）。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：前向不透明物体的 Overdraw 大幅降低；延迟与前向物体交接处无闪烁。
- **失败处理 / 决策映射**：若某些显卡驱动在切换 RT 后丢失 Stencil 状态，通过 SCRAPE 显式重新绑定 `DepthBuffer`。
- **知识回写**：无。

---

### P5-T10 正式切换延迟主光照输出
- **执行者**：agent　**规模**：S　**依赖**：P5-T09
- **目标**：在 `main/ingame.scrapeo` 中正式将 `Deferred.IsActive` 默认激活，将主帧不透明视觉输出彻底切换为延迟光照合成结果。
- **前置条件**：P5-T09 完成。
- **必读上下文**：`pass-templates.md` §2.3；`plans/README.md` D5。
- **步骤**：
  1. 配置 `configureDeferredFlags`：在 HDR 开启且无 AA 时，将 `Deferred.IsEnabled` 设为 `true`。
  2. 确保 `FrameRenderTarget`（FP16 HDR）平滑向下游的 `PostFX`（Distortion/Bloom/LUT）传递。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：游戏主画面由延迟管线完全主导输出。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P5-T11 USER-RUN：主光照、阴影、IBL 与前向兼容实机 A/B 对比
- **执行者**：agent（打包/记录）+ USER-RUN　**规模**：L　**依赖**：P5-T10
- **目标**：在游戏实机中对延迟主光照效果进行全面的视觉与性能 A/B 对比评测。
- **前置条件**：构建包就绪。
- **必读上下文**：`tests/scenes.md`（GS-01 白昼，GS-02 夜景，GS-05 大规模部队交火）。
- **步骤**：
  1. 生成构建包，提供 A（原版正向 `Deferred.IsEnabled=false`）与 B（延迟渲染 `Deferred.IsEnabled=true`）两组模式。
  2. 编写测试脚本 `tests/user-run/P5-T11.md`。
  3. 用户进入测试场景：
     - 白昼场景（GS-01）：观察阳光直射、阴影软化过渡、树影与建筑阴影遮蔽；
     - 金属反射：观察各阵营坦克炮管与装甲板的高光反光质感；
     - 夜景场景（GS-02）：观察无直射光区域的环境漫反射与单位自发光；
     - 战争迷雾：观察迷雾边缘淡入淡出与黑雾完全遮蔽；
     - 性能：在大规模交火（GS-05）下对比帧率与 GPU 占用，验证延迟管线消除 Overdraw 的优势。
  4. 整理测试报告至 `tests/results/P5-T11.md`。
- **产出文件**：`tests/user-run/P5-T11.md`、`tests/results/P5-T11.md`。
- **验证**：实机截图与对比视频/数据记录。
- **验收标准**：PBR 视觉表现显著超越原版，无破音、无黑屏崩溃，Overdraw 明显改善。
- **失败处理 / 决策映射**：若背光处过暗，调整 IBL 漫反射强度包络。
- **知识回写**：记录实测数据至 `dictionaries/engine-ground-truth.md`。

---

### P5-T12 Phase 5 知识回写与清理
- **执行者**：agent　**规模**：S　**依赖**：P5-T11
- **目标**：执行 PK-T01 回写流程，固化延迟光照合成参数，更新技术文档与进度看板。
- **前置条件**：P5-T11 验收通过。
- **必读上下文**：`plans/phase-K-knowledge-maintenance.md`。
- **步骤**：
  1. 更新 `knowledge/deferred-techniques-sm3.md` 中关于 D3D9 全屏 Quad PBR 的实操参数。
  2. 更新 `dictionaries/engine-ground-truth.md` 中关于 HDR 合成与 Stencil 剔除的实测结论。
  3. 更新 `plans/task-board.md`。
- **产出文件**：相关知识文档与看板。
- **验证**：git diff 检查。
- **验收标准**：文档更新清晰完备。
- **失败处理 / 决策映射**：无。
- **知识回写**：本任务即回写任务。
