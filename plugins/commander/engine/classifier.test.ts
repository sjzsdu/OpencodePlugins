import { describe, expect, test } from "bun:test"
import { classifyComplexity } from "./classifier"
import type { Plan } from "../types"

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    analysis: "test",
    subtasks: [],
    risks: [],
    ...overrides,
  }
}

describe("classifyComplexity", () => {
  test("trivial — zero subtasks", () => {
    expect(classifyComplexity(makePlan())).toBe("trivial")
  })

  test("simple — one low-effort subtask", () => {
    const plan = makePlan({
      subtasks: [
        { index: 0, title: "fix typo", description: "", dependencies: [], effort: "low" },
      ],
    })
    expect(classifyComplexity(plan)).toBe("simple")
  })

  test("standard — one medium-effort subtask", () => {
    const plan = makePlan({
      subtasks: [
        { index: 0, title: "add feature", description: "", dependencies: [], effort: "medium" },
      ],
    })
    expect(classifyComplexity(plan)).toBe("standard")
  })

  test("standard — two low-effort subtasks", () => {
    const plan = makePlan({
      subtasks: [
        { index: 0, title: "a", description: "", dependencies: [], effort: "low" },
        { index: 1, title: "b", description: "", dependencies: [0], effort: "low" },
      ],
    })
    expect(classifyComplexity(plan)).toBe("standard")
  })

  test("complex — has high-effort subtask", () => {
    const plan = makePlan({
      subtasks: [
        { index: 0, title: "refactor", description: "", dependencies: [], effort: "high" },
      ],
    })
    expect(classifyComplexity(plan)).toBe("complex")
  })

  test("complex — risks + 4 subtasks", () => {
    const plan = makePlan({
      subtasks: [
        { index: 0, title: "a", description: "", dependencies: [], effort: "low" },
        { index: 1, title: "b", description: "", dependencies: [], effort: "low" },
        { index: 2, title: "c", description: "", dependencies: [], effort: "medium" },
        { index: 3, title: "d", description: "", dependencies: [], effort: "low" },
      ],
      risks: ["breaking change"],
    })
    expect(classifyComplexity(plan)).toBe("complex")
  })

  test("standard — risks but < 4 subtasks", () => {
    const plan = makePlan({
      subtasks: [
        { index: 0, title: "a", description: "", dependencies: [], effort: "medium" },
        { index: 1, title: "b", description: "", dependencies: [], effort: "low" },
      ],
      risks: ["some risk"],
    })
    expect(classifyComplexity(plan)).toBe("standard")
  })
})
