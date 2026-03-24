# Hive — 动态领域代理插件

Hive 是一个 OpenCode 插件，可自动发现项目领域（前端、后端、基础设施等），在启动时为每个领域创建 AI 代理，并通过自定义 EventBus 实现代理间的协调通信，同时支持完全自主的代码修改能力。

## 架构

```
启动 → 扫描项目 → 发现领域 → 创建领域代理 + Queen → EventBus 协调 → 自主执行
```

- **领域发现**: 静态项目扫描 + LLM 丰富 + 用户配置合并
- **EventBus**: 发布/订阅事件系统，用于代理间通信
- **Queen 协调器**: 广播需求、协调接口、分配并行任务
- **自主执行**: 领域代理可以自主适应依赖项的变更

## 快速开始

### 1. 注册插件

在 `.opencode/opencode.json` 中添加:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./plugins/hive/index.ts"
  ]
}
```

### 2. 使用

```bash
@queen 实现基于 JWT 的用户认证和基于角色的访问控制
```

Queen 代理将:
1. 向相关领域代理广播需求
2. 在领域间协调接口（如 auth ↔ API ↔ 前端）
3. 向领域代理分配并行任务
4. 监控进度并处理冲突

## 配置

在项目根目录创建 `.opencode/hive.json`:

```json
{
  "domains": {
    "frontend": {
      "name": "前端",
      "paths": ["src/ui/**", "src/components/**"],
      "techStack": "React, TypeScript",
      "responsibilities": "用户界面、组件库",
      "disabled": false
    },
    "backend": {
      "name": "后端",
      "paths": ["src/api/**", "src/services/**"],
      "techStack": "Node.js, Express",
      "responsibilities": "API 端点、业务逻辑"
    }
  },
  "discovery": {
    "model": "anthropic/claude-sonnet-4-20250514",
    "autoRefresh": true
  },
  "coordination": {
    "autonomyLevel": "full"
  },
  "queen": {
    "model": "anthropic/claude-sonnet-4-20250514"
  },
  "store": {
    "dataDir": ".hive"
  }
}
```

### 配置项说明

#### `domains`

用户定义的领域配置。这些将覆盖/扩展自动发现的领域。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 自动 | 唯一领域标识符（如 "frontend", "backend"）|
| `name` | `string` | 是 | 人类可读的领域名称 |
| `description` | `string` | 否 | 领域用途描述 |
| `paths` | `string[]` | 是 | 匹配领域源文件的 glob 模式 |
| `techStack` | `string` | 否 | 技术栈（如 "React, TypeScript"）|
| `responsibilities` | `string` | 否 | 该领域的职责 |
| `interfaces` | `string[]` | 否 | 向其他领域公开的 API 契约 |
| `dependencies` | `string[]` | 否 | 该领域依赖的其他领域 ID |
| `conventions` | `string[]` | 否 | 要遵循的代码规范 |
| `disabled` | `boolean` | 否 | 如果为 `true`，该领域不会创建代理 |

**示例:**

```json
{
  "domains": {
    "auth": {
      "name": "认证服务",
      "paths": ["src/auth/**", "src/middleware/auth.ts"],
      "techStack": "Node.js, JWT",
      "responsibilities": "用户认证、令牌管理",
      "interfaces": ["login(email, password)", "verifyToken(token)", "refreshToken(token)"],
      "dependencies": ["database"],
      "conventions": ["使用 bcrypt 加密密码", "JWT 有效期 24 小时"]
    }
  }
}
```

---

#### `discovery`

控制如何从项目结构自动发现领域。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `model` | `string` | `anthropic/claude-sonnet-4-20250514` | 用于分析项目结构和丰富领域元数据的 LLM 模型 |
| `autoRefresh` | `boolean` | `true` | 项目结构变化时是否重新发现领域（文件监视器）|

**示例:**

```json
{
  "discovery": {
    "model": "anthropic/claude-sonnet-4-20250514",
    "autoRefresh": false
  }
}
```

- `model`: 如果需要更快/更便宜的分析，可以设置为其他模型。必须是你的 LLM 提供商支持的模型。
- `autoRefresh`: 设置为 `false` 可手动控制领域发现。使用 `hive_status` 工具触发重新发现。

---

#### `coordination`

控制领域代理的协调方式和自主程度。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `autonomyLevel` | `string` | `"full"` | 代理自主程度: `"passive"` \| `"propose"` \| `"full"` |

**自主程度级别:**

| 级别 | 行为 |
|------|------|
| `passive` | 代理只响应 Queen 命令，从不主动发起行动。 |
| `propose` | 代理可以提议更改，但必须获得 Queen 批准后才能执行。 |
| `full` | 代理可以在收到破坏性变更或依赖更新通知时自主执行更改。 |

**示例:**

```json
{
  "coordination": {
    "autonomyLevel": "propose"
  }
}
```

---

#### `queen`

控制 Queen 协调器代理。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `model` | `string` | `anthropic/claude-sonnet-4-20250514` | Queen 代理推理使用的 LLM 模型 |

**示例:**

```json
{
  "queen": {
    "model": "anthropic/claude-sonnet-4-20250514"
  }
}
```

---

#### `store`

控制持久化设置。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dataDir` | `string` | `.hive` | 用于存储发现缓存、事件历史和代理状态的目录 |

**示例:**

```json
{
  "store": {
    "dataDir": ".hive"
  }
}
```

---

## 工具

Hive 提供了几个与插件交互的工具:

### `hive_emit`

向 EventBus 发布自定义事件。

```
hive_emit --type task_started --source frontend --target backend --message "开始实现登录表单"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--type` | 是 | 事件类型（见下方事件类型）|
| `--source` | 是 | 源领域 ID 或 "system" |
| `--target` | 是 | 目标领域 ID 或 "*"（广播）|
| `--message` | 是 | 事件消息 |
| `--data` | 否 | 额外的 JSON 数据 |

---

### `hive_status`

显示当前 Hive 状态（已发现的领域、Queen 状态、最近的事件）。

```
hive_status
```

---

### `hive_broadcast`（仅 Queen）

向所有相关领域代理广播需求。

```
hive_broadcast --message "添加 OAuth2 登录"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--message` | 是 | 需求描述 |
| `--target` | 否 | 特定目标领域（默认：全部）|

---

### `hive_negotiate`（仅 Queen）

在领域间发起接口协商。

```
hive_negotiate --domain1 frontend --domain2 backend --topic "认证 API"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--domain1` | 是 | 第一个领域 ID |
| `--domain2` | 是 | 第二个领域 ID |
| `--topic` | 是 | 协商主题 |

---

### `hive_dispatch`（仅 Queen）

向领域代理分配并行任务。

```
hive_dispatch --tasks "frontend:实现登录 UI" "backend:实现认证 API"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--tasks` | 是 | "领域ID:任务" 对的数组 |

---

## 事件类型

Hive 使用 EventBus 进行代理间通信。支持的事件类型:

| 事件 | 说明 |
|------|------|
| `requirement_broadcast` | Queen 广播新需求 |
| `relevance_response` | 领域响应相关性检查 |
| `interface_proposal` | 领域提议接口契约 |
| `interface_accepted` | 接口提议被接受 |
| `interface_rejected` | 接口提议被拒绝 |
| `task_started` | 领域开始任务 |
| `task_completed` | 领域完成任务 |
| `task_failed` | 领域任务失败 |
| `file_changed` | 检测到文件更改 |
| `breaking_change` | 检测到破坏性变更 |
| `dependency_updated` | 依赖已更新 |
| `action_proposed` | 提议操作（用于 `propose` 自主程度）|
| `action_completed` | 操作已完成 |
| `help_request` | 领域请求帮助 |
| `conflict_detected` | 检测到领域间冲突 |
| `info` | 一般信息 |

---

## 自主模式

当 `autonomyLevel` 设置为 `"full"` 时，Hive 可以自动响应破坏性变更:

1. 文件监视器检测到 `breaking_change` 或 `dependency_updated` 事件
2. Plugin 为受影响的领域代理创建新会话
3. 代理分析变更并提出修复方案
4. 代理自主执行更改

这使得代码库能够自愈，领域代理可以自主适应依赖项的变更，无需手动干预。

---

## 目录结构

```
.opencode/
├── opencode.json              # 插件注册
├── hive.json                  # Hive 配置（本文件）
└── plugins/
    └── hive/
        ├── index.ts           # 插件入口点
        ├── types.ts           # 类型定义
        ├── config.ts          # 配置加载器
        ├── store.ts           # JSON 持久化
        ├── discovery/         # 领域发现
        │   ├── scanner.ts     # 静态项目扫描
        │   ├── cache.ts       # 发现缓存
        │   ├── analyzer.ts    # LLM 分析
        │   └── merger.ts      # 用户配置合并
        ├── agents/            # 代理生成
        │   ├── generator.ts   # 领域 → AgentConfig
        │   └── prompts.ts     # 提示词模板
        ├── eventbus/          # 事件系统
        │   └── bus.ts         # 发布/订阅实现
        ├── tools/             # CLI 工具
        │   ├── emit.ts        # hive_emit
        │   ├── status.ts      # hive_status
        │   ├── broadcast.ts   # hive_broadcast
        │   ├── negotiate.ts   # hive_negotiate
        │   └── dispatch.ts    # hive_dispatch
        └── hooks/             # 插件钩子
            ├── config.ts      # 动态注册
            ├── system-transform.ts
            ├── file-watcher.ts
            └── autonomy.ts    # 自主响应
```

---

## 示例

### 最小配置

```json
{
  "domains": {
    "frontend": {
      "name": "前端",
      "paths": ["src/**"]
    }
  }
}
```

### 完整配置

```json
{
  "domains": {
    "frontend": {
      "name": "前端应用",
      "description": "使用 React 构建的主 Web UI",
      "paths": ["src/ui/**", "src/components/**", "src/pages/**"],
      "techStack": "React 18, TypeScript, TailwindCSS",
      "responsibilities": "用户界面、路由、状态管理",
      "interfaces": ["useAuth()", "ApiClient"],
      "dependencies": ["api", "shared"],
      "conventions": ["使用函数组件", "遵循 atomic design"]
    },
    "api": {
      "name": "API 服务器",
      "description": "使用 Express 构建的 REST API",
      "paths": ["src/api/**", "src/controllers/**", "src/middleware/**"],
      "techStack": "Node.js, Express, PostgreSQL",
      "responsibilities": "API 端点、认证、数据验证",
      "interfaces": ["POST /auth/login", "POST /auth/register", "GET /users/:id"],
      "dependencies": ["database", "auth"],
      "conventions": ["RESTful URL 模式", "使用 async/await"]
    },
    "database": {
      "name": "数据库层",
      "description": "数据库模型和迁移",
      "paths": ["src/db/**", "src/models/**", "migrations/**"],
      "techStack": "PostgreSQL, Prisma",
      "responsibilities": "数据建模、迁移、查询",
      "interfaces": ["User 模型", "Session 模型"],
      "conventions": ["使用 Prisma ORM", "软删除"]
    },
    "auth": {
      "name": "认证服务",
      "description": "跨层共享的认证逻辑",
      "paths": ["src/auth/**", "src/middleware/auth.ts"],
      "techStack": "JWT, bcrypt",
      "responsibilities": "密码哈希、令牌生成、验证",
      "interfaces": ["verifyToken(token)", "hashPassword(password)", "comparePassword(input, hash)"],
      "dependencies": ["database"],
      "conventions": ["bcrypt cost 12", "JWT 有效期 24 小时"]
    },
    "shared": {
      "name": "共享工具",
      "description": "共享类型和工具函数",
      "paths": ["src/shared/**", "src/types/**"],
      "techStack": "TypeScript",
      "responsibilities": "共享类型、工具函数、常量",
      "interfaces": ["User 类型", "ApiResponse 类型", "错误类型"],
      "conventions": ["使用 barrel exports", "使用 const assertions"]
    }
  },
  "discovery": {
    "model": "anthropic/claude-sonnet-4-20250514",
    "autoRefresh": true
  },
  "coordination": {
    "autonomyLevel": "full"
  },
  "queen": {
    "model": "anthropic/claude-sonnet-4-20250514"
  },
  "store": {
    "dataDir": ".hive"
  }
}
```

---

## 故障排除

### 领域未被发现

1. 检查 `paths` glob 是否匹配实际文件
2. 确保 `discovery.autoRefresh` 不是 `false`
3. 运行 `hive_status` 查看已发现的领域

### Queen 无响应

1. 检查 `queen.model` 是否设置为有效模型
2. 验证 `coordination.autonomyLevel` 的自主程度设置

### 事件未收到

1. 确保目标领域 ID 正确
2. 检查 `autonomyLevel` 设置

---

## 参见

- [设计文档](docs/plans/2026-03-11-hive-plugin-design.md)
- [实现计划](docs/plans/2026-03-11-hive-implementation.md)
