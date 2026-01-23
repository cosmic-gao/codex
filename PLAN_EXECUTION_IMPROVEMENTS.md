# 计划执行状态管理改进

## 问题分析

### 原问题
计划模式下的步骤状态更新存在不一致的情况，有时正确有时不正确。

### 根本原因
1. **提示词约束不够强**: 虽然告诉AI不要越界执行，但缺乏强制机制
2. **状态更新路径不统一**: 多个地方可能更新状态，导致竞态条件
3. **错误处理不完整**: 某些异常情况下状态可能不会被更新
4. **缺少验证机制**: 没有检查AI是否遵循单步执行规则

## 解决方案

### 1. 强化系统提示词 (`route.ts`)

#### 改进前
```typescript
`\n## STEP EXECUTION MODE - STRICT SINGLE-STEP EXECUTION\n`,
`Current Task: Execute ONLY Step ${i}\n`,
// ... 简单的约束说明
```

#### 改进后
```typescript
`\n## 🔒 STEP EXECUTION MODE - MANDATORY SINGLE-STEP CONSTRAINT\n`,
`\n### 📍 CURRENT EXECUTION SCOPE (IMMUTABLE)\n`,
// 明确的结构化约束，包含：
- 当前步骤索引和总步骤数
- 步骤标题和描述
- 四个ABSOLUTE规则（绝对规则）
- 执行前验证清单
- 执行协议
```

**关键改进点**:
- 使用 "MANDATORY"、"ABSOLUTE"、"FORBIDDEN" 等强烈词汇
- 结构化规则（RULE 1-4），更易于AI理解和遵循
- 明确说明系统自动管理状态，AI不得干预
- 添加执行前心理验证清单
- 使用emoji增强视觉识别度

### 2. 保证状态更新一定执行 (`runStep` 函数)

#### 改进前
```typescript
const runStep = async (...) => {
  writeStepStatus({ status: "in_progress" });
  
  // ... 执行逻辑
  
  if (isStepAborted()) {
    writeStepStatus({ status: "failed" });
    return { status: "aborted" };
  }
  
  writeStepStatus({ status: "completed" });
  return { status: "completed" };
};
```

**问题**: 如果中途抛出异常，状态可能不会更新到最终状态

#### 改进后
```typescript
const runStep = async (...) => {
  // GUARANTEE: 开始时必定设置 in_progress
  writeStepStatus({ status: "in_progress" });
  
  let finalStatus = "completed";
  let finalErrorMessage: string | undefined;
  
  try {
    // ... 执行逻辑
    // 所有错误情况只设置 finalStatus，不立即返回
  } catch (error) {
    // 捕获所有未预期的异常
    finalStatus = "failed";
    finalErrorMessage = error.message;
  }
  
  // GUARANTEE: 无论如何，最终状态必定被写入
  if (finalStatus === "completed") {
    writeStepStatus({ status: "completed" });
  } else {
    writeStepStatus({ status: "failed", errorMessage: finalErrorMessage });
  }
  
  return { status: finalStatus, output: textOutput };
};
```

**关键改进点**:
- 使用 try-catch-finally 保证状态一定更新
- 所有错误路径统一在最后处理
- 添加详细的日志（带emoji标识）
- 检测禁止工具调用（outline/plan/progress）

### 3. 增强状态写入函数 (`writeStepStatus`)

#### 新增功能
1. **状态转换日志**: 记录每次状态变化 `pending → in_progress → completed/failed`
2. **异常检测**: 检测并警告不正常的状态转换
3. **时间追踪**: 记录每个步骤的执行时长
4. **错误验证**: 如果Plan不存在立即报错
5. **清理旧状态**: 确保同时只有一个步骤处于 in_progress

```typescript
// 日志示例
[Plan] 📊 Status transition: Step 1 pending → in_progress
[Plan] ⏰ Step 1 inheriting endTime from step 0: 2026-01-23T10:30:45.123Z
[Plan] ✅ Step 1 completed in 12.34s
[Plan] 📈 Progress update emitted: planId=abc, step=1/5, status=completed
```

### 4. 更新计划生成提示词 (`plan-prompts.ts`)

在 `OUTLINE_GENERATION_PROMPT` 和 `PLAN_GENERATION_PROMPT` 中添加:

```typescript
## ⚠️ IMPORTANT: Plan Creation Phase Only
- You are ONLY creating the plan structure
- You will NOT execute any steps yourself
- After you call \`plan\`, the system will automatically:
  1. Execute each step one by one
  2. Track progress and status for each step
  3. Handle transitions between steps
- Do NOT include status management or progress tracking in your plan
- Do NOT describe how to update status in step descriptions
```

**目的**: 明确告知AI在计划阶段只需创建结构，执行和状态管理由系统负责

## 技术保证

### 状态更新保证
1. ✅ 每个步骤**必定**从 `pending` → `in_progress`
2. ✅ 每个步骤**必定**最终到达 `completed`、`failed` 或 `aborted`
3. ✅ 状态转换**必定**被记录和发送到客户端
4. ✅ 异常情况**必定**被捕获并标记为 `failed`

### 单步执行保证
1. ✅ 系统提示词强制单步执行边界
2. ✅ 检测禁止的工具调用（outline/plan/progress）
3. ✅ 详细日志记录步骤边界
4. ✅ 每个步骤独立的 abort 控制器

### 日志可追溯性
```
[Plan] ⏳ Step 0/3 starting: plan=abc123
[Plan] 📊 Status transition: Step 0 pending → in_progress
[Plan] ✅ Step 0 completed in 5.67s
[Plan] 📈 Progress update emitted: planId=abc123, step=0/3, status=completed
```

所有日志使用emoji标识，易于快速定位问题:
- ⏳ 开始
- 📊 状态转换
- ⏰ 时间继承
- ✅ 成功
- ❌ 失败
- ⚠️ 警告
- 🛑 中止
- 💥 异常
- 📈 进度更新

## 测试建议

### 功能测试
1. **正常流程**: 创建3-5步计划，验证每步状态正确更新
2. **中途失败**: 让某个步骤失败，验证状态标记为 failed
3. **用户中止**: 执行过程中取消，验证状态标记为 aborted
4. **工具错误**: 工具调用失败，验证错误被正确捕获
5. **复杂计划**: 10+步骤的长计划，验证所有状态正确

### 边界测试
1. **网络中断**: 模拟网络问题
2. **超长执行**: 单步执行超过预期时间
3. **并发请求**: 同时执行多个计划
4. **异常终止**: 服务重启等极端情况

### 验证点
```typescript
// 每个步骤应该满足
assert(step.status === 'pending' || 'in_progress' || 'completed' || 'failed')
assert(step.status === 'in_progress' => step.startTime !== undefined)
assert(step.status === 'completed' || 'failed' => step.endTime !== undefined)
assert(step.status === 'failed' => step.errorMessage !== undefined)
```

## 监控指标

建议添加以下监控:
1. **步骤成功率**: completed / (completed + failed + aborted)
2. **平均步骤时长**: avg(endTime - startTime)
3. **状态异常率**: 不正常的状态转换次数
4. **工具违规次数**: 尝试调用 progress 工具的次数

## 后续优化

### 短期 (P1)
- [ ] 添加单元测试覆盖 `runStep` 和 `writeStepStatus`
- [ ] 添加集成测试验证完整流程
- [ ] 前端展示优化：显示步骤执行时长

### 中期 (P2)
- [ ] 支持步骤重试机制
- [ ] 支持步骤并行执行（针对无依赖的步骤）
- [ ] 添加步骤执行历史和回溯

### 长期 (P3)
- [ ] 基于历史数据优化步骤时长预估
- [ ] 智能步骤拆分（太大的步骤自动细分）
- [ ] 步骤执行可视化时间轴

## 总结

通过以上改进，我们从以下维度确保了计划执行的可靠性：

1. **提示词层面**: 使用更强硬、更结构化的语言约束AI行为
2. **代码层面**: 保证状态更新一定执行，异常必被捕获
3. **架构层面**: 单一状态写入点，避免竞态条件
4. **可观测层面**: 详细日志，易于调试和追踪

**核心原则**: 状态管理完全由系统控制，AI只负责执行业务逻辑，不参与进度管理。
