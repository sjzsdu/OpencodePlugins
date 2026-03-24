# Emperor — OpenCode Multi-Agent Plugins

A collection of [OpenCode](https://opencode.ai) plugins that enable multiple AI agents to collaborate on software development tasks.

## Plugins

| Plugin | Agents | Approach | Best For | Docs |
|--------|--------|----------|----------|------|
| [**Commander**](plugins/commander/) | 4 | Single orchestrator, fast iteration, Coder↔Tester fix loops | Most development tasks | [README](plugins/commander/README.md) |
| [**Emperor**](plugins/emperor/) | 11 | Three Departments & Six Ministries (三省六部), governance with checks & balances | Tasks requiring rigorous multi-stage review | [README](plugins/emperor/README.md) |
| [**Hive**](plugins/hive/) | Dynamic | Domain auto-discovery, EventBus coordination, autonomous execution | Large multi-domain projects | [README](plugins/hive/README.md) |
| [**Superpower**](plugins/superpower/) | Dynamic | Loads agents, skills, and commands from superpowers repo | Extensible agent capabilities | [README](plugins/superpower/README.md) |
| [**Stock**](plugins/stock/) | 5 | Multi-dimensional A-share analysis (fundamental, technical, sentiment, flow, sector) | Chinese A-share stock analysis | [README](plugins/stock/README.md) |
| [**Triage**](plugins/triage/) | 6 | Jira ticket triage (Bug/Feature), code investigation, solution design | Bug triage and feature specification | - |

### Commander — Adaptive 4-Agent Team

```
User Task → Lead (analyze & plan) → Coder (implement) ↔ Tester (verify) → [Reviewer] → Report
```

- **Lead** explores the codebase and creates plans with adaptive complexity classification (trivial / simple / standard / complex)
- **Coder↔Tester fix loop**: Tester fails → Coder fixes in the same session (context accumulates) → Tester re-verifies → up to N rounds
- **Reviewer** only engages on complex tasks
- Parallel wave dispatch for independent subtasks

### Emperor — 11-Agent Governance System (三省六部)

```
Edict → Crown Prince → Jinyiwei Recon → Zhongshu (plan) → Menxia (review/veto) → Shangshu → Six Ministries (parallel) → Memorial
```

- Full governance model: planning, review/veto, parallel execution, post-verification
- Jinyiwei reconnaissance with git-hash caching
- Mandatory department participation (Hubu testing enforced)
- Sensitive operation detection with manual confirmation

### Hive — Dynamic Domain-Agent Coordination

```
Startup → Scan project → Discover domains → Create per-domain Agents + Queen → EventBus coordination → Autonomous execution
```

- **Domain Discovery**: Static project scanning + LLM enrichment + user config merge
- **EventBus**: Pub/sub event system for agent-to-agent communication
- **Queen Coordinator**: Broadcasts requirements, negotiates interfaces, dispatches parallel tasks
- **Autonomous Execution**: Domain agents can self-adapt to breaking changes from dependencies

### Stock — Multi-Dimensional A-Share Analysis

```
Query → Fundamentalist (基本面) + Technician (技术面) + Sentiment (情绪) + Flow (资金流) + Industry (行业) → HTML Report
```

- **5 并发 Agent**: 基本面、技术面、情绪面、资金流、行业分析
- **智能评分**: 预设权重（保守/平衡/激进），自定义权重
- **HTML 报告生成**: 可视化分析结果

### Triage — Jira Ticket Analysis & Implementation

```
Jira Ticket → Triage (分类) → Scout (探索) → [Detective (Bug调查) | Architect (Feature方案)] → [Auto-fix | Awaiting Confirm]
```

- **Bug 路径**: Scout 探索 → Detective 根因调查 → 自动修复
- **Feature 路径**: Scout 探索 → Architect 方案设计 → 等待确认后实现
- **6 Agent 协作**: triage, scout, detective, architect, coder, tester

### Superpower — Extensible Agent Capabilities

```
Load agents, skills, and commands from external superpowers repository
```

- **Dynamic Agent Loading**: Loads agent definitions from `~/.superpowers/agents/`
- **Skill Registry**: Registers skills from `~/.superpowers/skills/`
- **Command Templates**: Registers command templates from `~/.superpowers/commands/`
- Extends OpenCode with custom agents and capabilities from the [superpowers](https://github.com/obra/superpowers) repo

## Quick Start

### 1. Register plugins

In `.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./plugins/commander/index.ts",
    "./plugins/emperor/index.ts",
    "./plugins/hive/index.ts",
    "./plugins/superpower/index.ts",
    "./plugins/stock/index.ts",
    "./plugins/triage/index.ts"
  ]
}
```

Pick one or more.

### 2. Use

**Commander:**

```
@lead Implement user authentication with JWT and role-based access control
```

**Emperor:**

```
@taizi Implement user authentication with JWT and role-based access control
```

**Hive:**

```
@queen Implement user authentication with JWT and role-based access control
```

**Superpower:**

```
@<agent-name> Your task description here
```

The Superpower plugin loads agents from the [superpowers](https://github.com/obra/superpowers) repository. Use any agent defined there.

### 3. Configure (optional)

- Commander: `.opencode/commander.json` — [config docs](plugins/commander/README.md#configuration)
- Emperor: `.opencode/emperor.json` — [config docs](plugins/emperor/README.md#configuration)
- Hive: `.opencode/hive.json` — [design docs](docs/plans/2026-03-11-hive-plugin-design.md)
- Superpower: No config needed (loads from `~/.superpowers/`)
- Stock: `.opencode/stock.json` — [config docs](plugins/stock/README.md#配置)
- Triage: `.opencode/triage.json` — [config docs](plugins/triage/config.ts)

## Project Structure

```
.
├── plugins/                              # Plugin directory
│   ├── commander/                       # Commander plugin
│   │   ├── index.ts                     # Entry point
│   │   ├── agents/                      # 4 agent definitions
│   │   ├── engine/                      # Pipeline, classifier, dispatcher
│   │   └── tools/                       # cmd_task, cmd_status, cmd_halt
│   ├── emperor/                         # Emperor plugin
│   │   ├── index.ts                     # Entry point
│   │   ├── agents/                      # 11 agent definitions
│   │   ├── engine/                      # Pipeline, recon, reviewer, dispatcher
│   │   ├── tools/                       # edict, memorial, halt
│   │   └── skills/                      # Built-in skills
│   ├── hive/                            # Hive plugin
│   │   ├── index.ts                     # Entry point
│   │   ├── discovery/                   # Domain auto-discovery
│   │   ├── agents/                      # Dynamic agent generator
│   │   ├── eventbus/                    # Event pub/sub system
│   │   ├── tools/                       # hive_emit, hive_status, hive_broadcast, etc.
│   │   └── hooks/                       # config, system-transform, file-watcher, autonomy
│   ├── superpower/                      # Superpower plugin
│   │   └── index.ts                     # Entry point (loads agents/skills/commands from ~/.superpowers/)
│   ├── stock/                            # Stock plugin
│   │   ├── index.ts                     # Entry point
│   │   ├── agents/                      # 5 agent definitions
│   │   └── skills/                      # Built-in skills
│   └── triage/                          # Triage plugin
│       ├── index.ts                     # Entry point
│       ├── agents/                      # 6 agent definitions
│       ├── engine/                      # Pipeline, classifier, dispatcher
│       └── tools/                       # jira_analyze, jira_implement, jira_status
├── package.json                         # Build tooling (private)
├── tsconfig.json                        # TypeScript config
├── .hive/                               # Hive runtime data (events.json, domains.json)
└── .github/workflows/
    ├── ci.yml                           # Type check + tests
    └── npm-publish.yml                  # Tag-based selective publish
```

## Development

```bash
# Install dependencies
bun install

# Type check
bun run build

# Run tests
bun test
```

## Publishing

Each plugin is published independently to npm via git tags:

```bash
# Commander
git tag commander-v0.1.0 && git push --tags

# Emperor
git tag emperor-v0.5.1 && git push --tags

# Hive
git tag hive-v0.1.0 && git push --tags

# Superpower
git tag superpower-v0.1.0 && git push --tags

# Stock
git tag stock-v0.1.0 && git push --tags

# Triage
git tag triage-v0.1.0 && git push --tags
```

| Package | npm |
|---------|-----|
| `opencode-plugin-commander` | Commander plugin |
| `opencode-plugin-emperor` | Emperor plugin |
| `opencode-plugin-hive` | Hive plugin |
| `opencode-plugin-superpower` | Superpower plugin |
| `opencode-plugin-stock` | Stock plugin |
| `opencode-plugin-triage` | Triage plugin |

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Plugin SDK**: @opencode-ai/plugin
- **Storage**: JSON file persistence

## License

MIT

---

[中文版](./README.zh-CN.md)
