# Emperor — OpenCode Multi-Agent Plugins

A collection of [OpenCode](https://opencode.ai) plugins that enable multiple AI agents to collaborate on software development tasks.

## Plugins

| Plugin | Agents | Approach | Best For | Docs |
|--------|--------|----------|----------|------|
| [**Commander**](.opencode/plugins/commander/) | 4 | Single orchestrator, fast iteration, Coder↔Tester fix loops | Most development tasks | [README](.opencode/plugins/commander/README.md) |
| [**Emperor**](.opencode/plugins/emperor/) | 11 | Three Departments & Six Ministries (三省六部), governance with checks & balances | Tasks requiring rigorous multi-stage review | [README](.opencode/plugins/emperor/README.md) |

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

## Quick Start

### 1. Register plugins

In `.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./plugins/commander/index.ts",
    "./plugins/emperor/index.ts"
  ]
}
```

Pick one or both.

### 2. Use

**Commander:**

```
@lead Implement user authentication with JWT and role-based access control
```

**Emperor:**

```
@taizi Implement user authentication with JWT and role-based access control
```

### 3. Configure (optional)

- Commander: `.opencode/commander.json` — [config docs](.opencode/plugins/commander/README.md#configuration)
- Emperor: `.opencode/emperor.json` — [config docs](.opencode/plugins/emperor/README.md#configuration)

## Project Structure

```
.
├── .opencode/
│   ├── opencode.json                    # Plugin registration
│   ├── package.json                     # Plugin SDK dependency
│   ├── commander.json                   # Commander config (optional)
│   ├── emperor.json                     # Emperor config (optional)
│   └── plugins/
│       ├── commander/                   # Commander plugin
│       │   ├── index.ts                 # Entry point
│       │   ├── agents/                  # 4 agent definitions
│       │   ├── engine/                  # Pipeline, classifier, dispatcher
│       │   └── tools/                   # cmd_task, cmd_status, cmd_halt
│       └── emperor/                     # Emperor plugin
│           ├── index.ts                 # Entry point
│           ├── agents/                  # 11 agent definitions
│           ├── engine/                  # Pipeline, recon, reviewer, dispatcher
│           ├── tools/                   # edict, memorial, halt
│           └── skills/                  # Built-in skills
├── package.json                         # Build tooling (private)
├── tsconfig.json                        # TypeScript config
└── .github/workflows/
    ├── ci.yml                           # Type check + tests
    └── npm-publish.yml                  # Tag-based selective publish
```

## Development

```bash
# Install dependencies
bun install && bun install --cwd .opencode

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
```

| Package | npm |
|---------|-----|
| `opencode-plugin-commander` | Commander plugin |
| `opencode-plugin-emperor` | Emperor plugin |

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Plugin SDK**: @opencode-ai/plugin
- **Storage**: JSON file persistence

## License

MIT

---

[中文版](./README.zh-CN.md)
