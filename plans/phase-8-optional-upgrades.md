# Phase 8：可选进阶功能与性能极致优化

> **阶段目标**：在主干延迟管线完全稳定且发布验收后，按需探索与落地高质量后处理与性能优化进阶技术：屏幕空间环境光遮蔽（SSAO）、延迟抗锯齿（FXAA/SMAA）、投影贴花（Deferred Decals）、3-MRT 紧凑深度实验、模板光体积双 Pass 优化，以及基于 MSYS2 的全自动模块化 SCRAPE 构建脚本。
> **前置**：DG-7 发布验收已通过（P7-T12 ✅）。所有进阶任务均为可选独立卡。
> **阶段出口**：按需实施并记录评估结果。

---

### P8-T01 屏幕空间环境光遮蔽（SSAO）集成
- **执行者**：agent　**规模**：M　**依赖**：P7-T12
- **目标**：利用 G-Buffer RT1 法线与 RT3 线性深度，在半分辨率缓冲上生成双边滤波的 SSAO 遮罩，并将其仅调制在环境漫反射 IBL 上。
- **前置条件**：主光照稳定。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §8.1。
- **步骤**：
  1. 编写半分辨率 SSAO 着色器 `SSAO.fx`（Crysis / Alchemy 算法，8–12 采样点）。
  2. 编写半分辨率水平与垂直双边滤波着色器 `SSAO_Blur.fx`（基于深度与法线权重的边缘保留高斯滤波）。
  3. 在 `main/ingame.scrapeo` 中配置中间纹理 `SSAOTexture`（`L8` 或 `A8R8G8B8`）。
  4. 在 `DeferredComposite.fx` 中将 SSAO 遮罩乘入环境漫反射项。
- **产出文件**：`main/fx/SSAO.fx`, `main/fx/SSAO_Blur.fx`, `main/ingame.scrapeo`。
- **验证**：编译通过；检查器 0 警告。
- **验收标准**：建筑物阴角、坦克轮子底部与悬崖边缘呈现自然柔和的接触阴影，无光晕撕裂。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P8-T02 延迟抗锯齿后处理（FXAA 3.11 / SMAA 1x D3D9 移植）
- **执行者**：agent　**规模**：M　**依赖**：P7-T12
- **目标**：为延迟管线引入轻量高效的屏幕后处理抗锯齿（FXAA 或 SMAA），弥补延迟渲染下无法启用硬件 MSAA 的几何边缘锯齿。
- **前置条件**：全屏后处理链稳定。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §8.2。
- **步骤**：
  1. 移植 Timothy Lottes 官方开源的 FXAA 3.11 Quality D3D9 HLSL 实现至 `main/fx/PostFX_FXAA.fx`。
  2. 在后处理链末端、`PostEffectLookupTable` 之前（或合并入调色 Pass）执行边缘抗锯齿平滑。
  3. 针对高频细线（电线、天线）调整边缘检测阈值，防止画面整体模糊。
- **产出文件**：`main/fx/PostFX_FXAA.fx`, `main/ingame.scrapeo`。
- **验证**：编译通过无报错。
- **验收标准**：模型倾斜高频边缘锯齿显著平滑，文字与 UI 依然保持完全独立锐利。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P8-T03 G-Buffer 投影贴花（Deferred Decals）
- **执行者**：agent　**规模**：L　**依赖**：P7-T12
- **目标**：实现基于包围盒（Box Proxy）的 G-Buffer 延迟贴花，将弹坑、破损痕迹完美投射在复杂起伏的地形与多边形建筑立面上，彻底解决原版贴花拉伸穿模问题。
- **前置条件**：G-Buffer 结构稳定。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §7。
- **步骤**：
  1. 编写贴花着色器 `DeferredDecal.fx`：渲染立方体网格，PS 采样 G-Buffer RT3 重建世界坐标并变换至立方体局部空间，检查是否在 `[-0.5, 0.5]` 盒内。
  2. 计算局部 UV 并采样贴花 Albedo 与法线。
  3. 利用 D3D9 `COLORWRITEENABLE` 在 G-Buffer 生成之后、主光照合成之前修改 RT0 与 RT1。
- **产出文件**：`main/fx/DeferredDecal.fx`, `main/ingame.scrapeo`。
- **验证**：编译通过。
- **验收标准**：弹坑自然贴合在楼梯与斜坡上，无悬空与拉伸。
- **失败处理 / 决策映射**：若驱动不支持单独写掩码，降级为前向屏幕空间贴花。
- **知识回写**：无。

---

### P8-T04 3-MRT 紧凑深度实验（削减 RT3 节约显存与写带宽）
- **执行者**：agent　**规模**：M　**依赖**：P7-T12
- **目标**：实验性评估将线性深度高低 8 位编码进 `RT2.ba` 的方案，尝试将 4-MRT 裁剪为 3-MRT，在 1080p 下进一步节约 7.91 MiB 显存与 25% G-Buffer 写入带宽。
- **前置条件**：主干功能完全稳定。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §9.2。
- **步骤**：
  1. 在实验分支修改 `GBUFFER.FXH`，将线性深度分解为两个 8 位分量存入 `RT2.b` 与 `RT2.a`，关闭 `RT3` 绑定。
  2. 在合成与调试阶段解码 16 位整数线性深度。
  3. 实机对比远景精度是否出现深度阶梯断层（Z-Fighting / Banding）。
- **产出文件**：实验测试报告。
- **验证**：实机截图与精度对比。
- **验收标准**：记录精度与性能对比数据；若存在明显伪影则放弃并保持 4-MRT 基线。
- **失败处理 / 决策映射**：以稳定性优先，实验不合格直接终止。
- **知识回写**：更新相关技术沉淀。

---

### P8-T05 模板光体积双 Pass 优化（复杂场景填充率优化）
- **执行者**：agent　**规模**：M　**依赖**：P7-T12
- **目标**：在超多光体重叠或极大视距场景下，评估是否启用经典 Stencil 双 Pass 法（Pass 1 仅写 Stencil 标记光球与几何相交范围，Pass 2 仅在 Stencil 范围内着色），进一步降低大光球在空旷区域的像素着色浪费。
- **前置条件**：P6 局域光体积稳定。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §4.1。
- **步骤**：
  1. 编写双 Pass 模板光照测试 Technique。
  2. 在密集光照场景（GS-07）下使用 PIX 抓帧分析 Overdraw 与 GPU 周期耗时。
  3. 对比单 Pass 背面法的 DrawCall 翻倍开销与像素节省收益。
- **产出文件**：性能对比报告。
- **验证**：性能数据。
- **验收标准**：得出清晰的场景复杂度分界阈值。
- **失败处理 / 决策映射**：若双 Pass 导致的 DrawCall 增长抵消了像素收益，维持单 Pass 背面法。
- **知识回写**：无。

---

### P8-T06 动态分支与指令槽极限优化
- **执行者**：agent　**规模**：S　**依赖**：P7-T12
- **目标**：对合成着色器与光体积着色器进行汇编级指令重排，消除低效的标量计算与动态分支惩罚。
- **前置条件**：P7-T12 完成。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §10.3；`fxc-workflow.md`。
- **步骤**：
  1. 分析 `DeferredComposite_ps.asm` 与 `DeferredPointLight_ps.asm`。
  2. 使用向量打包优化多变量数学运算；利用 `saturate` 与乘加指令（MAD）压缩 ALU 槽。
  3. 消除 PS 内部的不必要动态判断，改为平滑权重混合或静态编译宏。
- **产出文件**：优化后的 `.fx` 文件。
- **验证**：汇编指令数统计比对。
- **验收标准**：指令槽缩减 10% 以上，实机帧率微幅提升。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P8-T07 模块化 SCRAPE 自动化构建脚本（基于 MSYS2 GCC）
- **执行者**：agent　**规模**：M　**依赖**：P7-T12
- **目标**：依据 `preprocess-and-build.md` 规格，编写生产级 PowerShell 构建脚本，将模块化 `.scrape/.scrapeh` 源码通过 MSYS2 `gcc -E` 自动预处理展开为 `ingame.scrapeo`，并自动调用 `check_scrape.js` 执行零警告校验。
- **前置条件**：P7-T12 完成。
- **必读上下文**：`.agents/skills/ra3-scrape-pipeline/references/preprocess-and-build.md`。
- **步骤**：
  1. 梳理模块化源码目录 `main/scrape_src/`。
  2. 编写 `main/tools/build_scrape.ps1`：自动检测 MSYS2 环境，配置 `EA_PLATFORM_WINDOWS` 宏，调用 `gcc -E -P -undef -nostdinc -x c` 展开源码。
  3. 串联调用 `check_scrape.js`。
- **产出文件**：`main/tools/build_scrape.ps1`。
- **验证**：
  ```powershell
  & main\tools\build_scrape.ps1
  ```
- **验收标准**：输出的 `ingame.scrapeo` 校验 0 错误，且与手动维护的脚本完全等价。
- **失败处理 / 决策映射**：若用户未安装 MSYS2，自动降级为直接编辑模式。
- **知识回写**：更新构建文档。

---

### P8-T08 进阶功能评估与文档技术归档
- **执行者**：lead-review　**规模**：S　**依赖**：P8-T01..P8-T07
- **目标**：汇总所有进阶功能的实测成果与对比数据，形成完整的技术白皮书并归档。
- **前置条件**：已开展的进阶任务就绪。
- **必读上下文**：各任务产出报告。
- **步骤**：
  1. 整合各进阶模块的视觉对比截图与性能数据。
  2. 编制技术总结与社区 Mod 推广指南。
  3. 归档项目全部知识资产。
- **产出文件**：技术白皮书与归档文档。
- **验证**：文档完备。
- **验收标准**：全部技术文档归类整洁。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。
