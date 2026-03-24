import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { Task, TaskStore, TaskStatus } from "./types"

function randomHex(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export class JsonTaskStore implements TaskStore {
  private readonly dataDir: string
  private readonly filePath: string
  private tasks: Task[] = []
  private loaded = false

  /**
   * @param baseDir - Project root directory (absolute path from plugin context)
   * @param relativeDataDir - Data directory relative to baseDir
   */
  constructor(baseDir: string, relativeDataDir: string) {
    this.dataDir = join(baseDir, relativeDataDir)
    this.filePath = join(this.dataDir, "tasks.json")
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true })
    }
  }

  private loadFromDisk(): void {
    this.ensureDir()

    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, "utf-8")
        const data = JSON.parse(raw)
        if (Array.isArray(data?.tasks)) {
          this.tasks = data.tasks
        } else {
          this.tasks = []
        }
      } catch {
        // Corrupted JSON — start with empty store
        console.warn("[commander] corrupted tasks.json, starting with empty store")
        this.tasks = []
      }
    } else {
      this.tasks = []
    }
    this.loaded = true
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.loadFromDisk()
    }
  }

  create(input: Omit<Task, "id" | "createdAt" | "updatedAt" | "executions">): Task {
    this.ensureLoaded()
    const now = Date.now()
    const task: Task = {
      ...input,
      id: `task_${now}_${randomHex(4)}`,
      createdAt: now,
      updatedAt: now,
      executions: [],
    }
    this.tasks.push(task)
    this.save()
    return task
  }

  get(id: string): Task | undefined {
    this.ensureLoaded()
    return this.tasks.find((t) => t.id === id)
  }

  update(id: string, patch: Partial<Task>): Task {
    this.ensureLoaded()
    const idx = this.tasks.findIndex((t) => t.id === id)
    if (idx === -1) {
      throw new Error(`Task not found: ${id}`)
    }
    const updated: Task = { ...this.tasks[idx], ...patch, updatedAt: Date.now() }
    this.tasks[idx] = updated
    this.save()
    return updated
  }

  list(filter?: { status?: TaskStatus }): Task[] {
    this.ensureLoaded()
    if (filter?.status) {
      return this.tasks.filter((t) => t.status === filter.status)
    }
    return [...this.tasks]
  }

  save(): void {
    this.ensureDir()
    writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2), "utf-8")
  }
}
