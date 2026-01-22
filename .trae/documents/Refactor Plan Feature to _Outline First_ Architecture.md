# 计划：重构 Plan 功能为“先大纲后执行”架构

本计划通过实施两阶段“先大纲后执行”的方法，解决 UI 闪烁和延迟问题。

## 1. Schema 与类型定义 (`src/types/plan.ts`)
- **新增 `OutlineToolOutputSchema`**：大纲的严格 Schema（包含标题、描述、步骤，不含具体 actions）。
- **新增 `OutlineDataPartSchema`**：`{ type: "data-outline", ... }`，用于传输稳定的大纲事件。
- **新增 `PlanStepOutputDataPartSchema`**：`{ type: "data-step-output", ... }`，用于流式传输单步工具输出。

## 2. 工具实现
- **创建 `src/lib/ai/tools/planning/outline.ts`**：定义新的 `outline` 工具。
- **更新 `src/lib/ai/tools/index.ts`**：在 `DefaultToolName` 中添加 `Outline`。
- **更新 `src/lib/ai/tools/tool-kit.ts`**：在 `APP_DEFAULT_TOOL_KIT` 中注册 `outline` 工具。

## 3. 后端逻辑 (`src/app/api/chat/`)
- **`shared.chat.ts`**：
  - 更新 `convertToSavePart`，将 `outline` 工具调用转换为持久化的 `data-outline` part。
- **`route.ts`**：
  - **阶段 A（大纲生成）**：
    - 触发计划时强制使用 `outline` 工具。
    - 检测到工具输入可用时，立即流式传输 `data-outline`。
  - **阶段 B（执行）**：
    - 将生成的大纲步骤注入 System Prompt。
    - 从可用工具列表中移除 `outline` 工具。
    - 实现 TransformStream 拦截工具输出，将其映射到当前 `stepIndex`，并写入 `data-step-output`。

## 4. 前端实现 (`src/components/`)
- **`message.tsx`**：
  - 更新解析逻辑，优先使用 `data-outline` 渲染计划结构。
  - 按 `stepIndex` 聚合 `data-step-output` 数据。
- **`plan-message-part.tsx`**：
  - 重构组件，直接从 `data-outline` 渲染计划结构（立即显示）。
  - 从聚合的 `data-step-output` 动态渲染步骤详情。
  - 移除对不稳定的 tool input 解析的依赖。

## 验证
- **本地测试**：触发一个计划任务（例如“搜索并总结 HTTP 方法”），验证：
  1.  大纲立即显示。
  2.  步骤按顺序执行。
  3.  工具输出（如搜索结果）逐个步骤追加显示，无闪烁。
