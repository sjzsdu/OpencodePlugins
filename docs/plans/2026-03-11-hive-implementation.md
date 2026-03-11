# Hive Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Hive plugin — a dynamic domain-agent coordination system where project domains auto-discover, self-organize via EventBus, and autonomously maintain their code.

**Architecture:** Plugin startup scans project → discovers logical domains → dynamically creates per-domain Agents + Queen coordinator → EventBus enables agent-to-agent communication via system prompt injection (receive) and tool calls (publish) → agents execute code changes in parallel with full autonomy.

**Tech Stack:** TypeScript (strict), Bun runtime, @opencode-ai/plugin SDK, @opencode-ai/sdk, JSON file persistence, zod for schema validation.

**Reference patterns:** Follow `.opencode/plugins/commander/` conventions exactly — `tool()` factory, `JsonStore` pattern, `client.session.create/prompt` for agent invocation, `client.tui.showToast` for progress.

**Design doc:** `docs/plans/2026-03-11-hive-plugin-design.md`

---

## Task 1: Types + Config Foundation

**Files:**
- Create: `.opencode/plugins/hive/types.ts`
- Create: `.opencode/plugins/hive/config.ts`

**Step 1: Create type definitions**

```typescript
// .opencode/plugins/hive/types.ts
import type { AgentConfig } from "@opencode-ai/sdk"

// === Domain ===

export interface Domain {
  id: string
  name: string
  description: string
  paths: string[]
  techStack: string
  responsibilities: string
  interfaces: string[]
  dependencies: string[]  // other domain ids
  conventions: string[]
  disabled?: boolean
}

// === Events ===

export type EventType =
  | "requirement_broadcast"
  | "relevance_response"
  | "interface_proposal"
  | "interface_accepted"
  | "interface_rejected"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "file_changed"
  | "breaking_change"
  | "dependency_updated"
  | "action_proposal"
  | "action_completed"
  | "help_request"
  | "conflict_detected"
  | "info"

export interface HiveEvent {
  id: string
  type: EventType
  source: string
  target: string  // domain id or "*"
  payload: {
    message: string
    data?: unknown
  }
  timestamp: number
  consumed: string[]
  status: "pending" | "consumed" | "expired"
}

// === Discovery Cache ===

export interface DomainCache {
  structureHash: string
  discoveredAt: number
  source: "static" | "llm" | "user"
  domains: Domain[]
}

// === Config ===

export type AutonomyLevel = "passive" | "propose" | "full"

export interface HiveUserConfig {
  domains?: Record<string, Partial<Domain> & { disabled?: boolean }>
  discovery?: {
    model?: string
    autoRefresh?: boolean
  }
  coordination?: {
    autonomyLevel?: AutonomyLevel
  }
  queen?: {
    model?: string
  }
  store?: {
    dataDir?: string
  }
}

export interface HiveConfig {
  domains: Record<string, Partial<Domain> & { disabled?: boolean }>
  discovery: {
    model: string
    autoRefresh: boolean
  }
  coordination: {
    autonomyLevel: AutonomyLevel
  }
  queen: {
    model: string
  }
  store: {
    dataDir: string
  }
}
```

**Step 2: Create config loader**

Follow Commander's `config.ts` pattern exactly.

```typescript
// .opencode/plugins/hive/config.ts
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { HiveConfig, HiveUserConfig } from "./types"

const DEFAULTS: Omit<HiveConfig, "domains"> = {
  discovery: {
    model: "anthropic/claude-sonnet-4-20250514",
    autoRefresh: true,
  },
  coordination: {
    autonomyLevel: "full",
  },
  queen: {
    model: "anthropic/claude-sonnet-4-20250514",
  },
  store: {
    dataDir: ".hive",
  },
}

export function loadConfig(directory: string): HiveConfig {
  const configPath = join(directory, ".opencode", "hive.json")
  let userConfig: HiveUserConfig = {}

  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8")
      userConfig = JSON.parse(raw) as HiveUserConfig
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`[hive] Invalid JSON in ${configPath}, using defaults`)
    } else {
      console.warn(`[hive] Failed to load config: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    domains: userConfig.domains ?? {},
    discovery: { ...DEFAULTS.discovery, ...userConfig.discovery },
    coordination: { ...DEFAULTS.coordination, ...userConfig.coordination },
    queen: { ...DEFAULTS.queen, ...userConfig.queen },
    store: { ...DEFAULTS.store, ...userConfig.store },
  }
}
```

**Step 3: Verify types compile**

Run: `bun run build`
Expected: No type errors.

**Step 4: Commit**

```
feat(hive): add type definitions and config loader
```

---

## Task 2: Store + EventBus Core

**Files:**
- Create: `.opencode/plugins/hive/store.ts`
- Create: `.opencode/plugins/hive/eventbus/types.ts` (re-export from main types)
- Create: `.opencode/plugins/hive/eventbus/bus.ts`

**Step 1: Create store (directory manager)**

```typescript
// .opencode/plugins/hive/store.ts
// Follow Commander's JsonTaskStore pattern.
// Manages .hive/ directory: domains.json, events.json
// Methods: saveDomains(), loadDomains(), saveEvents(), loadEvents()
```

**Step 2: Implement EventBus core**

```typescript
// .opencode/plugins/hive/eventbus/bus.ts
import type { HiveEvent, EventType, Domain } from "../types"

export class HiveEventBus {
  private events: HiveEvent[] = []
  private subscriptions: Map<string, Set<string>> = new Map()
  // domainId → Set<EventType>

  constructor(
    private persistFn: (events: HiveEvent[]) => void,
    private restoreFn: () => HiveEvent[],
  ) {}

  restore(): void {
    this.events = this.restoreFn()
  }

  autoSubscribe(domain: Domain): void {
    // Subscribe based on domain dependencies:
    // - All agents: requirement_broadcast, conflict_detected
    // - Dependents: breaking_change, interface_proposal from deps
    // - All: file_changed, action_proposal
  }

  publish(event: Omit<HiveEvent, "id" | "timestamp" | "consumed" | "status">): string {
    // Generate id, push to events, persist, return id
  }

  consume(domainId: string): HiveEvent[] {
    // Filter pending events matching domain's subscriptions
    // Mark as consumed for this domain
    // Persist
    // Return matching events
  }

  getAll(): HiveEvent[] {
    return [...this.events]
  }

  cleanup(maxAgeMs: number = 3600_000): void {
    // Remove expired/fully-consumed events older than maxAge
  }
}
```

Key logic for `consume()`:
- Skip already consumed by this domain
- Skip self-published events
- Match: target === domainId OR (target === "*" AND type in subscriptions)

**Step 3: Verify compile**

Run: `bun run build`

**Step 4: Commit**

```
feat(hive): add store and EventBus core
```

---

## Task 3: EventBus Tests

**Files:**
- Create: `.opencode/plugins/hive/eventbus/bus.test.ts`

**Step 1: Write EventBus unit tests**

```typescript
// .opencode/plugins/hive/eventbus/bus.test.ts
import { describe, expect, test, beforeEach } from "bun:test"
import { HiveEventBus } from "./bus"
import type { Domain, HiveEvent } from "../types"

describe("HiveEventBus", () => {
  let bus: HiveEventBus
  let persisted: HiveEvent[]

  const frontendDomain: Domain = {
    id: "frontend",
    name: "Frontend",
    description: "React frontend",
    paths: ["src/client/"],
    techStack: "React",
    responsibilities: "UI",
    interfaces: [],
    dependencies: ["backend"],
    conventions: [],
  }

  const backendDomain: Domain = {
    id: "backend",
    name: "Backend",
    description: "Express backend",
    paths: ["src/server/"],
    techStack: "Express",
    responsibilities: "API",
    interfaces: ["GET /api/users"],
    dependencies: [],
    conventions: [],
  }

  beforeEach(() => {
    persisted = []
    bus = new HiveEventBus(
      (events) => { persisted = events },
      () => [],
    )
    bus.autoSubscribe(frontendDomain)
    bus.autoSubscribe(backendDomain)
  })

  test("publish returns event id", () => {
    const id = bus.publish({
      type: "info",
      source: "frontend",
      target: "backend",
      payload: { message: "hello" },
    })
    expect(id).toMatch(/^evt_/)
  })

  test("targeted event delivered to correct domain", () => {
    bus.publish({
      type: "interface_proposal",
      source: "frontend",
      target: "backend",
      payload: { message: "Need GET /profile" },
    })
    const backendEvents = bus.consume("backend")
    const frontendEvents = bus.consume("frontend")
    expect(backendEvents).toHaveLength(1)
    expect(frontendEvents).toHaveLength(0)
  })

  test("broadcast delivered to all except source", () => {
    bus.publish({
      type: "requirement_broadcast",
      source: "queen",
      target: "*",
      payload: { message: "Add OAuth" },
    })
    expect(bus.consume("frontend")).toHaveLength(1)
    expect(bus.consume("backend")).toHaveLength(1)
  })

  test("consumed events not re-delivered", () => {
    bus.publish({
      type: "requirement_broadcast",
      source: "queen",
      target: "*",
      payload: { message: "test" },
    })
    bus.consume("frontend") // first consume
    expect(bus.consume("frontend")).toHaveLength(0) // second consume = empty
  })

  test("self-published events not delivered to self", () => {
    bus.publish({
      type: "task_completed",
      source: "frontend",
      target: "*",
      payload: { message: "done" },
    })
    expect(bus.consume("frontend")).toHaveLength(0)
  })

  test("persist called on publish", () => {
    bus.publish({
      type: "info",
      source: "frontend",
      target: "*",
      payload: { message: "test" },
    })
    expect(persisted.length).toBeGreaterThan(0)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test .opencode/plugins/hive/eventbus/bus.test.ts`
Expected: Tests fail (publish/consume not yet fully implemented).

**Step 3: Complete EventBus implementation to pass tests**

Implement the full `publish()`, `consume()`, `autoSubscribe()` logic.

**Step 4: Run tests to verify they pass**

Run: `bun test .opencode/plugins/hive/eventbus/bus.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```
test(hive): add EventBus unit tests and complete implementation
```

---

## Task 4: Discovery — Static Scanner

**Files:**
- Create: `.opencode/plugins/hive/discovery/scanner.ts`
- Create: `.opencode/plugins/hive/discovery/cache.ts`

**Step 1: Implement static scanner**

The scanner reads project structure without LLM calls. It detects:

```typescript
// .opencode/plugins/hive/discovery/scanner.ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, basename } from "node:path"
import type { Domain } from "../types"

interface ScanResult {
  structureHash: string
  domains: Domain[]
}

export function scanProject(directory: string): ScanResult {
  const domains: Domain[] = []

  // 1. Check package.json workspaces
  const pkgPath = join(directory, "package.json")
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    if (pkg.workspaces) {
      // Resolve workspace globs → actual directories → Domain per workspace
      domains.push(...resolveWorkspaces(directory, pkg.workspaces))
    }
  }

  // 2. Check pnpm-workspace.yaml
  const pnpmPath = join(directory, "pnpm-workspace.yaml")
  if (existsSync(pnpmPath) && domains.length === 0) {
    // Parse yaml, resolve packages → Domain per package
    domains.push(...resolvePnpmWorkspaces(directory, pnpmPath))
  }

  // 3. Heuristic directory detection (if no workspaces found)
  if (domains.length === 0) {
    domains.push(...detectByStructure(directory))
  }

  // 4. Compute structure hash
  const structureHash = computeStructureHash(directory)

  return { structureHash, domains }
}
```

**Heuristic detection rules (`detectByStructure`):**

| Pattern | Domain | Tech Stack Signal |
|---------|--------|-------------------|
| `src/client/` or `src/frontend/` or `client/` or `frontend/` | frontend | Check for react/vue/angular in deps |
| `src/server/` or `src/backend/` or `server/` or `backend/` or `src/api/` | backend | Check for express/fastify/hono in deps |
| `apps/*` directories | One domain per app | Read each app's package.json |
| `packages/*` directories | One domain per package | Read each package's package.json |
| `.github/workflows/` or `Dockerfile` or `docker-compose.yml` | infra | CI/CD |
| `docs/` | docs | Documentation |

**`computeStructureHash`:** Hash of sorted top-level directory names + existence of key config files. This is fast and doesn't require git.

**Step 2: Implement cache**

```typescript
// .opencode/plugins/hive/discovery/cache.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { DomainCache } from "../types"

export class DiscoveryCache {
  private readonly filePath: string

  constructor(baseDir: string, dataDir: string) {
    const dir = join(baseDir, dataDir)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, "domains.json")
  }

  load(): DomainCache | null {
    if (!existsSync(this.filePath)) return null
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as DomainCache
    } catch {
      return null
    }
  }

  save(cache: DomainCache): void {
    writeFileSync(this.filePath, JSON.stringify(cache, null, 2), "utf-8")
  }

  isValid(currentHash: string): boolean {
    const cached = this.load()
    return cached !== null && cached.structureHash === currentHash
  }
}
```

**Step 3: Verify compile**

Run: `bun run build`

**Step 4: Commit**

```
feat(hive): add static scanner and discovery cache
```

---

## Task 5: Discovery — LLM Analyzer + Merger

**Files:**
- Create: `.opencode/plugins/hive/discovery/analyzer.ts`
- Create: `.opencode/plugins/hive/discovery/merger.ts`
- Create: `.opencode/plugins/hive/discovery/index.ts` (orchestrator)

**Step 1: Implement LLM analyzer**

```typescript
// .opencode/plugins/hive/discovery/analyzer.ts
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Domain } from "../types"

// Takes static scan results + reads key files → asks LLM to produce Domain[]
export async function analyzeWithLLM(
  client: OpencodeClient,
  directory: string,
  staticDomains: Domain[],
  model: string,
): Promise<Domain[]> {
  // 1. Gather context: README, key entry files, package.json descriptions
  // 2. Build prompt with static scan results as hints
  // 3. Create session, prompt LLM for structured JSON output
  // 4. Parse response into Domain[]
  // 5. Return enriched domains
}
```

**LLM Prompt structure:**
- Input: static scan results, project README, key file summaries
- Output: JSON array of Domain objects with filled-in techStack, responsibilities, interfaces, conventions
- Fallback: if LLM fails or unparseable, return static scan results as-is

**Step 2: Implement merger**

```typescript
// .opencode/plugins/hive/discovery/merger.ts
import type { Domain, HiveConfig } from "../types"

// Merge: auto-discovered domains + user overrides from hive.json
export function mergeDomains(
  discovered: Domain[],
  userOverrides: HiveConfig["domains"],
): Domain[] {
  const result: Domain[] = []

  for (const domain of discovered) {
    const override = userOverrides[domain.id]
    if (override?.disabled) continue  // User disabled this domain
    if (override) {
      result.push({ ...domain, ...override })  // User overrides fields
    } else {
      result.push(domain)
    }
  }

  // User-defined domains not in discovered list
  for (const [id, def] of Object.entries(userOverrides)) {
    if (def.disabled) continue
    if (result.some(d => d.id === id)) continue
    // Must have at least paths to be valid
    if (def.paths && def.paths.length > 0) {
      result.push({
        id,
        name: def.name ?? id,
        description: def.description ?? `Domain: ${id}`,
        paths: def.paths,
        techStack: def.techStack ?? "",
        responsibilities: def.responsibilities ?? "",
        interfaces: def.interfaces ?? [],
        dependencies: def.dependencies ?? [],
        conventions: def.conventions ?? [],
      })
    }
  }

  return result
}
```

**Step 3: Create discovery orchestrator**

```typescript
// .opencode/plugins/hive/discovery/index.ts
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Domain, HiveConfig } from "../types"
import { scanProject } from "./scanner"
import { DiscoveryCache } from "./cache"
import { analyzeWithLLM } from "./analyzer"
import { mergeDomains } from "./merger"

export async function discoverDomains(
  directory: string,
  config: HiveConfig,
  client: OpencodeClient,
): Promise<Domain[]> {
  const cache = new DiscoveryCache(directory, config.store.dataDir)
  const scan = scanProject(directory)

  // Check cache
  if (cache.isValid(scan.structureHash)) {
    const cached = cache.load()!
    return mergeDomains(cached.domains, config.domains)
  }

  // Static scan gives immediate results
  let domains = scan.domains

  // LLM enrichment (async, may be slow)
  try {
    domains = await analyzeWithLLM(client, directory, domains, config.discovery.model)
  } catch (err) {
    console.warn(`[hive] LLM analysis failed, using static scan results: ${err}`)
  }

  // Cache results
  cache.save({
    structureHash: scan.structureHash,
    discoveredAt: Date.now(),
    source: "llm",
    domains,
  })

  // Merge with user config
  return mergeDomains(domains, config.domains)
}
```

**Step 4: Verify compile**

Run: `bun run build`

**Step 5: Commit**

```
feat(hive): add LLM analyzer, merger, and discovery orchestrator
```

---

## Task 6: Discovery Tests

**Files:**
- Create: `.opencode/plugins/hive/discovery/scanner.test.ts`
- Create: `.opencode/plugins/hive/discovery/merger.test.ts`

**Step 1: Write scanner tests**

```typescript
// Test scanProject with mocked directory structures:
// - monorepo with workspaces → domains per workspace
// - fullstack with src/client + src/server → frontend + backend domains
// - flat project → single domain
// - structureHash changes when dir structure changes
```

**Step 2: Write merger tests**

```typescript
// Test mergeDomains:
// - user override merges into discovered domain
// - disabled domain removed
// - user-only domain (not discovered) added if paths present
// - user-only domain without paths ignored
```

**Step 3: Run tests**

Run: `bun test .opencode/plugins/hive/discovery/`
Expected: All PASS.

**Step 4: Commit**

```
test(hive): add discovery scanner and merger tests
```

---

## Task 7: Agent Generator

**Files:**
- Create: `.opencode/plugins/hive/agents/prompts.ts`
- Create: `.opencode/plugins/hive/agents/queen.ts`
- Create: `.opencode/plugins/hive/agents/generator.ts`
- Create: `.opencode/plugins/hive/agents/index.ts`

**Step 1: Create prompt templates**

```typescript
// .opencode/plugins/hive/agents/prompts.ts
import type { Domain } from "../types"

export function buildDomainPrompt(domain: Domain): string {
  // Return the full domain agent prompt from the design doc (Section 5.2)
  // Includes: identity, scope, conventions, perception/negotiation/execution rules
}

export function buildQueenPrompt(domains: Domain[]): string {
  // Return the Queen coordinator prompt from the design doc (Section 5.3)
  // Includes: registered domains listing, dependency graph, coordination rules
}

export function buildDependencyGraph(domains: Domain[]): string {
  // Render a text-based dependency graph
  // e.g. "frontend → backend → database"
}
```

**Step 2: Create generator**

```typescript
// .opencode/plugins/hive/agents/generator.ts
import type { AgentConfig } from "@opencode-ai/sdk"
import type { Domain, HiveConfig } from "../types"
import { buildDomainPrompt, buildQueenPrompt } from "./prompts"

// Color palette for dynamic domains
const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
                "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1"]

export function generateAgents(
  domains: Domain[],
  config: HiveConfig,
): Record<string, AgentConfig> {
  const agents: Record<string, AgentConfig> = {}

  // Queen (coordinator)
  agents["queen"] = {
    name: "queen",
    description: "Hive Coordinator — analyzes requirements, coordinates domain agents",
    mode: "primary",
    color: "#F59E0B",
    model: config.queen.model,
    prompt: buildQueenPrompt(domains),
  }

  // Domain agents
  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i]
    agents[domain.id] = {
      name: domain.id,
      description: `${domain.name} — ${domain.description}`,
      mode: "all",
      color: COLORS[i % COLORS.length],
      prompt: buildDomainPrompt(domain),
    }
  }

  return agents
}
```

**Step 3: Create agent index**

```typescript
// .opencode/plugins/hive/agents/index.ts
export { generateAgents } from "./generator"
export { buildDomainPrompt, buildQueenPrompt } from "./prompts"
```

**Step 4: Verify compile**

Run: `bun run build`

**Step 5: Commit**

```
feat(hive): add agent generator with domain and queen prompts
```

---

## Task 8: Agent Generator Tests

**Files:**
- Create: `.opencode/plugins/hive/agents/generator.test.ts`

**Step 1: Write tests**

```typescript
// Test generateAgents:
// - always creates "queen" agent with primary mode
// - creates one agent per domain with "all" mode
// - each agent has non-empty prompt containing domain info
// - color assigned from palette
// - queen prompt contains all domain descriptions
```

Follow the pattern from commander's `agents.test.ts`.

**Step 2: Run tests**

Run: `bun test .opencode/plugins/hive/agents/`
Expected: All PASS.

**Step 3: Commit**

```
test(hive): add agent generator tests
```

---

## Task 9: Tools — hive_emit + hive_status

**Files:**
- Create: `.opencode/plugins/hive/tools/emit.ts`
- Create: `.opencode/plugins/hive/tools/status.ts`

**Step 1: Implement hive_emit**

Follow Commander's `createTaskTool` pattern.

```typescript
// .opencode/plugins/hive/tools/emit.ts
import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { HiveEventBus } from "../eventbus/bus"
import type { EventType } from "../types"

// sessionToDomain map passed in so we know which domain agent is calling
export function createEmitTool(
  eventBus: HiveEventBus,
  sessionToDomain: Map<string, string>,
) {
  return tool({
    description: `发布事件到其他Domain Agent。用于通知接口变更、请求协助、宣告任务完成等。其他Agent会在下次交互时自动收到你的消息。`,
    args: {
      type: z.enum([
        "interface_proposal", "interface_accepted", "interface_rejected",
        "task_started", "task_completed", "task_failed",
        "breaking_change", "action_proposal", "action_completed",
        "help_request", "info",
      ]).describe("事件类型"),
      target: z.string().describe('目标domain id，或 "*" 广播给所有'),
      message: z.string().describe("事件内容，要具体到其他Agent能据此行动"),
      data: z.any().optional().describe("结构化数据（如接口定义）"),
    },
    async execute(args, context) {
      const source = sessionToDomain.get(context.sessionID)
      if (!source) return "❌ 无法识别当前Domain Agent身份"

      const eventId = eventBus.publish({
        type: args.type as EventType,
        source,
        target: args.target,
        payload: { message: args.message, data: args.data },
      })
      const targetDesc = args.target === "*" ? "所有Domain" : args.target
      return `✅ 事件已发布 (${eventId}) [${args.type}] → ${targetDesc}`
    },
  })
}
```

**Step 2: Implement hive_status**

```typescript
// .opencode/plugins/hive/tools/status.ts
// Shows: registered domains, pending events count, active sessions
// Takes optional "detail" arg: "overview" | "events" | "domains"
```

**Step 3: Verify compile**

Run: `bun run build`

**Step 4: Commit**

```
feat(hive): add hive_emit and hive_status tools
```

---

## Task 10: Tools — hive_broadcast + hive_negotiate + hive_dispatch

**Files:**
- Create: `.opencode/plugins/hive/tools/broadcast.ts`
- Create: `.opencode/plugins/hive/tools/negotiate.ts`
- Create: `.opencode/plugins/hive/tools/dispatch.ts`

**Step 1: Implement hive_broadcast**

Queen-only tool. Uses `client.session.create` + `client.session.prompt` to ask each domain agent for relevance assessment.

Key pattern from Commander's pipeline.ts:
```typescript
const session = await client.session.create({ body: { title: `Hive·${domain.name}·感知` } })
const response = await client.session.prompt({
  path: { id: session.data!.id },
  body: {
    agent: domain.id,
    parts: [{ type: "text" as const, text: prompt }],
  },
})
```

Collect assessments from all domains, return formatted summary.

**Step 2: Implement hive_negotiate**

Takes requester + provider domain ids.
1. Prompt requester for interface spec
2. Prompt provider to evaluate
3. If agreed → publish interface_accepted event
4. Return negotiation summary

**Step 3: Implement hive_dispatch**

Takes array of `{domain, instruction}`.
`Promise.all` parallel execution — create session per domain, prompt, collect results.
Publish task_started/task_completed events automatically.

Follow Commander's `dispatchAll` pattern for parallel execution.

**Step 4: Verify compile**

Run: `bun run build`

**Step 5: Commit**

```
feat(hive): add broadcast, negotiate, and dispatch tools
```

---

## Task 11: Hooks

**Files:**
- Create: `.opencode/plugins/hive/hooks/config.ts`
- Create: `.opencode/plugins/hive/hooks/system-transform.ts`
- Create: `.opencode/plugins/hive/hooks/file-watcher.ts`
- Create: `.opencode/plugins/hive/hooks/autonomy.ts`
- Create: `.opencode/plugins/hive/hooks/index.ts`

**Step 1: Config hook — dynamic agent registration**

```typescript
// .opencode/plugins/hive/hooks/config.ts
import type { AgentConfig } from "@opencode-ai/sdk"

export function createConfigHook(agents: Record<string, AgentConfig>) {
  return async (openCodeConfig: any) => {
    if (!openCodeConfig.agent) openCodeConfig.agent = {}
    for (const [id, agentConfig] of Object.entries(agents)) {
      openCodeConfig.agent[id] = agentConfig
    }
  }
}
```

**Step 2: System-transform hook — event injection**

```typescript
// .opencode/plugins/hive/hooks/system-transform.ts
import type { HiveEventBus } from "../eventbus/bus"
import type { HiveEvent } from "../types"

export function createSystemTransformHook(
  eventBus: HiveEventBus,
  sessionToDomain: Map<string, string>,
) {
  return async (
    input: { sessionID?: string; model: any },
    output: { system: string[] },
  ) => {
    if (!input.sessionID) return
    const domainId = sessionToDomain.get(input.sessionID)
    if (!domainId) return

    const pending = eventBus.consume(domainId)
    if (pending.length === 0) return

    const formatted = pending.map(e =>
      `[${e.source}] (${e.type}) ${e.payload.message}`
    ).join("\n")

    output.system.push(
      `\n## 📬 来自其他Domain的通知\n\n${formatted}\n\n请根据以上通知评估是否需要采取行动。`
    )
  }
}
```

**Step 3: File-watcher hook**

```typescript
// .opencode/plugins/hive/hooks/file-watcher.ts
// Intercepts tool.execute.after for "write" and "edit" tools
// Publishes file_changed event to EventBus
// Identifies which domain owns the changed file by matching paths
```

**Step 4: Autonomy hook**

```typescript
// .opencode/plugins/hive/hooks/autonomy.ts
// When a breaking_change event is published AND autonomyLevel is "full":
// Find dependent domains → create sessions → prompt them to self-adapt
// When autonomyLevel is "propose": just notify, don't auto-execute
// When "passive": do nothing
```

**Step 5: Create hooks index**

```typescript
// .opencode/plugins/hive/hooks/index.ts
export { createConfigHook } from "./config"
export { createSystemTransformHook } from "./system-transform"
export { createFileWatcherHook } from "./file-watcher"
export { createAutonomyHandler } from "./autonomy"
```

**Step 6: Verify compile**

Run: `bun run build`

**Step 7: Commit**

```
feat(hive): add hooks for config, system-transform, file-watcher, autonomy
```

---

## Task 12: Plugin Entry + Wiring

**Files:**
- Create: `.opencode/plugins/hive/index.ts`

**Step 1: Wire everything together**

Follow Commander's `index.ts` pattern exactly:

```typescript
// .opencode/plugins/hive/index.ts
import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { HiveEventBus } from "./eventbus/bus"
import { discoverDomains } from "./discovery/index"
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
// Store for persistence
import { HiveStore } from "./store"

export const HivePlugin: Plugin = async ({ client, directory }) => {
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

  // Discover domains
  const domains = await discoverDomains(directory, config, client)

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

  client.tui.showToast({
    body: {
      message: `🐝 Hive initialized: ${domains.length} domains (${domains.map(d => d.id).join(", ")})`,
      variant: "info",
    },
  })

  return {
    config: createConfigHook(agents),

    "experimental.chat.system.transform": createSystemTransformHook(
      eventBus, sessionToDomain,
    ),

    "tool.execute.after": createFileWatcherHook(
      eventBus, domains, sessionToDomain, autonomyHandler,
    ),

    tool: {
      hive_emit: createEmitTool(eventBus, sessionToDomain),
      hive_status: createStatusTool(domains, eventBus),
      hive_broadcast: createBroadcastTool(eventBus, domains, client, sessionToDomain, config),
      hive_negotiate: createNegotiateTool(eventBus, domains, client, sessionToDomain),
      hive_dispatch: createDispatchTool(eventBus, domains, client, sessionToDomain),
    },
  }
}
```

**Step 2: Register plugin**

Add to `.opencode/opencode.json`:
```json
{
  "plugin": [
    "./plugins/commander/index.ts",
    "./plugins/emperor/index.ts",
    "./plugins/hive/index.ts"
  ]
}
```

**Step 3: Verify full build**

Run: `bun run build`
Expected: Zero type errors.

**Step 4: Run all tests**

Run: `bun test`
Expected: All tests PASS.

**Step 5: Commit**

```
feat(hive): wire plugin entry and register in opencode config
```

---

## Task 13: Integration Smoke Test

**Files:**
- Create: `.opencode/plugins/hive/hive.test.ts`

**Step 1: Write integration test**

```typescript
// .opencode/plugins/hive/hive.test.ts
import { describe, expect, test } from "bun:test"
import { loadConfig } from "./config"
import { HiveEventBus } from "./eventbus/bus"
import { generateAgents } from "./agents/index"
import { mergeDomains } from "./discovery/merger"
import type { Domain } from "./types"

// Verifies the full flow: domains → agents → eventbus → hooks
// without requiring a live OpenCode instance

const MOCK_DOMAINS: Domain[] = [
  {
    id: "frontend",
    name: "Frontend",
    description: "React SPA",
    paths: ["src/client/"],
    techStack: "React 18, TypeScript",
    responsibilities: "UI rendering",
    interfaces: ["App", "Router"],
    dependencies: ["backend"],
    conventions: ["Use functional components"],
  },
  {
    id: "backend",
    name: "Backend",
    description: "Express API",
    paths: ["src/server/"],
    techStack: "Express, Prisma",
    responsibilities: "API and data layer",
    interfaces: ["GET /api/users", "POST /api/auth"],
    dependencies: [],
    conventions: ["RESTful conventions"],
  },
]

describe("Hive integration", () => {
  test("generates correct agents from domains", () => {
    const config = loadConfig("/nonexistent") // uses defaults
    const agents = generateAgents(MOCK_DOMAINS, config)

    // Queen + 2 domains = 3 agents
    expect(Object.keys(agents)).toHaveLength(3)
    expect(agents["queen"]).toBeDefined()
    expect(agents["queen"].mode).toBe("primary")
    expect(agents["frontend"]).toBeDefined()
    expect(agents["frontend"].mode).toBe("all")
    expect(agents["backend"]).toBeDefined()
  })

  test("queen prompt contains all domain info", () => {
    const config = loadConfig("/nonexistent")
    const agents = generateAgents(MOCK_DOMAINS, config)
    const queenPrompt = agents["queen"].prompt!
    expect(queenPrompt).toContain("frontend")
    expect(queenPrompt).toContain("backend")
    expect(queenPrompt).toContain("React SPA")
  })

  test("domain agent prompt contains domain-specific info", () => {
    const config = loadConfig("/nonexistent")
    const agents = generateAgents(MOCK_DOMAINS, config)
    const fePrompt = agents["frontend"].prompt!
    expect(fePrompt).toContain("React 18")
    expect(fePrompt).toContain("src/client/")
    expect(fePrompt).toContain("functional components")
    // Should NOT contain backend details
    expect(fePrompt).not.toContain("Express")
    expect(fePrompt).not.toContain("Prisma")
  })

  test("eventbus integration with domain subscriptions", () => {
    const bus = new HiveEventBus(() => {}, () => [])
    for (const d of MOCK_DOMAINS) bus.autoSubscribe(d)

    // Backend publishes breaking change
    bus.publish({
      type: "breaking_change",
      source: "backend",
      target: "*",
      payload: { message: "Changed /api/users response format" },
    })

    // Frontend (depends on backend) should receive it
    const feEvents = bus.consume("frontend")
    expect(feEvents).toHaveLength(1)
    expect(feEvents[0].payload.message).toContain("/api/users")

    // Backend should NOT receive its own event
    const beEvents = bus.consume("backend")
    expect(beEvents).toHaveLength(0)
  })

  test("merger applies user overrides correctly", () => {
    const merged = mergeDomains(MOCK_DOMAINS, {
      frontend: { techStack: "Vue 3 + Pinia" },
      backend: { disabled: true },
      infra: {
        paths: [".github/"],
        description: "CI/CD",
      },
    })

    // Frontend overridden
    const fe = merged.find(d => d.id === "frontend")!
    expect(fe.techStack).toBe("Vue 3 + Pinia")

    // Backend disabled
    expect(merged.find(d => d.id === "backend")).toBeUndefined()

    // Infra added
    const infra = merged.find(d => d.id === "infra")!
    expect(infra.paths).toEqual([".github/"])
  })
})
```

**Step 2: Run all tests**

Run: `bun test`
Expected: All PASS.

**Step 3: Run full type check**

Run: `bun run build`
Expected: Zero errors.

**Step 4: Commit**

```
test(hive): add integration smoke tests
```

---

## Task 14: Update Project Documentation

**Files:**
- Modify: `README.md` — add Hive to plugin table
- Modify: `README.zh-CN.md` — same

**Step 1: Update READMEs**

Add Hive to the plugin table:

```markdown
| [**Hive**](.opencode/plugins/hive/) | Dynamic | Domain auto-discovery, EventBus coordination, autonomous execution | Large multi-domain projects | [README](.opencode/plugins/hive/README.md) |
```

Add Hive section with architecture diagram.

**Step 2: Commit**

```
docs: add Hive plugin to project documentation
```

---

## File Tree Summary

```
.opencode/plugins/hive/
├── index.ts                          # Plugin entry
├── types.ts                          # All type definitions
├── config.ts                         # Config loader (hive.json)
├── store.ts                          # .hive/ directory persistence
├── hive.test.ts                      # Integration smoke test
│
├── discovery/
│   ├── index.ts                      # Discovery orchestrator
│   ├── scanner.ts                    # Static project scan
│   ├── scanner.test.ts               # Scanner tests
│   ├── analyzer.ts                   # LLM-powered analysis
│   ├── merger.ts                     # User config merge
│   ├── merger.test.ts                # Merger tests
│   └── cache.ts                      # Discovery cache
│
├── agents/
│   ├── index.ts                      # Exports
│   ├── generator.ts                  # Domain → AgentConfig
│   ├── generator.test.ts             # Generator tests
│   ├── prompts.ts                    # Domain + Queen prompt templates
│   └── queen.ts                      # Queen agent definition
│
├── eventbus/
│   ├── bus.ts                        # EventBus core
│   └── bus.test.ts                   # EventBus tests
│
├── tools/
│   ├── emit.ts                       # hive_emit
│   ├── status.ts                     # hive_status
│   ├── broadcast.ts                  # hive_broadcast
│   ├── negotiate.ts                  # hive_negotiate
│   └── dispatch.ts                   # hive_dispatch
│
└── hooks/
    ├── index.ts                      # Exports
    ├── config.ts                     # Dynamic agent registration
    ├── system-transform.ts           # Event injection into agent context
    ├── file-watcher.ts               # File change detection
    └── autonomy.ts                   # Autonomous response handler
```

## Execution Order

| # | Task | Key Deliverable | Est. Effort |
|---|------|-----------------|-------------|
| 1 | Types + Config | Foundation types, config loader | Low |
| 2 | Store + EventBus Core | Persistence + event pub/sub | Medium |
| 3 | EventBus Tests | Verified EventBus correctness | Low |
| 4 | Discovery: Scanner + Cache | Static project analysis | Medium |
| 5 | Discovery: Analyzer + Merger | LLM enrichment + user merge | Medium |
| 6 | Discovery Tests | Verified discovery correctness | Low |
| 7 | Agent Generator | Domain → AgentConfig mapping | Medium |
| 8 | Agent Generator Tests | Verified agent generation | Low |
| 9 | Tools: emit + status | Basic agent communication | Low |
| 10 | Tools: broadcast + negotiate + dispatch | Full coordination toolkit | High |
| 11 | Hooks | config, system-transform, file-watcher, autonomy | High |
| 12 | Plugin Entry + Wiring | Everything connected | Medium |
| 13 | Integration Smoke Test | End-to-end verification | Medium |
| 14 | Documentation | README updates | Low |
