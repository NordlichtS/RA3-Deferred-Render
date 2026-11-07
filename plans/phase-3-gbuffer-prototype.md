# Phase 3：G-Buffer 单家族原型验证

> **阶段目标**：在受控的单材质家族（`objectsgeneric.fx`，建筑/道具/基础单位）与单骨骼蒙皮/镂空材质（`objectsallied.fx`，盟军单位）上，实现完整的 G-Buffer 输出；打通 SCRAPE 侧 Override 激活机制；验证 RT3 与原版线性深度逐像素等价性；验证有效像素标记（Stencil bit 7 / RT0.a）；通过实机验证后定稿决策门 DG-2（冻结 G-Buffer 编码）。
> **前置**：Phase 2 全部完成（P2-T07 ✅），4 份 G-Buffer 目标及调试视图已在实机正常工作。
> **阶段出口**：P3-T06 USER-RUN 通过，DG-2 决策定稿，P3-T08 知识回写完成。

---

### P3-T01 单材质 `objectsgeneric.fx` 增加 G-Buffer Technique
- **执行者**：agent　**规模**：M　**依赖**：P2-T07
- **目标**：为基础不透明材质 `main/fx/objectsgeneric.fx` 增加 G-Buffer 渲染 Pass，向 4 份 MRT 输出 albedo、world normal、roughness/metalness/AO/emissive 与 viewPos.z。
- **前置条件**：`main/fx/GBUFFER.FXH` 编译通过；DG-1 选定的 MRT 格式已在 `GBUFFER.FXH` 中定稿。
- **必读上下文**：`plans/README.md` D3、D4、D16；`main/fx/GBUFFER.FXH`；`.agents/skills/ra3-fx-shader/SKILL.md` §3–§4。
- **步骤**：
  1. 打开 `main/fx/objectsgeneric.fx`，引入 `#include "GBUFFER.FXH"`。
  2. 实现 `VS_GBuffer`：完成顶点的世界变换与投影变换，输出世界空间法线、切线、UV 以及视空间深度 `viewPos.z`（或世界坐标供 PS 变换）。
  3. 实现 `PS_GBuffer`：采样 BaseTexture 与 NormalTexture（还原切线空间法线至世界空间）；提取材质参数（粗糙度、金属度、AO、自发光包络）；调用 `GB_Encode` 返回 `GBufferOut`。
  4. 编写 `technique GBuffer`（或按 DG-1 路线决定的命名，如 `technique _CreateDepthMap`）：
     - 显式设置状态：`ZEnable = TRUE; ZWriteEnable = TRUE; AlphaBlendEnable = FALSE; AlphaTestEnable = FALSE; CullMode = CCW;`
     - 模板状态：`StencilEnable = TRUE; StencilPass = REPLACE; StencilRef = 128; StencilWriteMask = 128;`（写 bit 7）。
     - 严禁添加 `ExpressionEvaluator` 注解。
- **产出文件**：`main/fx/objectsgeneric.fx`。
- **验证**：
  ```powershell
  & main\fxc.exe /nologo /O2 /T fx_2_0 /D _WW3D_ /I main /I main\fx /Fo "$env:RA3DR_OUT\fxcheck\objectsgeneric.fxo" "main/fx/objectsgeneric.fx"
  & main\fxc.exe /nologo /O2 /T ps_3_0 /E PS_GBuffer /D _WW3D_ /I main /I main\fx /Fc "$env:RA3DR_OUT\asm\objectsgeneric_ps.asm" "main/fx/objectsgeneric.fx"
  ```
- **验收标准**：编译无报错；汇编指令数 ≤ 200 slots；uniform 不挤占固化寄存器；采样器在 s0..s7 范围内。
- **失败处理 / 决策映射**：若法线切线空间变换异常，比对原版 `head1objects.fxh` 的切线正交化公式。
- **知识回写**：无。

---

### P3-T02 蒙皮与镂空材质 `objectsallied.fx` 增加 G-Buffer Technique
- **执行者**：agent　**规模**：M　**依赖**：P3-T01
- **目标**：在带骨骼蒙皮与 Alpha 镂空的单位材质 `objectsallied.fx` 中实现 G-Buffer technique，验证多骨骼变换与 PS `clip()`。
- **前置条件**：P3-T01 编译通过。
- **必读上下文**：`.agents/skills/ra3-fx-shader/references/material-family-inventory.md`（Objects 家族蒙皮数组与 Alpha clip 约定）。
- **步骤**：
  1. 打开 `main/fx/objectsallied.fx`，引入 `#include "GBUFFER.FXH"`。
  2. 实现支持 0/1 骨骼蒙皮的 `VS_GBuffer_Skinned` 数组变体（对应 `POSITION0` / `BLENDINDICES0` / `BLENDWEIGHT0`）。
  3. 实现 `PS_GBuffer_Allied`：计算 BaseTexture.a，在镂空模式下执行 `clip(alpha - Cutoff)` 丢弃像素；阵营色混合 `lerp(albedo, RecolorColor, Mask)`；调用 `GB_Encode` 输出。
  4. 声明 technique 状态块，同样开启 Stencil bit 7 写入，禁用硬件 AlphaTest 与 AlphaBlend。
- **产出文件**：`main/fx/objectsallied.fx`。
- **验证**：
  ```powershell
  & main\fxc.exe /nologo /O2 /T fx_2_0 /D _WW3D_ /I main /I main\fx /Fo "$env:RA3DR_OUT\fxcheck\objectsallied.fxo" "main/fx/objectsallied.fx"
  ```
- **验收标准**：编译 0 报错；支持蒙皮与镂空的 technique 正常注册。
- **失败处理 / 决策映射**：若骨骼寄存器溢出，核对 `vs c128..c255` 骨骼矩阵绑定区间。
- **知识回写**：无。

---

### P3-T03 SCRAPE 侧 G-Buffer Technique 激活挂载
- **执行者**：agent　**规模**：M　**依赖**：P3-T02
- **目标**：依据 DG-1 确定的激活路线，在 `main/ingame.scrapeo` 的 `renderGBufferPass` 中切入已适配 Shader 的 G-Buffer Pass。
- **前置条件**：DG-1 结论已出；Shader 编译就绪。
- **必读上下文**：`plans/README.md` D2；`plans/phase-1-engine-probes.md` P1-T13（DG-1 结论）。
- **步骤**：
  1. 若 DG-1 为**路线 1（`setshaderoverride`）**：
     在 `renderGBufferPass` 的 MRT 绑定与 Clear 之后：
     `setshaderoverride objectsgeneric GBuffer`
     `setshaderoverride objectsallied GBuffer`
     提交相关物体 `renderbin UnitPlayer0 0` 等，随后执行 `clearshaderoverride`。
  2. 若 DG-1 为**路线 2（`_CreateDepthMap` + 全局 Override）**：
     在 `renderGBufferPass` 中执行 `beginDepthOverrideTechnique`，提交几何体，随后 `endDepthOverrideTechnique`。
  3. 确保 MRT0..3 绑定、相机 `setcamera Viewer` 与可见集 `visibleobjects Frame` 正确匹配。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：`node .agents/skills/ra3-scrape-pipeline/scripts/check_scrape.js main/ingame.scrapeo` 检查通过。
- **验收标准**：检查器 0 警告；单行 < 200 字节。
- **失败处理 / 决策映射**：若 override 产生状态泄漏，检查是否在返回前彻底解除了 override 与 MRT。
- **知识回写**：无。

---

### P3-T04 RT3 与原版线性深度等价性差分探针
- **执行者**：agent　**规模**：M　**依赖**：P3-T03
- **目标**：编写差分调试着色器 `diff_linear_depth.fx`，验证 G-Buffer RT3 写入的线性深度与原版 `DepthTextureLinear` 输出是否严格一致。
- **前置条件**：G-Buffer 已写入测试几何体深度。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §2.5；`plans/README.md` D3。
- **步骤**：
  1. 新建 `main/fx/probe/diff_linear_depth.fx`。
  2. 采样 G-Buffer RT3（`viewPos.z`）与原版 `DepthTextureLinear`。
  3. 计算误差：`float diff = abs(rt3Depth - vanillaDepth);`
  4. 可视化：若 `diff < 0.05` 输出纯绿；若 `diff >= 0.05` 输出纯红并随误差放大闪烁；无几何体处输出黑色。
  5. 挂入 `DeferredDebug` 视图 `DebugView = 7`。
- **产出文件**：`main/fx/probe/diff_linear_depth.fx`。
- **验证**：编译通过并输出汇编。
- **验收标准**：调试视图 7 能够在全屏显示差分热力图。
- **失败处理 / 决策映射**：若出现大面积红色，检查是否投影矩阵近远平面归一化存在缩放差异（核对原版 `PostFX_LinearDepth.fx` 逆投影推导）。
- **知识回写**：无。

---

### P3-T05 有效像素 Stencil bit 7 与 RT0.a 标记验证
- **执行者**：agent　**规模**：S　**依赖**：P3-T03
- **目标**：验证 G-Buffer 写入的像素是否正确被打上 Stencil bit 7（0x80）与 RT0.a（`128/255`）有效标记。
- **前置条件**：P3-T03 就绪。
- **必读上下文**：`plans/README.md` D4、D19。
- **步骤**：
  1. 在 `DeferredDebug.fx` 中配置 `DebugView = 8`（有效像素标记视图）。
  2. 读取 RT0.a：若 `abs(rt0.a - 0.502) < 0.05` 显示青色（Cyan），否则显示黑色。
  3. 配置全屏 Quad 读取 Stencil 掩码纹理（若通过探针可读）或在后续合成中测试 Stencil 过滤。
- **产出文件**：`main/fx/DeferredDebug.fx`。
- **验证**：编译通过。
- **验收标准**：调试模式 8 下，仅已适配 G-Buffer 的单位/建筑像素亮起青色，背景与未适配物体保持全黑。
- **失败处理 / 决策映射**：若整屏全黑，检查 Shader 中 RT0.a 的写入值是否被硬件 Alpha 写入掩码屏蔽。
- **知识回写**：无。

---

### P3-T06 USER-RUN：单材质 G-Buffer 原型实机验证
- **执行者**：agent（打包/记录）+ USER-RUN　**规模**：L　**依赖**：P3-T04, P3-T05
- **目标**：在游戏实机中验证单材质原型的法线、阵营色、镂空、骨骼动画与深度差分。
- **前置条件**：构建包就绪。
- **必读上下文**：`tests/scenes.md`（基准场景 GS-01 盟军单位）。
- **步骤**：
  1. 生成构建包：分别设置 `DebugView = 1`（法线）、`DebugView = 3`（Albedo/阵营色）、`DebugView = 7`（深度差分）、`DebugView = 8`（有效标记）。
  2. 编写测试脚本 `tests/user-run/P3-T06.md`，指导用户进入 GS-01 建造盟军电厂、兵营与守护者坦克。
  3. 用户观察：
     - 法线视图：坦克炮塔转动与车体法线凹凸是否平滑正确；
     - 深度差分：坦克与建筑表面是否绝大多数呈现纯绿色（`diff < 0.05`）；
     - 镂空边缘：步兵或铁丝网 Alpha 镂空边缘是否整洁无黑边毛刺；
     - 骨骼动画：步兵奔跑动作变形时 G-Buffer 是否无撕裂。
  4. 整理测试报告至 `tests/results/P3-T06.md`。
- **产出文件**：`tests/user-run/P3-T06.md`、`tests/results/P3-T06.md`。
- **验证**：用户截图与 PIX 抓帧确认。
- **验收标准**：观察项全部符合预期；无崩溃、无明显深度差分红斑。
- **失败处理 / 决策映射**：深度差分超差时，进入 P3-T04 调整 `viewPos.z` 符号与偏移；法线反向时调整 Y 轴翻转。
- **知识回写**：记录实测数据至 `dictionaries/engine-ground-truth.md`。

---

### P3-T07 决策门 DG-2：冻结 G-Buffer 编码规范
- **执行者**：lead-review　**规模**：S　**依赖**：P3-T06
- **目标**：依据实机测试结论，正式定稿并冻结 G-Buffer 的通道定义、数学编码与标记位。
- **前置条件**：P3-T06 验收合格。
- **必读上下文**：`plans/README.md` D3、D4、D19；`tests/results/P3-T06.md`。
- **步骤**：
  1. 审查 P3-T06 实机结果，确认 RT0..RT3 的数据精度满足视觉要求。
  2. 审查深度差分指标，确认 RT3 完全具备接管 `WW3D.DepthTexture` 的能力。
  3. 将 `GBUFFER.FXH` 中的编码结构锁定为最终生产版本，后续 Phase 4 大规模迁移一律不得擅自变更布局。
- **产出文件**：更新 `plans/README.md` 中的 DG-2 状态为 ✅。
- **验证**：文档记录完备。
- **验收标准**：DG-2 状态置为 ✅。
- **失败处理 / 决策映射**：若法线 10-bit 存在伪影，在此处决策是否切换为视空间法线或补充编码。
- **知识回写**：更新 `dictionaries/engine-ground-truth.md`。

---

### P3-T08 Phase 3 知识回写与清理
- **执行者**：agent　**规模**：S　**依赖**：P3-T07
- **目标**：执行 PK-T01 回写流程，归档 Phase 3 的经验与结论。
- **前置条件**：DG-2 ✅。
- **必读上下文**：`plans/phase-K-knowledge-maintenance.md`。
- **步骤**：
  1. 在 `dictionaries/engine-ground-truth.md` 中确认 GT-xx 相关条目已闭环。
  2. 在 `.agents/skills/ra3-fx-shader/references/fxfxh-architecture.md` 中更新 G-Buffer 生产实践。
  3. 清理 `main/fx/probe/` 中的临时差分着色器（保留测试源码至归档分支或标记为测试保留）。
  4. 更新 `plans/task-board.md`。
- **产出文件**：相关字典与技能文档。
- **验证**：git diff 检查。
- **验收标准**：文档更新清晰，无残留废弃配置。
- **失败处理 / 决策映射**：无。
- **知识回写**：本任务即回写任务。
