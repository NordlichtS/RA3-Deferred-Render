# Phase 7：正向尾段特效、水体、后处理与系统整合

> **阶段目标**：将延迟着色核心（G-Buffer + 主光照合成 + 局域体积光）与原版水下折射/水面反射、焦痕履带贴花、半透明特效、外描边、软粒子、全屏后处理链（Distortion/Bloom/LUT）以及 2D HUD 完美串联；保护原版 Stencil bit 0..1 描边与 bit 2 贴花；重新标定 HDR 曝光与 Bloom 阈值；确保 WorldBuilder 地编与 `Deferred.IsEnabled = false` 原版回退路径 100% 正常；定稿最终发布验收决策门 DG-7。
> **前置**：Phase 5 主光照与 Phase 6 局域体积光均已就绪（P5-T11 ✅，P6-T07 ✅）。
> **阶段出口**：P7-T12 DG-7 发布验收通过。

---

### P7-T01 焦痕、履带印与弹坑贴花叠加顺序梳理
- **执行者**：agent　**规模**：M　**依赖**：P5-T11
- **目标**：梳理 `renderScorchMarks`、`renderTerrainTracks` 与 `renderDecals` 的调用时机，确保各类贴花正确叠加在已完成延迟着色的地表与建筑表面上。
- **前置条件**：主光照输出稳定。
- **必读上下文**：`vanilla-pipeline-reference.md` §3 Step 5.3；`dictionaries/engine-ground-truth.md` GT-26。
- **步骤**：
  1. 确认各类贴花的混合模式（SrcAlpha/InvSrcAlpha）与 Stencil 状态。
  2. 保护贴花 Stencil 标记：贴花使用 Stencil bit 2（0x04），确保其在 G-Buffer 阶段或合成阶段不被错误覆盖。
  3. 在 `main/ingame.scrapeo` 中将贴花提交置于主光照合成 `renderDeferredComposite` 之后（或按 DG-T 策略处理）。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：坦克行驶履带印与火炮弹坑焦痕清晰叠加于地面上，无闪烁、无深度撕裂。
- **失败处理 / 决策映射**：若贴花颜色被全屏合成冲淡，确认贴花绘制在合成之后。
- **知识回写**：无。

---

### P7-T02 水下着色与水面折射纹理捕获
- **执行者**：agent　**规模**：M　**依赖**：P7-T01
- **目标**：在水体渲染之前，由 `renderUnderwaterDeferred` 执行水深颜色衰减查表与水下焦散，并通过 `updateWaterRefraction` 将当前包含主场景与体积光的完整画面抓屏至折射纹理。
- **前置条件**：局域光体积已在折射前渲染。
- **必读上下文**：`diagrams/vanilla-pipeline-reference.md` §3 Step 6、Step 7.1；`pass-templates.md` §1.3。
- **步骤**：
  1. 确认 `renderUnderwaterDeferred` 正常采样接管后的 `WW3D.DepthTexture`（`RA3DR_GBuffer3`）。
  2. 确保 `updateWaterRefraction` 调用 `copyFrameBufferToTexture` 正确捕获包含局域光的主缓冲。
  3. 确认折射目标 `WaterRefractionTexture` 正确绑定至 `Water.RefractionTexture` SCOPE 参数。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：水下地面与浸水建筑呈现逼真的水深吸收渐变与焦散动态水纹。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P7-T03 水面本体渲染与环境反射匹配
- **执行者**：agent　**规模**：M　**依赖**：P7-T02
- **目标**：调度 `renderWater` 绘制海洋与河流网格（`Ocean.fx`, `RiverWater.fx`），将菲涅尔折射、环境图反射与波浪法线扰动与延迟着色场景完美融合。
- **前置条件**：P7-T02 完成。
- **必读上下文**：`vanilla-pipeline-reference.md` §3 Step 7.2；`knowledge/engine-behavior.md`。
- **步骤**：
  1. 检查水面着色器采样 `WaterRefractionTexture` 与 `WaterReflectionTexture` 的混合系数。
  2. 验证岸边被局域体积光照亮的物体能否正确倒映在水面反射与浅水折射中。
  3. 确保水面绘制结束后的深度状态与主缓冲保持同步。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：水体呈现深浅透明渐变，海浪高光与周围 PBR 陆地光照色温和谐一致。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P7-T04 半透明几何体与排序队列交互
- **执行者**：agent　**规模**：M　**依赖**：P7-T03
- **目标**：调度半透明物体与排序队列（`renderbin Transparent 0/1`, `renderbin StaticSort4..1 0/1`），确保全息投影、能量护盾、玻璃窗在延迟主光照之后正确正向叠加。
- **前置条件**：水体渲染完成。
- **必读上下文**：`vanilla-pipeline-reference.md` §3 Step 8.1；`renderbin-dict.md`。
- **步骤**：
  1. 维持原版 `setdepth DepthBuffer`（只读深度测试，`ZWriteEnable = FALSE`）。
  2. 提交各类半透明队列：
     `renderbin Transparent 0`
     `renderbin StaticSort4 0` ... `renderbin StaticSort1 0`
  3. 确保半透明物体的 Alpha 混合模式（SrcAlpha/InvSrcAlpha 或加法）在 FP16 主缓冲上正确生效。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：能量护盾与超时空传送光效半透明通透，深度遮挡正确，无穿模切块。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P7-T05 软粒子与武器轨迹特效（软粒子复用 RT3 深度）
- **执行者**：agent　**规模**：M　**依赖**：P7-T04
- **目标**：验证烟雾粒子、爆炸火花、激光光束与示踪弹（`renderParticles`, `renderLasers`, `renderTracers`）对接管深度 `WW3D.DepthTexture` 的软淡出表现。
- **前置条件**：P7-T04 完成。
- **必读上下文**：`vanilla-pipeline-reference.md` §3 Step 9.1–9.4；`COMMON.FXH`。
- **步骤**：
  1. 确认软粒子开启（`Particle IsSoftParticlesEnabled`）。
  2. 检查 `GpuParticle*.fx` 与 `CommonGeometryParticle.fxh` 读取线性深度的软淡出公式。
  3. 确认延迟分支下烟雾贴地时完全消除了硬切断层。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：烟雾在地面与建筑物交界处柔和消散，激光枪轨迹明亮刺目。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P7-T06 单位与建筑外描边（Outlines.fxh 与 Stencil 隔离）
- **执行者**：agent　**规模**：M　**依赖**：P7-T05
- **目标**：验证选中单位/建筑时出现的外描边（`renderOutlines`，`Outlines.fxh`），确认原版 Stencil bit 0..1 描边逻辑未被延迟管线干扰。
- **前置条件**：P7-T05 完成。
- **必读上下文**：`vanilla-pipeline-reference.md` §3 Step 8.2；`knowledge/engine-behavior.md` GT-26。
- **步骤**：
  1. 确认选框高亮与描边绘制时 Stencil 读写掩码仅涉及 bit 0..1（`0x03`）。
  2. 确认延迟标记使用的 bit 7（`0x80`）与描边互不侵犯。
  3. 验证选中单位时边缘轮廓颜色纯正（盟军蓝/苏联红/帝国白）。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：鼠标悬停与点击选中时，模型轮廓描边清晰完整，无闪烁丢失。
- **失败处理 / 决策映射**：若描边断续，排查是否有延迟清除命令误重置了 Stencil 表面。
- **知识回写**：无。

---

### P7-T07 全屏热浪与爆炸扭曲（PostFX_Distortion.fx）
- **执行者**：agent　**规模**：S　**依赖**：P7-T06
- **目标**：保证爆炸与喷气尾焰引发的全屏像素级热浪扭曲后处理正常工作。
- **前置条件**：P7-T06 完成。
- **必读上下文**：`vanilla-pipeline-reference.md` §3 Step 10.1–10.3；`PostFX_Distortion.scrapeh`。
- **步骤**：
  1. 维持原版 `PostEffectDistortionTexture` 抓屏与 Distortion 累积缓冲。
  2. 确认 `PostFX_Distortion.fx` 正确采样抓屏纹理并根据扭曲图偏移 UV。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：导弹发射与大爆炸周围空气产生清晰的热折射波纹。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P7-T08 HDR 曝光与 Bloom 亮度重标定
- **执行者**：agent　**规模**：M　**依赖**：P7-T07
- **目标**：针对延迟 PBR 主光照带来的 HDR 亮度动态范围改变，重新标定 `PostFX_Bloom.fx` 的亮度提取阈值与高斯滤波衰减，防止全屏过曝发白。
- **前置条件**：P7-T07 完成。
- **必读上下文**：`knowledge/deferred-techniques-sm3.md` §8.3；`PostFX_Bloom.scrapeh`。
- **步骤**：
  1. 分析 `PostFX_Bloom.fx` 的高光提取公式：`saturate(color - BloomThreshold) * BloomIntensity`。
  2. 对比原版正向与延迟 PBR 合成的 HDR 动态范围直方图。
  3. 微调 `BloomThreshold` 与 `BloomScale`，确保只有强自发光、阳光镜面反射与爆炸核心才会激发出柔和的光晕（Bloom/Glare），常规漫反射地面不会泛白。
- **产出文件**：`main/fx/PostFX_Bloom.fx`。
- **验证**：编译通过。
- **验收标准**：白昼大理石与沙滩地面不再大面积发白过曝，能量武器光晕璀璨。
- **失败处理 / 决策映射**：根据不同地图光照配置预留曝光适配裕量。
- **知识回写**：更新相关技术参数。

---

### P7-T09 胶片调色与 3D LUT 色彩分级 Resolve
- **执行者**：agent　**规模**：M　**依赖**：P7-T08
- **目标**：确保后处理链末端的 `PostEffectLookupTable.fx` 正确将包含 Bloom 的 HDR 离屏缓冲 resolve 输出至最终的显示后台缓冲 `FrameBuffer`。
- **前置条件**：P7-T08 完成。
- **必读上下文**：`vanilla-pipeline-reference.md` §3 Step 10.8–10.9；`knowledge/engine-behavior.md` GT-05。
- **步骤**：
  1. 检查 `PostEffectLookupTable.fx` 采样 `sampler3D LookupTexture` 与 `sampler2D FilmTonemapping` 的色彩映射过程。
  2. 确认从 FP16 `FrameRenderTarget`（或临时抓屏纹理）至后台缓冲 `FrameBuffer` 的色域映射完全保真。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：全屏色彩分级正常，明暗对比强烈，无色彩断层。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P7-T10 2D HUD 与 UI 层级隔离确认
- **执行者**：agent　**规模**：S　**依赖**：P7-T09
- **目标**：确认游戏小地图、建造侧边栏、单位血条、图标等 2D UI 在 `renderPostEffects` 之后直接画在 `FrameBuffer` 上，彻底免受 Bloom、LUT 与热浪扭曲影响。
- **前置条件**：P7-T09 完成。
- **必读上下文**：`vanilla-pipeline-reference.md` §3 Step 11；`plans/README.md` D10。
- **步骤**：
  1. 检查 `main/ingame.scrapeo` 末尾调用：
     `renderIconLayers`
     `renderUI`
  2. 确认其绑定目标为 `FrameBuffer`（Back Buffer），深度置空或使用 UI 专用深度。
  3. 确认血条数字与小地图文字锐利无模糊。
- **产出文件**：`main/ingame.scrapeo`。
- **验证**：检查器 0 警告。
- **验收标准**：UI 文字线条像素级锐利，完全不受后处理光晕与调色浸染。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P7-T11 WorldBuilder 地图编辑器兼容性冒烟测试
- **执行者**：agent（打包）+ USER-RUN　**规模**：M　**依赖**：P7-T10
- **目标**：验证官方地图编辑器 WorldBuilder（`proc Editor`）在加载包含延迟修改的 `ingame.scrapeo` 时能够稳定启动与编辑，无崩溃。
- **前置条件**：全管线打通。
- **必读上下文**：`knowledge/open-questions.md` OQ-17；`vanilla-frame-walkthrough.md`。
- **步骤**：
  1. 检查 `proc Editor` 过程定义，确认新增的全局 `var` 变量不会对其造成结构冲突。
  2. 编写地编冒烟测试脚本 `tests/user-run/P7-T11.md`。
  3. 用户启动 WorldBuilder，新建一张空地图，刷涂地形、放置树木与建筑，保存并重新打开。
  4. 整理测试报告至 `tests/results/P7-T11.md`。
- **产出文件**：`tests/user-run/P7-T11.md`、`tests/results/P7-T11.md`。
- **验证**：WorldBuilder 启动无报错。
- **验收标准**：地图编辑器各工具操作正常，视口渲染正常，无加载崩溃。
- **失败处理 / 决策映射**：若地编报错，在 `proc Editor` 入口处强制 `setbool Deferred IsEnabled false` 走纯前向分支。
- **知识回写**：更新 OQ-17 结论。

---

### P7-T12 决策门 DG-7：全管线发布验收与 A/B 对比
- **执行者**：lead-review　**规模**：M　**依赖**：P7-T11
- **目标**：对 RA3 延迟渲染系统进行最终技术总评审，确认各模块均达到生产级发布标准。
- **前置条件**：全部前置任务完成。
- **必读上下文**：`plans/README.md` DG-7、定义完成标准（DoD）。
- **步骤**：
  1. 全面验收关键指标：
     - 不透明 G-Buffer 覆盖率达标，无黑屏与闪烁；
     - 主太阳光、软阴影、IBL 达到真实感 PBR 标准；
     - 局域体积光突破 8 光源限制，夜景与开火效果震撼；
     - 水体折射/反射、贴花、软粒子、描边、Bloom/LUT 与 UI 顺序完全正确；
     - `Deferred.IsEnabled = false` 时 100% 完美回退原版正向管线。
  2. 签署通过 DG-7，标记主干开发工作大功告成！
- **产出文件**：更新 `plans/README.md` 中的 DG-7 状态为 ✅；更新 `ROADMAP.md`。
- **验证**：发布评审文档归档。
- **验收标准**：DG-7 状态更新为 ✅。
- **失败处理 / 决策映射**：无。
- **知识回写**：同步全部字典与知识库。
