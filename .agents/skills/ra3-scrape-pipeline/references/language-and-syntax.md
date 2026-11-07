# SCRAPE 语言与语法参考（RA3 1.12 PC）

> 标签：`✅已实机验证` / `📄源码确认` / `🔍IDA静态推测` / `❓待实测`。行号指 [`main/ingame.scrapeo`](../../../../main/ingame.scrapeo)（下文简写 `scrapeo#Lnnn`）。

## 1. 处理链

```text
InGame.scrape + *.scrapeh ──C 预处理器(-DEA_PLATFORM_WINDOWS)──► ingame.scrapeo (文本)
      ──游戏加载(逐行 tokenize)──► 变量表 + 过程表 + 命令数组 ──每帧──► 执行 proc InGame
```
- 引擎加载路径 `Shaders/Compiled/<name>.scrapeo`，`<name>` = `ingame` 或 `shell`。`🔍` [src: readonly/llm-analysis/SCRAPE_COMMANDS_AND_RENDER_ORDER.md#L47-L57]
- 预处理规则与构建方法见 [preprocess-and-build.md](preprocess-and-build.md)。

## 2. 词法规则

| 规则 | 说明 | 置信度 |
|---|---|---|
| 一行一条命令/声明 | 无续行符；不支持一行多命令 | ✅ |
| 行长 | 含换行 **< 256 字节**；超长加载失败。工程建议 ≤ 200 | 🔍 |
| 注释 | `//` 行尾注释、`/* … */` 块注释、`#` 开头整行 | ✅（`#`：原版 L1、日冕发布版中文 `#` 注释） |
| 编码 | UTF-8 中文注释可用（日冕发布版），但吃行长预算 | ✅ |
| 换行 | 原版与日冕发布版均为 CRLF；纯 LF 是否可用 | ❓（保持 CRLF） |
| 大小写 | 命令名一律照抄官方小写/驼峰（`renderTerrain`、`shadowMap.beginUpdate`）；大小写容错未证实 | 🔍 |
| 缩进 | Tab/空格任意，仅为可读性 | ✅ |
| 数值 | 整数或浮点（`0`、`1.0`、`0.5`、`-1`）| ✅ |
| 布尔字面量 | `true` / `false` | ✅ scrapeo#L50 |
| 名称 | `[A-Za-z_][A-Za-z0-9_]*`，区分大小写；SCOPE 参数路径可含 `.` 与 `[i]`（`Shadow[0].ShadowMap`） | ✅ scrapeo#L1427 |

## 3. 声明 `var`

通用形式：`var <type> <name> [attributes...]`（只能在 proc 外顶层声明；原版全部在顶层）。`staticvar` 被解析器识别但无官方用例，**不要用**。`🔍`

| 类型 | 原版写法 | 含义 | 置信度 |
|---|---|---|---|
| `camera` | `var camera Viewer` | 引擎提供的命名相机；已知 `Viewer`/`ShadowMap`/`Reflection`/`OceanDisplacement`。自定义名是否有效 ❓ | ✅ scrapeo#L8,L174,L758,L891 |
| `surface` 后缓冲 | `var surface FrameBuffer color0` | `color0`..`color3` 引用设备颜色表面（只见 `color0`） | ✅ scrapeo#L34 |
| `surface` 默认深度 | `var surface DepthBuffer depth` | 设备默认 1x `D24S8` 深度/模板 | ✅ scrapeo#L35 |
| `surface` 离屏 RT | `var surface X edram <W> <H> <FMT> [<MSAA>]` | 不可被 shader 采样的 RT 表面（用于 MSAA 主帧） | ✅ scrapeo#L38 |
| `surface` 离屏深度 | `var surface X edramdepth <W> <H> D24S8 [<MSAA>]` | 深度/模板表面 | ✅ scrapeo#L41,L164 |
| `texture` 渲染目标 | `var texture X <W> <H> <FMT>` | 可作 RT 又可被采样（PC）| ✅ scrapeo#L159,L632 |
| `texture` 资产 | `var texture X <AssetName>` | 按名加载游戏纹理资产（如 `FXFilmLut`、`Octave3_NRM`）| ✅ scrapeo#L124-L130,L895 |
| `texture(cube)` 来自 SCOPE | `var texturecube X fromscope <Block> <Parm>` | 引用引擎当前绑定到 SCOPE 的纹理（`Terrain EnvironmentTexture`、`WW3D FXOceanCubeMap`、`Terrain Shroud.Texture`）| ✅ scrapeo#L1147-L1148；日冕 L83 |
| `texturecube` 渲染目标 | `var texturecube X 128 128 <FMT> autogenmipmap` | 6 面 RT，`settarget 0 X <face>` 逐面写 | ✅ scrapeo#L1154-L1155 |
| `shader` | `var shader X PostFX_Bloom.fx` | 加载对应编译效果（`Shaders/Compiled/*.fxo`）供 `setshader` | ✅ scrapeo#L404 |
| `surfacegroup` | `var surfacegroup G A B` | 仅 Xenon 分支出现 | 📄（PC 不用）|
| `texture3d`/`scene`/`matrix` | — | 解析器识别，无 RA3 用例 | 🔍 |

**属性规则**
- `surface` 若既不是 `color0..3/depth` 也没有 `edram/edramdepth` → `ERROR: SCRAPE surfaces in RAM are not supported (use textures)`。新离屏目标一律用 `var texture`。`🔍` [src: outdated/scrapeo反编译出来的一些注释.txt]
- MSAA 参数：`$WW3D.AntiAliasingMode` 或字面 `1x/2x/4x/6x/8x/16x`（Windows）。延迟管线不使用 MSAA。`🔍`
- 格式名：见 [command-reference.md §9](command-reference.md)（D3DFORMAT 去掉 `D3DFMT_` 前缀）。识别格式 ≠ 硬件可创建。
- `fromscope static <Name>` 是 **CC4 专有**，RA3 不存在。`📄`（AGENTS.md 红线）

## 4. `$` 引擎常量（只能出现在声明的尺寸/格式/MSAA 位置，加载时求值）

| 常量 | 用途 | 原版出处 |
|---|---|---|
| `$WW3D.FrameBufferSize.x/.y` | 后缓冲尺寸 | scrapeo#L38,L1023 |
| `$WW3D.FrameBufferSizeIfAntiAliasing.x/.y` | AA 开时=屏幕尺寸，关时 `0×0`（不分配）| scrapeo#L41,L1024 |
| `$WW3D.FrameRenderTargetSurfaceFormat` | 主帧 surface 格式（HDR=`A16B16G16R16F`）| scrapeo#L38 |
| `$WW3D.FrameRenderTargetTextureFormat` | 与主帧兼容的 texture 格式 | scrapeo#L259,L750 |
| `$WW3D.EnvMapRenderTargetTextureFormat` | 环境 Cube 格式 | scrapeo#L1154 |
| `$WW3D.AntiAliasingMode` | 当前 MSAA 模式 | scrapeo#L38 |
| `$WW3D.Outline.TextureSize.x/.y` | 描边模糊纹理尺寸 | scrapeo#L1026 |
| `$Sas.Shadow[0].MapSize` | 阴影图边长 | scrapeo#L159 |
| `$PostEffect.FrameBufferSize.x/.y` | 后处理全屏纹理尺寸（与 `DepthBuffer` 搭配已验证）| scrapeo#L259,L632 |
| `$PostEffect.Bloom.TextureSize{High,Medium,Low}.x/.y`、`$PostEffect.Bloom.TextureFormat` | Bloom 金字塔 | scrapeo#L424-L451 |

无法解析 → `ERROR: SCRAPE Error resolving constant %s`。`🔍`。`$PostEffect.FrameBufferSize` 与 `$WW3D.FrameBufferSize` 是否恒等 ❓（原版把前者尺寸的 `DepthTexture` 与 `DepthBuffer` 同时绑定且可运行，说明前者 ≤ 后者）。

## 5. 过程、标签、事件

```text
proc Name            // 不可嵌套；重名=加载失败
    ...
    return           // 可选：提前返回（原版未用）
endproc
callproc Name        // 返回到下一行；可前向引用
: Label              // 标签（原版未用）
goto Label
beginevent Name      // PIX 区段；可嵌套；endevent 的名字不强制一致
endevent Name
```
`✅` proc/callproc/beginevent；`🔍` return/goto/label（帮助字符串）。

## 6. 条件

```text
if <Block> <Parm>        // 读布尔 SCOPE 参数
elif <Block> <Parm>
elifnot <Block> <Parm>
else
endif
ifnot <Block> <Parm>
```
- 每个 `if/ifnot` 一个 `endif`；`else` 后不能再有 `elif`。
- AND：嵌套 `if`（scrapeo#L778-L781）；OR：`if A callproc X elif B callproc X endif`（scrapeo#L725-L729）。
- 关闭一段代码的惯用法：`setbool Blk Flag false` + `if Blk Flag`（日冕 L323-L324）。
- 能否测试 float/int 参数 ❓。

**原版/引擎已知可测条件**

| Block | Parm | 意义 | 出处 |
|---|---|---|---|
| `WW3D` | `IsHdrEnabled` / `IsAntiAliasingEnabled` | 画质开关 | scrapeo#L49,L51 |
| `WW3D` | `IsUsingFrameRenderTarget` | 脚本自写（L50），主帧画 `FrameRenderTarget` 还是 `FrameBuffer` | scrapeo#L59 |
| `WW3D` | `MustRefreshEnvironment` | 首帧/光照变化，脚本读后置 false | scrapeo#L1359-L1360 |
| `WW3D` | `Outline.IsEnabled`、`Outline.Is{Selected,HoverSelect,HoverAttack}BinPopulated` | 描边 | scrapeo#L1035,L1070-L1078 |
| `Sas` | `ShadowMappingEnabled` | 阴影 | scrapeo#L215 |
| `Water` | `IsReflectionVisible` / `IsRefractionVisible` | 当前画面有水 | scrapeo#L761,L830 |
| `Particle` | `IsSoftParticlesEnabled` | 软粒子画质；`ReallyRenderSoftParticles` 由脚本写 | scrapeo#L727,L766 |
| `PostEffect` | `Distortion.IsEnabled` / `Bloom.IsEnabled` / `LookupTable.IsEnabled` | 后处理开关 | scrapeo#L353,L461,L302 |
| `DebugToggle` | `BaselineRendering` `TerrainCaster` `StructureCaster` `TerrainReflection` `StructureReflection` `RenderUnderwater` `RenderCaustics` `RenderOutlines` `RenderParticles` + `.IsEnabled` | 调试开关（正常为 true） | scrapeo#L178-L200,L1457,L1477,L1486 |
| `WW3D` | `Fog.IsEnabled`、`SSAO.IsEnabled` | 引擎字符串中存在，脚本未用 | 🔍 |

## 7. SCOPE 写入（脚本 → HLSL）

| 命令 | 原版示例 | HLSL 侧 |
|---|---|---|
| `settexture B P T` | `settexture WW3D DepthTexture DepthTextureLinear`（L716）| `SasBindAddress = "WW3D.DepthTexture"` |
| `setfloat B P x [y z w]` | `setfloat Water DisplacementTextureSize 1024`（L905）| 分量数决定 float/float2/3/4 |
| `setbool B P v` | `setbool Particle ReallyRenderSoftParticles false`（L766）| bool |
| `settosize B P Res` | `settosize PostEffect Bloom.SourceTextureSize X`（L475）| float2(宽,高) |
| `setint B P v` | 原版未用 | int |

原版写入的 SCOPE 槽（供复用/勿冲突）：`WW3D.{FXDistortionFractal,FXOceanCubeMap,FXJapanBuildMask,FXChronoRift,FXIronCurtain,FXLightningTeslaHit,DepthTexture,Outline.Texture,IsUsingFrameRenderTarget,MustRefreshEnvironment}`、`PostEffect.{FrameBufferTexture,DepthBufferTexture,LookupTable.FilmTonemapping,Distortion.DistortionOffsetTexture,Bloom.SourceTexture,Bloom.SourceTextureSize,Bloom.TargetTextureSize}`、`Sas.Shadow[0].ShadowMap`、`Water.{ReflectionTexture,RefractionTexture,DisplacementTexture,StaticDisplacementTexture,DisplacementTextureSize,DepthLutTexture,CausticsTexture,LightSpaceEnvironmentMap}`、`Objects.LightSpaceEnvironmentMap`、`Environment.SourceTexture`、`Particle.ReallyRenderSoftParticles`。新功能请用独立块名（建议 `Deferred.*`）。
