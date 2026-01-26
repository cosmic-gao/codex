## 目标
- 让模型先判断是否需要“计划/大纲”（Todo），需要则先输出大纲（按优先级排序）。
- 大纲输出完成后，从第 1 项开始串行执行，每项允许调用工具并持续回传步骤输出与进度。
- 前端 Plan UI 不闪烁、不重复渲染、不因流式/去重策略导致“轮询感”。
- 清理兼容/废弃代码；文件/组件/方法/变量命名控制 1~2 个完整单词；拆分单一职责模块，避免文件膨胀。

## 现状问题定位（基于已读代码）
- 前端 Plan UI 存在大量 debug `console.*` 与基于 `stepOutputs` 的“推断状态”逻辑，容易与后端权威进度 `data-plan-progress` 产生竞态，造成闪烁与状态抖动（[plan-message-part.tsx](file:///e:/codex/src/components/plan-message-part.tsx)）。
- 消息渲染层同时支持 `data-outline/data-plan` 与 `tool Plan` 两套路径，且去重/隐藏条件依赖当前渲染帧的 `partsForDisplay`，在流式过程中可能出现“时有时无”的切换（[message.tsx](file:///e:/codex/src/components/message.tsx)）。
- 后端 `route.ts` 内包含：意图识别、生成大纲、写入快照、串行执行、进度写入、工具输出分发等多职责，文件已显著膨胀且难维护（[route.ts](file:///e:/codex/src/app/api/chat/route.ts)）。
- Outline/Plan 工具 schema 当前没有“优先级”字段，无法强约束“按优先级排序”的大纲输出（[types/plan.ts](file:///e:/codex/src/types/plan.ts)）。

## 协议与数据结构调整
- **OutlineStep 增加 priority（可选 + 默认值）**：例如 `"high"|"medium"|"low"`，保持向后兼容（未提供则默认 `medium`）。
- **Prompt 明确优先级与排序要求**：要求模型在输出 outline 时就按 priority 从高到低排序，并在 description 中说明排序依据。
- **执行顺序策略**：默认以输出数组顺序串行执行；如果未来要支持“依赖 + 优先级”，再引入“带权拓扑排序”。

## 后端重构（单一职责拆分）
- 从 [route.ts](file:///e:/codex/src/app/api/chat/route.ts) 中抽离 Plan Mode 相关逻辑到 `src/lib/ai/plan/*`：
  - **Intent**：保留 `detectIntent`，但将“最近对话上下文拼装/阈值策略”封装为一个函数，避免 route.ts 直接拼接。
  - **Outline**：独立 `outline-runner`（生成 outline + 校验 + 写入 snapshot）。
  - **Executor**：独立 `step-executor`（只负责单步 runStep：禁用 outline/plan/progress，流式写入 step-output，最终写入状态）。
  - **Progress Writer**：独立 `progress-writer`（唯一权威状态写入，保证单调状态迁移，避免同一步骤被重复“重置/回退”。）
- **清理 legacy 分支**：优先只保留 Outline 模式；Plan 模式与 `PLAN_GENERATION_PROMPT` 作为兼容分支将评估移除（涉及 [tool-kit.ts](file:///e:/codex/src/lib/ai/tools/tool-kit.ts)、[plan.ts](file:///e:/codex/src/lib/ai/tools/planning/plan.ts)、[plan-prompts.ts](file:///e:/codex/src/lib/ai/prompts/plan-prompts.ts)、[route.ts](file:///e:/codex/src/app/api/chat/route.ts)）。
- **命名收敛**：例如 `PlanProgressTracker` → `ProgressTracker`，目录/文件名同步收敛为 1~2 单词。

## 前端渲染与 UI 改造（防闪烁/去重）
- **统一“权威渲染源”**：一旦 message parts 中出现 `data-outline` 或 `data-plan`，就永久忽略对应 `tool Plan` 渲染（避免流式阶段切换）。
- **提取 Plan 相关 selector**：从 [message.tsx](file:///e:/codex/src/components/message.tsx) 抽出纯函数模块（例如 `plan-select.ts`），负责：
  - 计算稳定 planId（优先用 part.id/toolCallId）。
  - 去重策略（同 planId 只渲染一次）。
  - 从 parts 中提取 `progress` 与 `stepOutputs`。
- **Plan UI 移除“推断状态”与 debug 输出**：
  - 删除 `getLatestPlanProgress` 内 `console.*`、`PlanStepItem` debug `useEffect`。
  - 移除基于 `stepOutputs`/时间戳的状态推断，改为只消费后端 `data-plan-progress`（缺省时显示 skeleton，不做“猜测完成”。）
- **拆分 plan-message-part.tsx**：按单一职责拆为 `PlanCard / PlanHeader / StepList / StepItem / Duration` 等组件与少量 util，减少单文件膨胀并让 memo 粒度更明确。
- **减少布局抖动**：对“标题尚未生成/steps 尚未到齐”的状态使用固定高度 skeleton，避免内容高度频繁变化造成闪烁。

## 清理与命名规范落地
- 逐文件检查：删除废弃代码路径、无用 schema（如 lenient parse）、多余日志；把 3+ 单词命名收敛为 1~2 个完整单词。
- 对外导出/模块入口遵循 JSDoc（中文）要求；内部函数不强制写注释，保持代码自解释。

## 测试与验收
- 扩展/新增测试：
  - Outline schema（priority 默认值、校验规则）。
  - Progress 写入的单调性与“中止/失败”语义（复用现有 [progress-tracker.test.ts](file:///e:/codex/src/lib/ai/plan/progress-tracker.test.ts) 思路）。
- 关键验收点：
  - 触发 Plan Mode：先看到稳定的大纲卡片；随后 step 1 开始执行并持续刷新输出。
  - UI 不出现 outline/plan/tool-plan 的闪烁切换；无 console 噪音；无重复渲染导致的“轮询感”。