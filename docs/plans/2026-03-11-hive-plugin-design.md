# Hive Plugin Design — 自治域Agent协作系统

> Date: 2026-03-11
> Status: Draft
> Approach: Dynamic Domain Discovery + EventBus Coordination + Autonomous Execution

## 1. Problem

现有的多Agent编排系统（Commander 4-agent、Emperor 11-agent）有一个共同假设：**Agent的角色是固定的、按职能划分的**（Lead/Coder/Tester 或 中书/门下/六部）。这在通用场景下有效，但忽略了一个关键事实：

**真实项目中的知识边界不是按"编码/测试/审查"划分的，而是按"领域"划分的。**

一个全栈项目里，Frontend工程师和Backend工程师的差异不在于"谁写代码谁测试"，而在于他们各自深度理解不同的技术栈、模式和约束。当需求跨越多个领域时，最有效的协作方式不是一个全知的Lead分配任务，而是**各领域专家自主判断、互相协商、并行执行**。

### 具体痛点

1. **单Agent全栈困境**：一个Agent负责整个项目时，context window里塞满了无关信息（改前端时不需要看数据库schema），导致注意力稀释
2. **中心化调度瓶颈**：Lead/太子需要理解所有领域才能做出好的规划，但LLM对不熟悉领域的规划质量低
3. **无法自治**：当模块A的API变更时，依赖它的模块B不会自动适配——必须有人手动触发
4. **知识不沉淀**：每次任务从零开始，Agent不记得"上次改这个模块时需要注意什么"

## 2. Solution

Hive是一个OpenCode插件，核心理念：

> **每个项目的逻辑Domain是一个自治Agent，通过EventBus协商协作，可主动感知变更并自主执行修改。**

三层能力：

```
层级1: 感知 (Perception)     — Domain Agent知道"这个变更和我有关"
层级2: 协商 (Negotiation)    — Domain Agent之间通过事件协商接口和协作方式
层级3: 自主执行 (Autonomous) — Domain Agent自行修改自己领域的代码并验证
```

### 与Commander/Emperor的关系

完全独立。不复用、不依赖。设计哲学不同：

| | Commander | Emperor | Hive |
|--|-----------|---------|------|
| 角色划分 | 按职能 | 按官职 | 按项目领域 |
| Agent来源 | 固定4个 | 固定11个 | 动态发现 |
| 协调方式 | Lead统一调度 | Pipeline流转 | EventBus协商 |
| 自治能力 | 无 | 无 | 完全自主 |
| 知识范围 | Coder全栈 | 六部各司其职 | 每个Agent只深度了解自己的Domain |

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Hive Plugin                              │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │   Discovery   │  │   EventBus   │  │   Agent Generator    │  │
│  │              │  │              │  │                       │  │
│  │ Static Scan  │  │  publish()   │  │ Config → AgentConfig  │  │
│  │ LLM Analysis │  │  subscribe() │  │ Prompt Engineering    │  │
│  │ User Config  │  │  consume()   │  │ Tool Assignment       │  │
│  │ Cache Layer  │  │  persist()   │  │                       │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬────────────┘  │
│         │                 │                     │               │
│         │     ┌───────────┴──────────┐          │               │
│         │     │                      │          │               │
│         ▼     ▼                      ▼          ▼               │
│  ┌────────────────────────────────────────────────────────┐     │
│  │                   Runtime Layer                         │     │
│  │                                                         │     │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │     │
│  │  │  Queen   │  │ Domain  │  │ Domain  │  │ Domain  │   │     │
│  │  │ (coord.) │  │ Agent A │  │ Agent B │  │ Agent N │   │     │
│  │  │ primary  │  │  "all"  │  │  "all"  │  │  "all"  │   │     │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Hook Integration                       │    │
│  │  config → 注册动态Agent                                  │    │
│  │  tool.execute.after → 文件变更感知 → EventBus            │    │
│  │  experimental.chat.system.transform → 事件注入Agent      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Tools                                  │    │
│  │  hive_emit      — Agent发布事件                          │    │
│  │  hive_broadcast — Queen广播需求到所有Domain Agent         │    │
│  │  hive_negotiate — 两个Domain Agent协商接口               │    │
│  │  hive_dispatch  — Queen派发任务给Domain Agent并行执行     │    │
│  │  hive_status    — 查看全局状态                           │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## 4. Domain Discovery System

### 4.1 三阶段发现

```
Phase 1: Static Scan (无LLM，毫秒级)
  ├─ package.json workspaces → 包边界
  ├─ pnpm-workspace.yaml / lerna.json → monorepo结构
  ├─ 目录结构启发式 (src/client, src/server, apps/, packages/)
  ├─ 配置文件指纹 (next.config, vite.config, Dockerfile, .github)
  └─ 依赖分析 (react → 前端, express → 后端, prisma → 数据库)

Phase 2: LLM Analysis (首次或结构变化时，10-30秒)
  ├─ 输入: Phase 1扫描结果 + 关键文件摘要(README, 入口文件, 配置文件)
  ├─ 输出: Domain定义列表 (structured JSON)
  │   ├─ id, name, description
  │   ├─ paths (管辖的文件/目录)
  │   ├─ techStack (技术栈描述)
  │   ├─ responsibilities (职责描述)
  │   ├─ interfaces (对外暴露的关键接口)
  │   ├─ dependencies (依赖哪些其他domain)
  │   └─ conventions (编码约定、已知约束)
  └─ 缓存到 .hive/domains.json (带 structureHash 校验)

Phase 3: User Override (可选)
  └─ hive.json: 用户可覆盖/补充/删除自动发现的domain
```

### 4.2 缓存策略

```typescript
interface DomainCache {
  structureHash: string  // git ls-files 的 hash，检测项目结构变化
  discoveredAt: number
  domains: Domain[]
}

// 启动时:
// 1. 计算当前 structureHash
// 2. 与缓存比较
// 3. 一致 → 直接用缓存
// 4. 不一致 → 用Phase 1结果先启动(快)，后台跑Phase 2更新缓存
```

### 4.3 用户配置 (hive.json)

```jsonc
// .opencode/hive.json
{
  // 覆盖自动发现的domain
  "domains": {
    "frontend": {
      "paths": ["src/client/", "src/components/"],
      "description": "React 18 + Zustand + Shadcn UI前端应用",
      "techStack": "React 18, TypeScript, Zustand, Shadcn UI, React Router v6",
      "conventions": [
        "组件使用函数组件 + hooks",
        "状态管理统一用Zustand",
        "UI组件基于Shadcn，不要引入其他UI库"
      ]
    },
    // 显式禁用某个自动发现的domain
    "docs": { "disabled": true }
  },

  // 全局配置
  "discovery": {
    "model": "anthropic/claude-sonnet-4-20250514",  // 用于LLM分析的模型
    "autoRefresh": true   // 结构变化时自动重新分析
  },

  "coordination": {
    "autonomyLevel": "full"  // "passive" | "propose" | "full"
  },

  "queen": {
    "model": "anthropic/claude-sonnet-4-20250514"
  }
}
```

## 5. Dynamic Agent Creation

### 5.1 Domain → AgentConfig 映射

```typescript
function buildDomainAgent(domain: Domain): AgentConfig {
  return {
    name: domain.id,
    description: `${domain.name} — ${domain.description}`,
    mode: "all",  // 可被@直接对话，也可被Queen调用
    color: generateColor(domain.id),
    prompt: buildDomainPrompt(domain),
    tools: assignTools(domain),
    maxSteps: 50,
    permission: {
      read: "allow",
      grep: "allow",
      glob: "allow",
      edit: "allow",
      write: "allow",
      bash: "allow",
    },
  }
}
```

### 5.2 Domain Agent Prompt 结构

```typescript
function buildDomainPrompt(domain: Domain): string {
  return `你是 ${domain.name} 的领域专家Agent。

## 你的领域
- **职责**: ${domain.responsibilities}
- **技术栈**: ${domain.techStack}
- **管辖范围**: ${domain.paths.join(", ")}
- **对外接口**: ${domain.interfaces.join(", ")}
- **依赖的Domain**: ${domain.dependencies.join(", ")}

## 编码约定
${domain.conventions.map(c => `- ${c}`).join("\n")}

## 行为准则

### 1. 感知 (Perception)
当你收到来自其他Domain的通知(📬)时，评估是否影响你的领域：
- 接口变更 → 检查你的代码是否使用了该接口
- 文件变更 → 检查是否影响你的依赖
- 需求广播 → 评估是否与你的职责相关

### 2. 协商 (Negotiation)
当你需要其他Domain的配合时：
- 使用 hive_emit 工具发送 interface_proposal 事件
- 明确说明你需要的接口格式、参数和返回值
- 等待对方确认后再基于该接口开发

### 3. 自主执行 (Autonomous Execution)
你有完整的代码修改能力。执行流程：
1. 分析需求对你领域的影响
2. 阅读相关代码，理解现状
3. 制定修改计划
4. 实现修改
5. 运行构建/测试验证
6. 通过 hive_emit 通知其他Domain你的变更

### 4. 边界意识
- ✅ 修改你管辖范围内的文件
- ✅ 阅读任何文件（理解上下文）
- ⚠️ 修改共享文件(如根目录配置)前，通过 hive_emit 通知相关Domain
- ❌ 不要修改其他Domain管辖的文件

### 5. 主动维护
当你感知到以下情况时，即使没有用户指令也应主动行动：
- 你依赖的Domain发布了 breaking_change 事件
- 你的领域内出现了构建错误或测试失败
- 通过 hive_emit 先发送 action_proposal 说明你打算做什么，然后执行
`
}
```

### 5.3 Queen (Coordinator) Agent

```typescript
const queenAgent: AgentConfig = {
  name: "queen",
  description: "Hive Coordinator — 理解项目全局，协调各Domain Agent",
  mode: "primary",
  prompt: `你是 Hive 的协调者（Queen）。你理解项目的整体架构，负责：

## 已注册的Domain Agent
${domains.map(d => `- **@${d.id}**: ${d.description} (管辖: ${d.paths.join(", ")})`).join("\n")}

## Domain间依赖关系
${buildDependencyGraph(domains)}

## 你的职责

### 1. 需求分析与分发
当用户提出需求时：
1. 使用 hive_broadcast 向所有Domain Agent广播需求
2. 收集各Agent的相关性评估和初步计划
3. 识别跨Domain的依赖和接口需求
4. 使用 hive_negotiate 让相关Domain协商接口
5. 使用 hive_dispatch 并行派发任务

### 2. 协调冲突
- 当两个Domain Agent对同一文件有修改需求时，协调顺序
- 当接口协商未达成一致时，介入决策
- 当某个Domain Agent执行失败时，协调重试或降级

### 3. 汇总报告
所有Domain Agent完成后，汇总各领域的变更，输出统一报告。

## 禁止事项
- ❌ 不要自己写代码 — 你是协调者，不是执行者
- ❌ 不要替Domain Agent做领域决策 — 它们比你更了解自己的领域
- ❌ 不要跳过广播直接指定Domain — 让每个Agent自主判断相关性
`,
}
```

## 6. EventBus — Agent间通信系统

### 6.1 事件类型

```typescript
type EventType =
  // === 需求流转 ===
  | "requirement_broadcast"     // Queen → All: 新需求广播
  | "relevance_response"        // Domain → Queen: 相关性评估回复

  // === 接口协商 ===
  | "interface_proposal"        // Domain A → Domain B: 我需要/提供某个接口
  | "interface_accepted"        // Domain B → Domain A: 接受接口定义
  | "interface_rejected"        // Domain B → Domain A: 拒绝并给出替代方案

  // === 执行通知 ===
  | "task_started"              // Domain: 我开始做X
  | "task_completed"            // Domain: 我完成了X
  | "task_failed"               // Domain: X失败了，原因...

  // === 变更感知 ===
  | "file_changed"              // 系统自动: 某文件被修改
  | "breaking_change"           // Domain: 我的接口有破坏性变更
  | "dependency_updated"        // 系统自动: package依赖更新

  // === 自治行为 ===
  | "action_proposal"           // Domain: 我打算主动做X（自治模式）
  | "action_completed"          // Domain: 我主动完成了X

  // === 协调 ===
  | "help_request"              // Domain A → Domain B: 请求帮助
  | "conflict_detected"         // 系统/Agent: 检测到冲突
```

### 6.2 EventBus 实现

```typescript
interface HiveEvent {
  id: string
  type: EventType
  source: string        // 发布者domain id 或 "system" 或 "queen"
  target: string        // 目标domain id 或 "*"(广播)
  payload: {
    message: string     // 人类可读的描述
    data?: any          // 结构化数据
  }
  timestamp: number
  consumed: string[]    // 已消费的domain ids
  status: "pending" | "consumed" | "expired"
}

class HiveEventBus {
  private events: HiveEvent[] = []
  private subscriptions: Map<string, Set<EventType>> = new Map()
  private persistPath: string  // .hive/events.json

  // === 订阅管理 ===

  // Agent创建时自动调用
  autoSubscribe(domain: Domain): void {
    const types = new Set<EventType>()

    // 所有Agent都监听的事件
    types.add("requirement_broadcast")
    types.add("conflict_detected")

    // 依赖方变更通知
    for (const dep of domain.dependencies) {
      types.add("breaking_change")
      types.add("interface_proposal")
    }

    // 被依赖方需要知道谁在用自己
    types.add("interface_proposal")

    // 自治相关
    types.add("action_proposal")

    this.subscriptions.set(domain.id, types)
  }

  // === 发布/消费 ===

  publish(event: Omit<HiveEvent, "id" | "timestamp" | "consumed" | "status">): string {
    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const fullEvent: HiveEvent = {
      ...event,
      id,
      timestamp: Date.now(),
      consumed: [],
      status: "pending",
    }
    this.events.push(fullEvent)
    this.persist()
    return id
  }

  consume(domainId: string): HiveEvent[] {
    const subTypes = this.subscriptions.get(domainId)
    if (!subTypes) return []

    const pending = this.events.filter(e => {
      if (e.status === "expired") return false
      if (e.consumed.includes(domainId)) return false
      if (e.source === domainId) return false   // 不收自己发的
      // 精确目标 或 广播 或 订阅的类型
      const isTargeted = e.target === domainId
      const isBroadcast = e.target === "*"
      const isSubscribed = subTypes.has(e.type as EventType)
      return isTargeted || (isBroadcast && isSubscribed)
    })

    for (const e of pending) {
      e.consumed.push(domainId)
    }
    this.persist()
    return pending
  }

  // === 持久化 ===

  persist(): void {
    // 写入 .hive/events.json
    // 清理超过1小时的已消费事件
  }

  restore(): void {
    // 启动时从 .hive/events.json 恢复
    // 未消费的事件继续投递
  }
}
```

### 6.3 事件投递机制

事件通过两个通道投递到Agent：

```
通道1: System Prompt注入 (被动、自动)
  experimental.chat.system.transform hook
  → Agent每次收到消息前，自动注入待处理事件
  → Agent感知不到EventBus的存在，自然基于事件决策

通道2: hive_emit Tool (主动、显式)
  Agent主动调用 hive_emit → EventBus.publish()
  → 其他Agent在下次交互时通过通道1收到
```

```typescript
// 通道1实现
"experimental.chat.system.transform": async (input, output) => {
  const domainId = sessionToDomain.get(input.sessionID)
  if (!domainId) return

  const pending = eventBus.consume(domainId)
  if (pending.length === 0) return

  const notification = pending.map(e =>
    `[${e.source}] (${e.type}) ${e.payload.message}`
  ).join("\n")

  output.system.push(`
## 📬 来自其他Domain的通知

${notification}

请根据以上通知评估是否需要采取行动。如果需要修改代码或回应其他Domain，请先分析再执行。
`)
}
```

## 7. Tools

### 7.1 hive_emit — Agent发布事件

```typescript
const hiveEmitTool = tool({
  description: `发布事件到其他Domain Agent。用于通知接口变更、请求协助、宣告任务完成等。`,
  args: {
    type: tool.schema.enum([
      "interface_proposal",
      "interface_accepted",
      "interface_rejected",
      "task_started",
      "task_completed",
      "task_failed",
      "breaking_change",
      "action_proposal",
      "action_completed",
      "help_request",
      "info",
    ]),
    target: tool.schema.string()
      .describe('目标domain id，或 "*" 广播给所有'),
    message: tool.schema.string()
      .describe("事件内容，要具体到其他Agent能据此行动"),
    data: tool.schema.any().optional()
      .describe("结构化数据（如接口定义的JSON schema）"),
  },
  async execute(args, context) {
    const source = sessionToDomain.get(context.sessionID)
    if (!source) return "❌ 当前session不属于任何Domain Agent"

    const eventId = eventBus.publish({
      type: args.type as EventType,
      source,
      target: args.target,
      payload: { message: args.message, data: args.data },
    })

    return `✅ 事件已发布 (${eventId}) → ${args.target === "*" ? "所有Domain" : args.target}`
  },
})
```

### 7.2 hive_broadcast — Queen广播需求

```typescript
const hiveBroadcastTool = tool({
  description: `[Queen专用] 向所有Domain Agent广播需求，收集各Agent的相关性评估。`,
  args: {
    requirement: tool.schema.string()
      .describe("需求描述"),
    context: tool.schema.string().optional()
      .describe("补充上下文"),
  },
  async execute(args, ctx) {
    // 1. 发布广播事件
    eventBus.publish({
      type: "requirement_broadcast",
      source: "queen",
      target: "*",
      payload: { message: args.requirement, data: { context: args.context } },
    })

    // 2. 逐个询问Domain Agent相关性
    const assessments: Assessment[] = []
    for (const domain of domains) {
      const session = await client.session.create({
        body: { title: `Hive·${domain.name}·感知` },
      })
      sessionToDomain.set(session.data.id, domain.id)

      const result = await client.session.prompt({
        path: { id: session.data.id },
        body: {
          content: `新需求: "${args.requirement}"

请评估这个需求与你的领域(${domain.name})的相关性。回复JSON:
{
  "relevant": true/false,
  "reason": "原因",
  "impact": "low/medium/high",
  "plan": "如果相关，你打算怎么做（简要）",
  "needsFrom": ["其他domain id"] // 你需要哪些domain配合
}`,
          agent: domain.id,
        },
      })

      assessments.push(parseAssessment(result, domain))
    }

    // 3. 返回汇总
    return formatAssessments(assessments)
  },
})
```

### 7.3 hive_negotiate — 接口协商

```typescript
const hiveNegotiateTool = tool({
  description: `[Queen专用] 让两个Domain Agent协商接口定义。`,
  args: {
    requester: tool.schema.string().describe("需要接口的domain id"),
    provider: tool.schema.string().describe("提供接口的domain id"),
    requirement: tool.schema.string().describe("接口需求描述"),
  },
  async execute(args, ctx) {
    // 1. 让requester详细描述需求
    const requestDetail = await promptDomain(args.requester,
      `你需要 ${args.provider} 提供接口: "${args.requirement}"。
       请给出具体的接口定义（路径、方法、参数、返回值、错误码）。`)

    // 2. 让provider评估并回复
    const providerResponse = await promptDomain(args.provider,
      `${args.requester} 请求你提供以下接口:\n${requestDetail}\n
       请评估：1) 是否可以提供 2) 如需调整，给出你的方案`)

    // 3. 如果有分歧，再协商一轮
    // ...

    // 4. 双方达成一致后，发布接口确认事件
    eventBus.publish({
      type: "interface_accepted",
      source: args.provider,
      target: args.requester,
      payload: { message: "接口协商完成", data: { contract: finalContract } },
    })

    return formatNegotiationResult(requestDetail, providerResponse)
  },
})
```

### 7.4 hive_dispatch — 并行派发执行

```typescript
const hiveDispatchTool = tool({
  description: `[Queen专用] 向指定的Domain Agent派发任务并行执行。`,
  args: {
    tasks: tool.schema.array(tool.schema.object({
      domain: tool.schema.string().describe("目标domain id"),
      instruction: tool.schema.string().describe("具体执行指令"),
    })).describe("要派发的任务列表"),
  },
  async execute(args, ctx) {
    // 并行创建session并执行
    const results = await Promise.all(
      args.tasks.map(async (task) => {
        const session = await client.session.create({
          body: { title: `Hive·${task.domain}·执行` },
        })
        sessionToDomain.set(session.data.id, task.domain)

        // 发布开始事件
        eventBus.publish({
          type: "task_started",
          source: task.domain,
          target: "*",
          payload: { message: task.instruction },
        })

        const result = await client.session.prompt({
          path: { id: session.data.id },
          body: { content: task.instruction, agent: task.domain },
        })

        // 发布完成事件
        eventBus.publish({
          type: "task_completed",
          source: task.domain,
          target: "*",
          payload: { message: `完成: ${task.instruction}`, data: { result } },
        })

        return { domain: task.domain, result }
      })
    )

    return formatDispatchResults(results)
  },
})
```

### 7.5 hive_status — 全局状态

```typescript
const hiveStatusTool = tool({
  description: `查看Hive全局状态：已注册Domain、活跃事件、进行中任务。`,
  args: {
    detail: tool.schema.enum(["overview", "events", "domains"]).optional()
      .describe("查看详情类型，默认overview"),
  },
  async execute(args, ctx) {
    // 返回当前状态
  },
})
```

## 8. Hook Integration

### 8.1 文件变更自动感知

```typescript
"tool.execute.after": async (input, output) => {
  if (!["write", "edit"].includes(input.tool)) return

  const filePath = input.args?.filePath
  if (!filePath) return

  // 判断文件属于哪个domain
  const ownerDomain = findDomainByPath(filePath)
  const sourceDomain = sessionToDomain.get(input.sessionID)

  // 自动发布文件变更事件
  eventBus.publish({
    type: "file_changed",
    source: sourceDomain ?? "unknown",
    target: "*",
    payload: {
      message: `文件 ${filePath} 被修改 (by ${sourceDomain ?? "user"})`,
      data: { filePath, owner: ownerDomain },
    },
  })
}
```

### 8.2 自治模式 — 主动响应变更

当Domain Agent收到 `breaking_change` 或 `dependency_updated` 事件时，如果autonomyLevel为"full"，Plugin主动创建session让Agent处理：

```typescript
// 在EventBus内部，当发布breaking_change时
onPublish(event: HiveEvent) {
  if (event.type === "breaking_change" && config.autonomyLevel === "full") {
    // 找到所有依赖source的domain
    const dependents = domains.filter(d => d.dependencies.includes(event.source))

    for (const dep of dependents) {
      // 主动创建session让dependent agent适配变更
      const session = await client.session.create({
        body: { title: `Hive·${dep.id}·自动适配` },
      })
      sessionToDomain.set(session.data.id, dep.id)

      await client.session.prompt({
        path: { id: session.data.id },
        body: {
          content: `⚠️ 你依赖的 ${event.source} 发生了破坏性变更:
${event.payload.message}

请检查你领域内的代码是否受影响，如果受影响请自主修复。
修复前先发送 action_proposal 事件说明你的计划。`,
          agent: dep.id,
        },
      })
    }
  }
}
```

## 9. Data Structures

```typescript
// === Domain 定义 ===
interface Domain {
  id: string                    // 唯一标识，用作agent name (如 "frontend", "backend")
  name: string                  // 显示名称
  description: string           // 一句话描述
  paths: string[]               // 管辖的文件/目录路径
  techStack: string             // 技术栈描述
  responsibilities: string      // 职责描述
  interfaces: string[]          // 对外暴露的关键接口
  dependencies: string[]        // 依赖的其他domain ids
  conventions: string[]         // 编码约定
  disabled?: boolean            // 是否禁用
}

// === Discovery 缓存 ===
interface DomainCache {
  structureHash: string
  discoveredAt: number
  source: "static" | "llm" | "user"
  domains: Domain[]
}

// === Session 映射 ===
// sessionId → domainId，用于在hook中识别哪个Agent在操作
type SessionDomainMap = Map<string, string>

// === 配置 ===
interface HiveConfig {
  domains: Record<string, Partial<Domain> & { disabled?: boolean }>
  discovery: {
    model: string
    autoRefresh: boolean
  }
  coordination: {
    autonomyLevel: "passive" | "propose" | "full"
  }
  queen: {
    model: string
  }
  store: {
    dataDir: string  // 默认 ".hive"
  }
}
```

## 10. File Structure

```
.opencode/plugins/hive/
├── index.ts                # Plugin入口，注册hooks + tools
├── types.ts                # 全局类型定义
├── config.ts               # 配置加载 (hive.json + defaults)
│
├── discovery/
│   ├── scanner.ts          # Phase 1: 静态扫描
│   ├── analyzer.ts         # Phase 2: LLM分析
│   ├── merger.ts           # Phase 3: 合并用户配置
│   └── cache.ts            # 缓存管理
│
├── agents/
│   ├── generator.ts        # Domain → AgentConfig 生成器
│   ├── queen.ts            # Queen agent prompt模板
│   └── prompts.ts          # Domain agent prompt模板
│
├── eventbus/
│   ├── bus.ts              # EventBus核心实现
│   ├── types.ts            # 事件类型定义
│   ├── subscriptions.ts    # 订阅管理
│   └── persistence.ts      # 事件持久化
│
├── tools/
│   ├── emit.ts             # hive_emit
│   ├── broadcast.ts        # hive_broadcast
│   ├── negotiate.ts        # hive_negotiate
│   ├── dispatch.ts         # hive_dispatch
│   └── status.ts           # hive_status
│
├── hooks/
│   ├── config.ts           # config hook: 动态注册agent
│   ├── system-transform.ts # 事件注入agent context
│   ├── file-watcher.ts     # tool.execute.after: 文件变更感知
│   └── autonomy.ts         # 自治模式: 主动响应变更
│
└── store.ts                # .hive/ 目录管理
```

## 11. Execution Pipeline

### 11.1 用户发起模式

```
User: @queen 给项目加OAuth2登录

Queen:
  1. hive_broadcast("给项目加OAuth2登录")
     → 所有Domain Agent收到广播，评估相关性
     → 返回: frontend(高相关), backend(高相关), infra(低相关), docs(低相关)

  2. 识别跨域依赖:
     frontend需要backend的API → 需要协商

  3. hive_negotiate(requester="frontend", provider="backend", ...)
     → frontend: "我需要 GET /auth/oauth/callback"
     → backend: "OK，我提供 GET /auth/oauth/callback, 返回 {token, user}"
     → 达成一致

  4. hive_dispatch([
       {domain: "backend", instruction: "实现OAuth2 callback接口..."},
       {domain: "frontend", instruction: "实现OAuth登录页面..."},
     ])
     → 并行执行

  5. 汇总报告
```

### 11.2 直接对话模式

```
User: @frontend 给DatePicker加range选择功能

Frontend Agent:
  1. 直接处理（不经过Queen）
  2. 分析 → 实现 → 验证
  3. 如果改动影响接口:
     → hive_emit(type: "interface_proposal", ...)
     → 其他Agent下次交互时自动感知
```

### 11.3 自治模式

```
Backend Agent 修改了API返回格式:
  → hive_emit(type: "breaking_change", target: "*", ...)
  → EventBus检测到autonomyLevel="full"
  → 自动创建session让frontend Agent适配
  → Frontend Agent:
      1. action_proposal: "后端API格式变了，我需要更新数据解析"
      2. 修改代码
      3. 运行测试
      4. action_completed: "已适配新API格式"
```

## 12. Error Handling

| 场景 | 处理方式 |
|------|---------|
| LLM分析失败 | fallback到静态扫描结果，下次启动重试 |
| Domain Agent执行失败 | 标记task_failed事件，Queen决定重试或跳过 |
| 接口协商失败（3轮未达成一致） | Queen介入，做最终决策 |
| EventBus持久化失败 | 降级为内存模式，打印警告 |
| 自治模式Agent修改导致构建失败 | 自动revert，发送help_request事件 |
| session创建失败 | 重试2次，失败则标记domain暂不可用 |
| 用户叫停 | abort所有活跃session，发布halt事件 |

## 13. Design Decisions

1. **Agent mode 选 "all" 而非 "subagent"** — Domain Agent既能被Queen通过session.prompt()调用，也能被用户直接@对话。灵活性优先。

2. **EventBus在Plugin内部实现，不依赖外部** — 零依赖，跟随Plugin生命周期，持久化用JSON文件即可。

3. **事件投递用system prompt注入，不用Tool** — Agent不需要主动"检查邮箱"，事件自动出现在context里，更自然。发布才用Tool（显式行为）。

4. **Discovery采用三阶段混合策略** — 纯静态（速度）+ LLM增强（质量）+ 用户配置（精度），三者互补。

5. **Queen不写代码** — 严格的协调者角色。领域专家做领域决策，Queen只做协调决策。避免"全知全能Lead"的问题。

6. **完全自主模式作为配置项** — autonomyLevel可选passive/propose/full，让用户控制Agent的主动性程度。

7. **Session-Domain映射** — 维护sessionId到domainId的映射表，使hook能识别"这是哪个Agent在操作"。

## 14. Future Extensions

- Domain Agent记忆系统：每次任务结束提炼经验 → 下次注入prompt
- Domain健康度监控：构建成功率、测试通过率
- 跨项目Domain模板：common patterns可复用（如"React前端"模板）
- EventBus可视化：TUI展示实时事件流
- Domain Agent间直接对话（绕过Queen的P2P协商）
