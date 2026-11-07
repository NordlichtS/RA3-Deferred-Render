# RA3-Deferred-Render 任务看板（Task Board）

> **说明**：本文件是项目中所有执行任务的**唯一状态登记处**。子 Agent 领取任务前必须在此确认前置依赖全部为 `✅`，开工时将状态改为 `🟡`（并在备注记录执行者、**负责的 LLM 模型名称与版本**及开工日期），完工并通过验收后将状态改为 `✅`。任务卡规划归属与模型特征详见 [`ROADMAP.md` §5 大模型溯源档案](../ROADMAP.md#5-产出物归属与大模型溯源档案llm-provenance--authorship-ledger)。
>
> **状态图例**：
> - `⏳`：未开始（待领取）
> - `🟡`：进行中
> - `✅`：已完成并验收
> - `⛔`：被阻塞（见异常备注）
> - `🔀`：决策关口（Decision Gate）

---

## 阶段 0：构建工具链、部署与金丝雀基准（Phase 0）

| ID | 任务标题 | 阶段 | 依赖 | 执行者 | 规模 | 状态 | 核心产出 / 关键检查 |
|---|---|---|---|---|---|---|---|
| P0-T01 | 记录游戏安装与 Mod 部署机制（与用户访谈） | Phase 0 | 无 | USER-RUN | S | ⏳ | 确立 `%RA3_GAME_DIR%` 与部署目录 |
| P0-T02 | 抓帧工具调研（D3D9 / 32 位 / RA3 启动器） | Phase 0 | P0-T01 | agent | S | ⏳ | PIX / RenderDoc 抓帧方案确认 |
| P0-T03 | 搭建抓帧环境并抓取原版基准帧 | Phase 0 | P0-T02 | USER-RUN | M | ⏳ | 获得首个可复现的原版 D3D9 抓帧文件 |
| P0-T04 | 构建与部署脚本（`build.ps1` / `deploy.ps1` / `fx-manifest.csv`） | Phase 0 | P0-T01 | agent | M | ⏳ | `main/tools/build.ps1` 一键编译与检查 |
| P0-T05 | 导入 FXFXH 代码基到 `main/fx/` 并验证编译等价 | Phase 0 | P0-T04 | agent | M | ⏳ | `main/fx/` 基础 Shader 编译 0 报错 |
| P0-T06 | 金丝雀部署：证明 `.scrapeo` 与 `.fxo` 都从部署位置加载 | Phase 0 | P0-T04, P0-T05 | USER-RUN | M | ⏳ | 实机显现特征性红字/改动，证明生效 |
| P0-T07 | 定义基准测试场景 GS-xx 并采集基准截图 | Phase 0 | P0-T06 | USER-RUN | M | ⏳ | `tests/scenes.md` 与 GS-01..07 截图 |
| P0-T08 | 测试脚本/结果模板与任务看板维护工具 | Phase 0 | P0-T07 | agent | S | ⏳ | 测试模板规范化 |
| P0-T09 | DG-0：工具链就绪评审 | Phase 0 | P0-T03..P0-T08 | lead-review | S | 🔀 | 签署解锁 Phase 1 实机探针 |

---

## 阶段 1：引擎运行时黑盒探针实验（Phase 1）

| ID | 任务标题 | 阶段 | 依赖 | 执行者 | 规模 | 状态 | 核心产出 / 关键检查 |
|---|---|---|---|---|---|---|---|
| P1-T01 | 探针基础设施：`ProbeView.fx`、开关过程、钩子过程、`build.ps1 -Strip` | Phase 1 | P0-T09 | agent | M | ⏳ | 探针全屏指示与控制系统就绪 |
| P1-T02 | 探针 OQ-04：`A2R10G10B10` / `G16R16` / `R16F` 能否作 RT 写入并被采样 | Phase 1 | P1-T01 | agent | M | ⏳ | 格式探针 Shader 与 SCRAPE 绑定 |
| P1-T03 | 探针 OQ-05：4 路 MRT 同时绑定 + `renderbin`/`renderTerrain` 合法性 | Phase 1 | P1-T01 | agent | M | ⏳ | 验证 4-MRT 同时 Clear 与渲染 |
| P1-T04 | 探针 OQ-06 + OQ-12：尺寸一致性与全屏 quad 下的引擎 SAS 值 | Phase 1 | P1-T01 | agent | M | ⏳ | 全屏 Quad 下 SAS 常量与尺寸探测 |
| P1-T05 | 构建 A 打包 + USER-RUN（OQ-04 / OQ-05 / OQ-06 / OQ-07 / OQ-12） | Phase 1 | P1-T02..P1-T04 | USER-RUN | L | ⏳ | 实机指示色块与抓帧记录确认 |
| P1-T06 | 探针 OQ-01 / OQ-02 / OQ-15：`setshaderoverride` 是否命中材质、缺名回退 | Phase 1 | P1-T01 | agent | M | ⏳ | Override 机制与 Technique 匹配探针 |
| P1-T07 | 探针 OQ-18：SAS 驱动的 shader 数组在帧内逐段切换（路线 3） | Phase 1 | P1-T01 | agent | M | ⏳ | 路线 3 候选方案探测 |
| P1-T08 | 探针 OQ-19：MRT 混合（alpha 来源 / `R32F` 是否混合 / `ColorWriteEnable1`） | Phase 1 | P1-T01 | agent | M | ⏳ | D3D9 MRT 混合特性探针 |
| P1-T09 | 构建 B 打包 + USER-RUN（OQ-01 / OQ-02 / OQ-15 / OQ-18 / OQ-19） | Phase 1 | P1-T06..P1-T08 | USER-RUN | L | ⏳ | 实机观察材质替换与混合行为 |
| P1-T10 | OQ-13 静态部分：Stencil 写入者全量盘点 | Phase 1 | P1-T01 | agent | S | ⏳ | Stencil 位使用盘点确认 bit 7 空闲 |
| P1-T11 | 设置矩阵与地编冒烟（OQ-10 记录 / OQ-17） | Phase 1 | P1-T05 | USER-RUN | S | ⏳ | HDR 关闭回退与地编冒烟初测 |
| P1-T12 | 抓帧会话 C：shader 覆盖率（OQ-14）、排序层（OQ-09）、Stencil（OQ-13） | Phase 1 | P1-T09, P1-T10 | USER-RUN | M | ⏳ | 抓帧提取全场景材质清单与 Stencil 状态 |
| P1-T13 | DG-1：G-Buffer 激活路线、格式与尺寸决策 | Phase 1 | P1-T05, P1-T09, P1-T12 | lead-review | S | 🔀 | 拍板路线 1 vs 路线 2 及 RT 格式 |
| P1-T14 | DG-T：地形叠加层（`Cliff/Road/Scorch`）G-Buffer 策略 | Phase 1 | P1-T09, P1-T13 | lead-review | S | 🔀 | 拍板地形叠加层混合策略 |

---

## 阶段 2：G-Buffer 资源、特性开关与调试视图（Phase 2）

| ID | 任务标题 | 阶段 | 依赖 | 执行者 | 规模 | 状态 | 核心产出 / 关键检查 |
|---|---|---|---|---|---|---|---|
| P2-T01 | 共享头 `main/fx/GBUFFER.FXH`（编码/解码/重建工具） | Phase 2 | P1-T13 | agent | M | ⏳ | 集中定义 GBuffer 结构与编解码函数 |
| P2-T02 | G-Buffer 资源声明与 `Deferred.IsActive` 判定 | Phase 2 | P1-T13 | agent | S | ⏳ | `main/ingame.scrapeo` 声明 4 份 MRT |
| P2-T03 | 影子 G-Buffer Pass 骨架（每帧清屏 + 纹理绑定） | Phase 2 | P2-T02 | agent | S | ⏳ | 插入 `renderGBufferPass` 绑定与清除 |
| P2-T04 | 调试视图 shader `main/fx/DeferredDebug.fx` | Phase 2 | P2-T01 | agent | M | ⏳ | 全屏 Quad 显示各通道与世界坐标棋盘格 |
| P2-T05 | 调试视图接入 SCRAPE（播种测试 + 显示过程） | Phase 2 | P2-T03, P2-T04 | agent | S | ⏳ | 挂载 `renderDeferredDebug` |
| P2-T06 | USER-RUN：G-Buffer 资源、播种重建与调试视图验证 | Phase 2 | P2-T05 | USER-RUN | M | ⏳ | 实机观察棋盘格不滑动、半像素无错位 |
| P2-T07 | Phase 2 知识回写与清理 | Phase 2 | P2-T06 | agent | S | ⏳ | 知识入库，锁定基础数学 |

---

## 阶段 3：G-Buffer 单家族原型验证（Phase 3）

| ID | 任务标题 | 阶段 | 依赖 | 执行者 | 规模 | 状态 | 核心产出 / 关键检查 |
|---|---|---|---|---|---|---|---|
| P3-T01 | 单材质 `objectsgeneric.fx` 增加 G-Buffer Technique | Phase 3 | P2-T07 | agent | M | ⏳ | 首个不透明 Shader 接入 G-Buffer |
| P3-T02 | 蒙皮与镂空材质 `objectsallied.fx` 增加 G-Buffer Technique | Phase 3 | P3-T01 | agent | M | ⏳ | 首个单位 Shader 支持蒙皮与 PS `clip()` |
| P3-T03 | SCRAPE 侧 G-Buffer Technique 激活挂载 | Phase 3 | P3-T02 | agent | M | ⏳ | 脚本侧按 DG-1 路线调度 G-Buffer Pass |
| P3-T04 | RT3 与原版线性深度等价性差分探针 | Phase 3 | P3-T03 | agent | M | ⏳ | `diff_linear_depth.fx` 逐像素差分热力图 |
| P3-T05 | 有效像素 Stencil bit 7 与 RT0.a 标记验证 | Phase 3 | P3-T03 | agent | S | ⏳ | 调试模式 8 青色标记已延迟像素 |
| P3-T06 | USER-RUN：单材质 G-Buffer 原型实机验证 | Phase 3 | P3-T04, P3-T05 | USER-RUN | L | ⏳ | 实机检验法线、阵营色、镂空与深度差分 |
| P3-T07 | 决策门 DG-2：冻结 G-Buffer 编码规范 | Phase 3 | P3-T06 | lead-review | S | 🔀 | 正式冻结 G-Buffer 布局与通道数学 |
| P3-T08 | Phase 3 知识回写与清理 | Phase 3 | P3-T07 | agent | S | ⏳ | 回写至技能与字典 |

---

## 阶段 4：全场景不透明材质迁移与深度接管（Phase 4）

| ID | 任务标题 | 阶段 | 依赖 | 执行者 | 规模 | 状态 | 核心产出 / 关键检查 |
|---|---|---|---|---|---|---|---|
| P4-T01 | 载具家族（三阵营与中立载具）迁移 | Phase 4 | P3-T07 | agent | M | ⏳ | 载具 Shader 全量接入 GBuffer technique |
| P4-T02 | 建筑家族（三阵营建筑、破损与纳米建造）迁移 | Phase 4 | P4-T01 | agent | M | ⏳ | 建筑破损贴图与建造镂空裁剪接入 |
| P4-T03 | 步兵与基础 W3D 家族（双流蒙皮）迁移 | Phase 4 | P4-T02 | agent | M | ⏳ | 双顶点流与多骨骼蒙皮 G-Buffer 支持 |
| P4-T04 | 树木与动态植被家族（风吹摆动与枝叶裁剪）迁移 | Phase 4 | P4-T03 | agent | M | ⏳ | 树木顶点摆动与叶片 clip 接入 |
| P4-T05 | 道路与桥梁家族（Roads / Bridge）迁移 | Phase 4 | P4-T04 | agent | S | ⏳ | 道路与桥梁材质 G-Buffer 支持 |
| P4-T06 | 悬崖与地形道具家族（ObjectsTerrain）迁移 | Phase 4 | P4-T05 | agent | S | ⏳ | 悬崖立面与地形物体 G-Buffer 支持 |
| P4-T07 | 地形底图基础瓦片（TerrainTile）迁移 | Phase 4 | P4-T06 | agent | M | ⏳ | 地表瓦片层多贴图混合写入 MRT |
| P4-T08 | 地形叠加层（Cliff / Road / Scorch）MRT 混合落地 | Phase 4 | P4-T07 | agent | M | ⏳ | 依据 DG-T 策略完成地形叠加层渲染 |
| P4-T09 | 材质多层级 LOD Technique 变体适配 | Phase 4 | P4-T08 | agent | M | ⏳ | 各画质与远景 LOD 技术适配 |
| P4-T10 | 遗漏与边界材质扫描补齐 | Phase 4 | P4-T09 | agent | S | ⏳ | 对照清单消除不透明材质遗漏 |
| P4-T11 | RT3 正式接管 `WW3D.DepthTexture` 绑定 | Phase 4 | P4-T10 | agent | M | ⏳ | 引擎全局深度绑定指向 `RA3DR_GBuffer3` |
| P4-T12 | 延迟分支停用原版 `updateDepthMap` | Phase 4 | P4-T11 | agent | S | ⏳ | 规避整场重画，节省几何遍历与带宽 |
| P4-T13 | 水下着色与软粒子对新深度采样验证 | Phase 4 | P4-T12 | agent | S | ⏳ | 验证水下消散与软粒子贴地平滑度 |
| P4-T14 | USER-RUN：全场景不透明 G-Buffer 覆盖率与深度验证 | Phase 4 | P4-T13 | USER-RUN | L | ⏳ | 实机观察全场不透明覆盖率与水下/软粒子 |
| P4-T15 | 决策门 DG-3：不透明覆盖率达标验收 | Phase 4 | P4-T14 | lead-review | S | 🔀 | 签署覆盖率 ≥ 95% 达标 |
| P4-T16 | Phase 4 知识回写与清理 | Phase 4 | P4-T15 | agent | S | ⏳ | 状态更新与知识归档 |

---

## 阶段 5：全屏延迟主光照合成（Phase 5）

| ID | 任务标题 | 阶段 | 依赖 | 执行者 | 规模 | 状态 | 核心产出 / 关键检查 |
|---|---|---|---|---|---|---|---|
| P5-T01 | 全屏延迟光照合成框架与 Quad 流程 | Phase 5 | P4-T15 | agent | M | ⏳ | `DeferredComposite.fx` 与 Quad 调度 |
| P5-T02 | 屏幕空间软阴影与云影整合 | Phase 5 | P5-T01 | agent | M | ⏳ | 4-tap PCF 太阳阴影与云影合成 |
| P5-T03 | 主太阳光 PBR（Cook-Torrance / GGX 直接光照） | Phase 5 | P5-T02 | agent | M | ⏳ | 物理精确的直射光高光与漫反射 |
| P5-T04 | 漫反射 IBL 与辐照度立方体整合 | Phase 5 | P5-T03 | agent | M | ⏳ | 天空与地面环境漫反射冷暖光照 |
| P5-T05 | 镜面反射 IBL 与预滤波环境图 | Phase 5 | P5-T04 | agent | M | ⏳ | 基于粗糙度 Mip 采样的天空反射高光 |
| P5-T06 | 战争迷雾、自发光与阵营色重着色 | Phase 5 | P5-T05 | agent | S | ⏳ | 迷雾黑雾遮挡与彩色自发光叠加 |
| P5-T07 | 材质特殊类别分支与前向降级显示 | Phase 5 | P5-T06 | agent | S | ⏳ | 皮肤/无光照/前向残余透传 |
| P5-T08 | 决策门 DG-4：环境图空间裁定 | Phase 5 | P5-T07 | lead-review | S | 🔀 | 裁定原版太阳旋转 vs 日冕未旋转空间 |
| P5-T09 | 前向残余 Pass 隔离与 Stencil 剔除 | Phase 5 | P5-T08 | agent | M | ⏳ | 硬件剔除已延迟像素，消除 Overdraw |
| P5-T10 | 正式切换延迟主光照输出 | Phase 5 | P5-T09 | agent | S | ⏳ | `Deferred.IsEnabled=true` 默认切入延迟主帧 |
| P5-T11 | USER-RUN：主光照、阴影、IBL 与前向兼容 A/B 对比 | Phase 5 | P5-T10 | USER-RUN | L | ⏳ | 实机对比白昼/夜景与大规模交火性能 |
| P5-T12 | Phase 5 知识回写与清理 | Phase 5 | P5-T11 | agent | S | ⏳ | 知识回写与状态更新 |

---

## 阶段 6：无数量上限 PBR 局域体积光（Phase 6）

| ID | 任务标题 | 阶段 | 依赖 | 执行者 | 规模 | 状态 | 核心产出 / 关键检查 |
|---|---|---|---|---|---|---|---|
| P6-T01 | 局域光体积剔除面与深度测试探针 | Phase 6 | P5-T11 | agent | M | ⏳ | 实机验证 CCW 背面剔除与 GREATEREQUAL |
| P6-T02 | 局域点光源着色器 `DeferredPointLight.fx` 升级 | Phase 6 | P6-T01 | agent | M | ⏳ | PBR 采样 G-Buffer + 物理平方衰减 + clip |
| P6-T03 | 聚光灯与定向激光体积着色器 `DeferredSpotLight.fx` | Phase 6 | P6-T02 | agent | M | ⏳ | 锥体网格角度衰减定向光 |
| P6-T04 | SCRAPE 挂载队列打通（`StaticSort_END` 队列提交） | Phase 6 | P6-T03 | agent | M | ⏳ | 合成后、折射前调度 `renderbin StaticSort_END` |
| P6-T05 | 引擎原生点光源探测与代理体积转换 | Phase 6 | P6-T04 | agent | M | ⏳ | 解决单位开火火光与爆炸光照接入 |
| P6-T06 | 决策门 DG-5 与 DG-6：光体积队列与光源代理机制定稿 | Phase 6 | P6-T05 | lead-review | S | 🔀 | 锁定光体积队列与动态点光处理策略 |
| P6-T07 | USER-RUN：百级局域光源同屏压力测试与夜景验证 | Phase 6 | P6-T06 | USER-RUN | L | ⏳ | 实机同屏 100+ 光源测试与水面折射可见性 |
| P6-T08 | Phase 6 知识回写与清理 | Phase 6 | P6-T07 | agent | S | ⏳ | 知识回写与看板更新 |

---

## 阶段 7：正向尾段特效、水体、后处理与系统整合（Phase 7）

| ID | 任务标题 | 阶段 | 依赖 | 执行者 | 规模 | 状态 | 核心产出 / 关键检查 |
|---|---|---|---|---|---|---|---|
| P7-T01 | 焦痕、履带印与弹坑贴花叠加顺序梳理 | Phase 7 | P5-T11 | agent | M | ⏳ | 保护贴花 Stencil bit 2，正确覆盖地表 |
| P7-T02 | 水下着色与水面折射纹理捕获 | Phase 7 | P7-T01 | agent | M | ⏳ | 包含局域光的水下消散与折射纹理抓屏 |
| P7-T03 | 水面本体渲染与环境反射匹配 | Phase 7 | P7-T02 | agent | M | ⏳ | 水面菲涅尔折射反射与岸边光照融合 |
| P7-T04 | 半透明几何体与排序队列交互 | Phase 7 | P7-T03 | agent | M | ⏳ | 护盾与全息在延迟主帧后正确正向叠加 |
| P7-T05 | 软粒子与武器轨迹特效（复用 RT3 深度） | Phase 7 | P7-T04 | agent | M | ⏳ | 烟雾贴地软淡出与激光轨迹正常 |
| P7-T06 | 单位与建筑外描边（Outlines.fxh 与 Stencil 隔离） | Phase 7 | P7-T05 | agent | M | ⏳ | 选中高亮与外描边 Stencil bit 0..1 保护 |
| P7-T07 | 全屏热浪与爆炸扭曲（PostFX_Distortion.fx） | Phase 7 | P7-T06 | agent | S | ⏳ | 导弹尾焰与爆炸热浪后处理正常 |
| P7-T08 | HDR 曝光与 Bloom 亮度重标定 | Phase 7 | P7-T07 | agent | M | ⏳ | 重标定 Bloom 阈值，消除发白过曝 |
| P7-T09 | 胶片调色与 3D LUT 色彩分级 Resolve | Phase 7 | P7-T08 | agent | M | ⏳ | 最终色彩映射至后台缓冲 FrameBuffer |
| P7-T10 | 2D HUD 与 UI 层级隔离确认 | Phase 7 | P7-T09 | agent | S | ⏳ | 小地图与侧边栏完全不受后处理浸染 |
| P7-T11 | WorldBuilder 地图编辑器兼容性冒烟测试 | Phase 7 | P7-T10 | USER-RUN | M | ⏳ | 地编稳定启动、渲染与保存 |
| P7-T12 | 决策门 DG-7：全管线发布验收与 A/B 对比 | Phase 7 | P7-T11 | lead-review | M | 🔀 | 签署发布验收，主干开发完成！ |

---

## 阶段 8：可选进阶功能与性能极致优化（Phase 8，可选）

| ID | 任务标题 | 阶段 | 依赖 | 执行者 | 规模 | 状态 | 核心产出 / 关键检查 |
|---|---|---|---|---|---|---|---|
| P8-T01 | 屏幕空间环境光遮蔽（SSAO）集成 | Phase 8 | P7-T12 | agent | M | ⏳ | 半分辨率双边滤波 SSAO 遮罩 |
| P8-T02 | 延迟抗锯齿后处理（FXAA 3.11 / SMAA 1x 移植） | Phase 8 | P7-T12 | agent | M | ⏳ | 屏幕空间边缘平滑消除锯齿 |
| P8-T03 | G-Buffer 投影贴花（Deferred Decals） | Phase 8 | P7-T12 | agent | L | ⏳ | 立方体包围盒贴花消除拉伸穿模 |
| P8-T04 | 3-MRT 紧凑深度实验（削减 RT3 节约带宽） | Phase 8 | P7-T12 | agent | M | ⏳ | 深度压入 RT2.ba 节约 25% G-Buffer 带宽 |
| P8-T05 | 模板光体积双 Pass 优化（复杂场景填充率优化） | Phase 8 | P7-T12 | agent | M | ⏳ | 评估超密集光源下的 Stencil 双 Pass |
| P8-T06 | 动态分支与指令槽极限优化 | Phase 8 | P7-T12 | agent | S | ⏳ | 汇编级指令重排提升实机帧率 |
| P8-T07 | 模块化 SCRAPE 自动化构建脚本（基于 MSYS2 GCC） | Phase 8 | P7-T12 | agent | M | ⏳ | `build_scrape.ps1` 全自动展开与检查 |
| P8-T08 | 进阶功能评估与文档技术归档 | Phase 8 | P8-T01..P8-T07 | lead-review | S | ⏳ | 编制技术白皮书与成果归档 |

---

## 知识库维护与技能演进规范（Phase K，贯穿始终）

| ID | 任务标题 | 阶段 | 依赖 | 执行者 | 规模 | 状态 | 核心产出 / 关键检查 |
|---|---|---|---|---|---|---|---|
| PK-T01 | 标准阶段任务结束回写检查清单 | Phase K | 各阶段出口 | agent | S | ⏳ | OQ迁移、真理字典、技能、ROADMAP同步 |
| PK-T02 | SCRAPE 技能库增量维护规则 | Phase K | 发现新事实 | agent | S | ⏳ | 命令、模板、避坑案例同步 |
| PK-T03 | HLSL 技能库与头文件架构维护规则 | Phase K | 发现新事实 | agent | S | ⏳ | SAS、寄存器、材质宏同步 |
| PK-T04 | 异常阻塞升级与决策日志归档 | Phase K | 遇到硬阻塞 | agent / lead | S | ⏳ | 停机隔离、决策日志记录与方案升级 |
