# Phase 4：全场景不透明材质家族迁移与深度链合并

> **阶段目标**：依据 `material-family-inventory.md`，将 RA3 的全部核心不透明材质家族（载具、建筑、步兵/硬软蒙皮、植被风吹、道路桥梁、地形底图与叠加层）系统性地迁移至 G-Buffer；处理地形叠加层 MRT 混合风险（DG-T 落地）；正式将 G-Buffer RT3（`viewPos.z`）接管绑定为 `WW3D.DepthTexture`；在延迟分支停用原版整场重画的 `updateDepthMap` 与 `PostFX_LinearDepth`，达成关键的显存与几何遍历优化；通过实机验收后定稿决策门 DG-3（不透明覆盖率达标）。
> **前置**：DG-2（P3-T07 ✅）已冻结 G-Buffer 编码规范与布局。
> **阶段出口**：P4-T14 USER-RUN 通过，DG-3 达标，P4-T16 知识回写完成。

---

### P4-T01 载具家族（三阵营与中立载具）迁移
- **执行者**：agent　**规模**：M　**依赖**：P3-T07
- **目标**：为所有载具着色器（`objectssu.fx`, `objectsjapan.fx`, `objectsneutral.fx`, `objectscivilian.fx`, `objectsalliedtreads.fx` 等）接入 G-Buffer technique。
- **前置条件**：`main/fx/GBUFFER.FXH` 稳定。
- **必读上下文**：`material-family-inventory.md`（Objects 家族）；`plans/README.md` D3、D4。
- **步骤**：
  1. 遍历载具着色器列表，引入 `#include "GBUFFER.FXH"`。
  2. 实现各自顶点变换（履带滚动 UV 偏移变换、蒙皮支持）。
  3. 实现 PS：计算基础反照率、阵营色遮罩替换、法线凹凸映射、粗糙度与金属度编码，调用 `GB_Encode`。
  4. 声明 technique 状态块，开启 Stencil bit 7 写入，禁用硬件 AlphaBlend/AlphaTest。
- **产出文件**：`main/fx/objectssu.fx`, `main/fx/objectsjapan.fx`, `main/fx/objectsneutral.fx` 等。
- **验证**：一键编译全部载具 Shader，确认 0 错误。
- **验收标准**：所有载具 Shader 正确注册 GBuffer technique；指令数均在 ps_3_0 上限以内。
- **失败处理 / 决策映射**：若某些载具缺少法线贴图，自动使用几何顶点法线生成切线空间单位向量。
- **知识回写**：无。

---

### P4-T02 建筑家族（三阵营建筑、破损贴图与纳米建造）迁移
- **执行者**：agent　**规模**：M　**依赖**：P4-T01
- **目标**：为三阵营建筑着色器（`buildingsallied.fx`, `buildingssoviet.fx`, `buildingsjapan.fx`）接入 G-Buffer technique，处理破损贴图叠加与帝国纳米建造镂空裁剪。
- **前置条件**：P4-T01 完成。
- **必读上下文**：`material-family-inventory.md`（Buildings 家族）；`head2buildings.fxh`。
- **步骤**：
  1. 引入 `#include "GBUFFER.FXH"`。
  2. 支持 `SUPPORT_DAMAGETEXTURE`：在 PS 中根据 Damage 状态混合破损与燃烧焦黑贴图。
  3. 支持帝国纳米建造（`hp_nano_build`）：根据建造进度网格遮罩执行 `clip(nanoMask - progress)` 镂空丢弃。
  4. 声明建筑 G-Buffer technique 状态块。
- **产出文件**：`main/fx/buildingsallied.fx`, `main/fx/buildingssoviet.fx`, `main/fx/buildingsjapan.fx`。
- **验证**：编译通过无报错。
- **验收标准**：建造裁剪与破损逻辑在 G-Buffer PS 中正确转换为 `clip()`；无硬件 AlphaTest 残留。
- **失败处理 / 决策映射**：若纳米建造遮罩边缘锯齿明显，确认 UV 采样器过滤模式为 Linear。
- **知识回写**：无。

---

### P4-T03 步兵与基础 W3D 家族（双流蒙皮与多骨骼变换）迁移
- **执行者**：agent　**规模**：M　**依赖**：P4-T02
- **目标**：为步兵与基础模型 Shader（`basicw3d*.fx`, `defaultw3d*.fx`, `infantry*.fx`）接入 G-Buffer technique，严格支持双顶点流（POSITION0/POSITION1）与 0/1/2 bone 蒙皮。
- **前置条件**：P4-T02 完成。
- **必读上下文**：`material-family-inventory.md`（BasicW3D 家族蒙皮数组与流约定）。
- **步骤**：
  1. 引入 `#include "GBUFFER.FXH"`。
  2. 实现支持 3 元素着色器数组的 VS 变体（对应 0、1、2 骨骼变换，dual stream 混合）。
  3. 实现 PS：处理步兵皮肤次表面标记（材质类别 Class 1）；处理阵营色与自发光。
  4. 声明 G-Buffer technique 状态块。
- **产出文件**：`main/fx/basicw3d*.fx`, `main/fx/infantry*.fx` 等。
- **验证**：编译所有变体，检查指令槽位。
- **验收标准**：骨骼矩阵索引在 `vs c128..c255` 范围以内；双流顶点结构体完美对齐。
- **失败处理 / 决策映射**：若骨骼变换在部分显卡上出现网格爆炸，核对顶点着色器输入声明语义。
- **知识回写**：无。

---

### P4-T04 树木与动态植被家族（风吹摆动与枝叶 Alpha 裁剪）迁移
- **执行者**：agent　**规模**：M　**依赖**：P4-T03
- **目标**：为动态树木材质 `TreeSway.fx` 接入 G-Buffer，保持顶点世界风吹摆动计算并在 PS 中以 `clip()` 处理枝叶镂空。
- **前置条件**：P4-T03 完成。
- **必读上下文**：`material-family-inventory.md`（TreeSway.fx）；`head1treesway.fxh`。
- **步骤**：
  1. 引入 `#include "GBUFFER.FXH"`。
  2. 移植 `TreeSway` 顶点风力扰动公式（利用世界时间与顶点颜色/高度系数进行正弦/余弦位移），并重新计算摆动后的世界法线。
  3. PS 执行 `clip(alpha - Cutoff)` 丢弃空气像素；输出植被反照率与粗糙度。
  4. 声明 G-Buffer technique。
- **产出文件**：`main/fx/TreeSway.fx`。
- **验证**：编译通过无报错。
- **验收标准**：树木摆动顶点逻辑保留；镂空无黑边残留。
- **失败处理 / 决策映射**：若风吹法线不随位移旋转，补齐切线基正交化。
- **知识回写**：无。

---

### P4-T05 道路与桥梁家族（Roads / Bridge）迁移
- **执行者**：agent　**规模**：S　**依赖**：P4-T04
- **目标**：为道路与桥梁材质（`Roads.fx`, `ObjectsRoads.fx`, `Bridge.fx`）接入 G-Buffer technique。
- **前置条件**：P4-T04 完成。
- **必读上下文**：`material-family-inventory.md`（Roads/Bridge 家族）。
- **步骤**：
  1. 引入 `#include "GBUFFER.FXH"`。
  2. 编写 VS/PS：处理道路贴地绘制（贴地 Depth Bias 或标准世界变换），输出沥青/泥土材质参数与法线。
  3. 声明 G-Buffer technique 状态块。
- **产出文件**：`main/fx/Roads.fx`, `main/fx/ObjectsRoads.fx`, `main/fx/Bridge.fx`。
- **验证**：编译通过。
- **验收标准**：0 警告，技术名正确导出。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P4-T06 悬崖与地形道具家族（ObjectsTerrain）迁移
- **执行者**：agent　**规模**：S　**依赖**：P4-T05
- **目标**：为悬崖、海墙与地形物体材质（`ObjectsTerrain.fx`, `TerrainLikeGroundObject`）接入 G-Buffer technique。
- **前置条件**：P4-T05 完成。
- **必读上下文**：`material-family-inventory.md`（ObjectsTerrain）。
- **步骤**：
  1. 引入 `#include "GBUFFER.FXH"`。
  2. 实现 VS/PS：处理悬崖立面三向投影或 UV 映射，输出岩石法线与高粗糙度参数。
  3. 声明 G-Buffer technique。
- **产出文件**：`main/fx/ObjectsTerrain.fx`。
- **验证**：编译通过。
- **验收标准**：悬崖模型在 G-Buffer 模式下输出正常岩石参数。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P4-T07 地形底图基础瓦片（TerrainTile）迁移
- **执行者**：agent　**规模**：M　**依赖**：P4-T06
- **目标**：为 `Terrain.fx` 的基础不透明瓦片 Pass（`TerrainTile*`）接入 G-Buffer 写入，输出全地图地面基础 Albedo、法线与深度。
- **前置条件**：P4-T06 完成。
- **必读上下文**：`material-family-inventory.md`（Terrain.fx 结构）；`plans/README.md` D16。
- **步骤**：
  1. 打开 `main/fx/Terrain.fx`，引入 `#include "GBUFFER.FXH"`。
  2. 为基础不透明瓦片（`TerrainTile`）编写 G-Buffer Pass：采样多层地面混合贴图，计算混合法线与粗糙度，输出 4 份 MRT，写入深度与 Stencil bit 7。
  3. 保持 `ZEnable = TRUE; ZWriteEnable = TRUE; AlphaBlendEnable = FALSE;`。
- **产出文件**：`main/fx/Terrain.fx`。
- **验证**：编译 `Terrain.fx` 并反汇编检查指令槽。
- **验收标准**：基础瓦片成功写入 G-Buffer；指令数符合 SM3 限制。
- **失败处理 / 决策映射**：若瓦片层数过多导致指令超标，拆分宏分支或优化多层采样。
- **知识回写**：无。

---

### P4-T08 地形叠加层（Cliff / Road / Scorch）MRT 混合策略落地
- **执行者**：agent　**规模**：M　**依赖**：P4-T07
- **目标**：根据 P1-T14（DG-T 决策）选定的策略，处理 `Terrain.fx` 中的悬崖、道路与焦痕叠加层在 MRT 下的渲染。
- **前置条件**：DG-T 决策已定稿。
- **必读上下文**：`plans/phase-1-engine-probes.md` P1-T14；`knowledge/deferred-techniques-sm3.md` §7。
- **步骤**：
  1. 若 DG-T 选定**策略 T-A（两遍法）**：基础瓦片在 G-Buffer Pass 写入 MRT，叠加层在独立后续 Pass 仅绑定 RT0（Albedo）与 RT1（法线），利用 `COLORWRITEENABLE` 与加权混合叠加。
  2. 若 DG-T 选定**策略 T-B（单遍烘焙）**：在 PS 内部展开多层混合，一次性写入 MRT。
  3. 若 DG-T 选定**策略 T-C（前向保留）**：叠加层保持在延迟主光照之后作为前向贴花叠加。
  4. 编写并调整对应 Technique 状态与 Shader 代码。
- **产出文件**：`main/fx/Terrain.fx`。
- **验证**：编译通过无报错。
- **验收标准**：叠加层与基础地表交界处平滑无黑边，法线过渡自然。
- **失败处理 / 决策映射**：若 MRT 混合引发驱动不可预知错误，强制回退至策略 T-C。
- **知识回写**：无。

---

### P4-T09 材质多层级 LOD Technique 变体适配
- **执行者**：agent　**规模**：M　**依赖**：P4-T08
- **目标**：为所有已迁移材质补充 LOD 变体（`_M`, `_L`, `_U` 以及 underscore-renamed 规范），确保远景与不同画质档位下均能正确切入 G-Buffer。
- **前置条件**：各材质基础 G-Buffer technique 完成。
- **必读上下文**：`.agents/skills/ra3-fx-shader/references/material-family-inventory.md` §2；`fxc-workflow.md`。
- **步骤**：
  1. 梳理各家族使用的 LOD 后缀列表（如 `GBuffer_M`, `GBuffer_L` 或 `_Default_M` 等）。
  2. 简化低 LOD 的 PS 计算（例如在 `_L` 档位省去法线贴图采样，直接使用几何面法线；或合并粗糙度常量）。
  3. 批量在各 `.fx` 中注册对应的 Technique LOD 块。
- **产出文件**：各已迁移 `.fx` 文件。
- **验证**：批量编译检查。
- **验收标准**：低画质下无缺少 Technique 回退到默认前向渲染的现象。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P4-T10 遗漏与边界材质扫描补齐
- **执行者**：agent　**规模**：S　**依赖**：P4-T09
- **目标**：对照 P1-T12（OQ-14）抓帧清单与官方 129 个 Shader 文件，筛查是否存在进入主场景不透明队列却未被迁移的冷门材质，做兜底端口补齐。
- **前置条件**：P4-T09 完成。
- **必读上下文**：`knowledge/open-questions.md` OQ-14；`material-family-inventory.md`。
- **步骤**：
  1. 检查扫描清单中标记为冷门或特殊的材质（如 `ObjectsScaffolding`, `ObjectsOre` 等）。
  2. 对确实在主帧绘制的不透明材质，按模板补写基础 G-Buffer technique。
  3. 对属于半透明或特效的材质（如全息、护盾、激光），显式标记为保持前向。
- **产出文件**：相关遗漏 `.fx` 文件。
- **验证**：编译通过。
- **验收标准**：主场景不透明物体清单覆盖率达 100%。
- **失败处理 / 决策映射**：无可编译源码的专有 Shader，依据 D19 配置降级标记。
- **知识回写**：更新 `material-family-inventory.md` 状态。

---

### P4-T11 RT3 正式接管 `WW3D.DepthTexture` 绑定
- **执行者**：agent　**规模**：M　**依赖**：P4-T10
- **目标**：在 `main/ingame.scrapeo` 中，将 G-Buffer RT3（`RA3DR_GBuffer3`）绑定至全局 `WW3D.DepthTexture`，使全引擎后续渲染阶段直接采样 G-Buffer 产出的高质量线性深度。
- **前置条件**：全场景不透明深度已完整写入 RT3。
- **必读上下文**：`plans/README.md` D3；`knowledge/engine-behavior.md` GT-01。
- **步骤**：
  1. 打开 `main/ingame.scrapeo`。
  2. 在 `renderGBufferPass` 结束处（MRT 解绑之后）：
     `settexture WW3D DepthTexture RA3DR_GBuffer3`
     `setfloat Deferred VanillaDepthBound 0`
  3. 保留条件开关：仅当 `Deferred.IsActive` 为真时执行此接管，否则维持原版绑定。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告；行长合规。
- **验收标准**：`settexture WW3D DepthTexture` 成功指向 `RA3DR_GBuffer3`。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P4-T12 延迟分支停用原版 `updateDepthMap`
- **执行者**：agent　**规模**：S　**依赖**：P4-T11
- **目标**：在 `main/ingame.scrapeo` 中对 `updateDepthMap` 的调用增加条件规避，在延迟模式下彻底省去一次全场景几何遍历与 `PostFX_LinearDepth` 计算。
- **前置条件**：P4-T11 完成。
- **必读上下文**：`diagrams/vanilla-pipeline-reference.md` §3 Step 4；`pass-templates.md` §2.3。
- **步骤**：
  1. 在 `proc InGame` 中找到 `updateDepthMap` 的调用点（原版第 1405 行前后）。
  2. 将其包裹在条件中：
     ```text
     	ifnot Deferred IsActive
     		callproc updateDepthMap
     	endif
     ```
     （或以已证明可靠的 `if/else` 结构表达）。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：在延迟激活状态下，`updateDepthMap` 过程完全被跳过；原版状态下照常执行。
- **失败处理 / 决策映射**：若跳过后某些后处理异常，检查是否有其他阶段隐式依赖 `DepthTexture`（非线性深度表面）。
- **知识回写**：更新 `dictionaries/engine-ground-truth.md`。

---

### P4-T13 水下着色与软粒子对新深度采样验证
- **执行者**：agent　**规模**：S　**依赖**：P4-T12
- **目标**：验证在停用原版深度图后，水下着色（`UnderwaterDeferred.fx`）与软粒子（`Particle IsSoftParticlesEnabled`）直接读取 `RA3DR_GBuffer3` 的渲染表现。
- **前置条件**：P4-T12 就绪。
- **必读上下文**：`readonly/SCRAPE-RA3/UnderwaterDeferred.scrapeh`；`COMMON.FXH`。
- **步骤**：
  1. 检查 `UnderwaterDeferred.fx` 采样 `WW3D.DepthTexture` 的深度反求公式。
  2. 检查软粒子着色器中粒子渐变淡出公式（`saturate((sceneDepth - particleDepth) * scale)`）。
  3. 确认两者无需修改 HLSL，完全无缝兼容。
- **产出文件**：无修改或微调。
- **验证**：本地静态比对。
- **验收标准**：数学公式完全等价。
- **失败处理 / 决策映射**：若软粒子出现深度裁切断层，检查近远平面比例系数。
- **知识回写**：无。

---

### P4-T14 USER-RUN：全场景不透明 G-Buffer 覆盖率与深度接管实机验证
- **执行者**：agent（打包/记录）+ USER-RUN　**规模**：L　**依赖**：P4-T13
- **目标**：在游戏实机中检验全场景地表、各阵营建筑、单位、树木的 G-Buffer 覆盖率，以及水下和软粒子效果。
- **前置条件**：构建包就绪。
- **必读上下文**：`tests/scenes.md`（GS-01 海战/陆战混编，GS-02 夜景，GS-04 树木茂密地图）。
- **步骤**：
  1. 生成测试构建包，配置 `DebugView = 1`（法线）、`DebugView = 8`（有效像素青色标记）。
  2. 编写测试脚本 `tests/user-run/P4-T14.md`。
  3. 用户进入 GS-01 与 GS-04：
     - 观察法线视图：地形起伏、悬崖切面、道路路面、三阵营建筑物与单位是否全场填满法线；
     - 观察有效像素视图：全屏不透明陆地与物体是否均亮起青色（除天空与水面外全覆盖）；
     - 观察水体与特效：浅水区水底折射与水深颜色渐变是否正常；步兵/载具开火产生的烟雾软粒子是否柔和贴地、无硬切边缘；
     - 观察帧率：确认停用原版深度重画后无异常卡顿或明显帧率波动。
  4. 整理测试报告至 `tests/results/P4-T14.md`。
- **产出文件**：`tests/user-run/P4-T14.md`、`tests/results/P4-T14.md`。
- **验证**：实机截图与 PIX 抓帧确认。
- **验收标准**：不透明有效覆盖率目测 ≥ 95%；水下与软粒子表现与原版一致；无崩溃。
- **失败处理 / 决策映射**：若发现个别单位全黑（未覆盖），记录其模型名并补充其材质 technique。
- **知识回写**：记录实测覆盖率数据。

---

### P4-T15 决策门 DG-3：不透明覆盖率达标验收
- **执行者**：lead-review　**规模**：S　**依赖**：P4-T14
- **目标**：对全场景不透明迁移结果进行正式技术验收，判定是否具备开启主光照合成的条件。
- **前置条件**：P4-T14 报告提交。
- **必读上下文**：`tests/results/P4-T14.md`；`plans/README.md` DG-3。
- **步骤**：
  1. 审查覆盖率指标：全场不透明像素有效标记覆盖率是否 ≥ 95%。
  2. 审查兼容性指标：未覆盖的边缘物体（如特殊过场道具）是否具备安全的降级显示能力，不引发黑屏或崩溃。
  3. 审查深度指标：RT3 深度接管是否稳定，软粒子与水体无破损。
  4. 签署通过 DG-3，正式解锁 Phase 5 延迟主光照合成。
- **产出文件**：更新 `plans/README.md` 中的 DG-3 状态为 ✅。
- **验证**：文档记录完备。
- **验收标准**：DG-3 状态更新为 ✅。
- **失败处理 / 决策映射**：若覆盖率不足 90%，排查遗漏的大型材质家族并补写后重新验收。
- **知识回写**：更新 `dictionaries/engine-ground-truth.md`。

---

### P4-T16 Phase 4 知识回写与清理
- **执行者**：agent　**规模**：S　**依赖**：P4-T15
- **目标**：执行 PK-T01 回写流程，固化材质迁移事实并更新进度看板。
- **前置条件**：DG-3 ✅。
- **必读上下文**：`plans/phase-K-knowledge-maintenance.md`。
- **步骤**：
  1. 更新 `.agents/skills/ra3-fx-shader/references/material-family-inventory.md`，将已迁移家族状态统一标记为 `✅已迁移G-Buffer`。
  2. 更新 `dictionaries/engine-ground-truth.md` 中关于深度接管与材质覆盖的条目。
  3. 更新 `plans/task-board.md`。
- **产出文件**：相关技能与字典文档。
- **验证**：git diff 检查。
- **验收标准**：文档条目准确对应，无失效链接。
- **失败处理 / 决策映射**：无。
- **知识回写**：本任务即回写任务。
