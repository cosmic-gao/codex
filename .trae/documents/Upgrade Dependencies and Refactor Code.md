我将把所有依赖项升级到最新版本，并确保项目能够正常构建和运行。

## 1. 升级依赖项
- 运行 `pnpm up --latest` 将 `package.json` 中的所有依赖项更新为最新的稳定版本。
- 这包括 `next`、`react`、`better-auth`、`ai` 等核心框架，以及 `drizzle-orm` 和 `tailwindcss` 等工具库。

## 2. 验证并修复类型问题
- 运行 `pnpm check-types` 以识别升级引入的任何 TypeScript 错误。
- 修复代码中的任何类型不匹配或重大更改（常见于 `ai` SDK 或 `better-auth` 的主要版本升级）。

## 3. 验证配置兼容性
- 检查 `next.config.ts`、`drizzle.config.ts` 和 `tailwind.config.ts`（如果存在）是否有已弃用的选项。
- 确保 `src/lib/auth/auth-instance.ts` 中的 `better-auth` 配置符合最新的 API 规范。

## 4. 构建与验证
- 运行 `pnpm build` 以确保应用程序能够成功编译为生产版本。
- 运行基本功能检查（启动开发服务器），确保应用启动时没有运行时错误。
