import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { Edict, EdictStore, EdictStatus } from "./types"

function randomHex(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export class JsonEdictStore implements EdictStore {
  private readonly dataDir: string
  private readonly filePath: string
  private edicts: Edict[] = []
  private loaded = false

  /**
   * @param baseDir - Project root directory (absolute path from plugin context)
   * @param relativeDataDir - Data directory relative to baseDir
   */
  constructor(baseDir: string, relativeDataDir: string) {
    this.dataDir = join(baseDir, relativeDataDir)
    this.filePath = join(this.dataDir, "edicts.json")
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
        if (Array.isArray(data?.edicts)) {
          this.edicts = data.edicts
        } else {
          this.edicts = []
        }
      } catch {
        // Corrupted JSON — start with empty store
        console.warn("[emperor] corrupted edicts.json, starting with empty store")
        this.edicts = []
      }
    } else {
      this.edicts = []
    }
    this.loaded = true
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.loadFromDisk()
    }
  }

  create(input: Omit<Edict, "id" | "createdAt" | "updatedAt" | "executions">): Edict {
    this.ensureLoaded()
    const now = Date.now()
    const edict: Edict = {
      ...input,
      id: `edict_${now}_${randomHex(4)}`,
      createdAt: now,
      updatedAt: now,
      executions: [],
    }
    this.edicts.push(edict)
    this.save()
    return edict
  }

  get(id: string): Edict | undefined {
    this.ensureLoaded()
    return this.edicts.find((e) => e.id === id)
  }

  update(id: string, patch: Partial<Edict>): Edict {
    this.ensureLoaded()
    const idx = this.edicts.findIndex((e) => e.id === id)
    if (idx === -1) {
      throw new Error(`Edict not found: ${id}`)
    }
    const updated: Edict = { ...this.edicts[idx], ...patch, updatedAt: Date.now() }
    this.edicts[idx] = updated
    this.save()
    return updated
  }

  list(filter?: { status?: EdictStatus }): Edict[] {
    this.ensureLoaded()
    if (filter?.status) {
      return this.edicts.filter((e) => e.status === filter.status)
    }
    return [...this.edicts]
  }

  save(): void {
    this.ensureDir()
    writeFileSync(this.filePath, JSON.stringify({ edicts: this.edicts }, null, 2), "utf-8")
  }
}
