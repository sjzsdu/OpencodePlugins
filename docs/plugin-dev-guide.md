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
├── index.ts          # 导出 Hooks、Plugin 类型
└── tool.ts           # tool() 辅助函数定义
```

### 插件类型

OpenCode 支持两种插件形式：

1. **本地插件**: 放置在项目 `{tool,tools}/*.ts` 目录
   - 自动发现，无需额外配置
   - 适合项目特定的工具

2. **NPM 插件**: 通过 `opencode.jsonc` 的 `plugin` 字段配置
   ```jsonc
   {
     "plugin": [
       "my-opencode-plugin@1.0.0"
     ]
   }
   ```
   - 需要在配置中显式声明
   - 适合可发布的通用工具

### 插件接口定义

```typescript
// packages/plugin/src/index.ts

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell
}

export type Plugin = (input: PluginInput) => Promise<Hooks>

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: { [key: string]: ToolDefinition }
  auth?: AuthHook
  "chat.message"?: ...
  "tool.execute.before"?: ...
  "tool.execute.after"?: ...
  // ... 更多 hooks
}
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
  directory: string
  worktree: string
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
```

### 示例：自定义 Search Tool

```typescript
// my-plugin.ts
import { tool } from "@opencode-ai/plugin/tool"

export const SearchTool = tool({
  description: "Search the web for information",
  args: {
    query: z.string().describe("The search query"),
    limit: z.number().optional().describe("Maximum results"),
  },
  async execute(args, context) {
    // 访问项目信息
    const { directory, worktree } = context
    
    // 记录元数据
    context.metadata({
      title: `Search: ${args.query}`,
      metadata: { query: args.query }
    })
    
    // 执行搜索逻辑
    const results = await performSearch(args.query, args.limit)
    
    // 返回字符串，核心系统会自动包装为对象
    return formatResults(results)
  }
})

// 使用 tool.schema 访问 zod 用于类型验证
const schema = tool.schema
```

### ToolContext 详解

| 属性 | 类型 | 说明 |
|------|------|------|
| `sessionID` | string | 当前会话 ID |
| `messageID` | string | 当前消息 ID |
| `agent` | string | 当前使用的 Agent 名称 |
| `directory` | string | 当前项目目录 |
| `worktree` | string | 工作区根目录 |
| `abort` | AbortSignal | 中止信号，用于取消长时间操作 |
| `metadata()` | function | 设置工具执行元数据 |
| `ask()` | function | 请求用户授权 |

### 注册 Tool

通过插件的 `tool` hook 注册：

```typescript
// my-plugin.ts
export default async function myPlugin(input) {
  return {
    tool: {
      search: SearchTool,
      // 可以定义多个 tool
    }
  }
}
```

---

## Agent 系统详解

### Agent 定义

Agent 定义在 `packages/opencode/src/agent/agent.ts` 中，使用 Zod schema 严格定义：

```typescript
export const Info = z.object({
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  native: z.boolean().optional(),
  hidden: z.boolean().optional(),
  topP: z.number().optional(),
  temperature: z.number().optional(),
  color: z.string().optional(),
  permission: PermissionNext.Ruleset,
  model: z.object({
    modelID: z.string(),
    providerID: z.string(),
  }).optional(),
  variant: z.string().optional(),
  prompt: z.string().optional(),
  options: z.record(z.string(), z.any()),
  steps: z.number().int().positive().optional(),
})
```

### Agent 模式

| 模式 | 说明 | 使用场景 |
|------|------|----------|
| `primary` | 主 Agent，可执行工具 | 默认的 build、plan Agent |
| `subagent` | 子 Agent，被主 Agent 调用 | explore、general Agent |
| `hidden` | 隐藏 Agent，不显示给用户 | compaction、title Agent |
| `all` | 可作为主 Agent 或子 Agent | 自定义 Agent 的默认模式，可根据调用场景自动适配 |

### 内置 Agent

OpenCode 内置以下 Agent：

```typescript
// build - 默认主 Agent
{
  name: "build",
  mode: "primary",
  permission: PermissionNext.merge(defaults, user, {
    question: "allow",
    plan_enter: "allow",
  })
}

// plan - 计划模式，禁止编辑
{
  name: "plan",
  mode: "primary",
  permission: PermissionNext.merge(defaults, user, {
    edit: { "*": "deny" },
    plan_exit: "allow",
  })
}

// explore - 只读子 Agent
{
  name: "explore",
  mode: "subagent",
  permission: PermissionNext.merge(defaults, user, {
    "*": "deny",
    grep: "allow",
    glob: "allow",
    read: "allow",
    bash: "allow",
  })
}

// general - 通用子 Agent
{
  name: "general",
  mode: "subagent",
  permission: PermissionNext.merge(defaults, user, {
    todoread: "deny",
    todowrite: "deny",
  })
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
        "bash": "ask"
      }
    }
  }
}
```

---

## 子代理编排 (Task Tool)

### Task Tool 机制

Task Tool 是 OpenCode 子代理编排的核心机制，允许主 Agent 调用子 Agent：

```typescript
// packages/opencode/src/tool/task.ts

const parameters = z.object({
  description: z.string(),      // 任务简短描述
  prompt: z.string(),           // 任务的具体指令
  subagent_type: z.string(),    // 子 Agent 类型
  task_id: z.string().optional(), // 用于恢复之前的任务
  command: z.string().optional,
})

export const TaskTool = Tool.define("task", async (ctx) => {
  return {
    description,
    parameters,
    async execute(params, ctx) {
      // 获取子 Agent
      const agent = await Agent.get(params.subagent_type)
      
      // 创建子会话
      const session = await Session.create({
        parentID: ctx.sessionID,
        title: params.description + ` (@${agent.name} subagent)`,
        permission: [...],
      })
      
      // 执行子任务
      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: ...,
        agent: agent.name,
        parts: promptParts,
      })
      
      // 返回结果
      return {
        title: params.description,
        metadata: { sessionId: session.id },
        output: result,
      }
    }
  }
})
```

### 调用子代理

主 Agent 通过以下方式调用子代理：

1. **显式调用**: 用户在消息中使用 `@agent-name` 触发
2. **工具调用**: Agent 主动调用 `task` 工具

```typescript
// 用户消息中使用 @ 触发
// "请 @explore 帮我查找某个文件"

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

子 Agent 的权限是父 Agent 权限的子集：

```typescript
// 子代理权限限制示例
const session = await Session.create({
  permission: [
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "todoread", pattern: "*", action: "deny" },
    // 禁止子代理调用 task 工具（除非父代理允许）
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

### PermissionNext 概述

OpenCode 使用细粒度的权限控制系统：

```typescript
// packages/opencode/src/permission/next.ts

export const Action = z.enum(["allow", "deny", "ask"])
export const Rule = z.object({
  permission: z.string(),
  pattern: z.string(),
  action: Action,
})
export const Ruleset = Rule.array()
```

### 权限操作

| 操作 | 说明 |
|------|------|
| `allow` | 自动允许，无需用户确认 |
| `deny` | 自动拒绝，禁止操作 |
| `ask` | 请求用户授权 |

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
const rule = PermissionNext.evaluate("bash", "/usr/bin/ls", ruleset)

// 结果
{ action: "allow" | "deny" | "ask", permission: "...", pattern: "..." }

// ask 时需要请求用户授权
await ctx.ask({
  permission: "bash",
  patterns: ["/usr/bin/ls"],
  always: ["~/scripts/*"],  // 记住此Pattern
  metadata: { ... }
})
```

### 工具与权限映射

```typescript
const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]

// edit 权限控制所有编辑工具
PermissionNext.evaluate("edit", filePath, ruleset)
```

---

## Hooks 回调体系

### 完整 Hooks 列表

OpenCode 插件系统提供以下 17 个 Hook，按功能分类如下：

#### 1. 基础 Hooks

| Hook 名称 | 输入 | 输出 | 说明 |
|-----------|------|------|------|
| `event` | `{ event: Event }` | `void` | 全局事件监听，处理所有系统事件 |
| `config` | `Config` | `void` | 配置加载时调用，可修改配置 |
| `tool` | - | `{[key: string]: ToolDefinition}` | 注册自定义工具 |
| `auth` | - | `AuthHook` | 定义认证方式（OAuth/API Key） |

#### 2. 聊天相关 Hooks

| Hook 名称 | 输入 | 输出 | 说明 |
|-----------|------|------|------|
| `chat.message` | `sessionID`, `agent`, `model`, `messageID`, `variant` | `message: UserMessage`, `parts: Part[]` | 新消息到达时调用 |
| `chat.params` | `sessionID`, `agent`, `model`, `provider`, `message` | `temperature`, `topP`, `topK`, `options` | 修改发送给 LLM 的参数 |
| `chat.headers` | `sessionID`, `agent`, `model`, `provider`, `message` | `headers: Record<string, string>` | 修改请求头 |
| `experimental.chat.messages.transform` | `{}` | `messages: {info: Message, parts: Part[]}[]` | 转换聊天消息 |
| `experimental.chat.system.transform` | `sessionID?`, `model` | `system: string[]` | 转换系统提示 |

#### 3. 工具相关 Hooks

| Hook 名称 | 输入 | 输出 | 说明 |
|-----------|------|------|------|
| `tool.definition` | `toolID: string` | `description: string`, `parameters: any` | 修改工具定义（描述和参数）发送给 LLM |
| `tool.execute.before` | `tool`, `sessionID`, `callID` | `args: any` | 工具执行前调用，可修改参数 |
| `tool.execute.after` | `tool`, `sessionID`, `callID`, `args` | `title`, `output`, `metadata` | 工具执行后调用，可修改结果 |

#### 4. 权限相关 Hooks

| Hook 名称 | 输入 | 输出 | 说明 |
|-----------|------|------|------|
| `permission.ask` | `Permission` | `status: "ask" | "deny" | "allow"` | 权限请求时调用，可拦截或修改权限决策 |

#### 5. Shell 相关 Hooks

| Hook 名称 | 输入 | 输出 | 说明 |
|-----------|------|------|------|
| `shell.env` | `cwd`, `sessionID?`, `callID?` | `env: Record<string, string>` | 修改 shell 环境变量 |

#### 6. 命令相关 Hooks

| Hook 名称 | 输入 | 输出 | 说明 |
|-----------|------|------|------|
| `command.execute.before` | `command`, `sessionID`, `arguments` | `parts: Part[]` | TUI 命令执行前调用 |

#### 7. 会话相关 Hooks

| Hook 名称 | 输入 | 输出 | 说明 |
|-----------|------|------|------|
| `experimental.session.compacting` | `sessionID: string` | `context: string[]`, `prompt?: string` | 会话压缩前调用，可自定义压缩 prompt |

#### 8. 文本处理 Hooks

| Hook 名称 | 输入 | 输出 | 说明 |
|-----------|------|------|------|
| `experimental.text.complete` | `sessionID`, `messageID`, `partID` | `text: string` | 文本完成时调用，可修改输出文本 |

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
  "tool.definition"?: (
    input: { toolID: string },
    output: { description: string; parameters: any },
  ) => Promise<void>

  // Shell 相关
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>

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
    }
  }
}
```

#### tool.definition - 修改工具定义

```typescript
export default async function myPlugin(input) {
  return {
    "tool.definition": async (input, output) => {
      if (input.toolID === "myTool") {
        // 修改工具描述和参数定义
        output.description = "Custom description for the LLM"
        output.parameters = { ... } // 修改发送给 LLM 的参数 schema
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
        // 添加元数据
        output.metadata.readLength = output.output.length
      }
    }
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
    }
  }
}
```

#### chat.headers - 修改请求头

```typescript
export default async function myPlugin(input) {
  return {
    "chat.headers": async (input, output) => {
      // 为特定 provider 添加自定义头
      if (input.model.providerID === "my-provider") {
        output.headers["X-Custom-Header"] = "value"
      }
    }
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
    }
  }
}
```

---

## 认证集成

### AuthHook 结构

```typescript
export type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: AuthMethod[]
}

type AuthMethod = 
  | {
      type: "oauth"
      label: string
      prompts?: Prompt[]
      authorize(inputs?: Record<string, string>): Promise<AuthOuathResult>
    }
  | {
      type: "api"
      label: string
      prompts?: Prompt[]
      authorize?(inputs?: Record<string, string>): Promise<AuthResult>
    }
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
            // 拦截并修改请求
            const req = new Request(requestInput, init)
            req.headers.set("Authorization", `Bearer ${auth.access}`)
            return fetch(req)
          }
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
                // 处理回调，获取 token
                const tokens = await exchangeCodeForTokens(code)
                return {
                  type: "success",
                  refresh: tokens.refresh_token,
                  access: tokens.access_token,
                  expires: Date.now() + tokens.expires_in * 1000,
                }
              }
            }
          }
        }
      ]
    }
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

---

## 最佳实践与示例

### 完整的插件示例

```typescript
// my-opencode-plugin.ts
import { tool } from "@opencode-ai/plugin/tool"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

// 定义自定义工具
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
      metadata: { operation: args.operation }
    })
    
    // 实现你的逻辑
    return `Operation ${args.operation} completed with value: ${args.value}`
  }
})

// 定义自定义 Agent 使用的工具
const AnalysisTool = tool({
  description: "Analyze code structure",
  args: {
    filePath: z.string().describe("File to analyze"),
  },
  async execute(args, context) {
    // 分析逻辑
    return analyzeCode(args.filePath, context.directory)
  }
})

// 插件主函数
export default async function myPlugin(input): Promise<Hooks> {
  return {
    // 注册工具
    tool: {
      myTool: MyTool,
      analysis: AnalysisTool,
    },
    
    // 聊天消息拦截
    "chat.message": async (input, output) => {
      console.log("New message in session:", input.sessionID)
    },
    
    // 工具执行前拦截
    "tool.execute.before": async (input, output) => {
      // 记录或修改参数
      console.log("Executing tool:", input.tool)
    },
    
    // 工具执行后拦截
    "tool.execute.after": async (input, output) => {
      // 处理结果或添加元数据
      output.metadata.executedAt = Date.now()
    },
    
    // 修改请求头
    "chat.headers": async (input, output) => {
      if (input.model.providerID === "openai") {
        output.headers["X-Custom-Header"] = "plugin-value"
      }
    },
    
    // 自定义 shell 环境
    "shell.env": async (input, output) => {
      output.env = {
        ...output.env,
        PLUGIN_ENV: "enabled",
      }
    },
  }
}
```

### 配置文件

```jsonc
// opencode.jsonc
{
  "plugin": [
    // NPM 插件
    "my-opencode-plugin@1.0.0",
    
    // 本地插件 (放在 {tool,tools} 目录)
    // 不需要在这里注册，会自动发现
  ],
  
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
        "bash": "ask"
      }
    }
  }
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

#### 1. 包装现有工具

```typescript
export const WrappedReadTool = tool({
  description: "Read file with custom processing",
  args: {
    filePath: z.string(),
  },
  async execute(args, context) {
    // 添加自定义处理逻辑
    const content = await originalReadTool.execute(args, context)
    return processContent(content)
  }
})
```

#### 2. 条件性启用功能

```typescript
export default async function myPlugin(input): Promise<Hooks> {
  const config = await input.client.config.get()
  
  if (!config.features?.myFeature) {
    return {} // 功能未启用，返回空 hooks
  }
  
  return {
    tool: { myTool: MyTool }
  }
}
```

#### 3. 错误处理

```typescript
export default async function myPlugin(input): Promise<Hooks> {
  return {
    "tool.execute.after": async (input, output) => {
      try {
        // 处理逻辑
      } catch (error) {
        // 记录错误但不影响原流程
        console.error("Plugin error:", error)
      }
    }
  }
}
```

---

## 总结

本文档涵盖了 OpenCode 插件开发的核心概念：

1. **Tool 开发**: 使用 `tool()` 函数定义，带参数 schema 和执行函数
2. **Agent 系统**: 支持 primary、subagent、hidden 三种模式
3. **子代理编排**: 通过 Task Tool 实现主 Agent 调用子 Agent
4. **权限系统**: 细粒度的 allow/deny/ask 规则
5. **Hooks 回调**: 丰富的生命周期钩子用于扩展功能
6. **认证集成**: 支持 OAuth 和 API Key 两种认证方式

更多示例请参考内置插件：
- `packages/opencode/src/plugin/codex.ts` - Codex 认证插件
- `packages/opencode/src/plugin/copilot.ts` - GitHub Copilot 认证插件