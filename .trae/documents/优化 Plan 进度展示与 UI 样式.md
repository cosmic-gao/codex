## 目标
1.  **修复 Plan 生成过程中的闪烁问题**：优化 `PlanMessagePart` 的渲染逻辑，确保在流式传输或状态更新时保持组件稳定性。
2.  **隐藏 `updatePlanProgress` 工具调用**：在聊天界面中隐藏该工具的 JSON 视图，仅通过 Plan 组件的状态更新来体现进度，符合用户期望的“隐形”执行。
3.  **优化 Plan UI 样式**：调整 Plan 组件的视觉效果，对齐用户提供的截图（卡片式列表、清晰的进度指示、简洁的布局）。

## 具体方案

### 1. 隐藏 `updatePlanProgress` 工具调用
- **文件**：`src/components/message.tsx`
- **改动**：在遍历 `message.parts` 进行渲染时，增加对 `DefaultToolName.UpdatePlanProgress` 的判断。如果遇到该工具的 part（无论是 input 还是 output），直接返回 `null`，不渲染 `ToolMessagePart`。

### 2. 修复闪烁与组件稳定性
- **文件**：`src/components/message.tsx`
- **改动**：
  - 在渲染 `PlanMessagePart` 时，显式过滤掉对应的 `DefaultToolName.Plan` 工具 part，防止与 `data-plan` part 同时存在导致重复渲染或布局跳变。
  - 确保 `PlanMessagePart` 的 `key` 是稳定的（基于 `planId` 或 `messageIndex`，而不是易变的流式状态）。
- **文件**：`src/components/plan-message-part.tsx`
- **改动**：
  - 优化内部状态管理，确保 `isStreaming` 状态下的平滑过渡，避免因数据刷新导致的重排。

### 3. 优化 Plan UI 样式
- **文件**：`src/components/plan-message-part.tsx`
- **改动**：
  - 调整结构，使其更接近用户截图：
    - 移除不必要的边框或背景，如果 Queue 组件自带了 Card 样式。
    - 优化“已完成 X/Y”的显示位置和样式。
    - 调整步骤列表项的间距和排版。
- **文件**：`src/components/ai-elements/queue.tsx`
- **改动**：
  - 微调 `QueueItem` 和 `QueueList` 的样式，确保圆角、阴影和内边距符合设计要求。
  - 确保 `QueueItemIndicator`（圆圈/对钩）的视觉效果清晰。

## 验证
- **闪烁验证**：观察 Plan 生成过程，确保没有明显的布局抖动或组件销毁重挂载。
- **隐藏验证**：AI 执行 `updatePlanProgress` 时，聊天流中不应出现工具气泡，但 Plan 组件上的进度应实时更新。
- **样式验证**：对比渲染结果与用户提供的截图（图1），确认布局一致。

## 执行步骤
1.  修改 `message.tsx`，隐藏 `updatePlanProgress` 和 `plan` 工具 part。
2.  修改 `plan-message-part.tsx` 和 `queue.tsx`，优化 UI 样式。
3.  检查并修复任何可能的闪烁源。