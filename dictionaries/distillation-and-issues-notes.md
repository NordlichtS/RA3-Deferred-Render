# 知识库蒸馏与实机避坑备忘录 (Distillation & Ground Truth Notes)

> **状态（2026-11-04）**：§2 的蒸馏计划**已执行完毕**，成果见 `.agents/skills/ra3-scrape-pipeline/`、`.agents/skills/ra3-fx-shader/`、`dictionaries/engine-ground-truth.md`、`knowledge/`。本文件留作历史备忘。§1 的事实已并入上述文件；其中两处被蒸馏时以 `main/ingame.scrapeo` 原文勘误：环境 Cube 格式应为 `$WW3D.EnvMapRenderTargetTextureFormat`（L1154）；`renderUnits` 是否提交描边 bin 降级为 `❓`（OQ 见 `knowledge/open-questions.md`）。

> **定位**：本文档记录工作区整理与代码走查中发现的关键事实、前代假设勘误，以及未来进行 Skill 蒸馏和知识库重构时的必查要点。在正式启动蒸馏工作前，作为统一认知基准。

---

## 1. 原版渲染管线实机事实勘误 (Ground Truth Corrections)

### 1.1 贴图格式与分辨率真相
- **ShadowMap**：
  - 颜色目标：`ShadowMapTexture` 格式为 **`R32F`**（第 159 行），尺寸为 `$Sas.Shadow[0].MapSize`。
  - 深度缓冲：`ShadowMapDepthBuffer` 格式为 **`D24S8`**。
  - *勘误*：严禁写成 `L16 + D24S8`。
- **DepthMap (场景线性深度)**：
  - 原版两步走：首先以 `beginDepthOverrideTechnique` 渲染整场投射物至 `DepthTexture`（`R32F` + `D24S8`，第 632、685 行）；然后由全屏 Quad `PostEffectLinearDepthShader LinearDepth` 转换写出至 `DepthTextureLinear`（`R32F`，第 638、710 行），最终绑定为 `WW3D DepthTexture` 供后续水底与粒子采样。
  - *改造关键*：延迟管线可在 Phase 1 G-Buffer PS 中直接将视图空间线性深度写入 RT3（如 `R32F`），从而在 Phase 1 彻底废弃整场重画的 `updateDepthMap`，节省大量光栅开销！
- **Water Reflection (水面反射)**：
  - 贴图格式：`WaterReflectionTexture` 512×512，格式为 `$WW3D.FrameRenderTargetTextureFormat`（第 750 行）。
  - 执行条件：受 `if Water IsReflectionVisible` 控制。使用 `camera Reflection` 重新将全场景不透明几何体与粒子再画一遍！
- **Ocean Displacement (海洋波浪位移)**：
  - 贴图格式：1024×1024 **`A16B16G16R16F`**，包含静态位移叠加与 BlurU/BlurV 两次全屏高斯滤波（第 876–956 行）。

### 1.2 执行条件与全场景遍历频次
- 原版单帧极端情况下，主场景几何体可能会被遍历 **最多 4 次**：
  1. `updateShadowTexture`（太阳视锥，`camera ShadowMap`）
  2. `doRotateEnvironmentMaps`（环境盒 6 面刷新，条件触发）
  3. `updateWaterReflection`（水面反射视锥，`camera Reflection`）
  4. `updateDepthMap`（主相机视锥，仅当开启反射或软粒子时触发）
  5. `UpdateFrameBuffer`（主相机主帧绘制）
- `updateDepthMap` **并非无条件每帧执行**，而是由 `Water IsReflectionVisible` 或 `Particle IsSoftParticlesEnabled` 条件门控（第 723–730 行）。

### 1.3 渲染目标 (RT) 切换与 UI 层级隔离
- **主场景 RT**：
  - 若开启 HDR 或抗锯齿（AA），引擎使用 `FrameRenderTarget`（离屏 Surface）；否则直接使用后台缓冲 `FrameBuffer`（第 48–64 行）。
- **Resolve 与后处理串联**：
  - 后处理链末端的 `PostEffectLookupTable`（LUT 调色，第 299–329 行）负责把离屏 `PostEffectFrameBufferTexture` resolve 输出到最终真正的 `FrameBuffer`（Back Buffer）。
- **HUD UI**：
  - `renderIconLayers` 与 `renderUI` 是在 `renderPostEffects` **之后**直接画在 `FrameBuffer` 上。因此，HUD 永远不受 LUT 调色与 Distortion 扭曲的影响。MRT 改造必须严格维持此后处理后接 UI 的边界。

### 1.4 RenderBin 命名与引擎命令严格区分
- **一律使用官方字符串名**：在 SCRAPE 脚本中，RenderBin 永远通过名称调用（如 `renderbin Solid 0`、`renderbin Structure 0`、`renderbin UnitPlayer0 0`）。严禁在脚本或设计中使用任何纯数字假设！
- **引擎命令 ≠ RenderBin**：
  - `renderTerrain`（地形渲染）、`renderRoads`（道路）、`renderProps`（道具）、`renderWater`（水面）、`renderDecals`（贴花）、`renderParticles`（粒子）、`renderUI`（界面）是引擎内置的高级执行命令，并非单个 RenderBin。
  - `renderUnits` 会遍历提交 `UnitPlayer0`..`UnitPlayer19` 及单位外描边。
  - `renderStructures` 会提交 `Structure` 及建筑外描边。

---

## 2. 知识库蒸馏设计计划 (Future Distillation Plan)

当进入后续蒸馏阶段时，按以下要点重构各模块，坚决避免 GPT-5.6 式的碎片化与过度工程化：

### 2.1 `ra3-scrape-pipeline` 蒸馏要点
1. **核心命令紧凑清单**：
   - 提取真实使用的 15 个高频命令（`settarget`, `setdepth`, `setcamera`, `visibleobjects`, `clear`, `renderbin`, `setshader`, `renderquad`, `settexture`, `stretchrect`, `callproc`, `beginevent/endevent`, `if/elif/else/endif`）。
2. **256 字节行长硬约束自动化**：
   - 将 `readonly/llm-skill-for-scrape/scripts/check_scrape.js` 提炼为该 Skill 的内置轻量检查工具，在修改脚本后必须执行。
3. **状态隔离与回退经验**：
   - 记录 Technique 缺失时的实际表现（回退至默认 forward pass 而非必定崩溃），并在 G-Buffer Override 时配置正确的 dummy technique。

### 2.2 `ra3-dx9-hlsl` 蒸馏要点
1. **分层头文件最佳实践**：
   - 以 `COMMON.FXH` 为唯一硬件接口契约。
   - 避免在工作区内自建庞大的通用图形学长文，遇到通用 HLSL 语法统一路由到全局 `hlsl-directx-reference` 与 `shader-programming`。
2. **SM 3.0 / D3D9 约束规范**：
   - 禁用 SM 4+ 语法（如 `mad()`, `rcp()`, `Texture2D.Sample`）。
   - 明确 VPOS 在 D3D9 中为 `[0, W-1]` 整数像素坐标，采样 texel-center 必须补 `+ 0.5` 半像素偏移。

### 2.3 跨 Agent 全局配置验证备忘
- 已在本机配置：
  - `C:\Users\HP\.agents\skills\`（作为唯一主源）
  - `C:\Users\HP\.gemini\config\skills.json` 与 `mcp_config.json`
  - `C:\Users\HP\.codex\config.toml` 与 `~/.codex/skills/` Junction
  - `C:\Users\HP\.cursor\mcp.json` 与 `~/.cursor/skills/` Junction
- *验证提醒*：后续启动不同 Agent（Codex / Cursor）时，若某个 Agent 原生不支持目录联接或特定路径，可退回使用符号链接或各自原生的配置机制。
