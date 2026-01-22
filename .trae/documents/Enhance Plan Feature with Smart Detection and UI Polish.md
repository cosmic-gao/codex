# 计划：增强 Plan 功能（严格遵循 AGENTS.md 规范）

本计划旨在实现智能意图检测及 UI 优化，并严格遵守 `AGENTS.md` 中的命名与代码规范。

## 1. 意图检测模块 (`src/lib/ai/intent/`)
*遵循“模块化设计”与“命名规范（最多2词）”*

- **创建 `src/lib/ai/intent/detector.ts`**：
  - **核心函数**：`detectIntent`（动词+名词）。
  - **逻辑**：调用轻量级模型判断用户请求是否需要“计划（Plan）”。
  - **注释**：严格按第六章要求编写 JSDoc（意图、参数、返回值、示例）。
  - **约束**：函数行数控制在 50 行以内。

## 2. 重构 Chat 路由 (`src/app/api/chat/route.ts`)
*遵循“单一职责”与“禁止模糊命名”*

- **集成逻辑**：
  - 移除行内正则检查，替换为调用 `detectIntent`。
  - **变量重命名**：将 `forcePlanFirst` 重命名为 `isPlanMode`（布尔值，肯定语义）。
  - **流程控制**：
    - 若 `isPlanMode` 为真，触发 `Outline` 工具流。
    - 将长逻辑抽象为辅助函数，保持 `POST` 处理函数简洁。

## 3. UI 组件优化 (`src/components/plan-message-part.tsx`)
*遵循“命名规范”与“UI 交互优化”*

- **组件重构**：
  - **命名**：确保子组件使用 PascalCase（如 `PlanStep`、`StatusIcon`）。
  - **样式优化**（参考 Trae/Cursor）：
    - 采用清爽的垂直列表设计。
    - 状态图标明确：`Pending`（灰）、`Running`（蓝 Loading）、`Success`（绿勾）、`Failed`（红叉）。
    - 自动展开当前正在执行的步骤。
  - **结构拆分**：将渲染逻辑拆分为小组件（`StepHeader`、`StepContent`），尽量满足“函数 < 50 行”的原则。

## 4. 验证计划
- **单元测试**：验证 `detectIntent` 能正确区分复杂任务（需计划）和简单对话。
- **手动验证**：
  - 输入“调研 React Hooks 并总结” -> 触发 Plan 模式 -> UI 显示大纲 -> 步骤顺序执行。
  - 输入“你好” -> 不触发 Plan 模式。
