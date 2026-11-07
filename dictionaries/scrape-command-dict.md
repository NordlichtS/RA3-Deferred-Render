# SCRAPE 命令速查字典（RA3 1.12 PC）

> 紧凑查表。完整语义、参数细节与禁用命令见 [`.agents/skills/ra3-scrape-pipeline/references/command-reference.md`](../.agents/skills/ra3-scrape-pipeline/references/command-reference.md)。
> 置信度：✅已实机验证（原版 `main/ingame.scrapeo` 或日冕发布版实际运行）/ 📄源码确认 / 🔍IDA静态推测 / ❓待实测。src 行号默认指 `main/ingame.scrapeo`；`asm` = `readonly/scrapeo rules from asm.txt`（引擎帮助字符串）；`corona` = `readonly/ingame.scrapeo modded corona.txt`。
> 手改 `.scrapeo` 时**不存在宏**：写字面量。每行含换行 < 256 字节。

## 1. 控制流与声明

| 命令 | 参数 | 作用 | 置信度 | src |
|---|---|---|---|---|
| `var` | `<type> <name> [attrs…]` | 声明资源/引用（加载时创建，跨帧常驻）| ✅ | L8, L159 |
| `staticvar` | 同 `var` | 语义未知，勿用 | 🔍 | asm |
| `proc` / `endproc` | `<Name>` / — | 定义过程，不可嵌套 | ✅ | L48/L56 |
| `callproc` | `<Name>` | 调用；不保存任何状态；可前向引用 | ✅ | L1388 |
| `return` | — | 提前返回 | 🔍 | asm#L91 |
| `:` / `goto` | `<Label>` | 标签 / 跳转 | 🔍 | asm#L59-L60 |
| `if` / `elif` | `<Block> <Parm>` | 布尔 SCOPE 条件 | ✅ | L49/L51 |
| `ifnot` / `elifnot` | `<Block> <Parm>` | 取反条件 | 🔍 | asm#L48-L56 |
| `else` / `endif` | — | 兜底 / 闭合 | ✅ | L53/L55 |

## 2. 目标、视口、相机、清屏

| 命令 | 参数 | 作用 | 置信度 | src |
|---|---|---|---|---|
| `settarget` | `<0..3> <tex\|surf\|NULL> [face0..5]` | 绑定颜色 RT（cube 可选面）| 槽0 ✅ / 槽1..3 🔍❓ | L60, L1208; asm#L11-L21 |
| `setdepth` | `<surface\|NULL>` | 绑定深度模板（只接受 surface）| ✅ | L68, L908 |
| `cleartarget` | `<0..4>` | 解绑槽（4=depth）| 🔍 | asm#L68-L71 |
| `setviewport` | `l t r b` \| `l t <res>` \| `<res>` | 显式视口（默认取最后设置的 RT/Depth 尺寸）| 🔍 | asm#L24-L27 |
| `setscissor` | 同上 | 剪裁矩形 | 🔍 | asm#L29-L32 |
| `setcamera` | `<camera>` | 设 View/Proj | ✅ | L228 |
| `setclearcolor` | `r g b a` | 清屏色 | ✅ | L224 |
| `setcleardepth` | `z [stencil=0]` | 清屏深度/模板 | ✅ | L225 |
| `clear` | — | 清颜色+深度+模板（所有已绑定 RT）| ✅ | L226 |
| `clearcolor` | — | 只清颜色 | ✅ | L359 |
| `clearz` | — | 只清深度+模板 | 📄(Xenon 分支) 🔍 | asm#L63 |

## 3. Shader、SCOPE、纹理

| 命令 | 参数 | 作用 | 置信度 | src |
|---|---|---|---|---|
| `setshader` | `<shaderVar> [tech]` \| `<shaderVar> <Block> <Parm>` | 设 quad 用 shader（不影响场景材质）| ✅ | L310, L381 |
| `setshaderoverride` | `<shader> <tech>` | 该 shader 所有 draw 强制 technique，持续到清除；名错→静默无效 | 🔍❓ | asm#L130-L131 |
| `clearshaderoverride` | `<shader>` | 清该 shader override | 🔍 | asm#L133-L134 |
| `settexture` | `<Block> <Parm> <texVar>` | 纹理写入 SCOPE/SAS | ✅ | L133 |
| `settosize` | `<Block> <Parm> <res>` | 写 float2(宽,高) | ✅ | L475 |
| `casttexture` | `<texVar> <fmt>` | PC 为空操作 | 🔍 | asm#L146-L147 |
| `setfloat` | `<Block> <Parm> x [y z w]` | 写 1..4 float | ✅ | L905 |
| `setint` | `<Block> <Parm> v` | 写 int | 🔍 | asm#L119-L120 |
| `setbool` | `<Block> <Parm> true\|false` | 写 bool（跨帧保留）| ✅ | L50 |

## 4. 绘制、可见集、拷贝、标记

| 命令 | 参数 | 作用 | 置信度 | src |
|---|---|---|---|---|
| `visibleobjects` | `Frame\|ShadowMap\|DepthMap\|Reflection` | 切换可见集（mask 参数无效）| ✅ | L229, L700, L776, L1414 |
| `renderbin` | `<Bin> [0\|1] [reserved]` | 提交 bin；1=该 bin 粒子 | ✅ | L361/L363 |
| `renderquad` | `[r g b a]` | 视口大三角 | ✅ | L311 |
| `renderfullquad` | `[r g b a]` | 视口四边形 | ✅ | corona#L804 |
| `stretchrect` | `<src> <dst> [none\|point\|linear] [srcMip] [dstMip]` | 表面拷贝 / MSAA resolve | ✅ | L277, L1089 |
| `beginevent` / `endevent` | `<Name>` | PIX 区段 | ✅ | L216/L240 |
| `setmarker` | `<Name>` | PIX 标记 | 🔍 | asm#L79-L80 |

## 5. RA3 引擎回调（无参数）

| 命令 | 作用 | 置信度 | src |
|---|---|---|---|
| `renderTerrain` `renderRoads` `renderScorchMarks` `renderTerrainTracks` | 地表 | ✅ | L1430–L1439 |
| `renderProps` | 树木道具 | ✅ | L1444 |
| `renderUnits` | 单位（含 `UnitPlayer0..19`；Outline/Stencil ❓）| ✅/📄 | L1446; `readonly/SCRAPE-RA3/InGame.scrape#L86` |
| `renderStructures` | 建筑（含 `Structure`；Outline/Stencil ❓）| ✅/📄 | L1451; `InGame.scrape#L91` |
| `renderDecals` `renderTransparentOutlineObjects` `renderBehindBuildingMarkers` | 贴花 / 透明描边物 / 建筑后剪影 | ✅ | L1471, L1475, L1481 |
| `renderWater` `renderWaterDisplacement` | 水面 / 海浪位移源 | ✅ | L1469, L919 |
| `renderParticles` `renderTracers` `renderLasers` `renderConnectionLines` `renderRain` `renderDistortionLasers` | 特效 | ✅ | L1487–L1494, L365 |
| `renderTerrainUI` `renderIconLayers` `renderUI` `renderDebugDisplays` | 地面 UI / HUD | ✅ | L1490, L1505–L1508 |
| `renderDebugSystems` `renderTileFeedback` | 1.12 中 NoOp | ✅(存在)/🔍(NoOp) | L1502–L1503 |
| `renderEditorObjects` | 仅 `proc Editor` | ✅ | L1587 |
| `renderStreams` | 已注册，未用 | 🔍 | `readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md#L353` |
| `setGlobalLightInfo` | 刷新全局光照（环境图旋转前）| ✅ | L1363 |
| `shadowMap.beginUpdate` / `shadowMap.endUpdate` | 计算阴影相机/矩阵 | ✅ | L221/L234 |
| `beginShadowOverrideTechnique` / `beginDepthOverrideTechnique` | 全部 shader 切到 `_CreateShadowMap` / `_CreateDepthMap`（Depth 缺失回退 Shadow）| ✅/🔍 | L222/L688 |
| `endShadowOverrideTechnique` / `endDepthOverrideTechnique` | **所有** shader override=-1（会抹掉手动 override）| ✅/🔍 | L233/L704 |

## 6. 禁用（非 RA3 PC）

`setgpr` `gpuflush` `resolve` `clearbegintiling` `resolveendtiling`（Xenon）· 四参 `settarget`、`setfragmentshader`、`transferimage`（PS3）· `beginDepthNormalOverrideTechnique` `renderDeferredLights*` `renderDefferedLightingDebug*` `fromscope static`（CC4）· `compresstexture` `renderSpawnZoneEffect`（无证据）。
