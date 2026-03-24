# Emperor Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an OpenCode plugin that orchestrates multiple AI agents using the 三省六部 (Three Departments and Six Ministries) architecture for collaborative task execution.

**Architecture:** Tool-Driven orchestration. Plugin registers custom tools (`下旨`, `查看奏折`, `叫停`) and 8 OpenCode agents. When user issues a complex task, the 太子 agent calls the `下旨` tool, which internally uses the SDK to drive a pipeline: 中书省 plans → 门下省 reviews → 六部 execute in parallel → results compiled into a memorial.

**Tech Stack:** TypeScript, @opencode-ai/plugin, sjz-opencode-sdk, Bun runtime, Zod (via tool.schema)

**Design Doc:** `docs/plans/2026-03-06-emperor-plugin-design.md`

---

### Task 1: Project Scaffolding & Dependencies

**Files:**
- Modify: `.opencode/package.json`
- Create: `.opencode/plugins/emperor/types.ts`
- Create: `.opencode/plugins/emperor/index.ts` (skeleton)
- Create: `tsconfig.json`

**Step 1: Update package.json with dev dependency**

Add TypeScript type checking support. The plugin runs in Bun so no build step needed, but we want types.

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "1.2.20"
  }
}
```

No change needed — `@opencode-ai/plugin` already bundles `sjz-opencode-sdk` types. The plugin files will be loaded directly by OpenCode from `.opencode/plugins/`.

**Step 2: Create type definitions**

Create `.opencode/plugins/emperor/types.ts` with all core types from the design doc:
- `EdictStatus` union type
- `Edict`, `Plan`, `Subtask`, `Review`, `Execution` interfaces
- `DepartmentId` type
- `EdictStore` interface

**Step 3: Create plugin skeleton**

Create `.opencode/plugins/emperor/index.ts` — export an async plugin function that returns empty hooks + empty tool map. This validates the plugin loads correctly.

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const EmperorPlugin: Plugin = async ({ client, project, $, directory, worktree }) => {
  console.log("⚔️ Emperor plugin initialized")
  return {
    tool: {},
  }
}
```

**Step 4: Verify plugin loads**

Restart OpenCode and check that "Emperor plugin initialized" appears in logs. Use `client.app.log()` for structured logging.

**Step 5: Commit**

```bash
git add .opencode/plugins/emperor/types.ts .opencode/plugins/emperor/index.ts
git commit -m "feat: scaffold emperor plugin with types"
```

---

### Task 2: Edict Store (Persistence Layer)

**Files:**
- Create: `.opencode/plugins/emperor/store.ts`

**Step 1: Implement EdictStore**

JSON file-based storage at `.opencode/plugins/emperor/data/edicts.json`.

```typescript
// Core API:
// - store.create(edict: Partial<Edict>): Edict
// - store.get(id: string): Edict | undefined
// - store.update(id: string, patch: Partial<Edict>): Edict
// - store.list(filter?: { status?: EdictStatus }): Edict[]
// - store.save(): void  (flush to disk)
```

Key implementation details:
- Generate IDs as `edict_${Date.now()}_${random}`
- Auto-create data directory if not exists
- Read from file on first access, cache in memory
- Write to file on every `save()` call
- Handle concurrent access gracefully (read-before-write)

**Step 2: Manual smoke test**

Import store in index.ts, create a test edict on plugin init, verify the JSON file is created.

**Step 3: Remove smoke test code, commit**

```bash
git add .opencode/plugins/emperor/store.ts
git commit -m "feat: add edict store with JSON persistence"
```

---

### Task 3: Agent System Prompts

**Files:**
- Create: `.opencode/plugins/emperor/agents/prompts.ts`

**Step 1: Write system prompts for all agents**

Each prompt must:
- Clearly define the agent's role and constraints
- For 中书省 and 门下省: specify **strict JSON output format**
- For 六部: specify their domain expertise and output expectations

Agents to define prompts for:
1. `taizi` — 太子: Message triage. Classify as chat vs edict. For edicts, call `下旨` tool.
2. `zhongshu` — 中书省: Accept edict, analyze codebase context, produce structured plan JSON.
3. `menxia` — 门下省: Review plan against 4 criteria (completeness, feasibility, risk, efficiency), output structured review JSON.
4. `bingbu` — 兵部: Code implementation specialist.
5. `gongbu` — 工部: Infrastructure and CI/CD specialist.
6. `libu` — 礼部: Documentation specialist.
7. `xingbu` — 刑部: Security audit and code review specialist.
8. `hubu` — 户部: Testing and data analysis specialist.

Critical: 中书省 and 门下省 prompts must include exact JSON schema examples to ensure parseable output.

**Step 2: Commit**

```bash
git add .opencode/plugins/emperor/agents/prompts.ts
git commit -m "feat: add system prompts for all 8 agents"
```

---

### Task 4: Pipeline — 中书省 Planning Phase

**Files:**
- Create: `.opencode/plugins/emperor/engine/pipeline.ts`

**Step 1: Implement planWithZhongshu function**

```typescript
async function planWithZhongshu(
  client: OpencodeClient,
  edict: Edict,
  attempt: number
): Promise<Plan>
```

Logic:
1. Create a new session via `client.session.create()`
2. Build the prompt (first attempt vs retry with rejection reasons)
3. Send via `client.session.prompt()` with `agent: "zhongshu"`
4. Wait for completion (poll `client.session.status()` or use event subscription)
5. Retrieve messages via `client.session.messages()`
6. Extract assistant's last text response
7. Parse JSON from response — use `JSON.parse()` with regex fallback
8. Validate parsed plan structure
9. Return typed `Plan` object

Key concern: **How to wait for session completion.** Two options:
- Option A: `client.session.prompt()` may block until done (check SDK behavior)
- Option B: Poll `client.session.status()` until idle
- Option C: Use `client.event.subscribe()` for SSE events

Start with Option A (prompt blocking). If it returns immediately, switch to polling.

**Step 2: Implement parsePlan helper**

Extract JSON from LLM response text. Handle cases:
- Clean JSON response
- JSON wrapped in markdown code block
- Malformed JSON — regex extract fields as fallback

**Step 3: Commit**

```bash
git add .opencode/plugins/emperor/engine/pipeline.ts
git commit -m "feat: implement zhongshu planning phase"
```

---

### Task 5: Pipeline — 门下省 Review Phase

**Files:**
- Create: `.opencode/plugins/emperor/engine/reviewer.ts`
- Modify: `.opencode/plugins/emperor/engine/pipeline.ts`

**Step 1: Implement sensitive operation detection**

```typescript
function detectSensitiveOps(plan: Plan): string[]
```

Scan plan subtask descriptions against `SENSITIVE_PATTERNS` regex array. Return matched patterns.

**Step 2: Implement reviewWithMenxia function**

```typescript
async function reviewWithMenxia(
  client: OpencodeClient,
  edict: Edict,
  plan: Plan
): Promise<Review>
```

Logic:
1. Run code-level sensitive operation detection first
2. Create session for 门下省 agent
3. Format review prompt (include the full plan JSON + review criteria)
4. Send prompt and wait for completion
5. Parse review JSON from response
6. Merge code-detected sensitive ops into review result
7. Return typed `Review` object

**Step 3: Implement parseReview helper**

Same pattern as parsePlan — JSON.parse with regex fallback.

**Step 4: Commit**

```bash
git add .opencode/plugins/emperor/engine/reviewer.ts .opencode/plugins/emperor/engine/pipeline.ts
git commit -m "feat: implement menxia review phase with sensitive op detection"
```

---

### Task 6: Pipeline — 尚书省 Dispatch & 六部 Execution

**Files:**
- Create: `.opencode/plugins/emperor/engine/dispatcher.ts`
- Modify: `.opencode/plugins/emperor/engine/pipeline.ts`

**Step 1: Implement topological sort**

```typescript
function topologicalSort(subtasks: Subtask[]): Subtask[][]
```

Group subtasks into execution waves based on `dependencies` field. Subtasks with no dependencies go in wave 0. Subtasks depending on wave 0 items go in wave 1. Etc.

Use Kahn's algorithm. If cycle detected, treat all remaining as single wave (graceful degradation).

**Step 2: Implement executeSubtask function**

```typescript
async function executeSubtask(
  client: OpencodeClient,
  edict: Edict,
  subtask: Subtask
): Promise<Execution>
```

Logic:
1. Create session with title `${department}·${subtask.title}`
2. Build department-specific prompt (include task description + relevant context)
3. Send prompt with `agent: subtask.department`
4. Wait for completion
5. Extract result from assistant response
6. Return `Execution` with status and result

**Step 3: Implement dispatchAndExecute**

```typescript
async function dispatchAndExecute(
  client: OpencodeClient,
  edict: Edict,
  plan: Plan
): Promise<Execution[]>
```

Iterate waves from topologicalSort, `Promise.all` within each wave.

**Step 4: Commit**

```bash
git add .opencode/plugins/emperor/engine/dispatcher.ts .opencode/plugins/emperor/engine/pipeline.ts
git commit -m "feat: implement dispatch and parallel execution"
```

---

### Task 7: Pipeline — Full Orchestration + Memorial Formatting

**Files:**
- Modify: `.opencode/plugins/emperor/engine/pipeline.ts`

**Step 1: Implement runPipeline — the full orchestration**

```typescript
async function runPipeline(
  edict: Edict,
  context: ToolContext,
  client: OpencodeClient,
  store: EdictStore
): Promise<string>
```

Wire together:
1. Planning loop (max 3 attempts with rejection retry)
2. Review with sensitive op detection
3. Human approval via `context.ask()` when needed
4. Dispatch and execute
5. Error handling at each phase
6. State updates via store at each transition
7. AbortSignal checking between phases

**Step 2: Implement formatMemorial**

```typescript
function formatMemorial(edict: Edict, plan: Plan, executions: Execution[]): string
```

Format a readable markdown report:
```
# 奏折：[旨意标题]

## 旨意
[原始内容]

## 规划方案（中书省）
[分析 + 子任务列表]

## 审核意见（门下省）
[审核结果]

## 执行结果
### 兵部
[结果]
### 礼部
[结果]
...

## 总结
[成功/失败统计]
```

**Step 3: Commit**

```bash
git add .opencode/plugins/emperor/engine/pipeline.ts
git commit -m "feat: wire full pipeline orchestration with memorial formatting"
```

---

### Task 8: Custom Tools — 下旨, 查看奏折, 叫停

**Files:**
- Create: `.opencode/plugins/emperor/tools/edict.ts`
- Create: `.opencode/plugins/emperor/tools/memorial.ts`
- Create: `.opencode/plugins/emperor/tools/halt.ts`

**Step 1: Implement 下旨 tool**

Wire tool definition with `runPipeline`. Pass `context` and `client` through.

**Step 2: Implement 查看奏折 tool**

Read from store, format list or single edict details.

**Step 3: Implement 叫停 tool**

Update edict status to "halted". For active sessions, attempt to abort via `client.session.abort()`.

**Step 4: Commit**

```bash
git add .opencode/plugins/emperor/tools/
git commit -m "feat: implement custom tools (edict, memorial, halt)"
```

---

### Task 9: Plugin Entry Point — Wire Everything

**Files:**
- Modify: `.opencode/plugins/emperor/index.ts`

**Step 1: Wire tools + hooks in plugin entry**

```typescript
export const EmperorPlugin: Plugin = async ({ client, project, $, directory, worktree }) => {
  const store = new EdictStore(directory)

  return {
    tool: {
      "下旨": createEdictTool(client, store),
      "查看奏折": createMemorialTool(store),
      "叫停": createHaltTool(client, store),
    },
    event: async ({ event }) => {
      // Optional: log events for debugging
      if (event.type === "session.idle") {
        // Future: progress notifications
      }
    },
  }
}
```

**Step 2: Commit**

```bash
git add .opencode/plugins/emperor/index.ts
git commit -m "feat: wire plugin entry with tools and event hooks"
```

---

### Task 10: Agent Configuration in opencode.json

**Files:**
- Modify: `.opencode/opencode.json`

**Step 1: Configure all 8 agents**

Add agent configurations with:
- Model assignments
- System prompts (reference from prompts.ts or inline)
- Tool whitelists
- Mode (primary vs subagent)
- Descriptions

Note: System prompts in opencode.json should be concise summaries. The detailed prompts injected via `experimental.chat.system.transform` hook can be used for richer context if needed.

**Step 2: Update plugin registration**

Ensure `"plugin"` array includes the local plugin path or just the directory name.

**Step 3: Restart OpenCode, verify agents appear**

Check that all agents are listed via agent cycling (keybind).

**Step 4: Commit**

```bash
git add .opencode/opencode.json
git commit -m "feat: configure 8 agents (taizi + zhongshu + menxia + 5 departments)"
```

---

### Task 11: End-to-End Integration Test

**Files:**
- No new files — manual testing

**Step 1: Test basic chat (太子 direct response)**

Send a casual message like "你好" — verify 太子 responds directly without calling 下旨.

**Step 2: Test simple edict flow**

Send a complex task like:
```
给这个项目创建一个 README.md，要包含项目介绍、安装步骤、使用说明。同时检查一下有没有安全隐患。
```

Verify:
- 太子 calls 下旨 tool
- 中书省 produces a plan with subtasks for 礼部 + 刑部
- 门下省 reviews and approves
- 礼部 and 刑部 execute
- Memorial is returned to user

**Step 3: Test 封驳 flow**

Send a deliberately vague task to see if 门下省 rejects and 中书省 re-plans.

**Step 4: Test 查看奏折**

Ask "查看之前的奏折" — verify the memorial tool returns history.

**Step 5: Fix any issues discovered during testing**

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes"
```

---

### Task 12: Polish & Documentation

**Files:**
- Modify: `README.md` (if user requests)

**Step 1: Add structured logging throughout**

Replace `console.log` with `client.app.log()` at key pipeline stages.

**Step 2: Add TUI toast notifications**

Use `client.tui.showToast()` at pipeline stage transitions:
- "📜 中书省规划中..." (info)
- "🔍 门下省审核中..." (info)
- "✅ 门下省准奏" or "🚫 门下省封驳" (success/warning)
- "⚔️ 六部执行中..." (info)
- "📋 奏折已归档" (success)

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add structured logging and TUI toast notifications"
```
