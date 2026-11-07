# Phase K：知识库维护与技能演进规范

> **定位**：本文件是每个阶段完成后**强制执行的知识回写与技能演进规范**。任何子 Agent 在完成一个阶段或一张涉及实机事实的 Task Card 后，**严禁将新发现留在对话历史中**，必须按照本规范将实测真理第一时间同步至字典、技能库与知识库，确保项目的知识资产持续进化且 Single Source of Truth（唯一事实源）绝对纯洁。

---

### PK-T01 标准阶段任务结束回写检查清单
- **执行者**：各阶段最后一张任务卡执行者 / lead-review　**规模**：S
- **触发时机**：任何 Phase 的出口任务（如 P0-T09、P1-T13、P2-T07、P3-T08、P4-T16、P5-T12、P6-T08、P7-T12）。
- **必须执行的 5 项检查清单**：
  1. **OQ 状态迁移**：检查 `knowledge/open-questions.md`。若本阶段实测解决了某项待确认问题（如 OQ-01），将其从正文未决列表移入文末的“已关闭事实账本”，记录实机测试日期、测试用例与明确结论。
  2. **真理字典增补**：打开 `dictionaries/engine-ground-truth.md`，添加或更新对应的 `GT-xx` 条目。必须包含：`ID | 主题 | 结论 | 置信度（标记为 ✅已实机验证） | 证据来源 | 设计影响`。
  3. **技能库同步**：若发现了新的命令用法、避坑要点或状态约束，同步更新 `.agents/skills/ra3-scrape-pipeline/` 或 `.agents/skills/ra3-fx-shader/` 中的对应 reference 文件（见 PK-T02 与 PK-T03）。
  4. **ROADMAP 状态同步**：打开根目录 [`ROADMAP.md`](../ROADMAP.md)，将刚刚完成的阶段状态从 `⏳ 未开始` 或 `🟡 进行中` 更新为 `✅ 完成`，并更新总览图与关口状态。
  5. **看板状态同步**：打开 [`plans/task-board.md`](task-board.md)，将已完成任务标记为 `✅`，解除下游任务的阻塞。
- **验收标准**：5 项检查清单全部打勾，无遗漏事实。

---

### PK-T02 SCRAPE 技能库增量维护规则
- **执行者**：agent　**规模**：S
- **适用场景**：在实机运行或调试中发现 SCRAPE 命令、RenderBin、SCOPE 变量的实际运行行为与此前文档不符。
- **维护目标文件**：
  - 若验证了某个此前标为 `❓` 的命令参数（如 `settarget 1..3` 或 `stretchrect` 选项）：更新 `.agents/skills/ra3-scrape-pipeline/references/command-reference.md` 与 `dictionaries/scrape-command-dict.md`。
  - 若新增了已验证的 Pass 骨架：将脱敏后的精简模板追加至 `.agents/skills/ra3-scrape-pipeline/references/pass-templates.md` 并标记 `✅已实机验证`。
  - 若踩到了新的坑（如某种命令组合导致显存泄漏或视口错误）：将根因与解决方案记录到 `.agents/skills/ra3-scrape-pipeline/references/pitfalls.md`。
  - 若发现了新的未记录 RenderBin 行为：更新 `dictionaries/renderbin-dict.md`。

---

### PK-T03 HLSL 技能库与头文件架构维护规则
- **执行者**：agent　**规模**：S
- **适用场景**：在编写或编译着色器时发现寄存器冲突、编译器特殊报错、材质宏特性或新的 SAS 地址。
- **维护目标文件**：
  - 若新增了全局 SAS 变量绑定（如 `Deferred.GBufferSize`）：在 `dictionaries/hlsl-register-sas-dict.md` 中登记，防止后续开发者冲突。
  - 若发现了某种特定材质家族的隐藏宏定义或蒙皮流限制：更新 `.agents/skills/ra3-fx-shader/references/material-family-inventory.md`。
  - 若发现了 `main\fxc.exe` 的新特性或新报错码：记录至 `.agents/skills/ra3-fx-shader/references/fxc-workflow.md`。
  - 若对公共头文件 `GBUFFER.FXH` 或 `COMMON.FXH` 进行了接口增补：更新 `.agents/skills/ra3-fx-shader/references/fxfxh-architecture.md`。

---

### PK-T04 异常阻塞升级与决策日志归档
- **执行者**：agent / lead-review　**规模**：S
- **适用场景**：在执行任务卡时遇到非预期的严重阻碍（如出现与既往结论冲突的重大 Bug、驱动崩溃、硬未决未知问题无法通过当前手段解决）。
- **执行协议**：
  1. **立即停机**：不要在迷茫中盲目修改大量无关代码，防止引入二次污染。
  2. **提炼最小复现用例**：记录出现问题的精确文件、命令、错误提示或抓帧截屏。
  3. **在看板中标记阻塞**：将当前任务状态置为 `⛔`（被阻塞），并简短注明原因。
  4. **登记决策项**：若需要重新拍板技术路线（例如 MRT 某格式不可用需切换备选方案），在 [`plans/README.md`](README.md) 的“决策日志（Decision Log）”中追加编号条目（如 `D23`），并标明候选方案与评估标准，升级给 lead 或用户决策。
