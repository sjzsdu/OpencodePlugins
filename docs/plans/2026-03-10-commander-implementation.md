# Commander Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new OpenCode plugin with 4 agents (Lead, Coder, Tester, Reviewer) using a single-orchestrator pattern with adaptive complexity and Coder↔Tester fix loops.

**Architecture:** Single "Lead" agent orchestrates everything. Code-based dispatcher handles parallel execution and fix-loop iteration. Complexity classifier determines how many agents to involve. New plugin lives alongside existing emperor plugin.

**Tech Stack:** TypeScript (strict), @opencode-ai/plugin SDK, sjz-opencode-sdk, JSON file persistence

**Design Doc:** `docs/plans/2026-03-10-commander-plugin-design.md`

---

### Task 1: Scaffold and Types

**Files:**
- Create: `.opencode/plugins/commander/types.ts`

**Step 1: Create types.ts with all type definitions**

```typescript
import type { AgentConfig } from "sjz-opencode-sdk"

// --- State Machine ---

export type TaskStatus =
  | "received"    // Task created
  | "analyzing"   // Lead exploring codebase
  | "planning"    // Lead creating plan
  | "executing"   // Coder(s) working
  | "verifying"   // Tester running
  | "fixing"      // Coder fixing after test failure
  | "reviewing"   // Reviewer auditing (complex only)
  | "completed"   // Done
  | "failed"      // Unrecoverable error
  | "halted"      // User stopped

export type Complexity = "trivial" | "simple" | "standard" | "complex"

// --- Task and Plan ---

export interface Task {
  id: string
  title: string
  content: string
  priority: "high" | "normal" | "low"
  status: TaskStatus
  complexity?: Complexity
  plan?: Plan
  executions: Execution[]
  report?: string
  createdAt: number
  updatedAt: number
}

export interface Plan {
  analysis: string
  subtasks: Subtask[]
  risks: string[]
}

export interface Subtask {
  index: number
  title: string
  description: string
  dependencies: number[]
  effort: "low" | "medium" | "high"
}

// --- Execution ---

export interface Execution {
  subtaskIndex: number
  coderSessionId: string
  testerSessionId: string
  status: "running" | "completed" | "failed"
  fixAttempts: FixAttempt[]
  result?: string
  error?: string
  startedAt: number
  completedAt?: number
}

export interface FixAttempt {
  round: number
  coderResult: string
  testerResult: string
  passed: boolean
}

// --- Store ---

export interface TaskStore {
  create(input: Omit<Task, "id" | "createdAt" | "updatedAt" | "executions">): Task
  get(id: string): Task | undefined
  update(id: string, patch: Partial<Task>): Task
  list(filter?: { status?: TaskStatus }): Task[]
  save(): void
}

// --- Config ---

export interface CommanderUserConfig {
  agents?: Record<string, { model?: string }>
  pipeline?: Partial<CommanderConfig["pipeline"]>
  store?: Partial<CommanderConfig["store"]>
}

export interface CommanderConfig {
  agents: Record<string, AgentConfig>
  pipeline: {
    maxFixLoops: number
    enableReviewer: boolean
    sensitivePatterns: string[]
  }
  store: {
    dataDir: string
  }
}
```

**Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

**Step 3: Commit**

```
feat(commander): add type definitions for commander plugin
```

---

### Task 2: Config and Store

**Files:**
- Create: `.opencode/plugins/commander/config.ts`
- Create: `.opencode/plugins/commander/store.ts`

**Step 1: Create config.ts**

Reuse the pattern from `emperor/config.ts`:
- Load from `.opencode/commander.json`
- Merge user overrides with defaults
- Default `maxFixLoops: 3`, `enableReviewer: true`
- Default `dataDir: ".commander"`
- Import agent definitions from `./agents` (will exist after Task 3)

**Step 2: Create store.ts**

Reuse the pattern from `emperor/store.ts` exactly, but adapted for `Task` type instead of `Edict`:
- `JsonTaskStore` class implementing `TaskStore`
- Same file-based JSON persistence
- Same `create/get/update/list/save` interface
- Data file: `{dataDir}/tasks.json`

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: May have errors (agents/ not yet created). That's OK — will resolve in Task 3.

**Step 4: Commit**

```
feat(commander): add config loader and task store
```

---

### Task 3: Agent Definitions

**Files:**
- Create: `.opencode/plugins/commander/agents/lead.ts`
- Create: `.opencode/plugins/commander/agents/coder.ts`
- Create: `.opencode/plugins/commander/agents/tester.ts`
- Create: `.opencode/plugins/commander/agents/reviewer.ts`
- Create: `.opencode/plugins/commander/agents/index.ts`

**Step 1: Create lead.ts**

Lead is the brain. Key prompt requirements:
- Has full tool access: read, grep, glob, bash, webfetch, websearch
- Does NOT have write/edit (Lead plans, doesn't implement)
- Built-in code exploration (no separate recon agent)
- Classifies complexity: trivial/simple/standard/complex
- Creates plans with subtasks
- Outputs progress messages at each stage
- Prompt in Chinese

**Step 2: Create coder.ts**

Coder implements. Key prompt requirements:
- Full tools: read, grep, glob, write, edit, bash
- Follows project conventions
- Outputs progress at each stage
- When receiving fix requests: analyzes test failure, adjusts approach
- Must run build verification after implementation
- Prompt in Chinese

**Step 3: Create tester.ts**

Tester verifies. Key prompt requirements:
- Tools: read, grep, glob, bash, write, edit
- Must ACTUALLY RUN tests (build + test commands)
- Reports with evidence (exit codes, output)
- Clear pass/fail verdict at the end
- When failing: specific description of what failed and why
- Prompt in Chinese

**Step 4: Create reviewer.ts**

Reviewer audits (optional, complex tasks only). Key prompt requirements:
- Read-only tools: read, grep, glob
- Code quality review
- Security audit
- Architecture assessment
- Prompt in Chinese

**Step 5: Create agents/index.ts**

Export all agents as a `Record<string, AgentConfig>`:
```typescript
export const AGENTS: Record<string, AgentConfig> = { lead, coder, tester, reviewer }
```

**Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 7: Commit**

```
feat(commander): add agent definitions (lead, coder, tester, reviewer)
```

---

### Task 4: Complexity Classifier

**Files:**
- Create: `.opencode/plugins/commander/engine/classifier.ts`

**Step 1: Create classifier.ts**

This is a code-based heuristic classifier that Lead uses to decide the flow.

```typescript
import type { Plan, Complexity } from "../types"

/** Classify task complexity based on the plan Lead creates */
export function classifyComplexity(plan: Plan): Complexity {
  const { subtasks, risks } = plan
  
  if (subtasks.length === 0) return "trivial"
  if (subtasks.length === 1 && subtasks[0].effort === "low") return "simple"
  
  const hasHighEffort = subtasks.some(s => s.effort === "high")
  const hasRisks = risks.length > 0
  const hasManySubtasks = subtasks.length >= 4
  
  if (hasHighEffort || (hasRisks && hasManySubtasks)) return "complex"
  return "standard"
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
feat(commander): add complexity classifier
```

---

### Task 5: Dispatcher (Fix Loop + Parallel Execution)

**Files:**
- Create: `.opencode/plugins/commander/engine/dispatcher.ts`

This is the core innovation. Key behaviors:

**Step 1: Implement single subtask execution with fix loop**

```
executeSubtask(client, task, subtask, maxFixLoops):
  1. Create Coder session
  2. Prompt Coder with subtask
  3. Create Tester session
  4. Prompt Tester to verify
  5. If Tester passes → return success
  6. If Tester fails AND rounds < maxFixLoops:
     - Re-prompt Coder (SAME session) with failure context
     - Re-prompt Tester (SAME session) to re-verify
     - Loop
  7. If all rounds exhausted → return failure
```

Important: Coder and Tester each maintain their own session across fix rounds. Context accumulates.

Toast notifications at each step:
- `⚔️ Coder: implementing "{title}"`
- `🧪 Tester: verifying...`
- `❌ Tester: failed (round N)`
- `🔧 Coder: fixing (round N)...`
- `✅ Done: "{title}"`

**Step 2: Implement parallel dispatch with topological sort**

Reuse the `topologicalSort` function from `emperor/engine/dispatcher.ts` — it's a clean, generic Kahn's algorithm.

```
dispatchAll(client, task, plan, maxFixLoops):
  1. Topological sort subtasks into waves
  2. For each wave:
     - Promise.all(wave.map(subtask => executeSubtask(...)))
     - Toast progress per wave
  3. Return all executions
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```
feat(commander): add dispatcher with fix loop and parallel execution
```

---

### Task 6: Pipeline (Main Flow)

**Files:**
- Create: `.opencode/plugins/commander/engine/pipeline.ts`

This is the main orchestration engine.

**Step 1: Implement the adaptive pipeline**

```
runPipeline(task, context, client, store, config):

  // Phase 1: Lead analyzes and plans
  store.update(task.id, { status: "analyzing" })
  toast("🔍 Lead: analyzing requirement...")
  
  Create Lead session
  Prompt Lead with task content
  → Lead explores codebase, creates plan (JSON)
  
  Parse plan, classify complexity
  store.update(task.id, { status: "planning", plan, complexity })
  
  // Phase 1b: Trivial — Lead handles directly
  if complexity === "trivial":
    Prompt Lead to implement directly
    store.update(task.id, { status: "completed" })
    return result
  
  // Phase 2: Dispatch Coder(s) + Tester fix loops
  store.update(task.id, { status: "executing" })
  toast("⚔️ Dispatching coders...")
  
  executions = dispatchAll(client, task, plan, config.pipeline.maxFixLoops)
  store.update(task.id, { executions })
  
  // Phase 3: Reviewer (complex only)
  if complexity === "complex" && config.pipeline.enableReviewer:
    store.update(task.id, { status: "reviewing" })
    toast("🔍 Reviewer: auditing code...")
    
    Create Reviewer session
    Prompt with all coder results
    → Reviewer checks quality + security
  
  // Phase 4: Lead summarizes
  toast("📋 Lead: generating report...")
  
  Prompt Lead (same session) with all results
  → Lead generates final report
  
  store.update(task.id, { report, status: "completed" })
  return report
```

**Step 2: Implement abort checking**

Check `context.abort` signal between phases (reuse pattern from emperor).

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```
feat(commander): add main pipeline with adaptive flow
```

---

### Task 7: Tools

**Files:**
- Create: `.opencode/plugins/commander/tools/task.ts`
- Create: `.opencode/plugins/commander/tools/status.ts`
- Create: `.opencode/plugins/commander/tools/halt.ts`

**Step 1: Create cmd_task tool**

```typescript
args:
  - title: string ("Task title")
  - content: string ("Detailed requirement")
  - priority: string (optional, default "normal")

execute:
  1. Create task in store
  2. Show toast
  3. Run pipeline
  4. Return report (or error)
```

**Step 2: Create cmd_status tool**

```typescript
args:
  - task_id: string (optional — if omitted, list all)
  - status: string (optional — filter by status)

execute:
  - If task_id: return detailed task info
  - If status filter: list matching tasks
  - If neither: list recent tasks
```

**Step 3: Create cmd_halt tool**

```typescript
args:
  - task_id: string
  - reason: string

execute:
  1. Find task
  2. Update status to "halted"
  3. Show toast
  4. Return confirmation
```

**Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```
feat(commander): add tools (cmd_task, cmd_status, cmd_halt)
```

---

### Task 8: Plugin Entry + Registration

**Files:**
- Create: `.opencode/plugins/commander/index.ts`
- Modify: `.opencode/opencode.json`

**Step 1: Create index.ts**

Wire everything together. Follow the pattern from `emperor/index.ts`:

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { JsonTaskStore } from "./store"
import { createTaskTool } from "./tools/task"
import { createStatusTool } from "./tools/status"
import { createHaltTool } from "./tools/halt"

export const CommanderPlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory)
  const store = new JsonTaskStore(directory, config.store.dataDir)

  client.app.log({ body: { service: "commander", level: "info", message: "🎖️ Commander plugin initialized" } })

  return {
    config: async (openCodeConfig) => {
      const configAny = openCodeConfig as any
      if (!configAny.agent) configAny.agent = {}
      for (const [id, agentConfig] of Object.entries(config.agents)) {
        configAny.agent[id] = agentConfig
      }
    },
    tool: {
      cmd_task: createTaskTool(client, store, config, directory),
      cmd_status: createStatusTool(store),
      cmd_halt: createHaltTool(client, store),
    },
  }
}
```

**Step 2: Register in opencode.json**

Add `"./plugins/commander/index.ts"` to the plugin array.

Before:
```json
{ "plugin": ["oh-my-opencode@latest", "./plugins/emperor/index.ts"] }
```
After:
```json
{ "plugin": ["oh-my-opencode@latest", "./plugins/emperor/index.ts", "./plugins/commander/index.ts"] }
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors

**Step 4: Commit**

```
feat(commander): plugin entry and registration
```

---

### Task 9: Final Verification

**Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors

**Step 2: Verify plugin loads**

Check that OpenCode recognizes the new agents by verifying the config structure is correct.

**Step 3: Verify both plugins coexist**

Confirm emperor plugin still works (no naming conflicts, separate config files, separate data dirs).

**Step 4: Commit**

```
feat(commander): final verification pass
```
