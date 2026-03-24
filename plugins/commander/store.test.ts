import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { JsonTaskStore } from "./store"

let tmpDir: string
let store: JsonTaskStore

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "commander-test-"))
  store = new JsonTaskStore(tmpDir, ".commander")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("JsonTaskStore", () => {
  test("create() generates a task with id, timestamps, and empty executions", () => {
    const task = store.create({
      title: "test task",
      content: "do something",
      priority: "normal",
      status: "received",
    })

    expect(task.id).toMatch(/^task_\d+_[0-9a-f]{8}$/)
    expect(task.title).toBe("test task")
    expect(task.content).toBe("do something")
    expect(task.priority).toBe("normal")
    expect(task.status).toBe("received")
    expect(task.executions).toEqual([])
    expect(task.createdAt).toBeGreaterThan(0)
    expect(task.updatedAt).toBe(task.createdAt)
  })

  test("create() persists to disk", () => {
    store.create({ title: "t", content: "c", priority: "low", status: "received" })
    const filePath = join(tmpDir, ".commander", "tasks.json")
    expect(existsSync(filePath)).toBe(true)

    const raw = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(raw.tasks).toHaveLength(1)
    expect(raw.tasks[0].title).toBe("t")
  })

  test("get() retrieves task by id", () => {
    const created = store.create({ title: "x", content: "y", priority: "high", status: "received" })
    const found = store.get(created.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
  })

  test("get() returns undefined for missing id", () => {
    expect(store.get("nonexistent")).toBeUndefined()
  })

  test("update() patches task fields", () => {
    const task = store.create({ title: "a", content: "b", priority: "normal", status: "received" })
    const updated = store.update(task.id, { status: "analyzing", complexity: "standard" })

    expect(updated.status).toBe("analyzing")
    expect(updated.complexity).toBe("standard")
    expect(updated.updatedAt).toBeGreaterThanOrEqual(task.updatedAt)
    expect(updated.title).toBe("a") // unchanged fields preserved
  })

  test("update() throws for missing task", () => {
    expect(() => store.update("bad_id", { status: "failed" })).toThrow("Task not found")
  })

  test("list() returns all tasks", () => {
    store.create({ title: "a", content: "", priority: "normal", status: "received" })
    store.create({ title: "b", content: "", priority: "high", status: "completed" })

    const all = store.list()
    expect(all).toHaveLength(2)
  })

  test("list() filters by status", () => {
    store.create({ title: "a", content: "", priority: "normal", status: "received" })
    store.create({ title: "b", content: "", priority: "high", status: "completed" })

    expect(store.list({ status: "received" })).toHaveLength(1)
    expect(store.list({ status: "completed" })).toHaveLength(1)
    expect(store.list({ status: "failed" })).toHaveLength(0)
  })

  test("list() returns a copy (not internal reference)", () => {
    store.create({ title: "x", content: "", priority: "normal", status: "received" })
    const list1 = store.list()
    list1.pop()
    expect(store.list()).toHaveLength(1) // internal state unaffected
  })

  test("survives reload from disk (new store instance)", () => {
    store.create({ title: "persist-me", content: "yes", priority: "high", status: "executing" })

    // Create a new store instance pointing to same directory
    const store2 = new JsonTaskStore(tmpDir, ".commander")
    const tasks = store2.list()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe("persist-me")
    expect(tasks[0].status).toBe("executing")
  })

  test("handles corrupted JSON gracefully", () => {
    // Create the data directory and write garbage
    const dataDir = join(tmpDir, ".commander")
    const { mkdirSync, writeFileSync } = require("node:fs")
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, "tasks.json"), "not valid json!!!", "utf-8")

    const brokenStore = new JsonTaskStore(tmpDir, ".commander")
    expect(brokenStore.list()).toEqual([]) // graceful fallback
  })

  test("multiple creates generate unique ids", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const task = store.create({ title: `t${i}`, content: "", priority: "normal", status: "received" })
      ids.add(task.id)
    }
    expect(ids.size).toBe(20)
  })
})
