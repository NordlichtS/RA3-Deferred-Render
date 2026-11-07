# 日冕（Corona）Mod 对 `ingame.scrapeo` 的改动与可借鉴手法

> 来源：`readonly/ingame.scrapeo modded corona.txt`（下称 **txt**，行号以它为准，作者注明"在游戏中编译运行正常"）与已发布版 `D:\PROJECTS\SAGE shader source\CORONA Shaders 240820\ingame.scrapeo`（下称 **发布版**）。两者去注释后仅差 6 行（txt 多出 `RenderCoronaPostEffects` 中 `Lanyi.PostEffectInnerRadii`、`PostEffectPositionRadius1..4` 与 `settexture Lanyi DigitsTexture digits`——`digits` 从未 `var` 声明，且位于被 `setbool … false` 禁用的分支内，**不要据此推断未声明纹理可用**）。凡发布版中存在的写法记为 `✅已实机验证`。

## 1. 改动清单

| # | txt 行 | 改动 | 手法 | 置信度 |
|---|---|---|---|---|
| C1 | L8 | `var texturecube MapEnvironment fromscope Terrain EnvironmentTexture`（备选：资产 `EVSunset2`）| 从 SCOPE 引用地图环境图 | ✅ |
| C2 | L13–L27 | `proc ConfigureFlags`：`setbool/setfloat Lanyi …` 设置自定义开关；`if Lanyi DepthMapNotAvailable` 时关天空盒 | **自定义 SCOPE 块** + 每帧配置 proc（`InGame` 第 2 行调用，L993）| ✅ |
| C3 | L29–L37、L1063 | `SkyBoxEffect`：`renderWater` 之后画全屏天空 quad | 在主帧中插入全屏 Pass（不换 RT）| ✅ |
| C4 | L39–L75、L978 | `GeneratePbrIrradianceMap`：`PbrIrradianceTexture 128² A8R8G8B8 autogenmipmap`，6 次 `settarget 0 Tex <face>` + `setfloat Lanyi IrradianceMapGenerator.FaceDirection ±1 0 0` + `renderquad` | **首帧 IBL 预计算**：挂在原版 `if WW3D MustRefreshEnvironment` 分支内，只在地图载入/光变时执行 | ✅ |
| C5 | L77–L80、L984 | `SetupPbrEnvironmentTexture`：每帧 `settexture Lanyi PbrIrradianceTexture/EnvironmentTexture` | 绑定放在 if 外，每帧执行 | ✅ |
| C6 | L82–L131、L994 | `BlurShroud`/`BlurShroudReally`：`fromscope Terrain Shroud.Texture` → 512² `L8` 预处理 + 横/纵两次模糊；`WaitBlurShroud1..3` 布尔链实现**每 4 帧更新一次** | **跨帧布尔状态机**（未写过的布尔首读为 false）+ 跨帧保留纹理 | ✅ |
| C7 | L317–L366、L551 | `RenderCoronaPostEffects`：嵌套 4 级 `if`，每级先 `setbool … false` 再 `if` 同名参数 | 用 `setbool false` 关闭代码段的惯用法；放在 `renderPostEffects` 最前（Distortion 之前）| ✅（结构）|
| C8 | L626–L636 | `updateDepthMap` 增加 `else` 分支并写 `Lanyi DepthMapNotAvailable` | 把引擎条件结果导出为自定义标志供后续 proc 使用 | ✅ |
| C9 | L801–L805 | `renderUnderwaterDeferred` 内追加 `setshader SkyShader UnderWaterSupplement` + `renderfullquad` | 唯一一处 `renderfullquad` 实用证据 | ✅ |
| C10 | L882–L883 | `EnvironmentSourceTextureObjects` 由 `fromscope Terrain EnvironmentTexture` 改为资产 `EVOriginalDefault` | 用固定资产替换地图环境源 | ✅ |
| C11 | 全文 | 删除大部分预处理残留空行；保留 `// 1 "…"` 形式的原行号标记（txt）/ 发布版用 `#` 中文注释 | `#` 整行注释 + UTF-8 中文可被引擎接受 | ✅ |

**未改动**：主帧顺序、所有原版资源格式、`renderUnits`/`renderStructures`、后处理链本体、HUD 顺序。日冕**没有**使用 MRT（`settarget 1..3`）、`setshaderoverride`、`setviewport`、`goto`、`ifnot`。

## 2. 对本项目的直接价值

| 需求 | 借鉴 |
|---|---|
| 延迟管线总开关 / AA 回落 | C2 + C8：每帧 `configureDeferredFlags` 写 `Deferred.*` 布尔 |
| IBL 辐照度 / 粗糙度 Mip 预计算 | C4：放进 `doRotateEnvironmentMaps` 的 `MustRefreshEnvironment` 分支，结果纹理常驻 |
| 分帧摊销（如低频 SSAO/阴影模糊）| C6：布尔链 N 帧更新一次 |
| 读引擎内部纹理（Shroud、环境图）| C1/C6：`fromscope <Block> <Parm>` |
| 合成后补画天空/背景 | C3/C9：G-Buffer `GBuffer3==0` 像素的背景也可用同样的全屏 quad 手法 |

## 3. 注意
- 日冕 txt 的中文注释"来自猜测与测试，不一定正确"（txt L4），语义以 IDA/官方源码为准。
- 日冕 PBR 依赖其自带 FX（`IrradianceMapGenerator.fx`、`Sky.fx`、`BlurShroud.fx`、`CoronaPostEffects.fx`），位于 `D:\PROJECTS\SAGE shader source\CORONA Shaders 240820`（只读参考）。
