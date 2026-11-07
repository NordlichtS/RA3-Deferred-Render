# `tools/` — 工具与辅助脚本目录

本目录用于存放编译/纹理处理工具、构建脚本以及开发过程中的临时辅助脚本。

> **Git 规则**：所有二进制可执行文件（`*.exe`、`*.dll` 等）与临时缓存均已被 [`.gitignore`](../.gitignore) 忽略，仅保留源码脚本（`.ps1`、`.js`、`.py`）与说明文档入库。

## 1. 当前本地二进制工具（已 gitignore）

| 文件名 | 用途 |
|---|---|
| `fxc.exe` | DirectX SDK (June 2010, v9.29.952.3111) HLSL Effect 编译器（与 `main/fxc.exe` 相同） |
| `texconv.exe` | DirectXTex 纹理格式转换、Mipmap 生成与 sRGB/Linear 处理工具 |
| `texassemble.exe` | DirectXTex Cubemap / Texture Array 组装工具 |
| `texdiag.exe` | DirectXTex DDS 纹理头信息与像素统计诊断工具 |

## 2. 脚本存放约定

- **构建与部署脚本**：`build.ps1`、`deploy.ps1`、`fx-manifest.csv`（或按任务卡约定与 `main/tools/` 协同）。
- **一次性分析 / 校验 / 批量替换脚本**：统一放入本目录，避免污染根目录与 `main/`。
