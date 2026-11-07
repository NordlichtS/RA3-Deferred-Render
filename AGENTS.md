# AGENTS.md — RA3-Deferred-Render 总纲与按需知识路由

> **原则**：Progressive Disclosure（渐进式披露）。本文件仅保留**硬约束、目录索引、外部资源索引与按需知识路由**。图形学术语统一使用**英文原名**以消除中文翻译歧义。
> 概览见 [`README.md`](README.md)；阶段与 LLM 溯源见 [`ROADMAP.md`](ROADMAP.md)；可执行任务卡见 [`plans/README.md`](plans/README.md)。

---

## 1. 项目目标与平台红线

- **目标**：将 **Red Alert 3 v1.12（Windows PC）** 的 Opaque Geometry 从 **Forward Shading** 升级为 **Deferred Shading**（支持 `PBR`、`IBL` 与无数量上限的 Local `Light Volume`），保持 `Water Refraction/Reflection`、`Decal`、Translucent、`Soft Particle`、`PostFX`（`Distortion` / `Bloom` / `LUT`）与 `HUD` 的正确层级。
- **技术栈**：
  1. **Direct3D 9 HLSL**（`.fx` / `.fxh` → `tools/fxc.exe` 或 `main/fxc.exe` 编译为 `.fxo`；`fx_2_0` 容器，`Pass` 使用 `vs_3_0` / `ps_3_0`）。
  2. **SCRAPE Pipeline Script**（`.scrape` / `.scrapeh` 展开为 `.scrapeo`；引擎仅加载 `.scrapeo` 并逐行解析）。
- **平台红线**：
  - 仅 **`EA_PLATFORM_WINDOWS`**；严禁 `XENON` / `PS3` 分支与主机命令（`setgpr`、`gpuflush`、`resolve`、`*tiling`、四参数 `settarget`）。
  - **C&C4 源码仅作数学/架构参考**：RA3 1.12 不存在 `fromscope static` 与 `renderDeferredLights`（合法 `fromscope <Block> <Parm>` 可用）。
  - `Deferred Shading` 分支**禁用硬件 `MSAA`**，且以 `WW3D.IsHdrEnabled == true`（FP16 `FrameRenderTarget`）为前提；否则整帧回退 Vanilla `Forward Shading`。
  - 所有 `sRGB` ↔ `Linear Space` 转换在 HLSL 内显式计算（D3D9 `MRT` 下 `SRGBWRITEENABLE` 仅作用于 `RT0`）。

---

## 2. 工作区目录（Workspace Directory）

| 路径 | 读写权限 | 职责 |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) / [`README.md`](README.md) / [`ROADMAP.md`](ROADMAP.md) | 读写 | Agent 总纲 / 人类概览 / 阶段路线图与 LLM 溯源档案 |
| [`main/`](main/) | **主开发区（读写）** | HLSL（`.fx`/`.fxh`）与 SCRAPE（`.scrapeo`）源码。基线：[`COMMON.FXH`](main/COMMON.FXH)、[`ingame.scrapeo`](main/ingame.scrapeo) |
| [`tools/`](tools/README.md) | **工具与脚本（读写）** | 编译器/纹理工具（`fxc.exe`、`texconv.exe` 等，二进制已 gitignore）及构建/临时辅助脚本 |
| [`plans/`](plans/README.md) | **实施计划（读写）** | 任务看板 [`task-board.md`](plans/task-board.md) 与 `phase-0..8/K` 任务卡 |
| [`.agents/skills/`](.agents/skills/) | **项目技能（读写）** | [`ra3-scrape-pipeline`](.agents/skills/ra3-scrape-pipeline/SKILL.md)、[`ra3-fx-shader`](.agents/skills/ra3-fx-shader/SKILL.md) |
| [`dictionaries/`](dictionaries/) | **紧凑查表（读写）** | SCRAPE 命令、`RenderBin`、Register/SAS、实机真理账本（`GT-xx`） |
| [`knowledge/`](knowledge/) | **知识库（读写）** | 引擎行为详解、待实测问题（`OQ-xx`）、SM3 `Deferred Shading` 技术方案 |
| [`diagrams/`](diagrams/) | **原版管线基准（定稿）** | [`vanilla-pipeline-reference.md`](diagrams/vanilla-pipeline-reference.md)、[`design-B-vram-lifeline-matrix.md`](diagrams/design-B-vram-lifeline-matrix.md)、[`RA3 Render Pipeline VRAM control.html`](diagrams/RA3%20Render%20Pipeline%20VRAM%20control.html) |
| `readonly/` / `outdated/` | **只读归档（gitignored）** | 原始源码、反编译、前代分析与废弃旧文件；仅在追溯原始证据时按需检索 |

---

## 3. 外部资源索引目录（External Resources Index）

> 以下本机路径与在线文档不在本 Git 仓库内；本机路径**严格只读**，严禁写入或混入仓库提交。

### 3.1 本机代码与 SDK 备份（Local Paths — Read-Only）

| 类别 | 本机绝对路径 | 用途与说明 |
|---|---|---|
| **自研分层 Shader 基线 (`FXFXH`)** | `C:\Desktop01\MYGITHUB\custom-shaders-RedAlert3\FXFXH` | **本项目 HLSL 代码基线**（可被 `fxc.exe` 零报错编译；含分层 `.fxh`、PBR、点光与 Screen-Space Shadow 原型） |
| **EA 官方 RA3 源码备份** | `D:\PROJECTS\SAGE shader source\RA3_Shaders` | 官方 `.fx` / `.fxh` / `.scrape` / `.scrapeh` 源码（直接用 `fxc.exe` 编译会报 `X1516`，仅作对照参考） |
| **EA 官方 C&C4 源码备份** | `D:\PROJECTS\SAGE shader source\CC4_Shaders` | C&C4 延迟光照与 `.fx` 源码（仅作数学/着色参考，禁用其专属 SCRAPE 命令） |
| **Corona Mod（日冕）Shader** | `D:\PROJECTS\SAGE shader source\CORONA Shaders 240820`<br/>`C:\Desktop01\MYGITHUB\TMP FIX CORONA\326shaders` | 社区 Mod 的 `PBR`（GGX/Smith/Schlick）、`IBL`（`Irradiance Cubemap` + `Prefiltered EnvMap`）与 SCRAPE 扩展参考 |
| **Microsoft DirectX SDK (June 2010)** | `C:\Program Files (x86)\Microsoft DirectX SDK (June 2010)\` | 官方旧版 D3D9 SDK（含 `Include\`、`Lib\`、`Utilities\bin\x86\fxc.exe` 与离线文档） |
| **Microsoft Win32 Direct3D 离线文档** | `D:\GITLABS\msdocs-win32-direct3d` | 微软官方 Win32 D3D9 / HLSL Markdown 离线文档库（供全局技能检索） |
| **全局 Agent 技能** | `C:\Users\HP\.agents\skills\` | `hlsl-directx-reference`（SM≤3.0 规范）、`shader-programming`（通用着色算法） |

### 3.2 在线官方源码与技术文档（Online URLs）

| 资源名称 | 链接 |
|---|---|
| **EA 官方 RA3 Shaders & SCRAPE (GitHub)** | https://github.com/electronicarts/CnC_Modding_Support/tree/main/Red%20Alert%203/Shaders |
| **EA 官方 C&C4 Shaders & SCRAPE (GitHub)** | https://github.com/electronicarts/CnC_Modding_Support/tree/main/Tiberian%20Twilight/Shaders |
| **EA CnC Modding Support 主仓库** | https://github.com/electronicarts/CnC_Modding_Support |
| **Microsoft Learn — Writing HLSL Shaders in Direct3D 9** | https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-writing-shaders-9 |
| **Microsoft Learn — HLSL Language & Intrinsics Reference** | https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-reference |
| **Microsoft Learn — Direct3D 9 Effect Format (`fx_2_0`)** | https://learn.microsoft.com/en-us/windows/win32/direct3d9/effect-format |
| **Microsoft Learn — Direct3D 9 Graphics Reference** | https://learn.microsoft.com/en-us/windows/win32/direct3d9/dx9-graphics |

---

## 4. 硬约束（Hard Constraints）

### 4.1 HLSL / Effect (`fx_2_0` + `vs_3_0` / `ps_3_0`)
1. **Shader Model ≤ 3.0**：严禁 SM4+ 语法（`cbuffer`、`Texture2D.Sample`、`SV_*`、`mad()` / `rcp()` / `asfloat()` 函数形式）。
2. **Register Contract**：严禁挪动或占用引擎固化寄存器 `c0..c10`、`c89..c127`、`vs c128..c255`（Hardware `Skinning`）。包含 `COMMON.FXH` 时普通 Uniform 自动从 `c11` 起分配（安全区 `c11..c88`）；不含 `COMMON.FXH` 的文件必须显式绑定。
3. **SCRAPE ↔ HLSL 桥接**：SCRAPE 中 `settexture` / `setfloat` / `setbool` 写入的参数，HLSL 统一用 `string SasBindAddress = "<Block>.<Parm>";` 读取。
4. **编译参数**：始终附加 `/D _WW3D_ /I main`（漏加 `/D _WW3D_` 会静默生成 3dsMax 变体）。无头环境下严禁对 `/T fx_2_0` 使用 `/Fc`（会报 `Failed to create D3D device`），查看汇编一律用 `/T ps_3_0` 或 `/T vs_3_0` 单入口模式。

### 4.2 Direct3D 9 `Deferred Shading` / `MRT`
1. `G-Buffer Pass` 禁用 `AlphaTestEnable` / `AlphaBlendEnable`，Alpha Cutout 一律用 PS `clip()`；`G-Buffer Pass` **不带** `ExpressionEvaluator` 注解，所有 `RenderState` 显式书写。
2. **硬件 `D24S8` `DepthBuffer` 不可采样**：Linear Depth `viewPos.z` 写入 `RT3`（`R32F`），须与原版 `PostFX_LinearDepth` 输出等价并绑定为 `WW3D.DepthTexture`（`casttexture` 在 PC 上为 NoOp）。
3. 同时绑定的 `MRT` **Bit Depth 必须一致**（4×32 bpp）；`clear` 会将所有已绑定 `RT` 清为同一颜色；离屏 `MRT` 结束后必须显式 `settarget 1/2/3 NULL`。
4. 全屏 Quad / `VPOS` 采样必须补偿 **Half-Pixel Offset**：`uv = (vpos.xy + 0.5) / FrameBufferSize`；Lighting PS 读取 `G-Buffer` 一律使用 `tex2Dlod(..., float4(uv, 0, 0))` + `Point Sampling` + `Clamp`。
5. **`Stencil` 位分配**：`bit0..1` 原版 `Outline`、`bit2` 原版 `Decal`；Deferred 标记**只用 `bit7`（`0x80`）**（待 OQ-13 确认）。
6. `MRT` 下 Blend State 对所有 `RT` 共用；引擎不支持保存/恢复 `ColorWriteEnable1..3`（见 D16）。

### 4.3 SCRAPE
1. 每行（含换行符）**< 256 Bytes**（工程上限 ≤ 200 Bytes）；运行时不展开宏，直接改 `.scrapeo` 时写字面量与 ASCII 注释。
2. `callproc` 不保存状态；必须**先 `setdepth` 再 `settarget`**（`Viewport` 尺寸取最后设置的 Target）。
3. `end{Shadow,Depth}OverrideTechnique` 会把**所有** Shader 的 Override 重置为 `-1`（含手动 `setshaderoverride`）；Override `Technique` 名不存在时**静默回退原 `Technique` 绘制**（存在 `G-Buffer` 污染风险）。
4. `RenderBin` 为固定 47 项枚举表，只用官方字符串名（未知名称静默解析为 `NONE`）；Local `Light Volume` 候选队列为 `StaticSort_END`（待 OQ-08 确认）。
5. `HUD`（`renderIconLayers` / `renderUI`）必须在 `renderPostEffects` 之后；`updateWaterRefraction` 必须在 `renderWater` 之前。

---

## 5. 按需知识路由表（On-Demand Routing）

| 任务场景 | 按需读取目标 |
|---|---|
| 编写/修改 `.scrape` / `.scrapeo`，插入 `Pass` | [`.agents/skills/ra3-scrape-pipeline/SKILL.md`](.agents/skills/ra3-scrape-pipeline/SKILL.md) → `references/`（`pass-templates.md`、`vanilla-frame-walkthrough.md`、`pitfalls.md`） |
| 查 SCRAPE 命令签名 / `RenderBin` 枚举 | [`dictionaries/scrape-command-dict.md`](dictionaries/scrape-command-dict.md)、[`dictionaries/renderbin-dict.md`](dictionaries/renderbin-dict.md) |
| 编写/修改 `.fx` / `.fxh`、`G-Buffer Technique`、Lighting Shader | [`.agents/skills/ra3-fx-shader/SKILL.md`](.agents/skills/ra3-fx-shader/SKILL.md) → `references/`（`material-family-inventory.md`、`fxfxh-architecture.md`、`corona-pbr-ibl-notes.md`、`fxc-workflow.md`） |
| 查 `c0..c255` Register 与 `SasBindAddress` | [`dictionaries/hlsl-register-sas-dict.md`](dictionaries/hlsl-register-sas-dict.md)、[`main/COMMON.FXH`](main/COMMON.FXH) |
| 查引擎底层行为（`Technique` 匹配、Override、`RT` 格式、Light 数据） | [`dictionaries/engine-ground-truth.md`](dictionaries/engine-ground-truth.md) → [`knowledge/engine-behavior.md`](knowledge/engine-behavior.md) |
| 查待实测问题或设计 Probe 实验 | [`knowledge/open-questions.md`](knowledge/open-questions.md)（`OQ-01..`） |
| 查 SM3 `Deferred Shading` 算法 / 编码 / `PBR` / `Light Volume` | [`knowledge/deferred-techniques-sm3.md`](knowledge/deferred-techniques-sm3.md) |
| 查原版每帧管线与 VRAM 生命周期 | [`diagrams/vanilla-pipeline-reference.md`](diagrams/vanilla-pipeline-reference.md)（行号以 [`main/ingame.scrapeo`](main/ingame.scrapeo) 为准） |
| 领取并执行开发任务卡 | [`plans/README.md`](plans/README.md) → [`plans/task-board.md`](plans/task-board.md) → `plans/phase-*.md` |
| 查 D3D9 / HLSL SM3.0 官方规范 | 全局技能 `hlsl-directx-reference` 或 MCP `microsoft-learn` |

---

## 6. 工程与协作准则

1. **KISS**：管线与 Shader 保持扁平直观，拒绝冗余 Fallback。
2. **实机真理优先**：IDA 静态推测 < 实机运行 / PIX / RenderDoc 抓帧 / `fxc.exe` 实测。新结论必须回写 [`engine-ground-truth.md`](dictionaries/engine-ground-truth.md) 并关闭对应 `OQ`。
3. **置信度标签**：条目统一标注 `✅已实机验证` / `✅fxc实测` / `📄源码确认` / `🔍IDA静态推测` / `❓待实测` / `📚文献` 并附 `[src: 路径#L行]`。
4. **USER-RUN 协议**：Agent 无法运行游戏，所有实机验证按 [`plans/README.md`](plans/README.md) §4 准备部署包与测试脚本交由用户执行。
5. **非代码文件不入库**：所有 `.exe` 工具、图片、`.fxo` 编译产物、`.asm` 临时反汇编与缓存均由 [`.gitignore`](.gitignore) 排除。
6. **LLM 贡献溯源登记**：在记录或更新项目进展、完成里程碑、制定规划或做出重大技术决策时（不含细微文字修正与纯代码格式化），必须显式标注负责的大模型名称与版本，并在 [`ROADMAP.md`](ROADMAP.md) §5 与 [`plans/task-board.md`](plans/task-board.md) 中同步登记。

---

## 7. 常用校验与编译命令

```powershell
# 1. SCRAPE 语法与 256-Byte 行长校验（期望：Checked 1 SCRAPE files; 0 warning(s).）
node ".agents/skills/ra3-scrape-pipeline/scripts/check_scrape.js" "main/ingame.scrapeo"

# 2. 编译完整 Effect（.fxo 输出到仓库外或被 gitignore 的目录）
& "tools\fxc.exe" /nologo /O2 /T fx_2_0 /D _WW3D_ /I main /Fo "FXO\output.fxo" "source.fx"

# 3. 导出单入口 SM3 汇编与 Register 分配表
& "tools\fxc.exe" /nologo /O2 /T ps_3_0 /E <PS_Entry> /D _WW3D_ /I main /Fc "ps_dump.asm" "source.fx"
& "tools\fxc.exe" /nologo /O2 /T vs_3_0 /E <VS_Entry> /D _WW3D_ /I main /Fc "vs_dump.asm" "source.fx"
```
