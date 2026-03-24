import type { Plugin } from "sjz-opencode-sdk"
import type { Domain } from "./types"
import { loadConfig } from "./config"
import { HiveEventBus } from "./eventbus/bus"
import { discoverDomains, reloadDomains } from "./discovery/index"
import { generateAgents } from "./agents/index"
import { createEmitTool } from "./tools/emit"
import { createStatusTool } from "./tools/status"
import { createBroadcastTool } from "./tools/broadcast"
import { createNegotiateTool } from "./tools/negotiate"
import { createDispatchTool } from "./tools/dispatch"
import { createConfigHook } from "./hooks/config"
import { createSystemTransformHook } from "./hooks/system-transform"
import { createFileWatcherHook } from "./hooks/file-watcher"
import { createAutonomyHandler } from "./hooks/autonomy"
import { HiveStore } from "./store"
import { HivePipeline } from "./pipeline"
import { createRunTool } from "./tools/run"
import { createEventReactorHook } from "./hooks/event-reactor"

export const HivePlugin: Plugin = async ({ client, directory, registerAgent, registerCommand }) => {
  const config = loadConfig(directory)
  const store = new HiveStore(directory, config.store.dataDir)

  // EventBus with persistence
  const eventBus = new HiveEventBus(
    (events) => store.saveEvents(events),
    () => store.loadEvents(),
  )
  eventBus.restore()

  // Session → Domain mapping
  const sessionToDomain = new Map<string, string>()

  const discoveredDomains = discoverDomains(directory, config, registerAgent)

  const PROJECT_DOMAIN: Domain = {
    id: "project",
    name: "Project",
    description: "项目级通用域：根目录配置、共享代码、新模块初始化、跨域杂项",
    paths: [],
    techStack: "",
    responsibilities: "根目录配置文件、共享工具代码、新模块搭建、不属于任何专业域的任务",
    interfaces: [],
    dependencies: [],
    conventions: [],
  }
  const domains = discoveredDomains.some(d => d.id === "project")
    ? discoveredDomains
    : [PROJECT_DOMAIN, ...discoveredDomains]

  // Subscribe domains to EventBus
  for (const domain of domains) {
    eventBus.autoSubscribe(domain)
  }

  // Generate agent configs
  const agents = generateAgents(domains, config)

  // Set up autonomy handler
  const autonomyHandler = createAutonomyHandler(
    eventBus, domains, config, client, sessionToDomain,
  )

  // Initialize Hive pipeline (wire-up once pipeline.ts is available)
  const pipeline = new HivePipeline(eventBus, domains, client, sessionToDomain, config)

  // Register slash command
  try {
    await registerCommand({
      name: "hive-init",
      description: "初始化 Hive：创建配置文件、存储目录和自动发现项目中的 Domain",
      subtask: true,
      template: `
请执行 Hive 初始化任务。

## 用户参数
$ARGUMENTS (如 --force 表示强制覆盖)

## 任务说明

### 1. 检查现有文件
检查以下文件是否已存在:
- .opencode/hive.json
- .hive/domains.json

如果文件存在且用户没有 --force 参数 → 跳过并报告已存在
如果文件存在且用户有 --force 参数 → 覆盖
如果不存在 → 创建

### 2. 创建配置文件 .opencode/hive.json
内容如下:
{
  "discovery": { "autoRefresh": true },
  "coordination": { "autonomyLevel": "full" },
  "queen": {},
  "store": { "dataDir": ".hive" }
}

### 3. 创建存储目录 .hive

### 4. 发现并生成 domains.json

#### 4.1 分析项目结构

首先识别项目的语言、构建系统和整体架构。

**Step 1: 读取关键文件**
用 bash 列出根目录结构 (ls -la)，然后读取以下文件（如果存在）：
- README.md — 项目描述和功能
- 构建配置（见下方语言检测表）
- docs/ 目录下的架构文档

**Step 2: 识别语言和构建系统**

| 标志文件 | 语言/生态 | 额外检测 |
|----------|----------|---------|
| package.json | JavaScript/TypeScript | 检查 workspaces、dependencies |
| go.mod | Go | 检查 cmd/, internal/, pkg/ 目录 |
| Cargo.toml | Rust | 检查 workspace members、crates/ 目录 |
| pyproject.toml / setup.py / requirements.txt | Python | 检查 src/, app/, tests/ 目录 |
| pom.xml / build.gradle / build.gradle.kts | Java/Kotlin | 检查 src/main/java, modules/ 目录 |
| *.csproj / *.sln | C# / .NET | 检查 src/, Controllers/, Services/ |
| CMakeLists.txt / Makefile | C/C++ | 检查 src/, include/, lib/ 目录 |
| mix.exs | Elixir | 检查 lib/, priv/ 目录 |
| pubspec.yaml | Dart/Flutter | 检查 lib/, test/ 目录 |

如果同时存在多种标志文件，说明是多语言项目，每种语言可能对应不同的 Domain。

#### 4.2 Domain 发现方法论

Domain 的本质是"一个相对独立的职责单元，有明确的代码边界"。发现 Domain 的核心方法：

**方法 1: 模块边界发现**
寻找项目中自然存在的模块边界：
- Monorepo workspace 中的每个 package/app → 独立 Domain
- 编程语言的模块系统（Go 的 internal package、Rust 的 crate、Java 的 module）
- 顶层目录的职责划分（cmd/ vs lib/ vs web/）

**方法 2: 职责分层发现**
按软件架构分层寻找边界：
- 表现层（UI、CLI、API handler）
- 业务逻辑层（service、usecase、domain model）
- 数据层（repository、database、migration）
- 基础设施层（CI/CD、部署、监控）

**方法 3: 技术栈分界发现**
不同技术栈的代码自然形成边界：
- 前端代码（React/Vue/Template）vs 后端代码（API server）
- 应用代码 vs 基础设施代码（Dockerfile、Terraform、Helm）
- 主应用 vs SDK/库代码

#### 4.3 各语言发现示例

以下是不同语言项目的 Domain 发现参考，实际分析时根据项目结构灵活判断，不要生搬硬套：

**Go 项目:**
- cmd/ 下的每个子目录 → 独立的可执行文件 Domain（如 cmd/api, cmd/worker）
- internal/ → 内部业务逻辑 Domain（可按子目录拆分）
- pkg/ → 共享库 Domain
- migrations/ → 数据库 Domain
- 识别依据: go.mod, go.sum, cmd/ 目录结构

**Rust 项目:**
- crates/ 或 workspace members → 每个 crate 一个 Domain
- src/lib.rs + src/main.rs → 单 crate 项目可按模块拆分
- 识别依据: Cargo.toml [workspace] 配置

**Python 项目:**
- src/app/ 或项目名目录 → 主应用 Domain
- tests/ → 测试 Domain
- alembic/migrations/ → 数据库 Domain
- 如果是 Django: 每个 app → 独立 Domain
- 如果是 FastAPI: routers/ 按业务拆分
- 识别依据: pyproject.toml, setup.py, manage.py (Django)

**Java/Kotlin 项目:**
- 多模块 Maven/Gradle: 每个 module → 独立 Domain
- 单模块: 按 package 层级拆分（controller, service, repository）
- 识别依据: pom.xml <modules>, settings.gradle

**JavaScript/TypeScript 项目:**
- Monorepo: apps/ 和 packages/ 下的每个包 → 独立 Domain
- 全栈: 前端目录(client/frontend/src/pages) vs 后端目录(server/api/src/routes)
- 识别依据: package.json workspaces, pnpm-workspace.yaml

**通用 Domain（所有语言适用）:**
- 存在 .github/workflows, Dockerfile, Makefile → infra Domain
- 存在 docs/ → docs Domain
- 存在 **/migrations/, **/schema/ → database Domain

#### 4.4 必须生成 project Domain

无论发现了多少个专业域，domains.json 中必须包含一个 id 为 "project" 的 Domain。它是项目级兜底域，负责所有不属于其他专业域的内容。

根据对项目的实际分析，填写 project Domain 的字段：

{
  "id": "project",
  "name": "Project",
  "description": "基于对项目的实际分析，写一句话描述项目级通用域的职责",
  "paths": [],
  "techStack": "填写项目的主要技术栈",
  "responsibilities": "根目录配置文件、共享工具代码、不属于任何专业域的模块。具体列出你发现的根目录文件和共享目录",
  "interfaces": [],
  "dependencies": [],
  "conventions": ["从项目中发现的代码约定，如 linter 配置、命名风格等"]
}

#### 4.5 生成 domains.json 格式

生成 DomainCache 格式的 JSON 文件写入 .hive/domains.json:

{
  "structureHash": "基于目录结构计算的 hash（8位十六进制）",
  "discoveredAt": 当前时间戳(毫秒),
  "source": "static",
  "domains": [
    {
      "id": "唯一标识（小写字母+连字符）",
      "name": "显示名称",
      "description": "从项目宏观视角描述这个 Domain 的角色和职责",
      "paths": ["该 Domain 管辖的文件路径"],
      "techStack": "使用的技术栈",
      "responsibilities": "详细职责描述",
      "interfaces": ["对外暴露的接口：API 端点、导出的函数/类型、CLI 命令等"],
      "dependencies": ["依赖的其他 domain 的 id"],
      "conventions": ["代码约定：命名风格、架构模式、lint 规则等"]
    }
  ]
}

#### 4.6 宏观项目认知

每个 Domain 的 description 和 responsibilities 必须体现对项目整体的理解，而不是泛泛的模板化描述。

**好的描述（体现项目理解）：**
- "负责用户认证和授权流程，为前端提供 JWT token，与 user-service 协作管理会话"
- "Go API 网关，处理 HTTP 路由和中间件，调用 internal/service 层的业务逻辑"
- "Rust 核心引擎 crate，实现文件解析和 AST 转换，被 cli 和 wasm crate 依赖"

**差的描述（模板化废话）：**
- "负责后端逻辑"
- "Frontend application"
- "Database domain"

必须读取 README.md、docs/ 目录和各模块代码来补充具体描述。

### 5. 完成并报告
- 使用 bash 和 write 工具完成上述任务
- 完成后报告初始化结果:
  - 创建/覆盖的文件
  - 发现的 Domain 数量和名称
  - 每个 Domain 的 paths, techStack, responsibilities, dependencies
  - 项目的主语言和整体目标（一句话）
      `.trim(),
    })
  } catch (error) {
    console.error("[hive] Failed to register hive-init command:", error)
  }

  // Prepare hooks and tools
  const fileWatcherHook = createFileWatcherHook(
    eventBus, domains, sessionToDomain, autonomyHandler,
    directory, config, registerAgent,
  )
  const eventReactorHook = createEventReactorHook(eventBus, domains, client, sessionToDomain)

  return {
    config: createConfigHook(agents),

    "experimental.chat.system.transform": createSystemTransformHook(
      eventBus, sessionToDomain,
    ),

    // Combine file-watcher hook with event-reactor hook
    "tool.execute.after": async (input, output) => {
      await fileWatcherHook(input, output)
      await eventReactorHook(input, output)
    },

    tool: {
      hive_emit: createEmitTool(eventBus, sessionToDomain),
      hive_status: createStatusTool(domains, eventBus, pipeline),
      hive_broadcast: createBroadcastTool(eventBus, domains, client, sessionToDomain, config),
      hive_negotiate: createNegotiateTool(eventBus, domains, client, sessionToDomain),
      hive_dispatch: createDispatchTool(eventBus, domains, client, sessionToDomain),
      hive_run: createRunTool(pipeline),
    },
  }
}
