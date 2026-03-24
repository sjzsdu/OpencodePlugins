import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { scanProject, computeStructureHash } from "./scanner"

const TEST_DIR = join(import.meta.dir, "__test_fixture__")

function setup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
}

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
}

describe("scanProject", () => {
  beforeEach(setup)
  afterEach(cleanup)

  test("detects frontend + backend by directory structure", () => {
    mkdirSync(join(TEST_DIR, "src", "client"), { recursive: true })
    mkdirSync(join(TEST_DIR, "src", "server"), { recursive: true })
    writeFileSync(join(TEST_DIR, "package.json"), JSON.stringify({
      dependencies: { react: "^18.0.0", express: "^4.0.0" },
    }))

    const result = scanProject(TEST_DIR)
    expect(result.domains.length).toBeGreaterThanOrEqual(2)

    const frontend = result.domains.find((d) => d.id === "frontend")
    expect(frontend).toBeDefined()
    expect(frontend!.techStack).toContain("React")

    const backend = result.domains.find((d) => d.id === "backend")
    expect(backend).toBeDefined()
    expect(backend!.techStack).toContain("Express")
  })

  test("detects workspaces from package.json", () => {
    mkdirSync(join(TEST_DIR, "packages", "ui"), { recursive: true })
    mkdirSync(join(TEST_DIR, "packages", "core"), { recursive: true })
    writeFileSync(join(TEST_DIR, "packages", "ui", "package.json"), JSON.stringify({
      name: "@app/ui",
      description: "UI components",
    }))
    writeFileSync(join(TEST_DIR, "packages", "core", "package.json"), JSON.stringify({
      name: "@app/core",
    }))
    writeFileSync(join(TEST_DIR, "package.json"), JSON.stringify({
      workspaces: ["packages/*"],
    }))

    const result = scanProject(TEST_DIR)
    expect(result.domains.length).toBe(2)
    expect(result.domains.find(d => d.id === "ui")).toBeDefined()
    expect(result.domains.find(d => d.id === "core")).toBeDefined()
  })

  test("detects infra from Dockerfile", () => {
    mkdirSync(join(TEST_DIR, "src"), { recursive: true })
    writeFileSync(join(TEST_DIR, "Dockerfile"), "FROM node:18")
    writeFileSync(join(TEST_DIR, "package.json"), JSON.stringify({}))

    const result = scanProject(TEST_DIR)
    const infra = result.domains.find(d => d.id === "infra")
    expect(infra).toBeDefined()
    expect(infra!.paths).toContain("Dockerfile")
  })

  test("structureHash changes when directory structure changes", () => {
    mkdirSync(join(TEST_DIR, "src"), { recursive: true })
    const hash1 = computeStructureHash(TEST_DIR)

    mkdirSync(join(TEST_DIR, "packages"), { recursive: true })
    const hash2 = computeStructureHash(TEST_DIR)

    expect(hash1).not.toBe(hash2)
  })
})
