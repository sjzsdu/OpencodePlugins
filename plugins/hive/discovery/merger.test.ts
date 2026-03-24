import { describe, expect, test } from "bun:test"
import { mergeDomains } from "./merger"
import type { Domain } from "../types"

const MOCK_DOMAINS: Domain[] = [
  {
    id: "frontend",
    name: "Frontend",
    description: "React app",
    paths: ["src/client/"],
    techStack: "React",
    responsibilities: "UI",
    interfaces: [],
    dependencies: ["backend"],
    conventions: [],
  },
  {
    id: "backend",
    name: "Backend",
    description: "Express API",
    paths: ["src/server/"],
    techStack: "Express",
    responsibilities: "API",
    interfaces: ["GET /api/users"],
    dependencies: [],
    conventions: [],
  },
]

describe("mergeDomains", () => {
  test("user override merges into discovered domain", () => {
    const merged = mergeDomains(MOCK_DOMAINS, {
      frontend: { techStack: "Vue 3" },
    })
    const fe = merged.find(d => d.id === "frontend")!
    expect(fe.techStack).toBe("Vue 3")
    expect(fe.description).toBe("React app") // other fields preserved
  })

  test("disabled domain removed", () => {
    const merged = mergeDomains(MOCK_DOMAINS, {
      backend: { disabled: true },
    })
    expect(merged.find(d => d.id === "backend")).toBeUndefined()
    expect(merged).toHaveLength(1)
  })

  test("user-only domain added if paths present", () => {
    const merged = mergeDomains(MOCK_DOMAINS, {
      infra: {
        paths: [".github/"],
        description: "CI/CD",
      },
    })
    const infra = merged.find(d => d.id === "infra")!
    expect(infra).toBeDefined()
    expect(infra.paths).toEqual([".github/"])
  })

  test("user-only domain without paths ignored", () => {
    const merged = mergeDomains(MOCK_DOMAINS, {
      orphan: { description: "No paths" },
    })
    expect(merged.find(d => d.id === "orphan")).toBeUndefined()
    expect(merged).toHaveLength(2)
  })

  test("no overrides returns original domains", () => {
    const merged = mergeDomains(MOCK_DOMAINS, {})
    expect(merged).toHaveLength(2)
    expect(merged[0].id).toBe("frontend")
    expect(merged[1].id).toBe("backend")
  })
})
