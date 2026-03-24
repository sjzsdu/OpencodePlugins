import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { Domain, DomainCache, HiveEvent } from "./types"

export class HiveStore {
  private readonly dataDir: string
  private readonly domainsPath: string
  private readonly eventsPath: string

  constructor(baseDir: string, relativeDataDir: string) {
    this.dataDir = join(baseDir, relativeDataDir)
    this.domainsPath = join(this.dataDir, "domains.json")
    this.eventsPath = join(this.dataDir, "events.json")
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true })
    }
  }

  saveDomains(cache: DomainCache): void {
    this.ensureDir()
    writeFileSync(this.domainsPath, JSON.stringify(cache, null, 2), "utf-8")
  }

  loadDomains(): DomainCache | null {
    if (!existsSync(this.domainsPath)) return null
    try {
      return JSON.parse(readFileSync(this.domainsPath, "utf-8")) as DomainCache
    } catch {
      console.warn("[hive] corrupted domains.json, returning null")
      return null
    }
  }

  saveEvents(events: HiveEvent[]): void {
    this.ensureDir()
    writeFileSync(this.eventsPath, JSON.stringify({ events }, null, 2), "utf-8")
  }

  loadEvents(): HiveEvent[] {
    if (!existsSync(this.eventsPath)) return []
    try {
      const data = JSON.parse(readFileSync(this.eventsPath, "utf-8"))
      return Array.isArray(data?.events) ? data.events : []
    } catch {
      console.warn("[hive] corrupted events.json, returning empty")
      return []
    }
  }
}
