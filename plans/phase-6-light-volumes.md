# Phase 6：无数量上限 PBR 局域体积光（点光源、聚光灯与激光体积）

> **阶段目标**：升级局域体积光系统，彻底突破原版引擎「单个模型最多接收 8 个动态光源」的硬限制；采用**背面剔除 CCW + GREATEREQUAL 深度测试 + ONE/ONE 加法混合**架构，免疫相机穿入光球内部的近裁切失效；基于 G-Buffer 法线与粗糙度计算精确 PBR 光照与物理距离平方衰减；将光体积 Mesh 挂载于空闲队列 `StaticSort_END`，并在 `DeferredComposite` 之后、`updateWaterRefraction` 之前提交（使水面折射能够正确反射岸边光影）；定稿决策门 DG-5 与 DG-6。
> **前置**：Phase 5 主光照合成已就绪（P5-T11 ✅）。
> **阶段出口**：P6-T07 USER-RUN 通过，DG-5/DG-6 定稿，P6-T08 知识回写完成。

---

### P6-T01 局域光体积剔除面与深度测试探针
- **执行者**：agent　**规模**：M　**依赖**：P5-T11
- **目标**：编写探针 Shader 与轻量测试 Mesh，在游戏实机中检验 `CullMode = CCW` 与 `ZFunc = GREATEREQUAL` 下光体积绘制的面朝向，实机确认顺逆时针绕序与相机穿入时的视觉连贯性。
- **前置条件**：主光照稳定。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §4.1；`knowledge/open-questions.md` OQ-08、OQ-11。
- **步骤**：
  1. 新建 `main/fx/probe/probe_light_volume.fx`。
  2. 实现两种技术：
     - `TechBack`：`CullMode = CW`（剔除正面，保留背面），`ZFunc = GREATEREQUAL`，`ZWriteEnable = FALSE`；
     - `TechFront`：`CullMode = CCW`（剔除背面，保留正面），`ZFunc = LESSEQUAL`，`ZWriteEnable = FALSE`。
  3. 在 PS 中输出纯亮绿色。
  4. 验证当相机推近光球中心、甚至相机穿入球体内部时，`TechBack` 是否保持完整光斑且无任何近截面破洞。
- **产出文件**：`main/fx/probe/probe_light_volume.fx`。
- **验证**：编译通过无报错。
- **验收标准**：理论与汇编确认状态块符合 D3D9 规范。
- **失败处理 / 决策映射**：若 CCW 剔除的是背面而非正面，根据 D3D9 坐标系约定立即修正为 `CullMode = CW`。
- **知识回写**：更新 `dictionaries/engine-ground-truth.md`。

---

### P6-T02 局域点光源着色器 `DeferredPointLight.fx` 升级
- **执行者**：agent　**规模**：M　**依赖**：P6-T01
- **目标**：升级 `FXFXH/FXdeferredpointlight.FX`，弃用原版无奈的导数法线 `cross(ddy, ddx)`，改为直接采样 G-Buffer RT1 世界法线、RT0 反照率与 RT2 粗糙度/金属度，计算完整 PBR 直接光照。
- **前置条件**：P6-T01 验证通过。
- **必读上下文**：`FXFXH/FXdeferredpointlight.FX`；`GBUFFER.FXH`；`deferred-techniques-sm3.md` §4.1。
- **步骤**：
  1. 打开/重构 `main/fx/DeferredPointLight.fx`，引入 `#define GBUFFER_READ` 与 `#include "GBUFFER.FXH"`。
  2. VS 输出球体顶点在屏幕空间的投影坐标 `vpos` 与世界坐标。
  3. PS 使用 `GB_ScreenUVFromVPos(vpos)` 采样 G-Buffer：
     - 解码目标像素的实际世界坐标 `surfacePos`、法线 $N$、反照率与粗糙度；
     - 计算光线向量 $L = \text{LightPos} - surfacePos$，距离 $d = \text{length}(L)$；
     - **提前裁剪**：`clip(LightRadius * LightRadius - d * d);`，直接丢弃球体外部几何；
     - 物理距离平方衰减：$Atten = \text{saturate}(1.0 - (d / \text{LightRadius})^2)^2 / (d^2 + 1.0)$；
     - 计算 Cook-Torrance GGX 点光源高光与漫反射；
     - 输出加法光强：$PointLightColor \cdot (Diffuse + Specular) \cdot Atten$。
  4. 状态块配置：`AlphaBlendEnable = TRUE; SrcBlend = ONE; DestBlend = ONE; ZWriteEnable = FALSE;`。
- **产出文件**：`main/fx/DeferredPointLight.fx`。
- **验证**：反编译汇编，确认未超 ps_3_0 指令槽上限。
- **验收标准**：点光与几何体交界处无明显棱面感，法线贴图细节清晰，距离平滑衰减至零。
- **失败处理 / 决策映射**：半像素偏移严格使用 `GB_ScreenUVFromVPos`，防止原版硬编码 `4096` 导致的错位。
- **知识回写**：无。

---

### P6-T03 聚光灯与定向激光体积着色器 `DeferredSpotLight.fx`
- **执行者**：agent　**规模**：M　**依赖**：P6-T02
- **目标**：编写锥体与圆柱体体积光着色器 `DeferredSpotLight.fx`，支持路灯投射聚光灯与激光武器定向照射。
- **前置条件**：P6-T02 完成。
- **必读上下文**：`deferred-techniques-sm3.md` §4.2。
- **步骤**：
  1. 新建 `main/fx/DeferredSpotLight.fx`，引入 `#include "GBUFFER.FXH"`。
  2. 传入聚光灯方向向量 `SpotDirection`、内角余弦 `cosInner` 与外角余弦 `cosOuter`。
  3. 在 PS 中计算光线与聚光灯主轴夹角，应用角度平滑衰减：`saturate((dot(-L, SpotDirection) - cosOuter) / (cosInner - cosOuter))`。
  4. 采用同样的背面剔除与加法混合渲染圆锥体网格。
- **产出文件**：`main/fx/DeferredSpotLight.fx`。
- **验证**：编译通过无报错。
- **验收标准**：圆锥体聚光灯呈现清晰边界与柔和外圈衰减。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P6-T04 SCRAPE 挂载队列打通（`StaticSort_END` 队列提交）
- **执行者**：agent　**规模**：M　**依赖**：P6-T03
- **目标**：在 `main/ingame.scrapeo` 中配置局域光体积的渲染提交，将其放置在 `renderDeferredComposite` 紧接着的下一步，且在 `updateWaterRefraction` 之前。
- **前置条件**：Shader 编译就绪。
- **必读上下文**：`dictionaries/renderbin-dict.md`（StaticSort_END 编号 41）；`pass-templates.md` §2.4。
- **步骤**：
  1. 在 `main/fx/DeferredPointLight.fx` 与 `DeferredSpotLight.fx` 中声明：
     `string RenderBin = "StaticSort_END";`
  2. 在 `main/ingame.scrapeo` 中创建过程 `renderDeferredLightsPass`：
     - `setdepth DepthBuffer`（需要深度测试）
     - `settarget 0 FrameRenderTarget`（直接累加至 FP16 HDR 主缓冲）
     - `setcamera Viewer`
     - `visibleobjects Frame`
     - `renderbin StaticSort_END 0`
     - 恢复状态。
  3. 将 `renderDeferredLightsPass` 插入主时序中（`renderDeferredComposite` 之后、`updateWaterRefraction` 之前）。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告；行长合规。
- **验收标准**：`renderbin StaticSort_END 0` 被成功调度且无崩溃。
- **失败处理 / 决策映射**：若 `StaticSort_END` 引擎不处理，回退至借用未使用的 `StaticSort4` 或 `StaticSort3`。
- **知识回写**：更新 `dictionaries/engine-ground-truth.md`。

---

### P6-T05 引擎原生点光源探测与代理体积转换
- **执行者**：agent　**规模**：M　**依赖**：P6-T04
- **目标**：针对 OQ-11，评估能否将引擎每 Draw 提交至 `c89..c112` 的原生 8 点光源数据转换为延迟光照（或采用代理网格自动生成机制）。
- **前置条件**：P6-T04 跑通。
- **必读上下文**：`knowledge/open-questions.md` OQ-11；`register-sas-contract.md` §3。
- **步骤**：
  1. 分析引擎在主帧对单位开火火光、爆炸光照的 `PointLight[8]` 注入机制。
  2. 若引擎仅向模型网格传递点光，探索：
     - 方案 A（代理体积物）：通过 INI 脚本在爆炸处生成携带光体积 Shader 的不可见代理球体模型；
     - 方案 B（G-Buffer PS 预累积）：在材质 G-Buffer PS 阶段直接预累加该 8 个光源的低频漫反射并写入自发光或反照率通道；
     - 方案 C（前向保留）：在延迟合成之后，对极少数爆炸特效保留正向叠加。
  3. 编写对应测试原型并对比可行性。
- **产出文件**：测试配置与原型文档。
- **验证**：实机测试爆炸火光。
- **验收标准**：夜景交火中单位开火与爆炸具有强烈的动态光感。
- **失败处理 / 决策映射**：若方案 A 生成代理物极为便捷，优先确立方案 A 为社区 Mod 标准。
- **知识回写**：更新 OQ-11 结论。

---

### P6-T06 决策门 DG-5 与 DG-6：光体积队列与光源代理机制定稿
- **执行者**：lead-review　**规模**：S　**依赖**：P6-T05
- **目标**：定稿局域光体积的提交队列（DG-5）与动态火光爆炸代理转换机制（DG-6）。
- **前置条件**：P6-T05 原型测试就绪。
- **必读上下文**：`plans/README.md` DG-5、DG-6。
- **步骤**：
  1. 确认 `StaticSort_END` 队列在游戏实机中稳定无任何负面副作用（DG-5 ✅）。
  2. 确认动态点光源处理方案（DG-6 落地为方案 A、B 或 C）。
  3. 签署决策门。
- **产出文件**：更新 `plans/README.md` 中的 DG-5 与 DG-6 状态为 ✅。
- **验证**：决策记录完整。
- **验收标准**：DG-5/DG-6 状态更新为 ✅。
- **失败处理 / 决策映射**：无。
- **知识回写**：更新 `dictionaries/engine-ground-truth.md`。

---

### P6-T07 USER-RUN：百级局域光源同屏压力测试与夜景视觉验证
- **执行者**：agent（打包/记录）+ USER-RUN　**规模**：L　**依赖**：P6-T06
- **目标**：在游戏实机中布置上百个点光源体积，验证性能开销、水面折射可见性以及相机穿梭连贯性。
- **前置条件**：构建包就绪。
- **必读上下文**：`tests/scenes.md`（GS-02 夜景大地图，GS-07 光源极限压力测试）。
- **步骤**：
  1. 生成测试构建包，包含测试地图与密集点光源配置。
  2. 编写测试脚本 `tests/user-run/P6-T07.md`。
  3. 用户进入测试场景：
     - 数量突破验证：同屏观察 50–100 个路灯与激光束，确认不再产生原版「超过 8 个光源时闪烁断层」的现象；
     - 跨几何照射：观察一个大范围点光源同时照亮地面、桥梁、坦克装甲与建筑物墙面，接缝处完全自然连续；
     - 水面折射可见性：站在海边观察沿岸路灯与开火光照，确认岸上被局域光照亮的地面能否正确映射在浅水折射中；
     - 相机穿透：将镜头直接拉近并穿入某个路灯光球内部，确认光照保持完整、无瞬间黑屏闪烁；
     - 帧率评估：记录帧率与 GPU 占用。
  4. 整理测试报告至 `tests/results/P6-T07.md`。
- **产出文件**：`tests/user-run/P6-T07.md`、`tests/results/P6-T07.md`。
- **验证**：实机截图、录屏与性能数据。
- **验收标准**：无闪烁、无断层、水面折射正常可见局域光、相机穿透无异常、帧率表现平稳。
- **失败处理 / 决策映射**：若某些显卡在大量光球重叠时 Fillrate 压力过大，在 PS 中收紧裁剪半径。
- **知识回写**：记录实测数据至 `dictionaries/engine-ground-truth.md`。

---

### P6-T08 Phase 6 知识回写与清理
- **执行者**：agent　**规模**：S　**依赖**：P6-T07
- **目标**：执行 PK-T01 回写流程，固化局域光体积算法与管线集成规范。
- **前置条件**：P6-T07 验收通过。
- **必读上下文**：`plans/phase-K-knowledge-maintenance.md`。
- **步骤**：
  1. 更新 `.agents/skills/ra3-fx-shader/references/fxfxh-architecture.md` 中关于体积光的生产标准。
  2. 更新 `dictionaries/engine-ground-truth.md` 中关于光体积与队列提交的条目。
  3. 更新 `plans/task-board.md`。
- **产出文件**：相关知识文档与看板。
- **验证**：git diff 检查。
- **验收标准**：文档更新清晰完备。
- **失败处理 / 决策映射**：无。
- **知识回写**：本任务即回写任务。
