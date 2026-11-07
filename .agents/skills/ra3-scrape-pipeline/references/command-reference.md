# SCRAPE 命令全量参考（RA3 1.12 PC）

> 标签：`✅已实机验证`（在原版 `main/ingame.scrapeo` 或日冕发布版中实际运行）/ `📄源码确认` / `🔍IDA静态推测`（`ra3_1.12.game` 帮助字符串或反编译，见 `readonly/scrapeo rules from asm.txt`、`readonly/llm-analysis/*`）/ `❓待实测`。
> "原版行" 指 [`main/ingame.scrapeo`](../../../../main/ingame.scrapeo) 行号；"日冕" 指 `readonly/ingame.scrapeo modded corona.txt` 行号。

## 1. 控制流

| 命令 | 签名 | 语义 / 注意 | 置信度 | 原版行 |
|---|---|---|---|---|
| `proc` | `proc <Name>` | 定义过程；不可嵌套（`Nested procedure definitions are not allowed`）；重名报 `Duplicate function` | ✅ | L48 等 |
| `endproc` | `endproc` | 结束过程；缺失报 `Unexpected end of file, missing 'endproc'` | ✅ | L56 |
| `callproc` | `callproc <Name>` | 调用并返回下一行；目标加载后统一解析（`Unresolved goto/callproc target`）；**不隔离任何状态** | ✅ | L1388 |
| `return` | `return` | 提前返回调用方 | 🔍 | — |
| `:` | `: <Label>` | 定义 goto 标签；重名报 `duplicate label name` | 🔍 | — |
| `goto` | `goto <Label>` | 跳转；谨防死循环 | 🔍 | — |
| `if` | `if <Block> <Parm>` | 布尔 SCOPE 条件 | ✅ | L49 |
| `ifnot` | `ifnot <Block> <Parm>` | 取反 | 🔍 | — |
| `elif` | `elif <Block> <Parm>` | 追加分支 | ✅ | L51 |
| `elifnot` | `elifnot <Block> <Parm>` | 取反追加分支 | 🔍 | — |
| `else` | `else` | 兜底分支 | ✅ | L53 |
| `endif` | `endif` | 闭合 | ✅ | L55 |

## 2. 声明

| 命令 | 签名 | 语义 | 置信度 |
|---|---|---|---|
| `var` | `var <type> <name> [attrs…]` | 加载时创建资源/引用；重名报 `duplicate variable name`；类型/属性见 [language-and-syntax.md §3](language-and-syntax.md) | ✅ |
| `staticvar` | 同上 | 解析器识别，语义未知，勿用 | 🔍 |

## 3. 渲染目标、视口、相机、清屏

| 命令 | 签名 | 语义 / 注意 | 置信度 | 原版行 |
|---|---|---|---|---|
| `settarget` | `settarget <0..3> <texture\|surface\|NULL> [cubeFace 0..5]` | 绑定颜色 RT；PC 可绑 texture 或 surface；`NULL` 解绑；cube 面号 0..5（`+X,-X,+Y,-Y,+Z,-Z`）。帮助文本称索引 4=depth，但 PC 脚本一律用 `setdepth`。**原版只用过索引 0**；1..3 来自帮助文本与 CC4 PC 分支 | 槽 0 ✅；槽 1..3 🔍❓ | L60,L1208 |
| `setdepth` | `setdepth <surface\|NULL>` | 绑定深度/模板；只查 surface 表（`Unknown surface`）；texture 不可 | ✅ | L68,L908 |
| `cleartarget` | `cleartarget <0..4>` | 将该槽设为 NULL（4=depth）；`Target index out of range` | 🔍 | — |
| `setviewport` | `setviewport l t r b` / `setviewport l t <res>` / `setviewport <res>` | 显式视口；原版不用——视口自动取"最后一次设置的 RT/Depth"尺寸 | 🔍（自动规则 📄 `readonly/SCRAPE-RA3/WaterReflection.scrapeh#L33`） | — |
| `setscissor` | 同 `setviewport` 三种形式 | 剪裁矩形；是否同时打开 ScissorTestEnable ❓ | 🔍 | — |
| `setcamera` | `setcamera <camera>` | 设置 View/Projection（更新 `c119..c123` 与 SAS 矩阵）；`Unknown Camera` | ✅ | L228 |
| `setclearcolor` | `setclearcolor r g b a` | 设置下一次 clear 颜色（浮点 0..1）| ✅ | L224 |
| `setcleardepth` | `setcleardepth z [stencil]` | 设置 clear 深度/模板；省略 stencil=0 | ✅ | L225 |
| `clear` | `clear` | 清颜色+深度+模板（D3D9：清**所有已绑定 RT**）| ✅ | L226 |
| `clearcolor` | `clearcolor` | 只清颜色（所有已绑定 RT）| ✅ | L359 |
| `clearz` | `clearz` | 只清深度+模板 | 📄（Xenon 分支用）🔍 | — |

**绘制前合法性检查**（每个 draw 前，`🔍`）：至少 1 个 RT 或 Depth（`No color or depth surfaces active!`）；所有 RT 尺寸/格式组合合法且 MSAA 一致；RT 与 Depth MSAA 一致；Depth 不小于 RT（`Depth surface smaller than color surface(s)`）。失败报 `Current render targets are not a valid set … at command %d`。

## 4. Shader、纹理与 SCOPE

| 命令 | 签名 | 语义 / 注意 | 置信度 | 原版行 |
|---|---|---|---|---|
| `setshader` | `setshader <shaderVar> [technique]` 或 `setshader <shaderVar> <Block> <Parm>`（technique 名取自 SCOPE） | 设置 SCRAPE 当前 shader，draw 时才绑定；**只影响 `renderquad/renderfullquad`**；不写 technique 时用默认（L381）| ✅（SCOPE 形式 🔍）| L310,L381 |
| `setshaderoverride` | `setshaderoverride <shader> <technique>` | 把该 shader 运行时对象的 override 设为指定 technique 索引，持续到清除；作用于**所有**使用该 shader 的 draw；名字找不到→写 `-1`（=无 override，回退原 technique，无报错）。**第一个参数如何对应场景材质 shader（是否需 `var shader X Objects.fx` 且与材质共享同一对象）未验证** | 🔍❓（无任何可运行脚本使用过）| — |
| `clearshaderoverride` | `clearshaderoverride <shader>` | 该 shader override=-1 | 🔍 | — |
| `settexture` | `settexture <Block> <Parm> <textureVar>` | 把纹理写入 SCOPE/SAS；只查 texture 表（`Unknown texture`）| ✅ | L133 |
| `settosize` | `settosize <Block> <Parm> <texture\|surface>` | 写 VECTOR2(宽,高)；3D 纹理忽略深度 | ✅ | L475 |
| `casttexture` | `casttexture <textureVar> <format>` | PC 普通纹理实现为空操作（`return false`）；**不能**把 D24S8 变成可采样 | 🔍 | — |
| `setfloat` | `setfloat <Block> <Parm> x [y] [z] [w]` | 分量数决定类型 | ✅ | L905 |
| `setint` | `setint <Block> <Parm> v` | 整数 | 🔍 | — |
| `setbool` | `setbool <Block> <Parm> true\|false` | 布尔；跨帧保留 | ✅ | L50 |

## 5. 绘制、可见集、拷贝

| 命令 | 签名 | 语义 / 注意 | 置信度 | 原版行 |
|---|---|---|---|---|
| `visibleobjects` | `visibleobjects <Frame\|ShadowMap\|DepthMap\|Reflection> [+mask\|-mask…]` | 切换/准备可见集（内部值 ShadowMap=0 DepthMap=1 Reflection=2 Frame=3），不绘制；mask 解析器要求 `+/-` 前缀但 RA3 回调是返回 0 的桩，**只用单参数形式** | ✅（单参数）| L229,L700,L776,L1414 |
| `renderbin` | `renderbin <BinName> [binCommand=0] [reserved=0]` | 提交固定 47 项表中的一个 bin；`0`=普通对象，`1`=该 bin 的粒子（`TheFXParticleSystemManager`）；第 3 参数保留未用；未知名=NONE 不绘制 | ✅ | L361,L363 |
| `renderquad` | `renderquad [r g b a]` | 覆盖当前视口的大三角形；用当前 `setshader` | ✅ | L311 |
| `renderfullquad` | `renderfullquad [r g b a]` | 覆盖视口的真四边形 | ✅（日冕 L804）| — |
| `stretchrect` | `stretchrect <src> <dst> [none\|point\|linear] [srcMip] [dstMip]` | D3D9 StretchRect；surface/texture 均可；用于抓屏与 MSAA resolve；**不能**转换深度格式；`ambiguous texture/surface`=两表重名 | ✅ | L277,L1089 |

## 6. 性能标记

| 命令 | 签名 | 置信度 | 原版行 |
|---|---|---|---|
| `beginevent` | `beginevent <Name>` | ✅ | L216 |
| `endevent` | `endevent <Name>` | ✅ | L240 |
| `setmarker` | `setmarker <Name>` | 🔍 | — |

## 7. Override 全局命令（RA3 引擎注册，无参数）

| 命令 | 语义 | 置信度 | 原版行 |
|---|---|---|---|
| `beginShadowOverrideTechnique` | 扫描全部已加载 shader，各自切到本 `.fxo` 中名为 `_CreateShadowMap` 的 technique（无则 -1）| ✅（存在）/ 🔍（机制）| L222 |
| `endShadowOverrideTechnique` | **所有** shader override = -1（与 Depth end 同一函数）| ✅ / 🔍 | L233 |
| `beginDepthOverrideTechnique` | 同上但找 `_CreateDepthMap`；缺失时加载期已回退到 `_CreateShadowMap` 索引 | ✅ / 🔍 | L688 |
| `endDepthOverrideTechnique` | 同 Shadow end | ✅ / 🔍 | L704 |

名称为大小写敏感 `strcmp`，匹配最终 `.fxo` 中的 technique 名。缺名不跳过 draw，回退物体原 technique。

## 8. RA3 引擎回调命令（无参数）

| 分类 | 命令 | 原版使用位置 | 置信度 |
|---|---|---|---|
| 地表 | `renderTerrain` `renderRoads` `renderScorchMarks` `renderTerrainTracks` | L1430–L1439（主帧）；`renderTerrain` 亦在 Shadow/Depth/Reflection | ✅ |
| 贴花 | `renderDecals` | L1471 | ✅ |
| 物体 | `renderProps` | L1444 | ✅ |
| 物体 | `renderUnits` | L1446；官方注释"includes renderbin UnitPlayer0–UnitPlayer19"；是否同时提交 `UnitOutline*` 与写描边 Stencil 未证实 | ✅（存在）📄（含 UnitPlayer*）❓（Outline）|
| 物体 | `renderStructures` | L1451；官方注释"includes renderbin Structure"；`StructureOutline*` 同上未证实 | ✅ 📄 ❓ |
| 物体 | `renderTransparentOutlineObjects` | L1475（及 Shadow/Depth casters）| ✅ |
| 物体 | `renderBehindBuildingMarkers` | L1481 | ✅ |
| 物体 | `renderEditorObjects` | L1587（仅 `Editor`）| ✅ |
| 水 | `renderWater` `renderWaterDisplacement` | L1469、L919 | ✅ |
| 天气 | `renderRain` | L1494 | ✅ |
| 特效 | `renderParticles` `renderTracers` `renderLasers` `renderConnectionLines` `renderDistortionLasers` | L1487–L1493、L365 | ✅ |
| 特效 | `renderStreams` | 未用 | 🔍 |
| UI | `renderTerrainUI` `renderIconLayers` `renderUI` | L1490、L1505、L1506 | ✅ |
| 调试 | `renderDebugDisplays`（有效）`renderDebugSystems` `renderTileFeedback`（1.12 中为 NoOp） | L1502–L1508 | ✅ / 🔍(NoOp) |
| 光照 | `setGlobalLightInfo` | L1363（环境图旋转前）| ✅ |
| 阴影 | `shadowMap.beginUpdate` / `shadowMap.endUpdate` | L221、L234（计算阴影相机与 `ShadowMapWorldToShadow`）| ✅ |

## 9. 已识别的格式字符串（`var` 的 FMT 位置）

`A32B32G32R32F G32R32F R32F A16B16G16R16F G16R16F R16F Q16W16V16U16 L16 D24FS8 D16 D24X8 D24S8 D32 DXT4 DXT2 G8R8_G8B8 YUY2 R8G8_B8G8 UYVY A2W10V10U10 V16U16 Q8W8V8U8 X8L8V8U8 L6V5U5 V8U8 A8L8 L8 A16B16G16R16 A2R10G10B10 G16R16 X8B8G8R8 A8B8G8R8 A2B10G10R10 X4R4G4B4 A8 A4R4G4B4 A1R5G5B5 X1R5G5B5 CxV8U8 MULTI2_ARGB8 D32F_LOCKABLE D24X4S4 D15S1 D16_LOCKABLE A4L4 P8 A8P8 A8R3G3B2 R3G3B2 R8G8B8`（+ `INDEX16/32 VERTEXDATA` 非纹理）。`A8R8G8B8`/`X8R8G8B8` 原版在用。`*_EDRAM/_EXPAND/_TILED/_LIN` 为 Xenon。`🔍` [src: readonly/scrapeo rules from asm.txt#L151-L204]

## 10. 禁用命令（非 RA3 PC）

| 命令 | 来源 | 原因 |
|---|---|---|
| `setgpr` `gpuflush` `resolve` `clearbegintiling` `resolveendtiling` | RA3 源码 Xenon 分支 | PC 预处理后消失；PC 引擎无此命令 |
| 四参数 `settarget 0 Surf Tex`、`setfragmentshader` `transferimage` | PS3 | 平台专有（`ingame-test.scrape` L57 即 PS3 写法，勿抄）|
| `beginDepthNormalOverrideTechnique` `renderDeferredLights` `renderDeferredLightsOverdraw` `renderDefferedLightingDebug2D/3D`、`var … fromscope static …` | CC4 | RA3 1.12 C++ 无对应注册 |
| `compresstexture` `renderSpawnZoneEffect` | 只出现在检查器白名单 | 无 RA3 证据，勿用 |
