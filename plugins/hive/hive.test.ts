import { describe, expect, test } from "bun:test"
import { loadConfig } from "./config"
import { HiveEventBus } from "./eventbus/bus"
import { generateAgents } from "./agents/index"
import { mergeDomains } from "./discovery/merger"
import type { Domain } from "./types"

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
    const config = loadConfig("/nonexistent")
    const agents = generateAgents(MOCK_DOMAINS, config)

    // Queen + project + 2 domains = 4 agents
    expect(Object.keys(agents)).toHaveLength(4)
    expect(agents["project"]).toBeDefined()
    expect(agents["queen"]).toBeDefined()
    expect(agents["queen"].mode).toBe("primary")
    expect(agents["frontend"]).toBeDefined()
    expect(agents["frontend"].mode).toBe("subagent")
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

  test("config loader returns defaults for nonexistent directory", () => {
    const config = loadConfig("/nonexistent")
    expect(config.coordination.autonomyLevel).toBe("full")
    expect(config.discovery.autoRefresh).toBe(true)
    expect(config.store.dataDir).toBe(".hive")
    expect(config.queen.model).toBeUndefined()
  })

  test("eventbus cleanup removes old consumed events", () => {
    const bus = new HiveEventBus(() => {}, () => [])
    for (const d of MOCK_DOMAINS) bus.autoSubscribe(d)

    bus.publish({
      type: "info",
      source: "queen",
      target: "*",
      payload: { message: "old event" },
    })

    // Consume in all domains
    bus.consume("frontend")
    bus.consume("backend")

    // All events should be in the bus
    expect(bus.getAll().length).toBe(1)

    // Manually backdate the event timestamp to ensure cleanup works
    const events = bus.getAll()
    events[0].timestamp = Date.now() - 10_000 // 10 seconds ago

    // Cleanup with 1ms max age — should remove old consumed events
    bus.cleanup(1)
    expect(bus.getAll().length).toBe(0)
  })
})
