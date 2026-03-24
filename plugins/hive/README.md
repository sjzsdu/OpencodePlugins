# Hive — Dynamic Domain-Agent Plugin

Hive is an OpenCode plugin that automatically discovers project domains (frontend, backend, infra, etc.), creates per-domain AI agents at startup, and enables them to coordinate via a custom EventBus — with fully autonomous code modification capabilities.

## Architecture

```
Startup → Scan project → Discover domains → Create per-domain Agents + Queen → EventBus coordination → Autonomous execution
```

- **Domain Discovery**: Static project scanning + LLM enrichment + user config merge
- **EventBus**: Pub/sub event system for agent-to-agent communication
- **Queen Coordinator**: Broadcasts requirements, negotiates interfaces, dispatches parallel tasks
- **Autonomous Execution**: Domain agents can self-adapt to breaking changes from dependencies

## Quick Start

### 1. Register Plugin

In `.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./plugins/hive/index.ts"
  ]
}
```

### 2. Use

```bash
@queen Implement user authentication with JWT and role-based access control
```

The Queen agent will:
1. Broadcast the requirement to relevant domain agents
2. Negotiate interfaces between domains (e.g., auth ↔ API ↔ frontend)
3. Dispatch parallel tasks to domain agents
4. Monitor progress and handle conflicts

## Configuration

Create `.opencode/hive.json` in your project root:

```json
{
  "domains": {
    "frontend": {
      "name": "Frontend",
      "paths": ["src/ui/**", "src/components/**"],
      "techStack": "React, TypeScript",
      "responsibilities": "User interface, component library",
      "disabled": false
    },
    "backend": {
      "name": "Backend",
      "paths": ["src/api/**", "src/services/**"],
      "techStack": "Node.js, Express",
      "responsibilities": "API endpoints, business logic"
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

### Config Options

#### `domains`

User-defined domain configurations. These override/extend auto-discovered domains.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Auto | Unique domain identifier (e.g., "frontend", "backend") |
| `name` | `string` | Yes | Human-readable domain name |
| `description` | `string` | No | Domain purpose description |
| `paths` | `string[]` | Yes | Glob patterns matching domain source files |
| `techStack` | `string` | No | Technology stack (e.g., "React, TypeScript") |
| `responsibilities` | `string` | No | What this domain is responsible for |
| `interfaces` | `string[]` | No | API contracts exposed to other domains |
| `dependencies` | `string[]` | No | IDs of domains this domain depends on |
| `conventions` | `string[]` | No | Coding conventions to follow |
| `disabled` | `boolean` | No | If `true`, this domain won't get an agent |

**Example:**

```json
{
  "domains": {
    "auth": {
      "name": "Authentication",
      "paths": ["src/auth/**", "src/middleware/auth.ts"],
      "techStack": "Node.js, JWT",
      "responsibilities": "User authentication, token management",
      "interfaces": ["login(email, password)", "verifyToken(token)", "refreshToken(token)"],
      "dependencies": ["database"],
      "conventions": ["Use bcrypt for password hashing", "JWT expires in 24h"]
    }
  }
}
```

---

#### `discovery`

Controls how domains are auto-discovered from project structure.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `string` | `anthropic/claude-sonnet-4-20250514` | LLM model used for analyzing project structure and enriching domain metadata |
| `autoRefresh` | `boolean` | `true` | Whether to re-discover domains when project structure changes (file watcher) |

**Example:**

```json
{
  "discovery": {
    "model": "anthropic/claude-sonnet-4-20250514",
    "autoRefresh": false
  }
}
```

- `model`: Set to a different model if you want faster/cheaper analysis. Must be supported by your LLM provider.
- `autoRefresh`: Set to `false` if you want manual control over domain discovery. Use `hive_status` tool to trigger re-discovery.

---

#### `coordination`

Controls how domain agents coordinate and their autonomy level.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autonomyLevel` | `string` | `"full"` | Agent autonomy: `"passive"` \| `"propose"` \| `"full"` |

**Autonomy Levels:**

| Level | Behavior |
|-------|----------|
| `passive` | Agents only respond to Queen commands. Never initiate actions. |
| `propose` | Agents can propose changes but must get Queen approval before executing. |
| `full` | Agents can autonomously execute changes when notified of breaking changes or dependency updates. |

**Example:**

```json
{
  "coordination": {
    "autonomyLevel": "propose"
  }
}
```

---

#### `queen`

Controls the Queen coordinator agent.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `string` | `anthropic/claude-sonnet-4-20250514` | LLM model used for Queen agent reasoning |

**Example:**

```json
{
  "queen": {
    "model": "anthropic/claude-sonnet-4-20250514"
  }
}
```

---

#### `store`

Controls persistence settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dataDir` | `string` | `.hive` | Directory for storing discovery cache, event history, and agent state |

**Example:**

```json
{
  "store": {
    "dataDir": ".hive"
  }
}
```

---

## Tools

Hive provides several tools for interacting with the plugin:

### `hive_emit`

Emit a custom event to the EventBus.

```
hive_emit --type task_started --source frontend --target backend --message "Started implementing login form"
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--type` | Yes | Event type (see Event Types below) |
| `--source` | Yes | Source domain ID or "system" |
| `--target` | Yes | Target domain ID or "*" (broadcast) |
| `--message` | Yes | Event message |
| `--data` | No | Additional JSON data |

---

### `hive_status`

Show current Hive status (discovered domains, Queen status, recent events).

```
hive_status
```

---

### `hive_broadcast` (Queen only)

Broadcast a requirement to all relevant domain agents.

```
hive_broadcast --message "Add OAuth2 login"
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--message` | Yes | Requirement description |
| `--target` | No | Specific domain to target (default: all) |

---

### `hive_negotiate` (Queen only)

Initiate interface negotiation between domains.

```
hive_negotiate --domain1 frontend --domain2 backend --topic "auth API"
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--domain1` | Yes | First domain ID |
| `--domain2` | Yes | Second domain ID |
| `--topic` | Yes | Negotiation topic |

---

### `hive_dispatch` (Queen only)

Dispatch parallel tasks to domain agents.

```
hive_dispatch --tasks "frontend:implement login UI" "backend:implement auth API"
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--tasks` | Yes | Array of "domainId:task" pairs |

---

## Event Types

Hive uses an EventBus for agent-to-agent communication. Supported event types:

| Event | Description |
|-------|-------------|
| `requirement_broadcast` | Queen broadcasts a new requirement |
| `relevance_response` | Domain responds to relevance check |
| `interface_proposal` | Domain proposes an interface contract |
| `interface_accepted` | Interface proposal accepted |
| `interface_rejected` | Interface proposal rejected |
| `task_started` | Domain started a task |
| `task_completed` | Domain completed a task |
| `task_failed` | Domain task failed |
| `file_changed` | File change detected |
| `breaking_change` | Breaking change detected |
| `dependency_updated` | Dependency updated |
| `action_proposed` | Action proposed (for `propose` autonomy) |
| `action_completed` | Action completed |
| `help_request` | Domain requests help |
| `conflict_detected` | Conflict detected between domains |
| `info` | General info |

---

## Autonomy Mode

When `autonomyLevel` is set to `"full"`, Hive can automatically respond to breaking changes:

1. File watcher detects `breaking_change` or `dependency_updated` event
2. Plugin creates a new session for affected domain agent
3. Agent analyzes the change and proposes fixes
4. Agent autonomously executes changes

This enables self-healing codebases where domain agents can adapt to changes in their dependencies without manual intervention.

---

## Directory Structure

```
.opencode/
├── opencode.json              # Plugin registration
├── hive.json                  # Hive configuration (this file)
└── plugins/
    └── hive/
        ├── index.ts           # Plugin entry point
        ├── types.ts           # Type definitions
        ├── config.ts          # Config loader
        ├── store.ts           # JSON persistence
        ├── discovery/         # Domain discovery
        │   ├── scanner.ts     # Static project scanning
        │   ├── cache.ts      # Discovery cache
        │   ├── analyzer.ts   # LLM-powered analysis
        │   └── merger.ts     # User config merge
        ├── agents/           # Agent generation
        │   ├── generator.ts   # Domain → AgentConfig
        │   └── prompts.ts    # Prompt templates
        ├── eventbus/         # Event system
        │   └── bus.ts        # Pub/sub implementation
        ├── tools/            # CLI tools
        │   ├── emit.ts       # hive_emit
        │   ├── status.ts     # hive_status
        │   ├── broadcast.ts # hive_broadcast
        │   ├── negotiate.ts  # hive_negotiate
        │   └── dispatch.ts   # hive_dispatch
        └── hooks/            # Plugin hooks
            ├── config.ts     # Dynamic registration
            ├── system-transform.ts
            ├── file-watcher.ts
            └── autonomy.ts   # Autonomous response
```

---

## Examples

### Minimal Config

```json
{
  "domains": {
    "frontend": {
      "name": "Frontend",
      "paths": ["src/**"]
    }
  }
}
```

### Full Config

```json
{
  "domains": {
    "frontend": {
      "name": "Frontend Application",
      "description": "Main web UI built with React",
      "paths": ["src/ui/**", "src/components/**", "src/pages/**"],
      "techStack": "React 18, TypeScript, TailwindCSS",
      "responsibilities": "User interface, routing, state management",
      "interfaces": ["useAuth()", "ApiClient"],
      "dependencies": ["api", "shared"],
      "conventions": ["Use functional components", "Follow atomic design"]
    },
    "api": {
      "name": "API Server",
      "description": "REST API built with Express",
      "paths": ["src/api/**", "src/controllers/**", "src/middleware/**"],
      "techStack": "Node.js, Express, PostgreSQL",
      "responsibilities": "API endpoints, authentication, data validation",
      "interfaces": ["POST /auth/login", "POST /auth/register", "GET /users/:id"],
      "dependencies": ["database", "auth"],
      "conventions": ["RESTful URL patterns", "Use async/await"]
    },
    "database": {
      "name": "Database Layer",
      "description": "Database models and migrations",
      "paths": ["src/db/**", "src/models/**", "migrations/**"],
      "techStack": "PostgreSQL, Prisma",
      "responsibilities": "Data modeling, migrations, queries",
      "interfaces": ["User model", "Session model"],
      "conventions": ["Use Prisma ORM", "Soft deletes"]
    },
    "auth": {
      "name": "Authentication",
      "description": "Auth logic shared across layers",
      "paths": ["src/auth/**", "src/middleware/auth.ts"],
      "techStack": "JWT, bcrypt",
      "responsibilities": "Password hashing, token generation, validation",
      "interfaces": ["verifyToken(token)", "hashPassword(password)", "comparePassword(input, hash)"],
      "dependencies": ["database"],
      "conventions": ["bcrypt cost 12", "JWT expires 24h"]
    },
    "shared": {
      "name": "Shared Utilities",
      "description": "Shared types and utilities",
      "paths": ["src/shared/**", "src/types/**"],
      "techStack": "TypeScript",
      "responsibilities": "Shared types, utilities, constants",
      "interfaces": ["User type", "ApiResponse type", "error types"],
      "conventions": [" barrel exports", "use const assertions"]
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

## Troubleshooting

### Domains not being discovered

1. Check that your `paths` globs match actual files
2. Ensure `discovery.autoRefresh` is not `false`
3. Run `hive_status` to see discovered domains

### Queen not responding

1. Check `queen.model` is set to a valid model
2. Verify autonomy level in `coordination.autonomyLevel`

### Events not being received

1. Ensure target domain IDs are correct
2. Check `autonomyLevel` settings

---

## See Also

- [Design Document](docs/plans/2026-03-11-hive-plugin-design.md)
- [Implementation Plan](docs/plans/2026-03-11-hive-implementation.md)
