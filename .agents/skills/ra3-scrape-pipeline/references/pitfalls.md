# SCRAPE 避坑清单（RA3 1.12 PC）

> 标签：`✅已实机验证` / `📄源码确认` / `🔍IDA静态推测` / `❓待实测`。每条都给出"症状 → 规则"。

## 1. 加载期（脚本根本跑不起来）

| # | 坑 | 规则 | 置信度 |
|---|---|---|---|
| 1.1 | 行 ≥ 256 字节（含 CRLF；中文注释 3 字节/字）| 每行 ≤ 200 字节；长注释单独成行或删掉；宏展开后再量 | 🔍 |
| 1.2 | 手改 `.scrapeo` 写了宏名（`BinCommand_RenderParticles`、`GPUFLUSH`、`FrameDepthBuffer` 别名…）| `.scrapeo` 无预处理，写展开后的字面量 | ✅ |
| 1.3 | `proc` 嵌套 / 缺 `endproc` / 重名 proc 或 var 或 label | 加载失败（`Nested procedure…`、`missing 'endproc'`、`duplicate variable name`、`Duplicate function`）| 🔍 |
| 1.4 | `callproc`/`goto` 目标不存在 | `Unresolved goto/callproc target` | 🔍 |
| 1.5 | `var surface X W H FMT`（缺 `edram`/`edramdepth`）| `surfaces in RAM are not supported (use textures)`；离屏目标用 `var texture` | 🔍 |
| 1.6 | `$Scope.Const` 拼错 | `Error resolving constant` | 🔍 |
| 1.7 | 引入 Xenon/PS3/CC4 命令（`setgpr`、`resolve`、`renderDeferredLights`、`fromscope static`、四参 `settarget`）| `Unknown command` 或无效；只用 [command-reference.md](command-reference.md) §1–§8 | 📄/🔍 |
| 1.8 | 同名同时存在于 texture 与 surface 表 | `ambiguous texture/surface`；名字全局唯一 | 🔍 |

## 2. 状态泄漏（画面错乱但不崩）

| # | 坑 | 规则 | 置信度 |
|---|---|---|---|
| 2.1 | 以为 `callproc` 会恢复状态 | 任何离屏 proc 结束前 `callproc setFrameRenderTarget` + `callproc setFrameDepthBuffer`（必要时 `setcamera Viewer` + `visibleobjects Frame`）| 📄 |
| 2.2 | MRT 结束忘记解绑 1..3 | `settarget 1 NULL`、`2`、`3`；否则后续前向 draw 继续写 G-Buffer 或因尺寸不符报 invalid set | 🔍❓ |
| 2.3 | 换了相机没换可见集 | 每次 `setcamera` 后紧跟匹配的 `visibleobjects`（Shadow/Reflection/DepthMap/Frame）；`OceanDisplacement` 相机例外（原版不调 visibleobjects，L917）| ✅ |
| 2.4 | 先 `settarget` 后 `setdepth` 导致视口取深度尺寸 | 先 `setdepth` 再 `settarget 0`（EA 注释）；或显式 `setviewport <RT>`（🔍 未在原版用过）| 📄 |
| 2.5 | Reflection pass 把 `Particle.ReallyRenderSoftParticles` 置 false | 原版在 L821 与 L1485 恢复 true；新 pass 若画粒子需自行设置 | ✅ |
| 2.6 | 采样当前正作为 RT 的纹理 | 读写同一纹理需乒乓；`stretchrect` 先拷 | 📄 |
| 2.7 | 资源跨帧保留 | `var texture` 帧末不清零：在本帧写入前读取会得到上一帧内容（"画中画"）；需要干净内容必须 clear | 🔍（reference §1.4）|

## 3. Shader / Override

| # | 坑 | 规则 | 置信度 |
|---|---|---|---|
| 3.1 | 期望 `setshader` 改变场景物体材质 | `setshader` 只作用于 `renderquad/renderfullquad` | 🔍 |
| 3.2 | `setshaderoverride` 后接 `end{Shadow,Depth}OverrideTechnique` | `end*` 把**所有** shader override 清为 -1；手动 override 区间内不得出现全局 begin/end | 🔍 |
| 3.3 | 嵌套 `beginDepth…` / `beginShadow…` | 不是栈，`end*` 不恢复先前状态 | 🔍 |
| 3.4 | technique 名拼错 / shader 未提供 | override=-1 → **静默回退原前向 technique**（不跳过 draw）→ 污染 G-Buffer RT0 | 🔍（engine-ground-truth 标注待实测）|
| 3.5 | Override 作用域误解 | 作用于整个 shader 资源（所有共享它的物体），不是单物体 | 🔍 |
| 3.6 | `_CreateShadowMap`/`_CreateDepthMap` 大小写或下划线错 | 精确 `strcmp`；Depth 缺失回退 Shadow，反之不回退 | 🔍 |
| 3.7 | Effect 修改引擎不保存/恢复的渲染状态 | 引擎报 `sets non-saved+restored renderstate`；黑名单包括 `ColorWriteEnable1..3`、Fog*、Lighting 等——G-Buffer technique 不要设 `ColorWriteEnable1/2/3` | 🔍（`outdated/scrapeo反编译出来的一些注释.txt`）|

## 4. RenderBin

| # | 坑 | 规则 | 置信度 |
|---|---|---|---|
| 4.1 | 自创 bin 名（`geobuffer`）| 固定 47 项表，未知名=NONE(0)，不入队、不绘制 | 🔍 |
| 4.2 | 把 `renderbin X 1` 当 pass 1 | `1` = 该 bin 的粒子系统 | 🔍 + 📄（`BinCommand_RenderParticles`）|
| 4.3 | 以为 FX 的 `RenderBin` 注解一定生效 | 模型 `StaticSortLevel 1..5` 会强制改为 `StaticSort1..5` | 🔍 |
| 4.4 | 把物体移到新 bin 后阴影/反射消失 | 移出原 bin 的物体也要在 Shadow/Depth/Reflection casters 里补 `renderbin` | 🔍 |
| 4.5 | G-Buffer 抄 `renderDepthCasters` | 去掉 `renderbin Transparent` 与 `renderTransparentOutlineObjects` | 📄 |

## 5. 延迟改造专项（全部 ❓待实测，Phase 0/1 必须先验证）

| # | 问题 | 风险 | 验证方法 |
|---|---|---|---|
| 5.1 | `settarget 1..3` 在 RA3 PC 是否真正设置 MRT | 原版从未使用；帮助文本称 0-3 | Phase 0：4 RT 绑定 + clear + 可视化 |
| 5.2 | `setshaderoverride <X>` 的 `<X>` 是 SCRAPE `var shader` 名还是引擎 shader 资源名；`var shader X Objects.fx` 是否与场景材质共享对象 | 无 override 生效 = G-Buffer 被前向颜色污染 | 单 shader 家族测试：只 override `Objects` 看 RT1 是否有法线 |
| 5.3 | `clear` 对 4 RT 的效果 | D3D9 清所有 RT 为同一颜色 | PIX 查看 4 个 RT |
| 5.4 | `renderUnits`/`renderStructures` 是否写描边 Stencil、是否提交 `UnitOutline*` | 若在 G-Buffer 阶段写 Stencil，合成阶段**不能 clear 深度/模板**，否则后续 `renderOutlines` 失效 | PIX 查 Stencil |
| 5.5 | `StaticSort_END` 是否被所有 renderer 正常处理 | `_END` 是枚举边界 | 单个光体积 FX 设 `RenderBin="StaticSort_END"` + `renderbin StaticSort_END` |
| 5.6 | 开启 AA 时路径 | MSAA 主帧不能与 1x G-Buffer 混绑 | 用 `WW3D IsAntiAliasingEnabled` 回落前向 |

## 6. 资料冲突与裁决

| 冲突 | 裁决 |
|---|---|
| `readonly/ingame.scrapeo unfold.txt`：`ShadowMapTexture … L16`、`doRotateEnvironmentMaps` 先于 Shadow、surface 缺 `edram` | **以 `main/ingame.scrapeo` 为准**：`R32F`（L159）、Shadow 先（L1398 < L1400）、`edram`/`edramdepth`（L38/L41/L164）。unfold 文件是旧的手工展开稿，不可当原版 |
| GPT-5.6 `SCRAPE_COMMANDS…md` §8.3 称 `casttexture` "以指定格式解释/转换纹理视图" | 以 `SCRAPE_OVERRIDE与D24S8深度纹理结论.md` 为准：PC 实现为空操作 |
| reference §3 Step 0 行号 L1242/L1244 | 实际 L1359/L1360 |
| reference §1.3 环境 Cube 格式 | 实际 `$WW3D.EnvMapRenderTargetTextureFormat`（L1154）|
| distillation-notes §1.4 "renderUnits 提交 UnitPlayer0..19 **及单位外描边**" | 官方注释只证实 UnitPlayer0..19；外描边部分标 ❓ |
| AGENTS.md 称 "不可照搬 `fromscope static`" vs 原版用 `fromscope Terrain EnvironmentTexture` | 不冲突：`fromscope <Block> <Parm>` 是 RA3 合法形式（L1147）；`fromscope static` 是 CC4 专有 |
| 检查器白名单含 `compresstexture`、`renderSpawnZoneEffect`、CC4 命令 | 白名单 ≠ RA3 支持；以 [command-reference.md](command-reference.md) 为准 |
