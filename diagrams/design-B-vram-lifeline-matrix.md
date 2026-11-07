# 设计规范 B：基于“纵向时序步骤 + 右侧显存池生命线矩阵 (Vertical Timeline + VRAM Lifeline Matrix)”的渲染管线可视化方案

> **适用目标**：生成单文件零外部依赖的交互式 HTML 流程图（如 [`diagrams/RA3 Render Pipeline VRAM control.html`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/diagrams/RA3%20Render%20Pipeline%20VRAM%20control.html)）。  
> **新 Agent 零上下文执行指引**：
> 1. **必读唯一事实源（Ground Truth）**：在编写任何 HTML/CSS/JS 代码前，**必须先完整读取 [`diagrams/vanilla-pipeline-reference.md`](file:///c:/Desktop01/MYGITHUB/RA3-Deferred-Render/diagrams/vanilla-pipeline-reference.md)**。所有渲染步骤顺序（**`Step 0` 开局准备 + `Step 1` – `Step 11` 每帧循环，共 12 个可折叠父步骤 / 35 个原子子步骤**）、八大主功能分类、六种可共存辅助状态标志（`🕒` `☀️` `💧` `📷` `👁️` `🎞️`）、CPU 输入、静态资源、**14 组 GPU 动态显存变量名称/格式/尺寸（含 `ShadowMapDepthBuffer` 独立列与跨帧保留机制）**，一律严格以该文档为准。
> 2. **设计职责**：本文件定义**方案 B（左侧输入与步骤计算 + 右侧 GPU 显存垂直生命线矩阵）**的四栏同步网格、去编号化语义图例、14 条垂直显存生命线轨道、首尾创建/跨帧保留徽章、35 个原子子步骤拆解与折叠交互规范。

---

## 0. HTML 视觉审美基调与防错铁律

- **整体气质**：采用**科幻工程战术时序矩阵（Sci-Fi Engineering Telemetry Matrix）**风格——深邃暗色底板、细腻的工程网格底纹（Subtle Coordinate Grid）、类似硬件逻辑分析仪/GPU Profiler 的高对比度垂直发光生命线与清晰的技术字体排版。
- **彻底去除人为虚构编号（Zero Artificial Prefix Rule）**：
  - **显存列（VRAM Columns）**：**严禁**添加 `T01..T14` 等不存在于引擎中的编号，直接使用真实的 SCRAPE 变量名并按核心重要性排序（`FrameBuffer`, `FrameRenderTarget`, `DepthBuffer`, `DepthTexture`, `DepthTextureLinear` ...）。
  - **步骤分类（Step Categories）**：**严禁**添加 `C1..C8` 代号，直接使用语义化分类名称 + 高辨识度主题色。
  - **时序步骤行（Step Rows）**：**严禁**同时出现两套行号（如既标 `Row 01..28` 又标 `Step 01..13`）。全表唯一使用 **`Step 0`（含 `0.1`–`0.4`）+ `Step 1`..`Step 11`（含 `X.1, X.2` 子步骤）** 一套统一时序编号。
- **严禁将全屏 Shader 计算画成显存直接 Copy**：
  - 凡是通过 Pixel Shader + `renderquad` 采样源纹理并计算写出目标纹理的步骤（典型如 **`Step 4.2 PostFX_LinearDepth` 线性化深度**、`Step 3.2/3.3 BlurU/V`、`Step 8.3 BlurBox`、`Step 10.4/10.6/10.7/10.9` 后处理），**必须**绘制为 **源轨道 `SAMPLE` ──► Zone 2 Shader ──► 目标轨道 `OVERWRITE`**，**严禁**画成轨道间的 `COPY` 点线拷贝箭头！只有硬件 `IDirect3DDevice9::StretchRect`（`Step 7.1`, `10.1`, `10.3`, `10.5`, `10.8`）才能使用 `COPY ┄┄► OVERWRITE` 轨道直连箭头。

---

## 1. 顶部完备图例系统规范 (Mandatory Legend Bar)

页面顶部提供常驻/可点击筛选的四合一图例面板：

1. **八大步骤主分类色系（无字母代号，点击可按类别筛选步骤行）**：
   - **开局静态绑定与低频预烘焙**（冷青灰/钢蓝系：`Step 0.1`–`0.4`）
   - **非主相机离屏预绘制**（琥珀金/暖橙系：`Step 1`, `Step 2.1`–`2.2`, `Step 3.1`–`3.3`）
   - **主相机离屏深度预通道**（玫瑰红/品红系：`Step 4.1`–`4.2`）
   - **主视角正向不透明几何 · 写深度与模板**（亮青/电光蓝系：`Step 5.1`–`5.2`）
   - **读线性深度的延迟与软粒子着色 · 不写深度**（翡翠绿/亮绿系：`Step 6.1`–`6.2`, `Step 9.1`–`9.2`）
   - **主视角正向水面、半透明与模板描边叠加 · 不写深度**（皇家蓝/蔚蓝系：`Step 7.1`–`7.2`, `Step 8.1`–`8.5`）
   - **3D 画面全屏滤镜后处理链**（霓虹紫/紫罗兰系：`Step 10.1`–`10.9`）
   - **终态 2D HUD 与战术界面叠层**（柠檬黄/亮金系：`Step 11`）
2. **六种可共存的辅助状态图例标志（点击可筛选对应步骤行）**：
   - **`🕒` 开局准备 / 低频烘焙**：仅在开局/首帧执行 GPU 烘焙或静态绑定，进入对局后无需每帧重绘（`Step 0.1`–`0.4`）。
   - **`☀️` 阳光阴影专属**：关闭阴影或无太阳光场景跳过（`Step 1`）。
   - **`💧` 仅供水体**：完全无水场景跳过（`Step 2.1`–`2.2`, `Step 3.1`–`3.3`, `Step 6.1`–`6.2`, `Step 7.1`–`7.2`；*注：`Step 4` 深度图在开启软粒子时无水场景仍运行，不标 `💧`*）。
   - **`📷` 特殊虚拟相机与独立剔除组**：切换了非主相机（`ShadowMap`, `Reflection`, `OceanDisplacement`）与独立 `visibleobjects` 剔除组（`Step 1`, `Step 2.1`–`2.2`, `Step 3.1`）。
   - **`👁️` 主相机玩家直视画面**：采用主相机 `Viewer` 且直接改写玩家可见的主帧/后缓冲画面（`Step 5.1`–`5.2`, `6.1`–`6.2`, `7.2`, `8.1`, `8.4`, `8.5`, `9.1`–`9.2`, `10.4`, `10.7`, `10.9`, `11`）。
   - **`🎞️` LDR 胶卷定影画片**：主画面经 `FXFilmLut` 色调映射冲印为 8-bit LDR `FrameBuffer` 后的步骤，警示不再是可随意叠加高动态光能量的 HDR 缓冲（`Step 10.9`, `Step 11`）。
3. **14 组 GPU 显存池芯片（VRAM Pool Chips，点击可高亮追踪单条显存轨道）**。
4. **生命线生命周期与交点算子图例（详见第 4 节）**。

---

## 2. 整体四栏式同步网格架构与父子步骤折叠交互

全表采用**纵向严格按时序对齐的父步骤与原子子步骤行**，每一行横向划分为 **4 个职责分明的列区（Zones）**，且顶部表头在页面向下滚动时**吸顶冻结（`position: sticky; top: 0`）**：

```text
+-----------------------+-----------------------------------+----------------------------+-----------------------------------------------------------------------------------+
| Zone 1                | Zone 2                            | Zone 3                     | Zone 4 (右侧 14 列 GPU 显存池生命线矩阵 · 无虚构编号 · 底部复用各资源名)         |
| CPU 注入与静态预制    | 渲染步骤、分类与 Shader 计算      | 本步产出与深度/混合状态    | FrameBuf | FrameRT | DepthBuf | DepthTex | DepthLin | ShadowTex | ShadowZ | ...   |
+=======================+===================================+============================+==========+=========+==========+==========+==========+===========+=========+=======+
|                       | [顶栏按钮: 展开全部35子步 / 折叠] |                            | (表头列名与格式规格，点击可聚焦/高亮单个轨道生命线与关联读写箭头)                  |
+-----------------------+-----------------------------------+----------------------------+----------+---------+----------+----------+----------+-----------+---------+-------+
| ▼ Step 0 🕒 [可折叠父步 header: 开局准备、显存一次性分配与首帧环境烘焙 (4 sub-steps)]                                                                                     |
|   ├─ Step 0.1 🕒      | D3DPOOL_DEFAULT 显存初始化分配    | 一次性创建 14 组常驻显存   |    ┆     |    ┆    |    ┆     |    ┆     |    ┆     |     ┆     |    ┆    | ...   |
|   ├─ Step 0.2 🕒      | initCustomTextures                | 绑定 7 张全局静态贴图      |    ┆     |    ┆    |    ┆     |    ┆     |    ┆     |     ┆     |    ┆    | ...   |
|   ├─ Step 0.3 🕒      | updateFrameRenderTargetToUse      | 决策主帧 RT 路由布尔量     |    ┆     |    ┆    |    ┆     |    ┆     |    ┆     |     ┆     |    ┆    | ...   |
|   └─ Step 0.4 🕒      | doRotateEnvironmentMaps (首帧6×2) | 首帧烘焙光空间双环境立方盒 |    ┆     |    ┆    |    ┆     |    ┆     |    ┆     |     ┆     |    ┆    |OVERWRITE|
+-----------------------+-----------------------------------+----------------------------+----------+---------+----------+----------+----------+-----------+---------+-------+
|   Step 1 📷☀️         | updateShadowTexture               | 写 ShadowMapTexture (z/w)  |    ┆     |    ┆    |    ┆     |    ┆     |    ┆     |  ──►CLEAR | ──►CLEAR| ...   |
+-----------------------+-----------------------------------+----------------------------+----------+---------+----------+----------+----------+-----║-----+----║----+-------+
| ▼ Step 4 [可折叠父步 header: updateDepthMap — 主相机离屏深度预通道与线性化 (2 sub-steps)]                                                                                  |
|   ├─ Step 4.1         | Pass 1: _CreateDepthMap 几何重绘  | 借用 DepthBuffer@v2 写 z/w |    ┆     |    ┆    |  ──►CLEAR|  ──►CLEAR|    ┆     |     ║     |    ┆    | ...   |
|   └─ Step 4.2         | Pass 2: PostFX_LinearDepth Shader | Shader逆投影计算 viewPos.z |    ┆     |    ┆    |    ┆     |◄──SAMPLE |──►OVERWRITE|   ║     |    ┆    | ...   |
+-----------------------+-----------------------------------+----------------------------+----------+---------+----------+----------+----║-----+-----║-----+---------+-------+
| ...                   | ...                               | ...                        |    ║     |    ┆    |    ┆     |    ┆     |    ┆     |     ┆     |    ┆    | ...   |
+=======================+===================================+============================+====║=====+====┆====+====┆=====+====┆=====+====┆=====+=====┆=====+====┆====+=======+
| [帧末显存留存底栏]    | ↻ 全显存跨帧持久留存 (所有资源帧末绝不销毁，未清零像素直接跨帧)  | FrameBuf | FrameRT | DepthBuf | DepthTex | DepthLin | ShadowTex | ShadowZ | ...   |
+-----------------------+-----------------------------------+----------------------------+----------+---------+----------+----------+----------+-----------+---------+-------+
```

### 父步骤与原子子步骤折叠/展开交互（Collapsible Sub-steps）
- 全管线共 **12 个顶层父步骤（`Step 0` ~ `Step 11`）**，其中包含密集读写切换的 10 个复合父步骤拆分为 **35 个原子子步骤行**（`Step 1` 与 `Step 11` 本身即为单次原子步骤）。
- **为什么必须拆成原子子步骤？** 拆分后，每一行子步骤在任何一个显存轨道单元格内**最多只有 1 个操作芯片**（彻底消灭同一单元格内纵向堆叠多操作芯片的混乱现象），且“先读谁 $\rightarrow$ 经哪个 Shader $\rightarrow$ 后写谁”的因果箭头在纵向自上而下一目了然。
- **折叠与展开**：
  - 点击任意复合父步骤标题栏（如 `▼ Step 0`、`▼ Step 2 · updateWaterReflection` 或 `▼ Step 10 · renderPostEffects`）可单独折叠/展开其下属子步骤；折叠状态下父行聚合显示该步骤涉及的读写算子摘要。
  - 顶部工具栏提供 **`[折叠为 12 主步骤 / 展开全部 35 原子子步骤]`** 一键切换按钮（默认展开全部 35 个原子子步骤以完整展现微时序）。

---

## 3. 右侧显存池 14 条垂直轨道定义（按重要性排序 · 无虚构编号）

右侧显存池按核心重要性排列为 **14 条垂直轨道**（新增独立的 **`ShadowMapDepthBuffer`** 紧挨 `ShadowMapTexture`）：

| 排序 | 轨道变量名 (SCRAPE 标识符) | 顶部表头规格标签 (尺寸 / 格式) | 轨道核心职责与跨帧/借用说明 | 建议语义色相 |
|---|---|---|---|---|
| 1 | **`FrameBuffer`** | `FullRes ($WW3D.FrameBufferSize)`<br>`X8R8G8B8 (BackBuffer color0)` | 最终硬件显示后缓冲（`Step 10.9` Tonemap Resolve 写入 8-bit LDR $\rightarrow$ `Step 11` 叠画 2D UI $\rightarrow$ `Present`） | 琥珀金 (`#f59e0b`) |
| 2 | **`FrameRenderTarget`** | `FullRes ($WW3D.FrameBufferSize)`<br>`HDR FP16 / A8R8G8B8 (edram)` | 主场景离屏颜色目标（贯穿 `Step 5.1` ~ `Step 10.8`，经历 `@v1..@v7` 及 `10.2` 临时偏移场） | 电光青 (`#3dd6c6`) |
| 3 | **`DepthBuffer`** | `FullRes (1x · 无AA时 FrameDepth=0×0)`<br>`D24S8 (24-bit Z + 8-bit Stencil)` | 主硬件深度与模板表面：**`@v1` (`Step 2.1–2.2` 反射借用左上 `512²` 子区域)** $\rightarrow$ **`@v2` (`Step 4.1` 深度图全屏借用)** $\rightarrow$ **`@v3` (`Step 5.1–10.2` 主场景全屏 Z + Stencil `bit 0..2`)** | 紫罗兰 (`#a855f7`) |
| 4 | **`DepthTexture`** | `FullRes ($PostEffect.FrameBufferSize)`<br>`R32F (Nonlinear z/w)` | 主视角非线性 NDC 深度（`Step 4.1` 几何重绘写入 $\rightarrow$ `Step 4.2` 被 Shader 采样后本帧使命结束） | 玫瑰红 (`#f43f5e`) |
| 5 | **`DepthTextureLinear` (`WW3D.DepthTexture`)** | `FullRes ($PostEffect.FrameBufferSize)`<br>`R32F (Linear viewPos.z)` | **核心跨阶段线性深度**：`Step 4.2` Shader 写出 $\rightarrow$ `Step 6.1/6.2` (水下) $\rightarrow$ `Step 9.1` (软粒子) $\rightarrow$ `Step 10.2` (扭曲软粒子) | 醒目亮橙 (`#fb923c`) |
| 6 | **`ShadowMapTexture`** | `$Sas.Shadow[0].MapSize²`<br>`R32F (Sas.Shadow[0].ShadowMap)` | 太阳平行光正交阴影深度图（`Step 1` 写入 $\rightarrow$ `Step 5.1/5.2` 与 `Step 7.2` 采样） | 珊瑚红 (`#ef4444`) |
| 7 | **`ShadowMapDepthBuffer`** | `$Sas.Shadow[0].MapSize²`<br>`D24S8 (Shadow Z-Buffer)` | **太阳阴影专属硬件深度缓冲**（因 `MapSize²` 可达 `2048²` > 低分辨率屏幕，独立分配供 `Step 1` 写/测 Z） | 暗绯红 (`#dc2626`) |
| 8 | **`WaterReflectionTexture`** | `512 × 512`<br>`$WW3D.FrameRenderTargetTextureFormat` | 水面镜像反射纹理 (`Water.ReflectionTexture`：`Step 2.1` 清屏写不透明 $\rightarrow$ `Step 2.2` 叠加半透明/粒子 $\rightarrow$ `Step 7.2` 水面采样) | 天空蓝 (`#38bdf8`) |
| 9 | **`OceanDisplacementTexture` (×2)** | `1024 × 1024`<br>`A16B16G16R16F (Ping-Pong ×2)` | 海浪动态位移双纹理组（`Step 3.1` 写主纹理 $\rightarrow$ `Step 3.2 BlurU` 写 `Texture2` $\rightarrow$ `Step 3.3 BlurV` 写回主纹理 $\rightarrow$ `Step 7.2` 水面采样） | 海洋翠绿 (`#10b981`) |
| 10 | **`PostEffectFrameBufferTexture`** | `FullRes ($PostEffect.FrameBufferSize)`<br>`$WW3D.FrameRenderTargetTextureFormat` | **四次抓屏复用中转站 + 跨帧保留典型**：在 `Step 7.1` 前保留着 **上一帧 `Step 10.8` 残留的最终 HDR 画面（采样即触发画中画）**；本帧先后充当 `@v1 折射` (`7.1`)、`@v2 扭曲备份` (`10.1`)、`@v3 泛光备份` (`10.5`)、`@v4 LUT备份` (`10.8`) | 宝蓝 (`#60a5fa`) |
| 11 | **`DistortionOffsetTexture`** | `FullRes ($PostEffect.FrameBufferSize)`<br>`A8R8G8B8` | 热浪扭曲 UV 偏移场（`Step 10.3` 从主帧 `stretchrect` 抓取 $\rightarrow$ `Step 10.4` 被 `PostFX_Distortion.fx` 采样） | 洋红 (`#e879f9`) |
| 12 | **`BloomTextures` (×6)** | `High0/1 · Med0/1 · Low0/1`<br>`$PostEffect.Bloom.TextureFormat` | 6 张泛光金字塔纹理（`Step 10.6` 内部降采样与 11×11 高斯模糊乒乓累加 $\rightarrow$ `Step 10.7` 采样 `High1`） | 霓虹粉 (`#f472b6`) |
| 13 | **`OutlineTextureFill` $\rightarrow$ `OutlineTexture`** | `FullRes` $\rightarrow$ `$WW3D.Outline.TextureSize`<br>`A8R8G8B8 (×2)` | Stencil 发光描边双纹理组（`Step 8.2` 提取纯色剪影至 `Fill` $\rightarrow$ `Step 8.3 BlurBox` 膨胀至 `OutlineTexture` $\rightarrow$ `Step 8.4` 反向抠图合成回主帧） | 亮柠檬 (`#facc15`) |
| 14 | **`EnvironmentDestinationCube` (×2)** | `128 × 128 × 6 (autogenmipmap)`<br>`Objects & Water.LightSpaceEnvMap` | 光照空间双环境立方盒（`Step 0.4` 首帧 `6×2` Quad 旋转烘焙一次后跨帧常驻，`Step 2.1, 5.1, 5.2, 7.2, 8.1` 只读采样） | 青碧 (`#2dd4bf`) |

---

## 4. 生命线首尾徽章、线段三态与交点算子规范

### 4.1 显存分配位置与跨帧留存机制（Allocation in Step 0.1 & Bottom Persistence Row）
- **显存分配位置**：所有 14 组 `var surface` / `var texture` 的一次性分配由顶栏独立行合并进入 **`Step 0.1`（开局与地图加载期 D3DPOOL_DEFAULT 显存初始化）**，不在每条轨道顶端添加多余的重复 Load 徽标。
- **轨道底端（`Step 11` 下方帧末总结栏）**：
  - 14 列底部**直接复用该资源自身变量名与短格式规格**（与顶列表头对称呼应），免去长页面滚动回顶部的阅读成本。
  - 左侧 3 栏统一定义并注明：**`↻ 全显存跨帧持久留存 (Cross-Frame Persistence)`**（所有 D3DPOOL_DEFAULT 资源在帧末绝不销毁；若本帧未被清空或覆写，上帧像素完整保留至下一帧，直观揭示“画中画”嵌套与分帧模糊的底层成因）。

### 4.2 垂直生命线线段三态（彻底摒弃误导性的“Idle 空闲可复用”表述）
1. **本帧新数据活跃实线（`║` Solid Glowing Line）**：从该显存被写入**本帧**有效数据起，至本帧最后一个消费步骤读取完毕止，垂直轨道呈高对比度彩色实线。
2. **首帧烘焙跨帧常驻虚线（`┇` Colored Dashed Line）**：专用于 `EnvironmentDestinationCube (×2)`，表示在 `Step 0.4` 首帧烘焙后，跨所有后续帧持续携带有效只读数据。
3. **本帧未覆写（携带上帧 `Frame N-1` 残留数据）/ 本帧已消费完毕暗线（`┆` Dim Persistence Line）**：
   - 在本帧首次写入之前：显存中**正驻留着上一帧最后一次写入的旧像素**（例如 `PostEffectFrameBufferTexture` 在 `Step 1` ~ `Step 6` 期间一直驻留着上一帧 `Step 10.8` 的完整 HDR 画面；此时若被采样即产生“画中画”递归嵌套）。
   - 在本帧最后一次读取之后：本帧无需再读，但**显存槽位绝未释放，像素继续原样保留至下一帧被 Clear 或覆写为止**。

### 4.3 交点操作算子符号与水平因果流向箭头（6 种清晰大写语义芯片）

| 语义芯片 | 英文全称 | 核心含义与硬件行为 | 水平因果箭头绘制规则 | 典型子步骤示例 |
|---|---|---|---|---|
| **`CLEAR`** | `Clear & Write` | **清屏新建写入**：目标被全屏 Clear（清零或填充初值），随后由几何网格或全屏 Pass 写入 | 从 Zone 2 向右拉出**实线箭头 `──►`** 指向该轨道芯片 | `Step 1` (`ShadowMapTexture` & `ShadowMapDepthBuffer`), `Step 2.1/4.1/5.1` (`DepthBuffer` 三次清屏) |
| **`OVERWRITE`** | `Overwrite` | **全屏覆写写入**：无需 Clear，由全屏 Shader Quad 100% 覆写全部像素 | 从 Zone 2 向右拉出**实线箭头 `──►`** 指向该轨道芯片 | `Step 3.3` (`BlurV`), **`Step 4.2` (`PostFX_LinearDepth` 写 `DepthTextureLinear`)**, `Step 10.4/10.7/10.9` |
| **`BLEND`** | `Mutate / Blend` | **原地修改 / 混合叠加**：在已有像素或 Stencil 缓冲区上叠加绘制、AlphaBlend、水面局部绘制或写入特定 Stencil 标记位 | 从 Zone 2 向右拉出**实线箭头 `──►`** 指向该轨道芯片 | `Step 2.2` (反射透明物), `Step 5.2` (写单位与轮廓 Stencil), `Step 6.1/6.2/7.2/8.1/8.4/8.5/9.1/9.2` |
| **`COPY`** | `StretchRect Copy` | **硬件表面块拷贝**：**仅限 `stretchrect` 硬件命令**快速抓取当前渲染表面快照至纹理备份槽 | 从源轨道 `COPY` 向目标轨道 `OVERWRITE` 拉出**点线拷贝箭头 `┄┄►`** | `Step 7.1` (#1 折射), `Step 10.1` (#2 扭曲备份), `Step 10.3` (抓偏移图), `Step 10.5` (#3 泛光备份), `Step 10.8` (#4 LUT备份) |
| **`SAMPLE`** | `Read / Sample` | **Shader 只读纹理采样**：由 Pixel Shader / Vertex Shader 通过 `tex2D` / `texCUBE` / `tex3D` 进行纹理查表计算 | 从该轨道 `SAMPLE` 向左拉出**虚线读取箭头 `◄┄┄`** 指向 Zone 2 Shader | **`Step 4.2` (读 `DepthTexture` 进 Shader 算线性深度)**, `Step 6.1/6.2/9.1/10.2` (读 `WW3D.DepthTexture`) |
| **`TEST`** | `Depth / Stencil` | **硬件深度/模板测试**：只读 `Z-Test` 或 `Stencil` 掩码遮罩判定（不写入 Z 或仅比对掩码） | 从该轨道 `TEST` 向左拉出虚线箭头指向 Zone 2 | `Step 2.2` (`DepthBuffer` 左上 `512²` 测 Z), `Step 8.2` (`Stencil==1/2/3`), `Step 8.4` (`Stencil==0`), `Step 9.1` (软粒子 Z-Test) |

### 4.4 三种独立数据流连线规范（Dataflow Arrow Categories）与多重采样双芯片规则

1. **Shader 渲染写入流 (`Shader Write`)**：
   - **连线形态**：实线 `──►`（实心箭头向右指向目标轨道芯片）
   - **硬件行为**：Draw Call 几何体绘制或全屏 Quad Pixel Shader 计算写出至目标 Render Target / DepthBuffer。
2. **Shader 纹理采样读取流 (`Shader Read (Sample)`)**：
   - **连线形态**：虚线 `◄┄┄`（`stroke-dasharray: 4 3`，箭头向左指向 Zone 2 步骤卡片）
   - **硬件行为**：Pixel Shader / Vertex Shader 通过 `tex2D` / `texCUBE` / `tex3D` 进行纹理查表与多重采样卷积计算。
3. **硬件表面直接块拷贝流 (`StretchRect Copy`)**：
   - **连线形态**：点状虚线 `┄┄►`（`stroke-dasharray: 3 3`，从源轨道 `COPY` 芯片直连目标轨道 `OVERWRITE` 芯片，**完全不经过 Zone 2 着色器**）
   - **硬件行为**：调用 D3D9 `IDirect3DDevice9::StretchRect`，由显卡专用硬件单元直接进行显存表面跨格式/全屏快照拷贝。
4. **同轨乒乓模糊双芯片规则（Multi-Pass Ping-Pong Sampling Rule）**：
   - 针对 `OceanDisplacement (×2)`（`Step 3.2 BlurU`, `Step 3.3 BlurV`）、`OutlineTextures (×2)`（`Step 8.3 BlurBox`）与 `BloomTextures (×6)`（`Step 10.6 金字塔多级高斯`）等依赖多重采样的多 Pass 模糊滤波步骤，同一个轨道单元格内**纵向堆叠渲染两个独立芯片**：
     - **上层 `SAMPLE` 芯片**：向左拉出**虚线读取箭头 `◄┄┄`** 指向 Zone 2 Shader（体现着色器对上一轮纹理进行 21-tap / 11×11 抽头采样查表）。
     - **下层 `OVERWRITE` 芯片**：由 Zone 2 向右拉出**实线写入箭头 `──►`** 连入芯片（体现模糊卷积完成后写回目标缓冲）。
   - 彻底消灭“模糊步骤只标写入、缺失输入采样来源”的问题，完整还原硬件时序真实读写闭环。
