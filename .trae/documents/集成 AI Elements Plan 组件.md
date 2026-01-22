## 目标
- 把 AI Elements 的 `Plan` 组件集成进当前 Next.js Chat。
- 采用“方式2”：将 Plan 作为一种独立的 `UIMessage.parts` 类型进行渲染（而不是从 Markdown 文本解析）。

## 现状分析（与你的项目对齐）
- 你的项目是 Next.js（App Router）+ React 19 + Tailwind CSS v4 + shadcn/ui，且已集成 Vercel AI SDK（`ai`/`@ai-sdk/react`）。满足 AI Elements 的典型前置条件。[2][4]
- 聊天消息渲染链路：`useChat` 产生 `UIMessage[]` → [message.tsx](file:///e:/codex/src/components/message.tsx) 按 `parts` 分发 → 各 Part 组件渲染。
- 服务端流式输出：`streamText(...).toUIMessageStream()` 合并到 UI message stream，最终落库前通过 `convertToSavePart` 处理：[route.ts](file:///e:/codex/src/app/api/chat/route.ts#L325-L372)、[shared.chat.ts](file:///e:/codex/src/app/api/chat/shared.chat.ts#L463-L489)。

## 实施方案（我将在你确认后执行）
### 1) 把 AI Elements 的 Plan 源码拉进仓库
- 优先使用 AI Elements CLI 安装 `plan`（或用 shadcn registry 安装 `plan.json`），将组件代码下载到你的 components 目录，成为可修改源码。[4]
- 产出：`src/components/ai-elements/plan*`（以 registry 实际生成路径为准）。

### 2) 建立“Plan Part”数据结构（新增一种 UIMessage part）
- 新增一个强类型的 Plan part（例如 `type: "plan"`），承载：标题、描述、步骤列表、可选 action。
- 产出：新增 `PlanPart` 类型（放在你现有 `src/types/` 体系里，保持风格一致）。

### 3) 让模型稳定地产出 Plan part（不依赖 Markdown 解析）
- 新增一个内置 tool（例如名字仍叫 `plan`），其 input schema 就是 Plan 的结构；execute 做“结构回显/规范化”（不再二次调用 LLM），让主模型在 tool-call 阶段就给出结构化 plan。
  - 这样好处：结构稳定、易渲染、不会引入额外一次模型调用。
- 把该 tool 挂到现有 App 默认工具集合里（不新增新的 Toolkit，避免改多语言文案与 UI 大改），并在系统提示词中约束“仅在用户要计划/任务拆解时调用”。

### 4) 服务端落库时把 `plan` 工具调用转换为 `type: "plan"` part
- 在 [shared.chat.ts](file:///e:/codex/src/app/api/chat/shared.chat.ts#L463-L489) 的 `convertToSavePart` 中：
  - 如果检测到 tool part 的 toolName 是 `plan` 且已有结构化输出，则把它转换成 `type: "plan"` 的 part（并移除 tool part 的 provider metadata）。
- 结果：历史记录从 DB 读出来时，Plan 就以原生 `plan` part 存在，前端无需再依赖 tool 渲染分支。

### 5) 前端按 `plan` part 渲染（接入点就是 message parts 分发）
- 在 [message.tsx](file:///e:/codex/src/components/message.tsx#L74-L170) 的 `partsForDisplay.map(...)` 分发里新增 `if (part.type === "plan")` 分支，渲染一个 `PlanMessagePart`。
- `PlanMessagePart` 内部用 AI Elements 的组合式组件（`<Plan />`、`<PlanTitle />`、`<PlanContent />`、`<PlanAction />` 等）拼出你定义的数据结构。

### 6) 验证与回归
- 运行类型检查与测试（`check-types`、`vitest`），并在聊天里输入“给我一个执行计划/拆解任务”确认：
  - 生成阶段出现 plan（来自 tool-call 结构化输出）。
  - 刷新页面/重新进入线程后仍能看到 plan（说明落库转换成功）。

## 额外安全项（建议一并处理）
- `openai-compatible.config.ts` 存在硬编码 API Key，建议迁移到 `.env.local` 并轮换该 key，避免泄漏风险。

---
你已指定使用方式2；确认后我会按以上步骤直接在仓库内实现并跑通端到端渲染与落库。