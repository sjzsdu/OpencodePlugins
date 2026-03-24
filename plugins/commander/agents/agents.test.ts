import { describe, expect, test } from "bun:test"
import { AGENTS } from "./index"

describe("AGENTS registry", () => {
  const EXPECTED_AGENTS = ["lead", "coder", "tester", "reviewer"]

  test("exports exactly 4 agents", () => {
    expect(Object.keys(AGENTS).sort()).toEqual(EXPECTED_AGENTS.sort())
  })

  for (const id of EXPECTED_AGENTS) {
    describe(`agent: ${id}`, () => {
      test("has mode", () => {
        expect(AGENTS[id].mode).toBeDefined()
      })

      test("has description", () => {
        expect(typeof AGENTS[id].description).toBe("string")
        expect(AGENTS[id].description!.length).toBeGreaterThan(0)
      })

      test("has color (hex)", () => {
        expect(AGENTS[id].color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      })

      test("has substantial prompt in Chinese", () => {
        const prompt = AGENTS[id].prompt!
        expect(prompt.length).toBeGreaterThan(100)
        // Chinese character check — prompts should contain Chinese
        expect(/[\u4e00-\u9fff]/.test(prompt)).toBe(true)
      })
    })
  }
})
