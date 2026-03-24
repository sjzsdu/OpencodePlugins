# OpenCode 插件开发指南

本文档详细介绍了如何为 OpenCode 开发插件，涵盖 Tool、Agent、权限系统和子代理编排等核心概念。

## 目录

1. [插件系统架构](#插件系统架构)
2. [开发你的第一个 Tool](#开发你的第一个-tool)
3. [Agent 系统详解](#agent-系统详解)
4. [子代理编排 (Task Tool)](#子代理编排-task-tool)
5. [权限系统](#权限系统)
6. [Hooks 回调体系](#hooks-回调体系)
7. [认证集成](#认证集成)
8. [最佳实践与示例](#最佳实践与示例)

---

## 插件系统架构

### 核心组件

OpenCode 插件系统由以下核心组件构成：

```
packages/plugin/src/
├── index.ts          # 导出 Hooks、Plugin、AuthHook 类型
├── tool.ts           # tool() 辅助函数、ToolContext 定义
└── shell.ts          # BunShell 类型
```

### 插件类型

OpenCode 支持两种插件形式：

1. **本地插件**: 放置在项目 `{tool,tools}/*.ts` 目录
   - 自动发现，无需额外配置
   - 适合项目特定的工具

2. **NPM 插件**: 通过 `opencode.jsonc` 的 `plugin` 字段配置

   ```jsonc
   {
     "plugin": ["my-opencode-plugin@1.0.0"],
   }
   ```

   - 需要在配置中显式声明
   - 适合可发布的通用工具

### 插件接口定义

```typescript
// packages/plugin/src/index.ts

export type ProviderContext = {
  source: "env" | "config" | "custom" | "api"
  info: Provider
  options: Record<string, any>
}

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell
  registerAgent: (agent: import("sjz-opencode-sdk/v2").Agent) => Promise<void>
  unregisterAgent: (name: string) => Promise<void>
  listAgents: () => Promise<import("sjz-opencode-sdk/v2").Agent[]>
  registerCommand: (cmd: CommandInput) => Promise<void>
  unregisterCommand: (name: string) => Promise<void>
  registerSkill: (skill: SkillInput) => Promise<void>
  unregisterSkill: (name: string) => Promise<void>
}

export type Plugin = (input: PluginInput) => Promise<Hooks>
```

---

## 开发你的第一个 Tool

### Tool 定义基础

使用 `tool()` 函数定义自定义工具：

```typescript
// packages/plugin/src/tool.ts

import { z } from "zod"

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string // 当前项目目录，解析相对路径时优先使用
  worktree: string // 工作区根目录，用于生成稳定相对路径
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: AskInput): Promise<void>
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: { [key: string]: any }
}

export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>
}) {
  return input
}

tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>
```

### 示例：自定义 Search Tool

```typescript
// my-plugin.ts
import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"

export const SearchTool = tool({
  description: "Search the web for information",
  args: {
    query: z.string().describe("The search query"),
    limit: z.number().optional().describe("Maximum results"),
  },
  async execute(args, context) {
    const { directory, worktree } = context

    context.metadata({
      title: `Search: ${args.query}`,
      metadata: { query: args.query },
    })

    const results = await performSearch(args.query, args.limit)
    return formatResults(results)
  },
})

// 使用 tool.schema 访问 zod 用于类型验证
const schema = tool.schema
```

### ToolContext 详解

| 属性         | 类型        | 说明                                   |
| ------------ | ----------- | -------------------------------------- |
| `sessionID`  | string      | 当前会话 ID                            |
| `messageID`  | string      | 当前消息 ID                            |
| `agent`      | string      | 当前使用的 Agent 名称                  |
| `directory`  | string      | 当前项目目录，解析路径时优先使用       |
| `worktree`   | string      | 工作区根目录，用于生成稳定相对路径     |
| `abort`      | AbortSignal | 中止信号，用于取消长时间操作           |
| `metadata()` | function    | 设置工具执行元数据（标题、自定义数据） |
| `ask()`      | function    | 请求用户授权                           |

### 注册 Tool

通过插件的 `tool` hook 注册：

```typescript
// my-plugin.ts
import type { Plugin, Hooks } from "@opencode-ai/plugin"

const myPlugin: Plugin = async (input) => {
  return {
    tool: {
      search: SearchTool,
      // 可以定义多个 tool
    },
  }
}

export default myPlugin
```

---

## Agent 系统详解

### Agent 定义

Agent 定义在 `packages/opencode/src/agent/agent.ts` 中，使用 Zod schema 严格定义：

```typescript
export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: Permission.Ruleset,
      model: z
        .object({
          modelID: ModelID.zod,
          providerID: ProviderID.zod,
        })
        .optional(),
      variant: z.string().optional(),
      prompt: z.string().optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>
}
```

### Agent 模式

| 模式       | 说明                      | 使用场景                                        |
| ---------- | ------------------------- | ----------------------------------------------- |
| `primary`  | 主 Agent，可执行工具      | 默认的 build、plan Agent                        |
| `subagent` | 子 Agent，被主 Agent 调用 | explore、general Agent                          |
| `all`      | 可作为主 Agent 或子 Agent | 自定义 Agent 的默认模式，可根据调用场景自动适配 |

### 内置 Agent

OpenCode 内置以下 Agent：

```typescript
// build - 默认主 Agent
{
  name: "build",
  mode: "primary",
  permission: Permission.merge(defaults, user, [
    { permission: "question", pattern: "*", action: "allow" },
    { permission: "plan_enter", pattern: "*", action: "allow" },
  ])
}

// plan - 计划模式，禁止编辑
{
  name: "plan",
  mode: "primary",
  permission: Permission.merge(defaults, user, [
    { permission: "edit", pattern: "*", action: "deny" },
    { permission: "plan_exit", pattern: "*", action: "allow" },
  ])
}

// explore - 只读子 Agent
{
  name: "explore",
  mode: "subagent",
  permission: Permission.merge(defaults, user, [
    { permission: "*", pattern: "*", action: "deny" },
    { permission: "grep", pattern: "*", action: "allow" },
    { permission: "glob", pattern: "*", action: "allow" },
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "*", action: "allow" },
  ])
}

// general - 通用子 Agent
{
  name: "general",
  mode: "subagent",
  permission: Permission.merge(defaults, user, [
    { permission: "todoread", pattern: "*", action: "deny" },
    { permission: "todowrite", pattern: "*", action: "deny" },
  ])
}
```

### 自定义 Agent

在 `opencode.jsonc` 中配置自定义 Agent：

```jsonc
{
  "agent": {
    "my-agent": {
      "description": "My custom agent for X tasks",
      "mode": "subagent",
      "prompt": "You are a specialized agent for...",
      "temperature": 0.5,
      "permission": {
        "read": "allow",
        "grep": "allow",
        "bash": "ask",
      },
    },
  },
}
```

---

## 子代理编排 (Task Tool)

### Task Tool 机制

Task Tool 是 OpenCode 子代理编排的核心机制，允许主 Agent 调用子 Agent：

```typescript
// packages/opencode/src/tool/task.ts

const parameters = z.object({
  description: z.string(), // 任务简短描述
  prompt: z.string(), // 任务的具体指令
  subagent_type: z.string(), // 子 Agent 类型
  task_id: z.string().optional(), // 用于恢复之前的任务
  command: z.string().optional(),
})
```

### 调用子代理

主 Agent 通过以下方式调用子代理：

1. **显式调用**: 用户在消息中使用 `@agent-name` 触发
2. **工具调用**: Agent 主动调用 `task` 工具

```typescript
// Agent 主动调用 task 工具
{
  tool: "task",
  input: {
    description: "探索代码库",
    prompt: "请找出所有与用户认证相关的文件",
    subagent_type: "explore"
  }
}
```

### 子代理权限继承

子 Agent 的权限由其自身定义决定，父 Agent 可以通过权限规则限制子代理：

```typescript
// 子代理权限限制示例
const session = await Session.create({
  permission: [
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "todoread", pattern: "*", action: "deny" },
    // 禁止子代理调用 task 工具
    { permission: "task", pattern: "*", action: "deny" },
  ],
})
```

### 任务恢复 (task_id)

Task Tool 支持通过 `task_id` 恢复之前的任务：

```typescript
{
  task_id: "session-id-from-previous-task",
  description: "继续之前的任务",
  prompt: "请继续完成之前的工作",
  subagent_type: "general"
}
```

---

## 权限系统

### Permission 概述

OpenCode 使用细粒度的权限控制系统，定义在 `packages/opencode/src/permission/index.ts`：

```typescript
export namespace Permission {
  export const Action = z.enum(["allow", "deny", "ask"])
  export type Action = z.infer<typeof Action>

  export const Rule = z.object({
    permission: z.string(),
    pattern: z.string(),
    action: Action,
  })
  export type Rule = z.infer<typeof Rule>

  export const Ruleset = Rule.array()
  export type Ruleset = z.infer<typeof Ruleset>
}
```

### 权限操作

| 操作    | 说明                   |
| ------- | ---------------------- |
| `allow` | 自动允许，无需用户确认 |
| `deny`  | 自动拒绝，禁止操作     |
| `ask`   | 请求用户授权           |

### 权限模式匹配

使用通配符匹配权限规则：

```typescript
// 允许所有操作
{ permission: "*", pattern: "*", action: "allow" }

// 允许读取所有文件
{ permission: "read", pattern: "*", action: "allow" }

// 询问是否允许执行 bash
{ permission: "bash", pattern: "*", action: "ask" }

// 禁止编辑特定目录
{ permission: "edit", pattern: "/path/to/protected/*", action: "deny" }
```

### 权限检查流程

```typescript
// 检查权限
const rule = Permission.evaluate("bash", "/usr/bin/ls", ruleset)

// 结果
{ action: "allow" | "deny" | "ask", permission: "...", pattern: "..." }

// ask 时需要请求用户授权
await ctx.ask({
  permission: "bash",
  patterns: ["/usr/bin/ls"],
  always: ["~/scripts/*"],  // 记住此 Pattern
  metadata: { ... }
})
```

### 工具与权限映射

```typescript
const EDIT_TOOLS = ["edit", "write", "apply_patch", "multiedit"]

// edit 权限控制所有编辑工具
Permission.evaluate("edit", filePath, ruleset)
```

### Permission 辅助函数

```typescript
export namespace Permission {
  // 合并多个规则集
  export function merge(...rulesets: Ruleset[]): Ruleset

  // 从配置文件的权限对象转换为规则集
  export function fromConfig(permission: Config.Permission): Ruleset

  // 检查哪些工具被禁用
  export function disabled(tools: string[], ruleset: Ruleset): Set<string>

  // 评估权限
  export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule
}
```

---

## Hooks 回调体系

### 完整 Hooks 列表

OpenCode 插件系统提供以下 Hook，按功能分类如下：

#### 1. 基础 Hooks

| Hook 名称 | 输入               | 输出                              | 说明                           |
| --------- | ------------------ | --------------------------------- | ------------------------------ |
| `event`   | `{ event: Event }` | `void`                            | 全局事件监听，处理所有系统事件 |
| `config`  | `Config`           | `void`                            | 配置加载时调用，可修改配置     |
| `tool`    | -                  | `{[key: string]: ToolDefinition}` | 注册自定义工具                 |
| `auth`    | -                  | `AuthHook`                        | 定义认证方式（OAuth/API Key）  |

#### 2. 聊天相关 Hooks

| Hook 名称                              | 输入                                                      | 输出                                         | 说明                  |
| -------------------------------------- | --------------------------------------------------------- | -------------------------------------------- | --------------------- |
| `chat.message`                         | `sessionID`, `agent?`, `model?`, `messageID?`, `variant?` | `message: UserMessage`, `parts: Part[]`      | 新消息到达时调用      |
| `chat.params`                          | `sessionID`, `agent`, `model`, `provider`, `message`      | `temperature`, `topP`, `topK`, `options`     | 修改发送给 LLM 的参数 |
| `chat.headers`                         | `sessionID`, `agent`, `model`, `provider`, `message`      | `headers: Record<string, string>`            | 修改请求头            |
| `experimental.chat.messages.transform` | `{}`                                                      | `messages: {info: Message, parts: Part[]}[]` | 转换聊天消息          |
| `experimental.chat.system.transform`   | `sessionID?`, `model`                                     | `system: string[]`                           | 转换系统提示          |

#### 3. 工具相关 Hooks

| Hook 名称             | 输入                                  | 输出                                     | 说明                                 |
| --------------------- | ------------------------------------- | ---------------------------------------- | ------------------------------------ |
| `tool.definition`     | `toolID: string`                      | `description: string`, `parameters: any` | 修改工具定义（描述和参数）发送给 LLM |
| `tool.execute.before` | `tool`, `sessionID`, `callID`         | `args: any`                              | 工具执行前调用，可修改参数           |
| `tool.execute.after`  | `tool`, `sessionID`, `callID`, `args` | `title`, `output`, `metadata`            | 工具执行后调用，可修改结果           |

#### 4. 权限相关 Hooks

| Hook 名称        | 输入         | 输出                                 | 说明                                 |
| ---------------- | ------------ | ------------------------------------ | ------------------------------------ |
| `permission.ask` | `Permission` | `status: "ask" \| "deny" \| "allow"` | 权限请求时调用，可拦截或修改权限决策 |

#### 5. Shell 相关 Hooks

| Hook 名称   | 输入                           | 输出                          | 说明                |
| ----------- | ------------------------------ | ----------------------------- | ------------------- |
| `shell.env` | `cwd`, `sessionID?`, `callID?` | `env: Record<string, string>` | 修改 shell 环境变量 |

#### 6. 命令相关 Hooks

| Hook 名称                | 输入                                | 输出            | 说明               |
| ------------------------ | ----------------------------------- | --------------- | ------------------ |
| `command.execute.before` | `command`, `sessionID`, `arguments` | `parts: Part[]` | TUI 命令执行前调用 |

#### 7. Agent 相关 Hooks

| Hook 名称          | 输入                                             | 输出                                             | 说明                |
| ------------------ | ------------------------------------------------ | ------------------------------------------------ | ------------------- |
| `agent.register`   | `{ agent: import("sjz-opencode-sdk/v2").Agent }` | -                                                | Agent 注册时调用    |
| `agent.unregister` | `{ name: string }`                               | -                                                | Agent 注销时调用    |
| `agent.list`       | -                                                | `Promise<import("sjz-opencode-sdk/v2").Agent[]>` | 获取所有 Agent 列表 |

#### 8. 实验性 Hooks

| Hook 名称                         | 输入                               | 输出                                   | 说明                                |
| --------------------------------- | ---------------------------------- | -------------------------------------- | ----------------------------------- |
| `experimental.session.compacting` | `sessionID: string`                | `context: string[]`, `prompt?: string` | 会话压缩前调用，可自定义压缩 prompt |
| `experimental.text.complete`      | `sessionID`, `messageID`, `partID` | `text: string`                         | 文本完成时调用，可修改输出文本      |

### TypeScript 类型定义

```typescript
// packages/plugin/src/index.ts

export interface Hooks {
  // 基础 hooks
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: { [key: string]: ToolDefinition }
  auth?: AuthHook

  // 聊天相关
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => Promise<void>
  "chat.headers"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { headers: Record<string, string> },
  ) => Promise<void>

  // 权限相关
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>

  // 命令相关
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Part[] },
  ) => Promise<void>

  // 工具相关
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => Promise<void>
  "tool.definition"?: (input: { toolID: string }, output: { description: string; parameters: any }) => Promise<void>

  // Shell 相关
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>

  // Agent 相关
  "agent.register"?: (input: { agent: import("sjz-opencode-sdk/v2").Agent }) => Promise<void>
  "agent.unregister"?: (input: { name: string }) => Promise<void>
  "agent.list"?: () => Promise<import("sjz-opencode-sdk/v2").Agent[]>

  // 实验性 hooks
  "experimental.chat.messages.transform"?: (
    input: {},
    output: { messages: { info: Message; parts: Part[] }[] },
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: { system: string[] },
  ) => Promise<void>
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>
}
```

### Hook 示例

#### tool.execute.before - 修改工具参数

```typescript
export default async function myPlugin(input) {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash") {
        // 在命令前添加前缀
        output.args.command = "set -e; " + output.args.command
      }
    },
  }
}
```

#### tool.definition - 修改工具定义

```typescript
export default async function myPlugin(input) {
  return {
    "tool.definition": async (input, output) => {
      if (input.toolID === "myTool") {
        output.description = "Custom description for the LLM"
        output.parameters = { ... }
      }
    }
  }
}
```

#### tool.execute.after - 处理工具结果

```typescript
export default async function myPlugin(input) {
  return {
    "tool.execute.after": async (input, output) => {
      if (input.tool === "read") {
        output.metadata.readLength = output.output.length
      }
    },
  }
}
```

#### experimental.session.compacting - 自定义会话压缩

```typescript
export default async function myPlugin(input) {
  return {
    "experimental.session.compacting": async (input, output) => {
      // 添加自定义上下文
      output.context.push("Custom context for compaction")
      // 或完全替换压缩 prompt
      output.prompt = "Custom compaction prompt..."
    },
  }
}
```

#### chat.headers - 修改请求头

```typescript
export default async function myPlugin(input) {
  return {
    "chat.headers": async (input, output) => {
      if (input.model.providerID === "my-provider") {
        output.headers["X-Custom-Header"] = "value"
      }
    },
  }
}
```

#### shell.env - 修改环境变量

```typescript
export default async function myPlugin(input) {
  return {
    "shell.env": async (input, output) => {
      output.env = {
        ...output.env,
        MY_CUSTOM_VAR: "value",
      }
    },
  }
}
```

---

## 动态 Agent 注册

OpenCode 支持在运行时动态注册和注销 Agent，无需重启或修改配置文件。

### PluginInput 方法

插件可以通过 `PluginInput` 直接调用方法来动态管理 Agent：

```typescript
export type PluginInput = {
  // ... 其他属性
  registerAgent: (agent: import("sjz-opencode-sdk/v2").Agent) => Promise<void>
  unregisterAgent: (name: string) => Promise<void>
  listAgents: () => Promise<import("sjz-opencode-sdk/v2").Agent[]>
}
```

### 注册 Agent

```typescript
export default async function myPlugin(input: PluginInput): Promise<Hooks> {
  await input.registerAgent({
    name: "my-dynamic-agent",
    description: "A dynamically registered agent",
    mode: "subagent",
    permission: [
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "grep", pattern: "*", action: "allow" },
      { permission: "edit", pattern: "*", action: "deny" },
    ],
    options: {},
  })

  return {}
}
```

### 注销 Agent

```typescript
export default async function myPlugin(input: PluginInput): Promise<Hooks> {
  await input.unregisterAgent("my-dynamic-agent")
  return {}
}
```

### 监听 Agent 注册事件

通过 hooks 监听其他插件注册 Agent：

```typescript
export default async function myPlugin(input: PluginInput): Promise<Hooks> {
  return {
    "agent.register": async ({ agent }) => {
      console.log("Agent registered:", agent.name)
    },
    "agent.unregister": async ({ name }) => {
      console.log("Agent unregistered:", name)
    },
  }
}
```

### 获取 Agent 列表

```typescript
export default async function myPlugin(input: PluginInput): Promise<Hooks> {
  const agents = await input.listAgents()
  console.log(
    "Available agents:",
    agents.map((a) => a.name),
  )

  return {}
}
```

### SDK Agent 类型定义

```typescript
// sjz-opencode-sdk/v2
export type Agent = {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission: PermissionRuleset
  model?: {
    modelID: string
    providerID: string
  }
  variant?: string
  prompt?: string
  options: {
    [key: string]: unknown
  }
  steps?: number
}
```

---

## 动态 Command 注册

OpenCode 支持在运行时动态注册和注销 Command（斜杠命令），无需重启或修改配置文件。

### Command 是什么

Command 是用户在 TUI 中通过 `/name` 触发的模板化提示词。执行时，模板内容会被发送给 LLM 处理。支持 `$1`、`$2`、`$ARGUMENTS` 等占位符，由用户输入的参数替换。

### CommandInput 类型

```typescript
export type CommandInput = {
  name: string
  template: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
}
```

### 注册 Command

```typescript
export default async function myPlugin(input: PluginInput): Promise<Hooks> {
  await input.registerCommand({
    name: "deploy",
    description: "Deploy the current project to production",
    template: `Please deploy the project at ${input.directory} to production.
Follow these steps:
1. Run the test suite
2. Build the project
3. Deploy using the deploy script

User arguments: $ARGUMENTS`,
  })

  return {}
}
```

### 带参数占位符的 Command

```typescript
await input.registerCommand({
  name: "migrate",
  description: "Run database migration",
  template: `Run database migration for environment $1.
Migration name: $2
Additional options: $ARGUMENTS`,
})
// 用法: /migrate production add_users_table --dry-run
// $1 = "production", $2 = "add_users_table", $ARGUMENTS = "--dry-run"
```

### 指定 Agent 和模型

```typescript
await input.registerCommand({
  name: "analyze",
  description: "Deep code analysis",
  agent: "explore",
  model: "anthropic/claude-sonnet-4-20250514",
  subtask: true,
  template: `Analyze the codebase structure and provide a summary.
Focus on: $ARGUMENTS`,
})
```

### 注销 Command

```typescript
await input.unregisterCommand("deploy")
```

### 结合 Hooks 拦截 Command 执行

可以通过 `command.execute.before` hook 在命令执行前修改或增强内容：

```typescript
export default async function myPlugin(input: PluginInput): Promise<Hooks> {
  await input.registerCommand({
    name: "review-pr",
    description: "Review a pull request",
    template: "Review PR #$1: $ARGUMENTS",
  })

  return {
    "command.execute.before": async (input, output) => {
      if (input.command === "review-pr") {
        output.parts.push({
          type: "text",
          text: "\n\nPlease focus on security and performance issues.",
        })
      }
    },
  }
}
```

---

## 动态 Skill 注册

OpenCode 支持在运行时动态注册和注销 Skill，无需重启或修改配置文件。

### Skill 是什么

Skill 是提供特定领域指令和工作流程的技能模块。用户可以在对话中通过 `skill` 工具加载这些技能，加载后的技能会向对话上下文注入详细的指令和工作流程。

### SkillInput 类型

```typescript
export type SkillInput = {
  name: string
  description: string
  content: string
}
```

### 注册 Skill

```typescript
export default async function myPlugin(input: PluginInput): Promise<Hooks> {
  await input.registerSkill({
    name: "code-review",
    description: "Expert code review assistant",
    content: `# Skill: Code Review

You are an expert code reviewer. When reviewing code:

1. Check for potential bugs and security vulnerabilities
2. Look for code smells and anti-patterns
3. Suggest performance optimizations
4. Verify test coverage

## Review Checklist

- [ ] Input validation
- [ ] Error handling
- [ ] Resource cleanup
- [ ] Documentation
`,
  })

  return {}
}
```

### 动态 Skill 的位置信息

动态注册的 Skill 没有文件位置，因此显示为 `(dynamic)`：

```xml
<skill>
  <name>code-review</name>
  <description>Expert code review assistant</description>
  <location>(dynamic)</location>
</skill>
```

### 注销 Skill

```typescript
await input.unregisterSkill("code-review")
```

### 与静态 Skill 的区别

| 特性   | 静态 Skill                                       | 动态 Skill        |
| ------ | ------------------------------------------------ | ----------------- |
| 来源   | 文件系统 (`.claude/skills/`, `.opencode/skill/`) | 代码动态注册      |
| 位置   | 有文件路径                                       | `(dynamic)`       |
| 持久化 | 配置文件或目录                                   | 仅运行时有效      |
| 更新   | 修改文件后重启                                   | 重新调用 register |

---

## 认证集成

### AuthHook 结构

```typescript
type Rule = {
  key: string
  op: "eq" | "neq"
  value: string
}

export type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{ label: string; value: string; hint?: string }>
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
        >
        authorize(inputs?: Record<string, string>): Promise<AuthOuathResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{ label: string; value: string; hint?: string }>
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
        >
        authorize?(
          inputs?: Record<string, string>,
        ): Promise<{ type: "success"; key: string; provider?: string } | { type: "failed" }>
      }
  )[]
}

export type AuthOuathResult = { url: string; instructions: string } & (
  | {
      method: "auto"
      callback(): Promise<
        | ({ type: "success"; provider?: string } & (
            | { refresh: string; access: string; expires: number; accountId?: string }
            | { key: string }
          ))
        | { type: "failed" }
      >
    }
  | {
      method: "code"
      callback(
        code: string,
      ): Promise<
        | ({ type: "success"; provider?: string } & (
            | { refresh: string; access: string; expires: number; accountId?: string }
            | { key: string }
          ))
        | { type: "failed" }
      >
    }
)
```

### OAuth 认证示例

```typescript
export async function MyAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "my-provider",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        return {
          apiKey: auth.access,
          async fetch(requestInput, init) {
            const req = new Request(requestInput, init)
            req.headers.set("Authorization", `Bearer ${auth.access}`)
            return fetch(req)
          },
        }
      },
      methods: [
        {
          type: "oauth",
          label: "Login with Provider",
          authorize: async () => {
            const authUrl = "https://provider.com/oauth/authorize"

            return {
              url: authUrl,
              instructions: "Please authorize in the browser",
              method: "auto",
              callback: async () => {
                const tokens = await exchangeCodeForTokens(code)
                return {
                  type: "success",
                  refresh: tokens.refresh_token,
                  access: tokens.access_token,
                  expires: Date.now() + tokens.expires_in * 1000,
                }
              },
            }
          },
        },
      ],
    },
  }
}
```

### API Key 认证示例

```typescript
{
  type: "api",
  label: "Enter API Key",
  prompts: [
    {
      type: "text",
      key: "apiKey",
      message: "Enter your API Key",
      validate: (value) => value.length > 0 ? undefined : "Required"
    }
  ],
  authorize: async (inputs) => {
    const valid = await validateApiKey(inputs.apiKey)
    if (valid) {
      return { type: "success", key: inputs.apiKey, provider: "my-provider" }
    }
    return { type: "failed" }
  }
}
```

### 使用 `when` 规则的条件 Prompt

Prompts 支持使用声明式 `when` 规则来控制显示条件（替代已废弃的 `condition` 回调）：

```typescript
prompts: [
  {
    type: "select",
    key: "authMethod",
    message: "Select authentication method",
    options: [
      { label: "API Key", value: "api_key" },
      { label: "OAuth", value: "oauth" },
    ],
  },
  {
    type: "text",
    key: "apiKey",
    message: "Enter your API Key",
    when: { key: "authMethod", op: "eq", value: "api_key" },
  },
]
```

---

## 最佳实践与示例

### 完整的插件示例

```typescript
// my-opencode-plugin.ts
import { tool } from "@opencode-ai/plugin/tool"
import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { z } from "zod"

const MyTool = tool({
  description: "Execute a custom operation",
  args: {
    operation: z.enum(["option1", "option2"]).describe("Operation type"),
    value: z.string().describe("Input value"),
  },
  async execute(args, context) {
    const { directory, worktree } = context

    context.metadata({
      title: `Operation: ${args.operation}`,
      metadata: { operation: args.operation },
    })

    return `Operation ${args.operation} completed with value: ${args.value}`
  },
})

const AnalysisTool = tool({
  description: "Analyze code structure",
  args: {
    filePath: z.string().describe("File to analyze"),
  },
  async execute(args, context) {
    return analyzeCode(args.filePath, context.directory)
  },
})

const myPlugin: Plugin = async (input) => {
  return {
    tool: {
      myTool: MyTool,
      analysis: AnalysisTool,
    },

    "chat.message": async (input, output) => {
      console.log("New message in session:", input.sessionID)
    },

    "tool.execute.before": async (input, output) => {
      console.log("Executing tool:", input.tool)
    },

    "tool.execute.after": async (input, output) => {
      output.metadata.executedAt = Date.now()
    },

    "chat.headers": async (input, output) => {
      if (input.model.providerID === "openai") {
        output.headers["X-Custom-Header"] = "plugin-value"
      }
    },

    "shell.env": async (input, output) => {
      output.env = {
        ...output.env,
        PLUGIN_ENV: "enabled",
      }
    },
  }
}

export default myPlugin
```

### 配置文件

```jsonc
// opencode.jsonc
{
  "plugin": ["my-opencode-plugin@1.0.0"],

  "agent": {
    "code-analyst": {
      "description": "Agent specialized in code analysis",
      "mode": "subagent",
      "prompt": "You are an expert code analyst...",
      "temperature": 0.3,
      "permission": {
        "read": "allow",
        "grep": "allow",
        "glob": "allow",
        "edit": "deny",
        "bash": "ask",
      },
    },
  },
}
```

### 目录结构建议

```
my-plugin/
├── index.ts          # 插件入口
├── tools/
│   ├── my-tool.ts    # Tool 定义
│   └── another-tool.ts
├── auth/
│   └── my-auth.ts    # 认证逻辑
└── package.json
```

### 常见模式

#### 1. 条件性启用功能

```typescript
const myPlugin: Plugin = async (input) => {
  const config = await input.client.config.get()

  if (!config.features?.myFeature) {
    return {}
  }

  return {
    tool: { myTool: MyTool },
  }
}
```

#### 2. 错误处理

```typescript
const myPlugin: Plugin = async (input) => {
  return {
    "tool.execute.after": async (input, output) => {
      try {
        // 处理逻辑
      } catch (error) {
        console.error("Plugin error:", error)
      }
    },
  }
}
```

---

## 总结

本文档涵盖了 OpenCode 插件开发的核心概念：

1. **Tool 开发**: 使用 `tool()` 函数定义，带参数 schema 和执行函数
2. **Agent 系统**: 支持 primary、subagent、all 三种模式
3. **子代理编排**: 通过 Task Tool 实现主 Agent 调用子 Agent
4. **权限系统**: 细粒度的 allow/deny/ask 规则，使用 `Permission` 命名空间
5. **Hooks 回调**: 丰富的生命周期钩子用于扩展功能
6. **认证集成**: 支持 OAuth 和 API Key 两种认证方式，prompts 支持 `when` 条件规则
7. **动态注册**: 支持运行时动态注册 Agent、Command 和 Skill

更多示例请参考内置插件：

- `packages/opencode/src/plugin/codex.ts` - Codex 认证插件
- `packages/opencode/src/plugin/copilot.ts` - GitHub Copilot 认证插件
- `packages/opencode/src/plugin/gitlab.ts` - GitLab 认证插件
