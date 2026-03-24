import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { TriageStore, TriageTask, TriageStatus } from "./types"

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export class JsonTriageStore implements TriageStore {
  private readonly dataDir: string
  private readonly filePath: string
  private tasks: TriageTask[] = []
  private loaded = false

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
        console.warn("[triage] corrupted tasks.json, starting with empty store")
        this.tasks = []
      }
    } else {
      this.tasks = []
    }
    this.loaded = true
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.loadFromDisk()
  }

  create(ticketKey: string): TriageTask {
    this.ensureLoaded()
    const now = Date.now()
    const task: TriageTask = {
      id: `task_${now}_${randomHex(4)}`,
      ticketKey,
      createdAt: now,
      updatedAt: now,
      executions: [],
      sessions: [],
      status: "received",
      jiraUpdated: false,
    }
    this.tasks.push(task)
    this.save()
    return task
  }

  get(id: string): TriageTask | undefined {
    this.ensureLoaded()
    return this.tasks.find((t) => t.id === id)
  }

  getByTicketKey(ticketKey: string): TriageTask | undefined {
    this.ensureLoaded()
    // most recent for ticket key
    const filtered = this.tasks.filter((t) => t.ticketKey === ticketKey)
    if (filtered.length === 0) return undefined
    return filtered.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b))
  }

  update(id: string, patch: Partial<TriageTask>): TriageTask {
    this.ensureLoaded()
    const idx = this.tasks.findIndex((t) => t.id === id)
    if (idx === -1) throw new Error(`Task not found: ${id}`)
    const updated: TriageTask = { ...this.tasks[idx], ...patch, updatedAt: Date.now() }
    this.tasks[idx] = updated
    this.save()
    return updated
  }

  list(filter?: { status?: TriageStatus }): TriageTask[] {
    this.ensureLoaded()
    if (filter?.status) return this.tasks.filter((t) => t.status === filter.status)
    return [...this.tasks]
  }

  save(): void {
    this.ensureDir()
    writeFileSync(this.filePath, JSON.stringify({ tasks: this.tasks }, null, 2), "utf-8")
  }
}
