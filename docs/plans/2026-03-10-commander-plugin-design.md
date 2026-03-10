# Commander Plugin Design

Date: 2025-03-10
Status: Approved

## Problem

The Emperor plugin (三省六部) has 11 agents with a rigid pipeline. Every task — from a typo fix to a major feature — goes through the same 6-layer flow (太子→锦衣卫→中书→门下→尚书→六部). This causes:

- **Slow**: Simple tasks take too long to start
- **Context loss**: Information degrades through 4 management layers before reaching workers
- **No real collaboration**: Agents pass messages sequentially, never discuss or iterate
- **Poor quality**: No feedback loops — if tests fail, the whole pipeline fails
- **Top-heavy**: 4 governance agents for 6 execution agents

## Solution

A new plugin ("Commander") with 4 agents using a single-orchestrator pattern:

- **1 Lead** replaces 5 governance/recon agents (太子+中书+门下+尚书+锦衣卫)
- **1 Coder** replaces 4 execution agents (兵部+吏部+工部+礼部)
- **1 Tester** replaces 户部
- **1 Reviewer** (optional) replaces 刑部+门下审查

## Architecture

```
User Task → Lead (single brain)
              │
              ├─ trivial → Lead handles directly → done
              ├─ simple  → Coder → Tester ←→ fix loop → done
              ├─ standard → Coder×N parallel → Tester ←→ fix loop → done
              └─ complex  → Coder×N parallel → Tester ←→ fix loop → Reviewer → done
```

### Agents

| Agent | Role | Tools | Replaces |
|-------|------|-------|----------|
| **lead** | Analyze requirements, explore code, plan, dispatch, summarize | read, grep, glob, bash, webfetch | 太子+中书+门下+尚书+锦衣卫 |
| **coder** | Implement features, fix bugs, refactor, infra, docs | read, grep, glob, write, edit, bash | 兵部+吏部+工部+礼部 |
| **tester** | Run tests, verify functionality, report issues | read, grep, glob, bash, write, edit | 户部 |
| **reviewer** | Code review + security audit (complex tasks only) | read, grep, glob | 刑部+門下審查 |

### Tools

| Tool | Description |
|------|-------------|
| `cmd_task` | Create a task and start the workflow |
| `cmd_status` | View task status and history |
| `cmd_halt` | Halt a running task |

### Key Innovation: Fix Loop

The Coder↔Tester fix loop is the core quality mechanism:

```
Coder implements → Tester verifies
      ↑                  │
      │            pass? → done
      │                  │
      └── fail (same session, with failure context)
```

- Coder retains full context across fix attempts (same session)
- Tester feedback goes directly to Coder (no intermediary)
- Multiple iterations are expected behavior, not failure
- Max N rounds (default 3), then escalate to Lead

### Complexity Classification

Lead classifies each task before deciding the flow:

- **trivial**: Single-line change, typo fix → Lead handles directly
- **simple**: Single-file modification, small bug → 1 Coder + Tester
- **standard**: New feature, cross-file changes → N Coders parallel + Tester
- **complex**: Major refactor, security-sensitive → N Coders + Tester + Reviewer

### State Machine

```
received → analyzing → planning → executing → verifying → completed
                                      ↑            │
                                      └── fixing ←──┘
                                                    │
                                              (complex only)
                                                    ↓
                                               reviewing → completed

Any state → failed (unrecoverable error)
Any state → halted (user halt)
```

### Progress Visibility

Toast notifications at every step:

```
🔍 Lead: Analyzing requirement...
📁 Lead: Exploring codebase...
📋 Lead: Plan ready (2 subtasks, standard complexity)
⚔️ Coder: Implementing "user auth module"
✅ Coder: Done "user auth module"
🧪 Tester: Verifying...
❌ Tester: Failed (2 tests failing)
🔧 Coder: Fixing (round 1)...
✅ Coder: Fix complete
🧪 Tester: Re-verifying...
✅ Tester: All passed
📋 Lead: Task complete
```

## File Structure

```
.opencode/plugins/commander/
├── index.ts              # Plugin entry
├── types.ts              # Type definitions
├── config.ts             # Configuration loader
├── store.ts              # Task persistence
├── agents/
│   ├── index.ts          # Agent registry
│   ├── lead.ts           # Lead agent
│   ├── coder.ts          # Coder agent
│   ├── tester.ts         # Tester agent
│   └── reviewer.ts       # Reviewer agent
├── engine/
│   ├── pipeline.ts       # Main workflow engine
│   ├── dispatcher.ts     # Parallel dispatch + fix loop
│   └── classifier.ts     # Complexity classifier
└── tools/
    ├── task.ts           # cmd_task tool
    ├── status.ts         # cmd_status tool
    └── halt.ts           # cmd_halt tool
```

## Configuration

```json
// .opencode/commander.json
{
  "agents": {
    "lead":     { "model": "anthropic/claude-sonnet-4-20250514" },
    "coder":    { "model": "anthropic/claude-sonnet-4-20250514" },
    "tester":   { "model": "anthropic/claude-sonnet-4-20250514" },
    "reviewer": { "model": "anthropic/claude-sonnet-4-20250514" }
  },
  "pipeline": {
    "maxFixLoops": 3,
    "enableReviewer": true,
    "sensitivePatterns": ["delete", "drop", "rm -rf", "production", "credentials"]
  },
  "store": {
    "dataDir": ".commander"
  }
}
```

## Design Decisions

1. **Lead has built-in exploration** — No separate recon agent/phase. Lead can read, grep, glob directly. Eliminates the entire Jinyiwei phase.

2. **Adaptive complexity** — Trivial tasks skip all delegation. Simple tasks use minimal agents. Only complex tasks invoke the full pipeline.

3. **Fix loop over review layers** — Quality comes from iteration (Coder↔Tester), not from adding more reviewers. The old system had 门下 review + 户部 test + 刑部 audit = 3 quality gates but no iteration.

4. **Same-session retry** — When Tester rejects, Coder retries in the same session with full context of what it implemented and why it failed. This is fundamentally better than the old system's cross-session retry.

5. **Single Coder role** — One agent handles implementation, refactoring, infra, and docs. Specialization through prompt context, not separate agents. Reduces hand-off overhead.
