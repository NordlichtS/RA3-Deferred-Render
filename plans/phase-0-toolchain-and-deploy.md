# Phase 0：工具链、部署机制与金丝雀验证

> **阶段目标**：在写任何延迟渲染代码之前，确定"改动如何进入游戏、如何观察结果"。完成后应具备：①已知的游戏/Mod 部署路径与步骤；②可用的抓帧手段（或明确的替代方案）；③一键构建脚本；④导入并可编译的 FXFXH 代码基；⑤一次成功的"金丝雀"实机往返；⑥固定的基准测试场景。
> **阶段出口**：P0-T09（DG-0）通过。
> **本阶段不修改** `proc InGame` 的任何原版行（金丝雀只在 `renderUI` 之后追加一个标记块）。

---

### P0-T01 记录游戏安装与 Mod 部署机制（与用户访谈）
- **执行者**：agent（起草问卷）+ USER-RUN（用户回答）　**规模**：S　**依赖**：无
- **目标**：查清游戏安装路径、Mod 加载方式（mod 文件夹 / `.skudef` / `.big` 打包 / 散文件）、`.scrapeo` 与 `.fxo` 必须放到哪里，以及用户目前如何测试 FXFXH shader；形成可执行的部署说明。
- **前置条件**：无。
- **必读上下文**：本 README §1.1（变量表）、§4（USER-RUN 协议）；[`ra3-fx-shader` SKILL.md](../.agents/skills/ra3-fx-shader/SKILL.md) §5 末条（"游戏从 `Shaders/Compiled/<Name>.fxo` 加载"）；[`ra3-scrape-pipeline` SKILL.md](../.agents/skills/ra3-scrape-pipeline/SKILL.md) §2 第 1 条。
- **步骤**：
  1. 新建 `tests/user-run/P0-T01.md`，按 README §4 模板写一份**问卷**（不需要部署），至少包含以下问题（逐条编号，要求用户逐条回答）：
     1. RA3 1.12 安装目录 `%RA3_GAME_DIR%` 的完整路径；是 Steam / Origin(EA App) / 光盘版？
     2. 你目前如何让游戏加载 FXFXH 编译出的 `.fxo`？（例：放进某 Mod 的 `.big`、散文件放在 `Data\...`、覆盖原版 `.big` 中的文件……）请给出目标路径与文件夹结构示例。
     3. 是否使用 `-modConfig "<...>.skudef"` 启动？`.skudef` 位置与内容（`add-big` 行）？Mod 目录 `%RA3_MOD_DIR%` 的路径？
     4. `ingame.scrapeo` 应放在何处（与 `.fxo` 同目录的 `Shaders\Compiled\`？其它？）。日冕 Mod 是怎样部署 `ingame.scrapeo` 的（如果你知道）？
     5. 打包 `.big` 用什么工具？是否有命令行版本（可脚本化）？
     6. 游戏日志/报错位置（例如 `文档\Red Alert 3\` 下的 `.log`/崩溃转储）？SCRAPE 加载失败时你见过什么现象？
     7. 你当前测试环境中**已经安装了哪些自定义 shader**（FXFXH 全套？日冕？纯原版？）——这决定 A/B 基准（README D13）。
     8. 常用启动参数（`-win`、`-xres/-yres`、`-noshellmap` 等）与测试分辨率。
     9. 构建输出目录 `RA3DR_OUT` 与截图/抓帧目录 `RA3DR_CAPTURES` 你希望放在哪里（必须在仓库外）？
     10. 是否允许代理的 `deploy.ps1` 直接复制文件到 `%RA3_MOD_DIR%`？（默认：否，由你运行 `deploy.ps1`。）
  2. 状态改为 `🧪`，等待用户回答。
  3. 收到回答后，新建知识文件 `knowledge/deploy-and-capture.md`，写入 §1"部署"小节：路径变量取值、目录结构图、打包步骤（逐条命令）、加载优先级说明、日志位置、已安装的自定义 shader 清单。未知项写 `❓` 并说明谁来补。
  4. 新建 `main/tools/env.example.ps1`（只含变量定义与注释，例：`$env:RA3DR_OUT = 'D:\RA3DR_out'`，`$env:RA3_GAME_DIR = '<用户填写>'`，`$env:RA3_MOD_DIR = '<用户填写>'`，`$env:RA3DR_CAPTURES = '<用户填写>'`），并在文件头注释"复制为 `env.local.ps1` 后填写；`env.local.ps1` 不提交"。
- **产出文件**：`tests/user-run/P0-T01.md`、`tests/results/P0-T01.md`、`knowledge/deploy-and-capture.md`（新）、`main/tools/env.example.ps1`（新）。
- **验证**：人工检查 `knowledge/deploy-and-capture.md` 的部署小节能回答"一个新 `.fxo` 和一个修改后的 `ingame.scrapeo` 要放到哪里、怎么打包、怎么启动"。
- **验收标准**：①上述 10 个问题都有答案或明确的 `❓`+负责人；②部署步骤可被 P0-T04 脚本化（或明确必须手工的步骤）；③A/B 基准环境（已装 shader 清单）已记录。
- **失败处理 / 决策映射**：用户不清楚 `.scrapeo` 加载位置 → 在 P0-T06 金丝雀中同时尝试 2 个候选位置（各放一个可区分颜色的金丝雀），由结果决定；需要 `.big` 但无命令行工具 → 部署保持手工，`deploy.ps1` 只负责把暂存包复制到用户指定的"打包输入文件夹"。
- **知识回写**：`knowledge/deploy-and-capture.md`（新建）；在 `dictionaries/engine-ground-truth.md` §1 末尾追加一行 `GT-34 资源加载位置`（置信度按用户实际经验标 `✅` 或 `❓`）。

---

### P0-T02 抓帧工具调研（D3D9 / 32 位 / RA3 启动器）
- **执行者**：agent（可联网检索）　**规模**：M　**依赖**：无
- **目标**：选出能对 RA3 1.12（32 位 D3D9，`RA3.exe` 启动 `ra3_1.12.game`）抓帧并查看 RT 内容、渲染状态、draw 绑定的 shader/technique 的工具，并写明已知坑。
- **前置条件**：无。
- **必读上下文**：本卡；`knowledge/deferred-techniques-sm3.md` §0 第 4 条（仅了解背景）。
- **步骤**：
  1. 用 `search_web` 逐一调研并记录（每项：是否支持 D3D9、是否支持 32 位、注入方式、能否看 MRT 1..3 / Stencil / 常量寄存器 / effect technique 名、Windows 10/11 兼容性、下载地址与版本）：
     - **apitrace**（`d3d9.dll` 包装器、`qapitrace` 回放、`apitrace dump-images`）——首选候选；
     - **旧版 PIX for Windows**（DirectX SDK June 2010）——检查 Win10/11 可用性与已知崩溃；
     - **RenderDoc + DXVK**（`d3d9.dll` → Vulkan 后用 RenderDoc 抓 Vulkan）——注意：驱动行为（格式支持、MRT caps、混合）由 DXVK 决定，**格式/caps 类结论不能代表原生 D3D9**；
     - **Intel GPA**、**NVIDIA Nsight Graphics**、**D3D9On12 + PIX(2xxx)**——确认是否仍支持 D3D9；
     - 其它（如 `ReShade` 的调试/截图能力、`3DMigoto` 不适用说明）。
  2. 调研 RA3 特有问题：`RA3.exe` 只是启动器，实际渲染进程为 `Data\ra3_1.12.game`（或类似）；包装器 DLL 应放在哪个目录才会被 `.game` 进程加载；是否有 DRM/完整性检查阻止 DLL 注入。
  3. 在 `knowledge/deploy-and-capture.md` 新增 §2"抓帧工具"小节（若 P0-T01 尚未创建该文件则先创建骨架）：对比表 + 推荐顺序（主选 / 次选 / 兜底）+ 每个工具的安装步骤草案（交给 P0-T03 由用户执行）。
  4. 写明**兜底策略**："所有探针都提供游戏内可视指示（纯色、四象限调试视图、数值条形码），抓帧只用于补充细节"。
- **产出文件**：`knowledge/deploy-and-capture.md`（§2）。
- **验证**：表格中每个工具都有来源链接；推荐顺序有理由。
- **验收标准**：①至少 4 个工具有完整评估；②明确标注 DXVK 结果的适用边界；③给出主选工具的逐步安装草案（≤ 10 步）。
- **失败处理 / 决策映射**：没有任何工具确认支持 → 主选 apitrace 并在 P0-T03 实测；仍失败则全项目以游戏内调试视图为唯一观察手段（README R3），并在 DG-0 记录。
- **知识回写**：`knowledge/deploy-and-capture.md` §2。

---

### P0-T03 搭建抓帧环境并抓取原版基准帧
- **执行者**：USER-RUN（代理写脚本 + 记录）　**规模**：M　**依赖**：P0-T01、P0-T02
- **目标**：在用户机器上让主选抓帧工具成功抓到 RA3 一帧，并保存"原版/基准"帧作为后续对照。
- **前置条件**：`knowledge/deploy-and-capture.md` §1、§2 已存在。
- **必读上下文**：`knowledge/deploy-and-capture.md` §1–§2；[`vanilla-frame-walkthrough.md`](../.agents/skills/ra3-scrape-pipeline/references/vanilla-frame-walkthrough.md) §2（事件名 `UpdateFrameBuffer`、`UpdateDepthMap`、`RenderUnderwater` 等）。
- **步骤**：
  1. 写 `tests/user-run/P0-T03.md`：安装主选工具 → 启动游戏进入任意遭遇战地图 → 抓一帧 → 在工具中找到 `UpdateFrameBuffer` 事件 → 截取：(a) 该事件结束时 RT0 内容；(b) 任一单位 draw 的 VS/PS 常量面板（c0..c10、c113..c123）；(c) `DepthBuffer` 的 Stencil 视图（若工具支持）；(d) 资源列表中 `FrameRenderTarget`、`DepthTextureLinear` 的格式与尺寸。
  2. 如主选工具失败，脚本中给出次选工具的同样步骤。
  3. 用户回报后，把结论写入 `tests/results/P0-T03.md`，并在 `knowledge/deploy-and-capture.md` §2 标注"实测可用 ✅ / 不可用 ✘"及具体限制（例如"看不到 technique 名，只能看 shader 字节码"）。
  4. 记录基准帧文件名（存于 `%RA3DR_CAPTURES%\baseline\`）。
- **产出文件**：`tests/user-run/P0-T03.md`、`tests/results/P0-T03.md`、更新 `knowledge/deploy-and-capture.md`。
- **验证**：用户回报表中 (a)–(d) 至少 (a)(d) 成功。
- **验收标准**：①有一个工具能显示 `beginevent` 区段与 RT 内容；②`FrameRenderTarget`（HDR 开）实际格式已记录。
- **失败处理 / 决策映射**：全部工具失败 → 标记 README R3 已发生；Phase 1 中依赖抓帧的观察项全部改为游戏内调试视图（P1-T01 已预留），P1-T12 降级为"仅静态分析 + 游戏内覆盖率视图"。
- **知识回写**：`knowledge/deploy-and-capture.md` §2；`dictionaries/engine-ground-truth.md` GT-14 行补充 HDR 开时 `FrameRenderTarget` 实测格式（置信度 `✅`，注明日期与抓帧文件名）。

---

### P0-T04 构建与部署脚本（`build.ps1` / `deploy.ps1` / `fx-manifest.csv`）
- **执行者**：agent　**规模**：M　**依赖**：P0-T01
- **目标**：一条命令完成"编译 manifest 中全部 shader → 复制 `ingame.scrapeo` → 开关覆写 → 检查器 → 生成暂存部署包与哈希清单"；另一条命令（用户执行）把暂存包部署到游戏并支持恢复。
- **前置条件**：`knowledge/deploy-and-capture.md` §1 已给出部署布局（若打包必须手工，脚本只产出暂存目录）。
- **必读上下文**：README §1.1、§3；[`fxc-workflow.md`](../.agents/skills/ra3-fx-shader/references/fxc-workflow.md) §1–§3；`knowledge/deploy-and-capture.md` §1。
- **步骤**：
  1. 新建 `main/tools/fx-manifest.csv`，列：`source,output,enabled,notes`（`source` 为相对仓库根的 `.fx` 路径，`output` 为游戏资源名如 `ObjectsAllied.fxo`）。初始内容只有表头（P0-T05 填充）。
  2. 新建 `main/tools/build.ps1`，参数：`-Variant <string>`（必填）、`-Flags <string>`（可选，`Name=true|false|<float>` 逗号分隔）、`-Only <glob>`（可选，只编译匹配的 source）。行为：
     1. 读取 `main/tools/env.local.ps1`（若存在）以获得 `$env:RA3DR_OUT`；若 `RA3DR_OUT` 为空或位于仓库内 → 报错退出。
     2. 暂存目录 `$env:RA3DR_OUT\stage\<Variant>\`，按 `knowledge/deploy-and-capture.md` 的布局创建子目录（默认 `Shaders\Compiled\`）。
     3. 对 manifest 中 `enabled=1` 的每行执行：`& main\fxc.exe /nologo /O2 /T fx_2_0 /D _WW3D_ /I main /I main\fx /Fo "<stage>\Shaders\Compiled\<output>" "<source>"`；任何非 0 退出码 → 打印该行并整体失败。
     4. 复制 `main/ingame.scrapeo` 到暂存目录；若给了 `-Flags`，对每个 `Name=value`：在暂存副本中查找**位于 `proc configureDeferredFlags` 内**的 `setbool Deferred <Name> ...` 或 `setfloat Deferred <Name> ...` 行并替换值；找不到 → 失败（防止拼写错误静默无效）。
     5. 对暂存副本运行 `node .agents/skills/ra3-scrape-pipeline/scripts/check_scrape.js <副本>`；非 0 → 失败。再做 CRLF 字节行长检查（README §3），> 200 字节 → 警告，≥ 256 → 失败。
     6. 生成 `<stage>\manifest.txt`：每个文件的相对路径、字节数、SHA256、源文件、构建时间、`-Flags` 值。
  3. 新建 `main/tools/deploy.ps1`（**由用户运行**），参数：`-Variant <string>` 或 `-Restore`。行为：部署前把目标位置现有同名文件备份到 `$env:RA3DR_OUT\backup\<时间戳>\`；`-Restore` 恢复最近一次备份（或 `knowledge/deploy-and-capture.md` 定义的"原版"备份）。若需要 `.big` 打包且工具有命令行，按文档调用；否则打印"请用 <工具> 把 <stage> 打包为 <xxx.big>"。
  4. 新建 `main/tools/README.md`（≤ 40 行）：两条脚本的用法、`-Flags` 规则、"`.fxo` 永不入库"。
  5. 在仓库根 `.gitignore` 中**建议**（不要直接改，写进报告给 lead）追加 `main/tools/env.local.ps1`。
- **产出文件**：`main/tools/build.ps1`、`main/tools/deploy.ps1`、`main/tools/fx-manifest.csv`、`main/tools/README.md`。
- **验证**：
  ```powershell
  powershell -ExecutionPolicy Bypass -File main\tools\build.ps1 -Variant smoke
  Get-Content "$env:RA3DR_OUT\stage\smoke\manifest.txt"
  ```
  预期：0 个 shader（manifest 为空）、`ingame.scrapeo` 被复制且检查器 `0 warning(s)`；再用 `-Flags "Nope=true"` 运行应失败并提示找不到。
- **验收标准**：①`RA3DR_OUT` 指向仓库内时拒绝运行；②编译失败会使构建失败；③`-Flags` 拼错会失败；④manifest 含 SHA256；⑤`deploy.ps1` 有备份与 `-Restore`。
- **失败处理 / 决策映射**：PowerShell 执行策略阻止 → 文档写明 `-ExecutionPolicy Bypass`；部署布局未知 → 暂存目录同时生成两个候选布局（由 P0-T06 决定后删去一个）。
- **知识回写**：无（工具说明在 `main/tools/README.md`）。

---

### P0-T05 导入 FXFXH 代码基到 `main/fx/` 并验证编译等价
- **执行者**：agent　**规模**：M　**依赖**：P0-T04
- **目标**：把 FXFXH 中本项目需要的头文件与 wrapper 复制到 `main/fx/`，建立"源文件 → 游戏资源名"映射，并证明在新位置用项目命令编译的产物与在 FXFXH 原位置编译的产物一致。
- **前置条件**：`main/tools/fx-manifest.csv` 存在。
- **必读上下文**：[`fxfxh-architecture.md`](../.agents/skills/ra3-fx-shader/references/fxfxh-architecture.md) §1–§2；[`material-family-inventory.md`](../.agents/skills/ra3-fx-shader/references/material-family-inventory.md) §2（只看"文件"与"家族"两列）。
- **步骤**：
  1. 从 `C:\Desktop01\MYGITHUB\custom-shaders-RedAlert3\FXFXH\` **复制**（只读源，不得修改）到 `main/fx/`：`head1-maxui.FXH`、`head1-newvs.FXH`、`head2-functions.FXH`、`head3-vsps.FXH`、`usefulmath.hlsl`、`PBR5-10-objects-ARPBR.FX`、`basicW3D.FXH`、`TERRAIN.FX`、全部 `objects*.fx`、`buildings*.fx`、`basicw3d*.fx`/`.FX`、`FXdeferredpointlight.FX`、`FXscreenSpaceShadow.fx`、`FXcutDepthBuffer.FX`。**不要**复制 `COMMON.FXH`（`main/COMMON.FXH` 已存在且与 FXFXH 逐行相同——先用 `Compare-Object (Get-Content main\COMMON.FXH) (Get-Content <FXFXH>\COMMON.FXH)` 复核，若有差异则停止并升级）。不复制 `fxc.exe`、`.fxo`、`.lnk`。
  2. 在 `main/fx/` 中 `Select-String '#include'` 检查每个 include 都能解析（`COMMON.FXH` 通过 `/I main`，其余同目录）。
  3. 确定资源名映射：读每个 wrapper 末尾的注释（例如 `objectsallied.fx` 末尾 `//this is : objectsallied.fxo`）以及 `material-family-inventory.md` 的官方文件名，填写 `main/tools/fx-manifest.csv`：`source=main/fx/objectsallied.fx, output=ObjectsAllied.fxo`。官方资源名大小写使用官方源码文件名（如 `ObjectsAllied`、`BuildingsGeneric`、`Infantry`、`Tree`、`Terrain`）。FXFXH 名称与官方名不一一对应的（如 `basicw3dINFANTRY.FX` → `Infantry.fxo`？`basicw3dTREE.FX` → `Tree.fxo`？）在 `notes` 列写 `❓需用户确认` 并在报告中列出。初始全部 `enabled=0`。
  4. 等价性验证：对 `objectsgeneric.fx`、`objectsallied.fx`、`buildingsgeneric.fx`、`TERRAIN.FX`、`FXdeferredpointlight.FX` 各编译两次：(a) FXFXH 原目录 `& main\fxc.exe /nologo /O2 /T fx_2_0 /Fo $env:RA3DR_OUT\eq\a_<n>.fxo <FXFXH路径>`；(b) 项目命令 `/D _WW3D_ /I main /I main\fx` 编译 `main/fx/<n>`。用 `Get-FileHash` 比较；不同则再比较 (b) 去掉 `/D _WW3D_` 的结果，定位差异来源。
  5. 新建 `main/fx/README.md`（≤ 40 行）：来源（FXFXH 某日期副本）、目录约定（`probe/` 子目录、`GBUFFER.FXH` 将在 P2-T01 加入）、"技术只加在核心 `.FX`，wrapper 只写 `#define`"规则。
- **产出文件**：`main/fx/*`（复制件）、`main/fx/README.md`、`main/tools/fx-manifest.csv`（填充）。
- **验证**：步骤 4 的哈希比较表贴进报告；`powershell -File main\tools\build.ps1 -Variant eq -Only "*objects*"`（临时把对应行 `enabled=1` 后再改回 0）成功。
- **验收标准**：①5 个样本的 (a)(b) 哈希一致，或差异已解释（例如 `/D _WW3D_` 改变了某分支，此时向 lead 报告并按 D7 决定）；②manifest 覆盖所有复制的 wrapper；③无文件写入 FXFXH 原目录。
- **失败处理 / 决策映射**：哈希不同且原因是 `/D _WW3D_` → 报告 lead 修订 D7（建议对 FXFXH 系不加 `/D _WW3D_`）；include 解析失败 → 补复制缺失头文件。
- **知识回写**：`.agents/skills/ra3-fx-shader/references/fxc-workflow.md` §1 表格追加一行"`/D _WW3D_` 对 FXFXH 产物的影响：<结论>（✅fxc实测 日期）"（遵循 PK-T03 技能更新规则）。

---

### P0-T06 金丝雀部署：证明 `.scrapeo` 与 `.fxo` 都从我们的部署位置加载
- **执行者**：agent（准备）+ USER-RUN　**规模**：M　**依赖**：P0-T04、P0-T05
- **目标**：用两个肉眼可见的标记确认：(1) 修改后的 `ingame.scrapeo` 被加载，且我们新增的 `.fxo`（新资源名）被加载；(2) 替换原有资源名的 `.fxo`（`ObjectsAllied.fxo`）优先于原版被加载。
- **前置条件**：部署布局已知或已给出两个候选（P0-T01）。
- **必读上下文**：[`pass-templates.md`](../.agents/skills/ra3-scrape-pipeline/references/pass-templates.md) §1.2（全屏 Quad 模板）；FXFXH `FXscreenSpaceShadow.fx` 的 VS 输入结构与 technique 状态块（只读该文件 L58–L80 与 technique 段）；README §1 第 5 条（标记行）。
- **步骤**：
  1. 新建 `main/fx/probe/RA3DR_Canary.fx`：`#include "COMMON.FXH"`（保证寄存器契约）；全屏 quad VS 照抄 `FXscreenSpaceShadow.fx` 的 VS 输入/输出（`Position.xy` 为 NDC）；`ps_3_0` PS 输入 `float2 vpos : VPOS`，`if (vpos.x < 96 && vpos.y < 96) return float4(1,0,1,1); clip(-1); return 0;`（品红 96×96 方块，左上角）；`technique Default { pass P0 { VertexShader = compile vs_3_0 ...; PixelShader = compile ps_3_0 ...; ZEnable = 0; ZWriteEnable = 0; AlphaBlendEnable = 0; AlphaTestEnable = 0; CullMode = 1; } }`。
  2. manifest 增加 `main/fx/probe/RA3DR_Canary.fx,RA3DR_Canary.fxo,1,P0-T06 canary`。
  3. `main/ingame.scrapeo`：(a) 在文件顶部声明区末尾（锚点：`var shader PostEffectLinearDepthShader` 所在行之后的空行处，或任意 `proc` 之外的位置）插入：
     ```text
     # [RA3DR P0-T06] begin
     var shader RA3DRCanaryShader RA3DR_Canary.fx
     # [RA3DR P0-T06] end
     ```
     (b) 在 `proc InGame` 内锚点 `\trenderUI` 之后插入：
     ```text
     # [RA3DR P0-T06] begin
     	setdepth NULL
     	setshader RA3DRCanaryShader Default
     	renderquad
     # [RA3DR P0-T06] end
     ```
     （注意：`setdepth NULL` 后紧接 `renderDebugDisplays` 不依赖深度；若担心，可在 `renderquad` 后加 `callproc setFrameDepthBuffer`——原版 LUT 之后深度为 `DepthBuffer`，见 vanilla-frame-walkthrough §2 #10。）
  4. 场景 `.fxo` 金丝雀：在 `main/fx/PBR5-10-objects-ARPBR.FX` 的前向 PS（`PS_H_ARPBR`）`return` 前插入 3 行：
     ```hlsl
     #ifdef RA3DR_CANARY_GREEN
         return float4(0, 1, 0, 1);
     #endif
     ```
     新建 wrapper `main/fx/probe/canary_objectsallied.fx`：内容 = `#define RA3DR_CANARY_GREEN` + `objectsallied.fx` 的全部 `#define` 行 + `#include "../PBR5-10-objects-ARPBR.FX"`（或依 `/I main\fx` 写 `#include "PBR5-10-objects-ARPBR.FX"`）。manifest 增加 `main/fx/probe/canary_objectsallied.fx,ObjectsAllied.fxo,1,P0-T06 canary`。
  5. 运行 `build.ps1 -Variant P0-T06`，确认 2 个 `.fxo` 生成、检查器 0 告警。
  6. 写 `tests/user-run/P0-T06.md`：部署 → 遭遇战选盟军 → 观察：①左上角品红方块是否出现（证明 `.scrapeo` + 新 `.fxo` 加载）；②盟军载具（MCV、矿车）是否纯绿（证明替换资源名的 `.fxo` 生效）；③游戏能否正常进入/退出对局；④若打开 WorldBuilder 加载任意地图是否正常（`proc Editor` 未改动，应正常）。回报后 `deploy.ps1 -Restore`。
  7. 结果写 `tests/results/P0-T06.md`；**随后**把步骤 4 的 manifest 两行改为 `enabled=0`，保留 `RA3DR_Canary` 一行（它在后续所有构建中都作为"本构建已加载"的指示器；若 lead 不同意可删除）。
- **产出文件**：`main/fx/probe/RA3DR_Canary.fx`、`main/fx/probe/canary_objectsallied.fx`、`main/fx/PBR5-10-objects-ARPBR.FX`（+3 行 `#ifdef`）、`main/ingame.scrapeo`（2 个标记块）、`tests/user-run/P0-T06.md`、`tests/results/P0-T06.md`。
- **验证**：`build.ps1` 输出；`/Fc` 对 `RA3DR_Canary.fx` 的 PS 做寄存器复核（`/T ps_3_0 /E <PS名>`）。
- **验收标准**：观察①②均为"是"；游戏无崩溃。
- **失败处理 / 决策映射**：①否②是 → `.scrapeo` 位置错误或脚本加载失败：按 P0-T01 第二候选位置重试；同时检查日志；①是②否 → 原版 `.big` 优先级高于我们的文件：调整部署（覆盖原 `.big` 或改 skudef 顺序）并更新文档；①②都否 → 部署整体错误，回到 P0-T01；游戏崩溃 → 先只部署未修改的原版 `ingame.scrapeo` + 金丝雀 `.fxo`，定位是脚本还是 shader 引起。
- **知识回写**：`knowledge/deploy-and-capture.md` §1 标注"已验证的部署布局 ✅（日期）"；`dictionaries/engine-ground-truth.md` 新增/更新 `GT-34`。

---

### P0-T07 定义基准测试场景 GS-xx 并采集基准截图
- **执行者**：agent（起草）+ USER-RUN　**规模**：S　**依赖**：P0-T06
- **目标**：固定一组可重复的测试场景（地图 + 镜头 + 画质 + 最好是录像回放），后续所有 USER-RUN 都引用这些 ID。
- **前置条件**：部署链路已验证。
- **必读上下文**：本卡；README D13。
- **步骤**：
  1. 起草 `tests/scenes.md`，建议场景（用户可替换为等价地图）：
     - `GS-01` 白天、有水面（可见反射/折射）、三阵营单位与建筑、树木、桥梁、道路；
     - `GS-02` 夜晚/黄昏地图，大量灯光与爆炸（局域光测试）；
     - `GS-03` 水下单位/基地（帝国或苏联潜艇、水下建筑）——测试 `renderUnderwaterDeferred`；
     - `GS-04` 选中/悬停多个单位与建筑（描边 Stencil）、帝国建筑建造动画（纳米 buildup）、受损建筑（损伤破洞）；
     - `GS-05` 粒子密集（烟雾/火焰与地面相交，软粒子）、热浪扭曲；
     - `GS-06` WorldBuilder 打开 GS-01 同一地图。
  2. 建议用户为 GS-01/02/04/05 各录制一个 ≤ 60 秒的**录像回放**，以便 A/B 时镜头与时间一致；在 `tests/scenes.md` 记录回放文件名与"暂停时间点/镜头操作"。
  3. 写 `tests/user-run/P0-T07.md`：在"当前已装 shader 环境（D13 基准）"下，每个场景截图 1 张（HDR 开、AA 关、阴影高、软粒子开，分辨率按 P0-T01），存 `%RA3DR_CAPTURES%\baseline\GS-xx.png`；再在"纯原版 shader"下截同样画面（若用户愿意）。
  4. 结果记录到 `tests/results/P0-T07.md`。
- **产出文件**：`tests/scenes.md`、`tests/user-run/P0-T07.md`、`tests/results/P0-T07.md`。
- **验证**：`tests/scenes.md` 中每个 GS 都有：地图名、画质设置、镜头/回放说明、基准截图文件名。
- **验收标准**：至少 GS-01、GS-03、GS-04 有基准截图。
- **失败处理 / 决策映射**：找不到水下场景 → GS-03 标记 `❓`，在 Phase 7 前补齐。
- **知识回写**：无。

---

### P0-T08 测试脚本/结果模板与任务看板维护工具
- **执行者**：agent　**规模**：S　**依赖**：无
- **目标**：建立 `tests/` 目录结构与模板，使后续 USER-RUN 卡只需填空。
- **前置条件**：无。
- **必读上下文**：README §4。
- **步骤**：
  1. 新建 `tests/README.md`：目录说明（`user-run/`、`results/`、`scenes.md`、`coverage/`）、命名规则（文件名 = 任务 ID）、截图命名 `<TaskID>_<观察#>_<GS>.png`。
  2. 新建 `tests/user-run/_TEMPLATE.md`（复制 README §4 的模板并补充"画质设置默认值"段）与 `tests/results/_TEMPLATE.md`（字段：日期、构建 Variant、manifest 哈希、用户原始回答、结论、命中的决策映射、知识回写清单）。
- **产出文件**：`tests/README.md`、`tests/user-run/_TEMPLATE.md`、`tests/results/_TEMPLATE.md`。
- **验证**：人工检查。
- **验收标准**：模板字段与 README §4 一致。
- **失败处理 / 决策映射**：无。
- **知识回写**：无。

---

### P0-T09 DG-0：工具链就绪评审
- **执行者**：lead-review　**规模**：S　**依赖**：P0-T01…P0-T08
- **目标**：确认可以进入 Phase 1。
- **前置条件**：P0 其余卡为 ✅（P0-T03 可为"不可用但已记录"）。
- **必读上下文**：`tests/results/P0-T0*.md`；`knowledge/deploy-and-capture.md`。
- **步骤**：
  1. 核对：部署链路 ✅、金丝雀 ✅、构建脚本 ✅、FXFXH 等价 ✅、抓帧工具结论（✅ 或"兜底策略生效"）、基准场景 ✅。
  2. 在 README §7 决策日志追加 `D17 抓帧手段：<工具或兜底>`、确认/修订 `D7`（`/D _WW3D_`）与 `D13`。
  3. 执行 [PK-T01](phase-K-knowledge-maintenance.md) 阶段回写流程。
- **产出文件**：README §7（追加行）、task-board 状态。
- **验证**：README 决策日志新增行存在。
- **验收标准**：全部核对项通过或有书面例外。
- **失败处理 / 决策映射**：部署链路未通 → Phase 1 不得开始。
- **知识回写**：PK-T01 清单。
