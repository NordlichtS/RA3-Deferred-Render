# `fxc.exe` 编译 / 反汇编工作流（已实测）

> **定位**：本项目唯一编译器 [`main/fxc.exe`](../../../../main/fxc.exe)（`9.29.952.3111`，DX SDK June 2010）的实测命令、include 规则、常见报错与 SM3 预算速查。通用 HLSL 指令/寄存器上限的权威细节请查全局技能 `hlsl-directx-reference`（`~/.agents/skills/hlsl-directx-reference/references/sm3-intrinsics-and-d3d9-reference.md`）。
>
> 实测环境：Windows PowerShell，2026-11-04；所有输出写到仓库外的临时目录（**严禁把 `.fxo` 写进仓库**）。

## 1. 命令速查（全部 ✅fxc实测）

```powershell
$fxc = "c:\Desktop01\MYGITHUB\RA3-Deferred-Render\main\fxc.exe"
$out = "<仓库外临时目录>"          # 例如 agent 的 scratch\fxc-test
$inc = "c:\Desktop01\MYGITHUB\RA3-Deferred-Render\main"   # COMMON.FXH 所在目录

# (1) 完整 Effect 二进制（游戏加载的 .fxo）
& $fxc /nologo /O2 /T fx_2_0 /I $inc /Fo "$out\MyShader.fxo" "main\MyShader.fx"

# (2) 单入口 PS 汇编 + 寄存器表 + 指令槽统计
& $fxc /nologo /O2 /T ps_3_0 /E PS_GBuffer /I $inc /Fc "$out\ps.asm" "main\MyShader.fx"

# (3) 单入口 VS 汇编
& $fxc /nologo /O2 /T vs_3_0 /E VS_GBuffer_11skin /I $inc /Fc "$out\vs.asm" "main\MyShader.fx"

# (4) 只看关键行
Get-Content "$out\ps.asm" | Select-String '^//\s+\w+\s+[csbi]\d|slots'
```

| 实测用例 | 结果 |
|---|---|
| FXFXH `objectsgeneric.fx` → `/T fx_2_0` | 成功，41792 B |
| FXFXH `FXdeferredpointlight.FX`、`TERRAIN.FX` → `/T fx_2_0` | 成功 |
| FXFXH `objectsgeneric.fx` `/T ps_3_0 /E PS_H_ARPBR /Fc` | 成功：`approximately 345 instruction slots used (9 texture, 336 arithmetic)` |
| FXFXH `objectsgeneric.fx` `/T vs_3_0 /E VS_H_11skin /Fc` | 成功：66 slots；`WorldBones c128 (128)` |
| `FXscreenSpaceShadow.fx` `/T ps_3_0 /E PS_ScreenShadow /Fc` | 成功 |
| 仓库外探针 `gbuffer_probe.fx`（4×MRT + `clip`）无 `/I` | **失败** `X1507: failed to open source file: 'COMMON.FXH'` |
| 同上加 `/I main` | 成功 |

## 2. Include 路径规则 ✅fxc实测
- `#include "X"` 先相对**被编译源文件所在目录**解析；文件在 `main/` 内且 `COMMON.FXH` 同目录时无需 `/I`。
- 源文件在其他目录（scratch、子目录）时必须 `/I "<main 绝对路径>"`。
- Windows 文件系统大小写不敏感：`#include "head1-maxui.fxh"` 可命中 `head1-maxui.FXH`（FXFXH `FXdeferredpointlight.FX#L71` 即如此且编译通过）。

## 3. 常见错误与对策

| 现象 | 原因 | 对策 | 置信 |
|---|---|---|---|
| `/T fx_2_0` + `/Fc` → `Failed to create D3D device`，`.asm` 为 0 字节（`.fxo` 仍生成） | 整个 effect 反汇编需要创建 D3D9 设备，无头终端失败 | 只对单入口用 `/T ps_3_0`/`vs_3_0` + `/E` 做 `/Fc` | ✅fxc实测 |
| `X1507 failed to open source file` | include 路径缺失 | 加 `/I` | ✅fxc实测 |
| 编译**官方** `RA3_Shaders/ObjectsGeneric.fx`、`Terrain.fx`：`GlobalParameters.fxh(220,5): error X1516: not enough actual parameters for macro 'REGISTER_BIND'` | 官方宏传入空实参（`NO_INITIALIZER`/空 annotation），新版预处理器拒绝 | **官方源码只作参考，不直接编译**；本项目基于 FXFXH 架构自写 | ✅fxc实测 |
| 不加 `/D _WW3D_` 编译官方源码 | 官方 `Common.fxh` 在未定义 `_WW3D_` 时自动 `#define _3DSMAX_`，生成的是 Max 预览版 | 若必须编官方文件，加 `/D _WW3D_` | 📄源码确认 `[src: D:/PROJECTS/SAGE shader source/RA3_Shaders/Common.fxh#L25-L27]` |
| 旧编译器 `D:\PROJECTS\SAGE shader source\fxc2005.exe`（9.08.299）| 不识别 `/O2`（打印用法）；`/D _WW3D_` 下 `BasicW3D.fx`、`Terrain.fx` 可编，`ObjectsGeneric.fx` 报 `Skinning.fxh(135): X3030 array index out of bounds` | 不作为项目编译器，仅在需要复现官方二进制时参考 | ✅fxc实测 |
| FXFXH 文件中文注释在 PowerShell 输出乱码 | 文件为 UTF-8，控制台为 GBK | 用 `read_file` 工具读，或先 `[Console]::OutputEncoding=[Text.Encoding]::UTF8` | ✅已实机验证 |
| 官方 `.fxh` 被工具判定为二进制 | 含 Windows-1252 `©` 字节 | 用 `Get-Content -LiteralPath` 读取 | ✅已实机验证 |

## 4. SM3 预算速查（仅列 G-Buffer 迁移最常撞的项；完整表见全局技能）

| 项 | `vs_3_0` | `ps_3_0` | 本项目含义 |
|---|---|---|---|
| 指令槽 | ≥ 512 | ≥ 512 | ARPBR 前向 PS 已用 345；G-Buffer PS 应远低于此（无光照循环） |
| float 常量 | 256（`c0..c255`） | 224（`c0..c223`） | PS 内仍需避开 `c0..c10`、`c89..c127` |
| 临时寄存器 | 32 | 32 | —— |
| 插值器 | 输出 `o0..o11` | 输入 `v0..v9` + `vPos`/`vFace` | `VS_H_output` 已用 `COLOR0`+`TEXCOORD0..7`，加深度插值要注意上限 |
| MRT | —— | `COLOR0..COLOR3`（受 `NumSimultaneousRTs` 限制） | G-Buffer 4 路即上限 |

## 5. G-Buffer 探针源码（可复制到仓库外临时目录复现 §1 / 寄存器结论）

```hlsl
#define DEFERRED_RENDER
#include "COMMON.FXH"
float4 MatParamA < string UIName = "MatParamA"; > = float4(1, 0.5, 0.25, 1);
float4 MatParamB < string UIName = "MatParamB"; > = float4(0.1, 0.2, 0.3, 0.4);
texture DiffuseTexture < string UIName = "DiffuseTexture"; >;
sampler2D DiffuseTextureSampler = sampler_state { Texture = <DiffuseTexture>; MinFilter = 2; MagFilter = 2; MipFilter = 2; };
struct VS_OUT { float4 Pos : POSITION; float2 UV : TEXCOORD0; float3 NormalWS : TEXCOORD1; float DepthVS : TEXCOORD2; };
VS_OUT VS_GBuffer_00skin(float3 Pos : POSITION, float3 Nrm : NORMAL, float2 UV : TEXCOORD0)
{
    VS_OUT o;
    float3 posWS = mul(float4(Pos, 1), World);
    o.Pos = mul(float4(posWS, 1), ViewProjection);
    o.UV = UV;  o.NormalWS = mul(Nrm, (float3x3)World);
    o.DepthVS = mul(float4(posWS, 1), View).z;          // 线性视空间深度 -> RT3
    return o;
}
struct PS_GBUFFER_OUT { float4 RT0 : COLOR0; float4 RT1 : COLOR1; float4 RT2 : COLOR2; float4 RT3 : COLOR3; };
PS_GBUFFER_OUT PS_GBuffer_Probe(VS_OUT i)
{
    PS_GBUFFER_OUT o;
    float4 dif = tex2D(DiffuseTextureSampler, i.UV);
    clip(dif.a - 0.375);                                  // 代替固定管线 AlphaTest (0x60/255)
    o.RT0 = float4(dif.rgb * MatParamA.rgb, 1);
    o.RT1 = float4(normalize(i.NormalWS) * 0.5 + 0.5, 1);
    o.RT2 = MatParamB;
    o.RT3 = float4(i.DepthVS, 0, 0, 0);
    return o;
}
technique _CreateDepthMap
{   pass P0
    {   VertexShader = compile vs_3_0 VS_GBuffer_00skin();
        PixelShader  = compile ps_3_0 PS_GBuffer_Probe();
        ZEnable = 1; ZFunc = D3DCMP_LESSEQUAL; ZWriteEnable = 1; CullMode = D3DCULL_CW;
        AlphaBlendEnable = 0; AlphaTestEnable = 0;
    }
}
```
> 这是**编译探针**，不是最终 G-Buffer 布局；布局（格式/编码）由延迟技术知识库与计划阶段决定。
