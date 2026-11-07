---
name: ra3-scrape-pipeline
description: >-
  Author, inspect, and safely edit Red Alert 3 v1.12 (Windows PC) SCRAPE / SCRAPEO render pipeline
  scripts (.scrape / .scrapeh / .scrapeo). Use when changing per-frame passes, MRT 0..3 / depth
  bindings, cameras, visible sets, RenderBin submissions, SCOPE bindings, shader overrides, or when
  inserting G-Buffer / deferred composite / fullscreen passes into main/ingame.scrapeo.
---

# RA3 SCRAPE 管线技能（RA3 1.12 PC · 实机优先）

> 置信度标签：`✅已实机验证`（出现在可运行的原版 `main/ingame.scrapeo` 或已发布的日冕 Mod 脚本中）/ `📄源码确认`（EA 官方 `.scrape(h)` 源码或注释）/ `🔍IDA静态推测`（`ra3_1.12.game` 帮助字符串或反编译）/ `❓待实测`。
> 冲突裁决：`diagrams/vanilla-pipeline-reference.md` 与 `dictionaries/distillation-and-issues-notes.md` 优先于 `readonly/` 中 GPT-5.6 旧文档；但两者与 `main/ingame.scrapeo` 原文冲突时，以 `.scrapeo` 原文为准（见 [pitfalls.md §6](references/pitfalls.md)）。

## 1. 何时使用 / 先读什么

| 任务 | 必读 |
|---|---|
| 任何 SCRAPE 编辑 | 本文件 §2–§6 + [pitfalls.md](references/pitfalls.md) |
| 查命令签名 / 语义 | [command-reference.md](references/command-reference.md)（全量）或 [`dictionaries/scrape-command-dict.md`](../../../dictionaries/scrape-command-dict.md)（速查） |
| 查 RenderBin 名称 / 谁提交 | [`dictionaries/renderbin-dict.md`](../../../dictionaries/renderbin-dict.md) |
| 语法、声明、属性、`$` 常量、SCOPE 条件 | [language-and-syntax.md](references/language-and-syntax.md) |
| 改帧顺序 / 找插入点 | [vanilla-frame-walkthrough.md](references/vanilla-frame-walkthrough.md)（带 `main/ingame.scrapeo` 行号） |
| 写新 Pass（G-Buffer / 合成 / 拷贝 / Override） | [pass-templates.md](references/pass-templates.md) |
| 改模块化源码 `.scrape/.scrapeh` 或想要构建脚本 | [preprocess-and-build.md](references/preprocess-and-build.md) |
| 参考日冕 Mod 的成功扩展手法 | [corona-mod-diff.md](references/corona-mod-diff.md) |

## 2. 执行模型（必须理解）

1. **引擎只加载预处理后的文本 `.scrapeo`**：`Shaders/Compiled/ingame.scrapeo`（游戏）/ `shell.scrapeo`（主菜单）。`.scrape/.scrapeh` 是 EA 的模块化源码，经 **C 预处理器**（`#include/#define/#if`）展开为 `.scrapeo`。`📄源码确认` + 本地 `gcc -E` 逐行复现 636/636 条有效行 [src: readonly/SCRAPE-RA3/InGame.scrape] [src: main/ingame.scrapeo]
2. **运行时逐行解析**：`#` 开头整行 = 注释（预处理器留下的 `# 1 "file"` 行号标记无害）；支持 `//` 与 `/* */`。`✅已实机验证`（原版首行即 `# 1 "c:\\..."`，日冕发布版用 `#` 写中文注释）[src: main/ingame.scrapeo#L1]
3. **单行硬上限：含行尾换行 < 256 字节**（UTF-8 中文每字 3 字节）。超长 = 加载失败。`🔍IDA静态推测`；工程上一律保持每行 ≤ 200 字节。原版最长行 150 字节。
4. **宏不会在运行时展开**：手改 `.scrapeo` 时写字面量（`renderbin Underwater 1`，不是 `BinCommand_RenderParticles`）。`✅` [src: main/ingame.scrapeo#L1464]
5. **入口过程**：游戏每帧执行 `proc InGame`，WorldBuilder 执行 `proc Editor`，主菜单 `shell.scrapeo` 的 `proc Shell`。其它 proc 只有被 `callproc` 到才会执行。`✅` [src: main/ingame.scrapeo#L1386] [src: main/ingame.scrapeo#L1519]
6. **`proc` 不可嵌套；`callproc`/`goto` 目标可前向引用**（加载后统一解析）；变量/过程/标签重名 = 加载失败。`🔍`
7. **`callproc` 不保存/恢复任何状态**：RT0..3、Depth、Viewport、Camera、可见集、当前 `setshader`、SCOPE 值、Shader Override 全部是全局可变状态。被调过程留下的状态就是调用约定的一部分。`📄`（原版 `setFrameRenderTarget` 等 helper 正是靠副作用工作）
8. **资源在加载时一次性分配、跨帧常驻、帧末不清零**：`var texture/surface` 的内容会保留到下一帧（可做 History Buffer，也会造成"画中画"残影）。显存 = 全部声明之和，不用的声明也占显存。`🔍` [src: diagrams/vanilla-pipeline-reference.md §1.4]

## 3. 条件分支与 SCOPE

- 语法：`if <Block> <Parm>` / `ifnot` / `elif` / `elifnot` / `else` / `endif`；只测试**布尔** SCOPE 参数；**无 AND/OR 运算符**——AND 用嵌套 `if`，OR 用 `if A … elif B …`（两分支写同一 `callproc`）。`✅` [src: main/ingame.scrapeo#L723-L730] [src: main/ingame.scrapeo#L778-L781]
- 自定义 SCOPE 块（如 `Deferred.IsEnabled`）可直接 `setbool/setfloat/settexture` 创建；未写过的布尔首次 `if` 为 false；值跨帧保留。`✅`（日冕 `Lanyi.*`）[src: readonly/ingame.scrapeo modded corona.txt#L13-L27] [src: readonly/ingame.scrapeo modded corona.txt#L93-L131]
- HLSL 侧用 `string SasBindAddress = "<Block>.<Parm>";` 读取（B2 技能负责细节）。
- 常用引擎条件：`WW3D IsHdrEnabled|IsAntiAliasingEnabled|IsUsingFrameRenderTarget|MustRefreshEnvironment|Outline.IsEnabled`、`Sas ShadowMappingEnabled`、`Water IsReflectionVisible|IsRefractionVisible`、`Particle IsSoftParticlesEnabled`、`PostEffect Distortion.IsEnabled|Bloom.IsEnabled|LookupTable.IsEnabled`、`DebugToggle *.IsEnabled`。全表见 [language-and-syntax.md §6](references/language-and-syntax.md)。

## 4. 核心命令（签名速览）

```text
var <type> <name> [attrs...]            // surface|texture|texturecube|texture3d|shader|camera|surfacegroup|scene|matrix
proc <Name> … endproc  /  callproc <Name>  /  return
settarget <0..3> <texture|surface|NULL> [cubeFace0..5]
setdepth <surface|NULL>                 // 只接受 surface（DepthBuffer / FrameDepthBuffer / ShadowMapDepthBuffer）
setcamera <cameraVar>                   // Viewer | ShadowMap | Reflection | OceanDisplacement
visibleobjects <Frame|ShadowMap|DepthMap|Reflection>   // 切换可见集，不绘制
setclearcolor r g b a / setcleardepth z [stencil] / clear | clearcolor | clearz
renderbin <BinName> [0|1]               // 0=普通对象 1=同名 bin 的粒子；不是 pass 号
render<Category>                        // 引擎回调：renderTerrain renderUnits renderStructures renderWater …
setshader <shaderVar> [technique]       // 只供随后 renderquad/renderfullquad 使用
renderquad [r g b a] / renderfullquad [r g b a]
settexture <Block> <Parm> <textureVar>  // 绑定到 SCOPE/SAS，不创建纹理
setfloat <Block> <Parm> x [y z w] / setbool <Block> <Parm> true|false / setint / settosize
stretchrect <src> <dst> [none|point|linear] [srcMip] [dstMip]
setshaderoverride <shader> <technique> / clearshaderoverride <shader>
beginShadowOverrideTechnique / beginDepthOverrideTechnique / end*OverrideTechnique (全局清空!)
beginevent <Name> … endevent <Name>
```
完整语义、置信度与原版行号见 [command-reference.md](references/command-reference.md)。

## 5. 标准 Pass 骨架（精简版；完整版见 [pass-templates.md](references/pass-templates.md)）

**场景 Pass**（显式建立 5 件套：Depth → RT → Camera → 可见集 → Clear）：
```text
setdepth DepthBuffer            // 先 depth 后 RT：视口取"最后设置的 RT/Depth"尺寸 [📄 WaterReflection.scrapeh#L33]
settarget 0 MyColorTex
setclearcolor 0 0 0 1
setcleardepth 1.0
clear
setcamera Viewer
visibleobjects Frame
renderTerrain
renderbin Solid
callproc setFrameRenderTarget   // 恢复调用方状态
callproc setFrameDepthBuffer
```
**全屏 Quad Pass**：`setdepth NULL` → `settarget 0 Dst` → `settexture …` → `setshader S Tech` → `renderquad`（输入纹理 ≠ 当前 RT）。
**抓屏**：`callproc copyFrameBufferToTexture`（自动处理 `FrameRenderTarget` / `FrameBuffer` 二选一）。
**Override Pass**：`setshaderoverride S T` … 绘制 … `clearshaderoverride S`；区间内**不得**出现任何 `end*OverrideTechnique`。

## 6. 避坑清单（Top 12，详见 [pitfalls.md](references/pitfalls.md)）

1. 每次修改后跑检查器；任何行 ≥ 256 字节（含 CRLF）即失败。
2. 只挪 `renderbin` 不挪它前面的 `settarget/setdepth/setcamera/visibleobjects` = 错误画面或 `ERROR: SCRAPE Current render targets are not a valid set`。
3. 绑定目标组合规则：所有 RT 同尺寸同 MSAA；Depth 尺寸 ≥ RT 且 MSAA 一致；至少有一个 RT 或 Depth。`🔍`
4. MRT：D3D9 要求同时绑定的 RT **位深相同**（全 32-bit：`A8R8G8B8`/`A2R10G10B10`/`R32F`/`G16R16`）；`clear` 会把**所有已绑定 RT** 清成同一颜色。
5. 离屏 MRT 结束后必须 `settarget 1 NULL` / `2` / `3`，否则后续前向绘制继续写 MRT。
6. `setshader` 不影响 `renderbin`/`render*` 场景几何的材质 shader。
7. `end{Depth,Shadow}OverrideTechnique` 把**所有** shader 的 override 清为 `-1`，会抹掉手动 `setshaderoverride`；不是栈。`🔍`
8. Override technique 名找不到 → 静默回退到物体原 technique（前向颜色污染 G-Buffer），不会跳过 draw。`🔍`
9. `renderbin` 未知名称 → 解析为 `NONE`（0），什么也不画、可能无报错；名称区分大小写。`🔍`
10. 不要把 `renderDepthCasters` 的 `renderbin Transparent` / `renderTransparentOutlineObjects` 抄进 G-Buffer。
11. HUD（`renderIconLayers`/`renderUI`）必须留在 `renderPostEffects` 之后；`updateWaterRefraction` 必须在 `renderWater` 之前。
12. 禁止 Xenon/PS3 命令：`setgpr`、`gpuflush`、`resolve`、`clearbegintiling`、`resolveendtiling`、四参数 `settarget`；禁止 CC4 回调 `renderDeferredLights`、`fromscope static`。

## 7. 验证步骤（每次修改后）

```powershell
# 1) 结构 + 行长检查（推荐本技能内副本）
node ".agents/skills/ra3-scrape-pipeline/scripts/check_scrape.js" "main/ingame.scrapeo"
# AGENTS.md 指定的只读原件，结果相同：
node "readonly/llm-skill-for-scrape/scripts/check_scrape.js" "main/ingame.scrapeo"
```
- 期望输出（原版基线）：`Checked 1 SCRAPE files; 0 warning(s).`，退出码 0；有告警时退出码 1，格式 `<file>:<line>:<col> warning [<code>] <message>`；`--json` 输出机器可读结果。
- 告警码：`line-too-long` `unknown-command` `unknown-type` `nested-proc` `branch-placement` `branch-after-else` `misnested-close` `unclosed-structure` `unclosed-preprocessor` `missing-include` `missing-definition`。
- **检查器局限**：只扫描扩展名 `.scrape/.scrapeh/.scrapeo`（`.txt` 被忽略→ 0 files）；不校验 `settarget/setdepth/stretchrect` 的资源名、RenderBin 名、参数个数；按 LF 计行长（CRLF 文件实际多 1 字节，所以接近 255 的行要人工复核）；对宏生成的 proc 名（如 `RotateEnvironmentMap.scrapeh`）会误报 `missing-definition`。
- 2) 人工复核：新增资源名逐一 `Select-String` 确认已 `var` 声明；RenderBin 名对照 [renderbin-dict](../../../dictionaries/renderbin-dict.md)。
- 3) 实机：游戏启动不崩 + PIX/RenderDoc 抓帧确认 `beginevent` 区段、RT 绑定与 draw 数；结论写入 `dictionaries/engine-ground-truth.md`（B1 维护）。

## 8. 参考与来源
- 原版编译脚本：[`main/ingame.scrapeo`](../../../main/ingame.scrapeo)；EA 模块化源码：`readonly/SCRAPE-RA3/*.scrape(h)`（只读）。
- 原版帧唯一事实基准：[`diagrams/vanilla-pipeline-reference.md`](../../../diagrams/vanilla-pipeline-reference.md)。
- IDA 结论：`readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md`、`SCRAPE_OVERRIDE与D24S8深度纹理结论.md`、`问题1`、`问题5`；帮助字符串 `readonly/scrapeo rules from asm.txt`、`outdated/scrapeo反编译出来的一些注释.txt`。
- CC4 `DeferredLighting.scrapeh`（`D:\PROJECTS\SAGE shader source\CC4_Shaders`）**仅作架构参考**，其 `fromscope static`/`renderDeferredLights` 在 RA3 不存在。
