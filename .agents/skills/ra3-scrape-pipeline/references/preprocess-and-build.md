# 预处理规则与构建脚本评估（`.scrape/.scrapeh` → `.scrapeo`）

> 结论先行：**构建脚本可行且几乎零成本**——本机 MSYS2 `gcc -E` 已逐行复现原版 `main/ingame.scrapeo`（636/636 条非空非 `#` 行完全一致，空白归一化后比较）。是否需要它取决于工作流：直接手改 `main/ingame.scrapeo` 也完全可行（引擎只读它）。本文不实现脚本，只给出精确规则与实现规格。

## 1. 原版构建产物中观察到的预处理规则

| # | 规则 | 证据 | 置信度 |
|---|---|---|---|
| P1 | 预处理器是**标准 C 预处理器**，输出带 GCC 风格行号标记 `# <line> "<file>" [flag]`（flag `1`=进入 include，`2`=返回）| `main/ingame.scrapeo#L1` `# 1 "c:\\bf_ra3_qabuild_eala-build20\\ra3\\run\\shaders\\ingame.scrape"`；L10 `… Common.scrapeh" 1`；L143 `# 9 "…ingame.scrape" 2` | 📄 |
| P2 | 平台宏：PC 构建定义了 `EA_PLATFORM_WINDOWS`（未定义 `EA_PLATFORM_XENON`）| L38/L41 只出现 Windows 分支；`setgpr` 等消失 | 📄 |
| P3 | `#include "x.scrapeh"` 相对于包含文件目录解析；include 路径用 `/` | L10、L145 等标记中的路径 | 📄 |
| P4 | 头文件用 `#ifndef SCRAPE_SCRIPT_<NAME>_SCRAPEH` 守卫；**`RotateEnvironmentMap_Proc.scrapeh` 无守卫，被包含两次**，每次前面 `#define` 不同别名（模板化 proc）| `readonly/SCRAPE-RA3/RotateEnvironmentMap_{Water,Objects}.scrapeh#L10-L19`；产物 L1197、L1289 两个不同 proc | 📄 |
| P5 | 对象宏展开：数值（`BinCommand_RenderParticles`→`1`，L1464）、空宏（`GPUFLUSH`→空，原 `InGame.scrape#L39`）、资源别名（`ShadowMapRenderTarget`→`ShadowMapTexture`，L218）、**proc 名别名**（`doRotateEnvironmentMap`→`doRotateEnvironmentMapWater`，L1197）、含 `$` 常量的替换文本（`EnvironmentDestinationTextureFormat`→`$WW3D.EnvMapRenderTargetTextureFormat`，L1154）| 见行号 | 📄 |
| P6 | 函数宏：`XENON_RESOLVE(x)` / `XENON_RESOLVE_HDR(x)` 在 PC 展开为空 | `readonly/SCRAPE-RA3/PostFX.scrapeh#L16-L22` | 📄 |
| P7 | 条件：`#if defined(X)`、`#if !defined X`（无括号）、`#elif defined(X)`、`#if <整数宏>`（`TEST_TEXTURE_SIZES 0`、`CODE_DRIVEN_TEXTURE_SIZES 1`、`#if !WIDESCREEN`）、`#ifndef`、`#undef` | `Outlines.scrapeh#L9-L11`、`PostFX_Bloom.scrapeh#L18-L33`、`MSAA.scrapeh#L14` | 📄 |
| P8 | 注释被替换为空白：整行 `//` 注释变成单个空格行；行尾注释变成尾随空格（L1446 `renderUnits\t\t\t `）| L2–L6、L1446 | 📄 |
| P9 | 跳过的大段 `#if` 区块产生重同步标记而非大量空行 | L418 `# 67 "…PostFX_Bloom.scrapeh"`、L708 `# 102 "…DepthMap.scrapeh"` | 📄 |
| P10 | Tab 缩进、`$` 标识符、`.`/`[0]` 路径原样保留 | L159 `$Sas.Shadow[0].MapSize` | 📄 |
| P11 | **`callproc` 不被展开**——proc 结构原样保留，运行时调用 | 全文件 | 📄 |
| P12 | 运行时把 `#` 行当注释，所以保留行号标记无害；它们方便把引擎报错行号映射回源文件 | L1 等 | ✅ |
| P13 | 行尾 CRLF | 产物 1593 CR / 1593 LF | 📄 |

## 2. 已验证的复现命令（本机）

```powershell
$env:PATH = "C:\PRLANG\MSYS2\ucrt64\bin;$env:PATH"   # 必需：否则 gcc 找不到 cc1 依赖，静默 exit 1
Push-Location readonly/SCRAPE-RA3
gcc -E -P -undef -nostdinc -x c -DEA_PLATFORM_WINDOWS InGame.scrape -o <out>.scrapeo
Pop-Location
```
- 结果：653 行、CRLF、`check_scrape.js` 0 告警；与 `main/ingame.scrapeo` 的有效行逐行一致。`-DEA_PLATFORM_XENON` 时出现 `resolve`/`setgpr`（证明分支选择正确）。
- 参数含义：`-x c` 把非 `.c` 扩展名当 C；`-P` 去掉行号标记（想保留映射就去掉 `-P`，gcc 会多出 `# 0 "<built-in>"` 等无害行）；`-undef` 去掉 gcc 预定义宏（防止 `WIN32`/`_WIN32` 等误替换脚本标识符）；`-nostdinc` 禁系统头。
- **不可用的方案**：`main\fxc.exe /P` 会在 token 间插空格（`$ WW3D . FrameBufferSize . x`），破坏 `$` 常量——❌。
- **`outdated/unroll_scrape_proc.py` 不适合构建**：它把 `callproc` 递归内联成单一 proc（用于阅读），会改变语义（内联后 `return` 失效、无递归防护、只保留目标 proc + 顶层 `var`，丢弃其它 proc），其产物 `readonly/ingame.scrapeo unfold.txt` 还混入了错误内容（`L16` 阴影格式、顺序颠倒）。仅可作阅读辅助。

## 3. 是否需要构建脚本？

| 方案 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| A. 直接编辑 `main/ingame.scrapeo`（扁平文本）| 零工具链；所见即引擎所读；与 AGENTS.md 现有校验命令一致 | 1593 行单文件，含大量预处理残留空行；改动需手工保持 Windows 分支一致 | **Phase 0–2 默认采用**（KISS）|
| B. 模块化源码 + `gcc -E` | 可把延迟管线写成独立 `Deferred.scrapeh`，用 `#if defined(ENABLE_DEFERRED)` 一键切换前向/延迟；源码可写注释不怕行长（注释被去掉）| 依赖 MSYS2 gcc；必须保证源码在 `readonly/` 之外（如 `main/scrape-src/`）| 当改动跨多个 pass 或需要 A/B 双版本时再引入 |
| C. 自写 Node 预处理器 | 无外部依赖，可内置行长检查 | 需实现完整条件表达式 | 仅当 gcc 不可用时 |

## 4. 若实现构建脚本（给后续 Agent 的规格）

1. 输入：根文件（如 `main/scrape-src/InGame.scrape`）；定义 `EA_PLATFORM_WINDOWS`（可选 `ENABLE_DEFERRED`）。
2. 首选实现：PowerShell 包装 §2 的 gcc 命令；输出到 `main/ingame.scrapeo`（覆盖前先备份或由 git 管理）。
3. 若自写（方案 C），必须支持：`#include "…"`（相对路径、递归、**允许重复包含**、环检测）、`#define`（对象宏 + 带参函数宏，替换文本可含 `$`、`.`、`[]`）、`#undef`、`#ifdef/#ifndef/#if/#elif/#else/#endif`、`defined X` 与 `defined(X)`、`!`、`&&`、`||`、整数常量与宏求值；按**标识符边界**替换（不能替换 `Shadow[0].MapSize` 中的子串）；`//` 与 `/* */` 注释剔除（注意 `//` 不出现在字符串里——SCRAPE 无字符串字面量，`#include` 例外）。
4. 后处理（两种实现都要）：统一 CRLF；逐行计算 `UTF8字节数 + 2`，≥ 256 即失败并指出源文件:行；运行 `node .agents/skills/ra3-scrape-pipeline/scripts/check_scrape.js <out>`，非 0 退出则构建失败。
5. 回归测试：对 `readonly/SCRAPE-RA3/InGame.scrape` 运行，输出有效行须与 `main/ingame.scrapeo` 一致（比较方法：去掉 `#` 行与空行、`trim` 并把连续空白压成一个空格后逐行比较）。
