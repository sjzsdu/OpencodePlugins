import { describe, expect, test } from "bun:test"
import { topologicalSort } from "./dispatcher"
import type { Subtask } from "../types"

function st(index: number, deps: number[] = []): Subtask {
  return { index, title: `task-${index}`, description: "", dependencies: deps, effort: "low" }
}

describe("topologicalSort", () => {
  test("empty subtasks → empty waves", () => {
    expect(topologicalSort([])).toEqual([])
  })

  test("single subtask → one wave", () => {
    const result = topologicalSort([st(0)])
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(1)
    expect(result[0][0].index).toBe(0)
  })

  test("two independent subtasks → one wave", () => {
    const result = topologicalSort([st(0), st(1)])
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(2)
  })

  test("linear chain → one wave per subtask", () => {
    const result = topologicalSort([st(0), st(1, [0]), st(2, [1])])
    expect(result).toHaveLength(3)
    expect(result[0].map((s) => s.index)).toEqual([0])
    expect(result[1].map((s) => s.index)).toEqual([1])
    expect(result[2].map((s) => s.index)).toEqual([2])
  })

  test("diamond dependency → three waves", () => {
    // 0 → 1, 0 → 2, 1+2 → 3
    const subtasks = [st(0), st(1, [0]), st(2, [0]), st(3, [1, 2])]
    const result = topologicalSort(subtasks)
    expect(result).toHaveLength(3)
    expect(result[0].map((s) => s.index)).toEqual([0])
    expect(result[1].map((s) => s.index).sort()).toEqual([1, 2])
    expect(result[2].map((s) => s.index)).toEqual([3])
  })

  test("cycle detection → remaining go into single wave", () => {
    // 0 depends on 1, 1 depends on 0 — cycle
    const subtasks = [st(0, [1]), st(1, [0])]
    const result = topologicalSort(subtasks)
    // Should not hang — cycle gets dumped into one wave
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(2)
  })

  test("partial cycle — independent tasks still get their own wave", () => {
    // 0 is independent, 1↔2 form a cycle
    const subtasks = [st(0), st(1, [2]), st(2, [1])]
    const result = topologicalSort(subtasks)
    expect(result).toHaveLength(2)
    expect(result[0].map((s) => s.index)).toEqual([0])
    // Cycle nodes in second wave
    expect(result[1]).toHaveLength(2)
  })

  test("complex graph with mixed dependencies", () => {
    // 0, 1 independent; 2 depends on 0; 3 depends on 0,1; 4 depends on 2,3
    const subtasks = [st(0), st(1), st(2, [0]), st(3, [0, 1]), st(4, [2, 3])]
    const result = topologicalSort(subtasks)
    expect(result).toHaveLength(3)
    expect(result[0].map((s) => s.index).sort()).toEqual([0, 1])
    expect(result[1].map((s) => s.index).sort()).toEqual([2, 3])
    expect(result[2].map((s) => s.index)).toEqual([4])
  })
})
