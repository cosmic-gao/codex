## 目标
- 在聊天 UI 中让 Plan 的“执行过程中有进度”，视觉与交互接近 AI Elements 的 Queue：步骤队列 + 状态指示 + 总体完成度。
- 支持 **AI 自动推进**：服务端能够发出 `data-plan-progress` 数据 part（流式更新 + 落库），前端合并渲染，不产生额外重复气泡。

## 核心设计
- **数据结构**：
  - `data-plan`：计划内容快照（title/description/steps），并给它一个稳定 `id`（使用 plan tool 的 `toolCallId`）。
  - `data-plan-progress`：计划执行进度快照（按 stepIndex 记录 status，含当前 step 指针），同样使用 `id = planId`，便于在 UI 内合并更新。
- **进度来源（自动）**：
  1) **初始化（自动）**：当服务端检测到 Plan tool 已生成（拿到其输入结构）时，自动写入一条初始 `data-plan-progress`（全部 pending）。
  2) **推进（AI 主动）**：提供一个默认工具（如 `updatePlanProgress`），AI 在执行过程中调用它来推进/回退某一步状态，服务端写入新的 `data-plan-progress`。
  3) **推进（兜底）**：如果 AI 未显式更新，可选用“按 tool 调用完成数”做启发式推进（可开关），保证始终有可见进度。

## 具体改动

### 1) 新增 Queue 组件（AI Elements 风格）
- 新增 [queue.tsx](file:///e:/codex/src/components/ai-elements/queue.tsx)
- 组件最小子集：`Queue`/`QueueList`/`QueueItem`/`QueueItemIndicator`/`QueueItemContent`/`QueueItemDescription`（必要时再补 `QueueSection*`）。

### 2) 定义并落地 `data-plan-progress` schema
- 修改 [plan.ts](file:///e:/codex/src/types/plan.ts)
  - 新增 `PlanProgress`（例如：`planId: string; steps: Array<{ status: 'pending'|'running'|'success'|'fail' }>; currentStepIndex?: number`）。
  - 新增 `PlanProgressDataPartSchema`：`type: 'data-plan-progress'` + `id` + `data`。

### 3) 服务端：写入并更新进度 data part（AI 自动推进）
- 修改 [route.ts](file:///e:/codex/src/app/api/chat/route.ts)
  - 在 `createUIMessageStream({ execute })` 中对 `result.toUIMessageStream()` 做一层 Transform：
    - 追踪 `toolCallId -> toolName`，当捕获到 Plan tool 的 `tool-input-available`/`tool-output-available` 时：
      - 解析 Plan 结构，写入 `data-plan`（如果当前实现只在落库时转换，则这里补一条 *transient=false* 的 data chunk，让 UI 立即看到 planId/id）。
      - 同时写入初始 `data-plan-progress`（全部 pending）。
    - （可选）在任意工具 `tool-output-available` 时按启发式推进 progress（例如将 `currentStepIndex` 往后移、上一步置 success）。
  - 把历史消息喂给模型时继续过滤 `data-plan` 与 `data-plan-progress`，避免模型“看见 UI 内部状态”导致干扰。

### 4) 新增默认工具：`updatePlanProgress`（供 AI 主动推进）
- 修改 [index.ts](file:///e:/codex/src/lib/ai/tools/index.ts) 与 [tool-kit.ts](file:///e:/codex/src/lib/ai/tools/tool-kit.ts)
  - 增加 `DefaultToolName.UpdatePlanProgress`。
  - 在工具集里挂载占位 tool，并在加载阶段用闭包注入 `dataStream`（见下一条）。
- 修改 [shared.chat.ts](file:///e:/codex/src/app/api/chat/shared.chat.ts)
  - 扩展 `loadAppDefaultTools` 的入参支持 `dataStream`。
  - 将 `updatePlanProgress` 这个 tool 替换为“绑定 dataStream 的版本”，执行时：
    - 合并内存态的 progress（按 planId 缓存），
    - `dataStream.write({ type: 'data-plan-progress', id: planId, data: snapshot })`，
    - 返回简单字符串结果。
  - `convertToSavePart` 保持 data parts 原样落库（无需特殊转换），确保 reload 后仍有进度。

### 5) 前端：合并渲染（不新增气泡）
- 修改 [message.tsx](file:///e:/codex/src/components/message.tsx)
  - 渲染到 `data-plan` 时，把当前 `message.parts` 一并传给 Plan 渲染组件。
  - 对 `data-plan-progress` part：默认不单独渲染（return null），避免重复显示。
- 修改 [plan-message-part.tsx](file:///e:/codex/src/components/plan-message-part.tsx)
  - 用 Queue UI 渲染 steps。
  - 从 `message.parts` 中按 `id/planId` 抽取最新的 progress snapshot，映射到每个 step 的状态指示与总体完成度。
  - 仍支持 `isStreaming`：Plan 生成中可显示 shimmer + pending。

## 验证
- TypeScript：`pnpm check-types`。
- 行为：
  - 生成 Plan 后立即出现 Queue 步骤列表（pending）。
  - AI 在执行过程中调用 `updatePlanProgress` 时，Queue 状态实时变化。
  - 刷新页面/重新进入 thread，进度仍保持（因为 `data-plan-progress` 会落库到 message parts）。

## 执行期可见进度（Trae 侧）
- 我会在实现时用任务列表逐项标记 in_progress/completed，并在每步完成后写 summary，确保你在执行过程中能持续看到进度。