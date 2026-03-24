import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig } from "./config"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "commander-config-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("loadConfig", () => {
  test("returns defaults when no config file exists", () => {
    const config = loadConfig(tmpDir)

    // All 4 agents present
    expect(Object.keys(config.agents).sort()).toEqual(["coder", "lead", "reviewer", "tester"])

    // Pipeline defaults
    expect(config.pipeline.maxFixLoops).toBe(3)
    expect(config.pipeline.enableReviewer).toBe(true)
    expect(config.pipeline.sensitivePatterns.length).toBeGreaterThan(0)

    // Store defaults
    expect(config.store.dataDir).toBe(".commander")
  })

  test("each agent has required AgentConfig fields", () => {
    const config = loadConfig(tmpDir)

    for (const [id, agent] of Object.entries(config.agents)) {
      expect(agent.mode).toBeDefined()
      expect(agent.description).toBeDefined()
      expect(typeof agent.description).toBe("string")
      expect(agent.prompt).toBeDefined()
      expect(typeof agent.prompt).toBe("string")
      expect(agent.prompt!.length).toBeGreaterThan(50) // prompts should be substantial
    }
  })

  test("merges user model override", () => {
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
    writeFileSync(
      join(tmpDir, ".opencode", "commander.json"),
      JSON.stringify({
        agents: {
          lead: { model: "openai/gpt-4o" },
        },
      }),
      "utf-8",
    )

    const config = loadConfig(tmpDir)
    expect(config.agents.lead.model).toBe("openai/gpt-4o")
    // Other agents unaffected
    expect(config.agents.coder.model).toBeUndefined()
  })

  test("merges user pipeline overrides", () => {
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
    writeFileSync(
      join(tmpDir, ".opencode", "commander.json"),
      JSON.stringify({
        pipeline: { maxFixLoops: 5, enableReviewer: false },
      }),
      "utf-8",
    )

    const config = loadConfig(tmpDir)
    expect(config.pipeline.maxFixLoops).toBe(5)
    expect(config.pipeline.enableReviewer).toBe(false)
    // Non-overridden defaults preserved
    expect(config.pipeline.sensitivePatterns.length).toBeGreaterThan(0)
  })

  test("merges user store overrides", () => {
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
    writeFileSync(
      join(tmpDir, ".opencode", "commander.json"),
      JSON.stringify({ store: { dataDir: "custom-dir" } }),
      "utf-8",
    )

    const config = loadConfig(tmpDir)
    expect(config.store.dataDir).toBe("custom-dir")
  })

  test("handles malformed JSON gracefully", () => {
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true })
    writeFileSync(join(tmpDir, ".opencode", "commander.json"), "{ broken json", "utf-8")

    const config = loadConfig(tmpDir)
    // Should fall back to defaults
    expect(Object.keys(config.agents)).toHaveLength(4)
    expect(config.pipeline.maxFixLoops).toBe(3)
  })
})
