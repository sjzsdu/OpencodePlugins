import { describe, expect, test } from "bun:test"
import { generateAgents } from "./generator"
import { loadConfig } from "../config"
import type { Domain } from "../types"

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

describe("generateAgents", () => {
  const config = loadConfig("/nonexistent")

  test("always creates queen agent with primary mode", () => {
    const agents = generateAgents(MOCK_DOMAINS, config)
    expect(agents["queen"]).toBeDefined()
    expect(agents["queen"].mode).toBe("primary")
    expect(agents["queen"].name).toBe("queen")
  })

  test("creates one agent per domain with subagent mode", () => {
    const agents = generateAgents(MOCK_DOMAINS, config)
    expect(agents["frontend"]).toBeDefined()
    expect(agents["frontend"].mode).toBe("subagent")
    expect(agents["backend"]).toBeDefined()
    expect(agents["backend"].mode).toBe("subagent")
  })

  test("total agents = queen + domains", () => {
    const agents = generateAgents(MOCK_DOMAINS, config)
    expect(Object.keys(agents)).toHaveLength(3)
  })

  test("each agent has non-empty prompt containing domain info", () => {
    const agents = generateAgents(MOCK_DOMAINS, config)
    const fePrompt = agents["frontend"].prompt!
    expect(fePrompt).toContain("React 18")
    expect(fePrompt).toContain("src/client/")
    expect(fePrompt).toContain("functional components")

    const bePrompt = agents["backend"].prompt!
    expect(bePrompt).toContain("Express")
    expect(bePrompt).toContain("src/server/")
  })

  test("color assigned from palette", () => {
    const agents = generateAgents(MOCK_DOMAINS, config)
    expect(agents["frontend"].color).toBe("#3B82F6")
    expect(agents["backend"].color).toBe("#10B981")
    expect(agents["queen"].color).toBe("#F59E0B")
  })

  test("queen prompt contains all domain descriptions", () => {
    const agents = generateAgents(MOCK_DOMAINS, config)
    const queenPrompt = agents["queen"].prompt!
    expect(queenPrompt).toContain("frontend")
    expect(queenPrompt).toContain("backend")
    expect(queenPrompt).toContain("React SPA")
    expect(queenPrompt).toContain("Express API")
  })
})
