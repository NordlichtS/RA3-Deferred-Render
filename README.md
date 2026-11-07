# RA3-Deferred-Render

> 将《命令与征服：红色警戒 3》（**Red Alert 3 v1.12，Windows PC 版**）的 Opaque Geometry 渲染从 **Forward Shading** 升级为 **Deferred Shading**（支持 `PBR`、`IBL` 与无数量上限的 Local `Light Volume`），同时完整保留 `Water Refraction/Reflection`、`Decal`、Translucent、`Soft Particle`、`PostFX`（`Distortion` / `Bloom` / `LUT`）与 `HUD` 层级。
>
> 本项目基于 EA 公开的 RA3 / C&C4 Shader 与 SCRAPE 源码，仅用于非商业、学术研究与社区 Mod 开发。

---

## 1. 核心目标与当前进展

- **核心目标**：在不修改闭源引擎二进制（`ra3_1.12.game`）的前提下，纯粹通过 **SCRAPE Pipeline Script（`.scrapeo`）** 与 **Direct3D 9 HLSL Effect（`fx_2_0` / `vs_3_0` / `ps_3_0`）** 实现 4×32bpp `MRT G-Buffer`、全屏 `Deferred Composite`（GGX `PBR` + `IBL` + `Screen-Space Shadow`）与 `Back-Face` Local `Light Volume`。
- **当前进展**（详见 [`ROADMAP.md`](ROADMAP.md) 与 [`plans/task-board.md`](plans/task-board.md)）：
  - ✅ **Phase R（研究与知识基础）已完成**：完成原版管线逆向勘误、VRAM 生命周期建模、项目专有 Skills / Dictionaries / Knowledge 蒸馏，以及 98 张可执行任务卡规划。
  - ⏳ **Phase 0–8（工程实施）待启动**：即将从 `P0`（构建工具链与部署基准）与 `P1`（引擎 `MRT` / `Shader Override` 实机探针）开始执行。

---

## 2. 原版管线图表与基准文档（`diagrams/` 快速入口）

GitHub 读者可直接点击以下链接查看原版渲染管线分析成果：

- 📊 **[交互式 HTML 图表：`RA3 Render Pipeline VRAM control.html`](diagrams/RA3%20Render%20Pipeline%20VRAM%20control.html)**
  - 原版每帧 `RenderTarget` / `DepthStencilSurface` 显存生命周期、状态流转与 `Pass` 拓扑交互式视图（克隆到本地后双击即可在浏览器中打开；GitHub 在线浏览可查看源码或配合 HTML Preview 工具打开）。
- 📖 **[原版管线事实基准：`vanilla-pipeline-reference.md`](diagrams/vanilla-pipeline-reference.md)**
  - 逐 `Pass` 拆解 `main/ingame.scrapeo` 的 `Camera`、`VisibleSet`、`RenderBin` 提交顺序与引擎 C++ 绑定契约。
- 📐 **[VRAM 生命线矩阵设计规范：`design-B-vram-lifeline-matrix.md`](diagrams/design-B-vram-lifeline-matrix.md)**
  - 原版全帧 `Surface` 分配、复用与带宽开销矩阵。

---

## 3. 工作区目录（Workspace Directory）

```text
RA3-Deferred-Render/
├─ AGENTS.md            # AI Agent 总纲：硬约束、外部资源索引与按需知识路由（Agent 必读）
├─ README.md            # 项目概览、图表入口与目录导航（本文件）
├─ ROADMAP.md           # 阶段路线图、设计基线与 LLM 贡献溯源档案
├─ main/                # 主开发区：HLSL (.fx/.fxh) 与 SCRAPE (.scrapeo) 源码；含基线 COMMON.FXH、ingame.scrapeo
├─ tools/               # 工具与脚本目录：fxc / texconv 等工具（EXE 已 gitignore）及构建/临时辅助脚本
├─ plans/               # 分阶段实施计划：task-board.md 与 phase-0..8/K 任务卡
├─ .agents/skills/      # 项目专有 Skills：ra3-scrape-pipeline、ra3-fx-shader
├─ dictionaries/        # 紧凑查表：SCRAPE 命令、RenderBin、Register/SAS、Engine Ground Truth (GT-xx)
├─ knowledge/           # 知识库：引擎行为详解、待实测问题 (OQ-xx)、SM3 Deferred Shading 技术方案
├─ diagrams/            # 原版管线事实基准文档与交互式 HTML 显存生命线图表
├─ readonly/            # 历史归档（只读，gitignored）：官方源码备份、反编译、前代分析
└─ outdated/            # 已废弃的旧版产物（只读，gitignored）
```

---

## 4. 外部资源索引目录（External Resources Index）

### 4.1 本机外部源码与 SDK 路径（Read-Only）

| 资源名称 | 本机路径 | 说明 |
|---|---|---|
| **自研简化分层架构 (`FXFXH`)** | `C:\Desktop01\MYGITHUB\custom-shaders-RedAlert3\FXFXH` | **本项目 HLSL 代码基线**（可直接用 `fxc.exe` 编译） |
| **EA 官方 RA3 源码备份** | `D:\PROJECTS\SAGE shader source\RA3_Shaders` | 官方 `.fx` / `.fxh` / `.scrape` 源码（只读对照） |
| **EA 官方 C&C4 源码备份** | `D:\PROJECTS\SAGE shader source\CC4_Shaders` | 官方 C&C4 Shader 与延迟光照数学参考 |
| **Corona Mod（日冕）Shader** | `D:\PROJECTS\SAGE shader source\CORONA Shaders 240820`<br/>`C:\Desktop01\MYGITHUB\TMP FIX CORONA\326shaders` | 社区 `PBR` / `IBL` / `Irradiance Cubemap` 实现参考 |
| **Microsoft DirectX SDK (June 2010)** | `C:\Program Files (x86)\Microsoft DirectX SDK (June 2010)\` | 本机旧版 D3D9 SDK（含 `fxc.exe`、头文件与文档） |
| **Microsoft Win32 Direct3D 离线文档** | `D:\GITLABS\msdocs-win32-direct3d` | 微软 Win32 Direct3D 9 / HLSL 离线文档仓库 |

### 4.2 在线官方发布页与文档链接

- **EA 官方 RA3 Shaders & SCRAPE 发布页**：https://github.com/electronicarts/CnC_Modding_Support/tree/main/Red%20Alert%203/Shaders
- **EA 官方 C&C4 Shaders & SCRAPE 发布页**：https://github.com/electronicarts/CnC_Modding_Support/tree/main/Tiberian%20Twilight/Shaders
- **Microsoft Learn — Writing HLSL Shaders in Direct3D 9**：https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-writing-shaders-9
- **Microsoft Learn — HLSL Language Reference**：https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-reference
- **Microsoft Learn — Direct3D 9 Effect Format (`fx_2_0`)**：https://learn.microsoft.com/en-us/windows/win32/direct3d9/effect-format

---

## 5. 快速开始

- **AI Agent**：先读 [`AGENTS.md`](AGENTS.md)，再从 [`plans/README.md`](plans/README.md) 与 [`plans/task-board.md`](plans/task-board.md) 领取任务卡。
- **人类开发者**：先看 [`ROADMAP.md`](ROADMAP.md) 与 [`diagrams/RA3 Render Pipeline VRAM control.html`](diagrams/RA3%20Render%20Pipeline%20VRAM%20control.html)。
