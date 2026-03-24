import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { DomainCache } from "../types"

export class DiscoveryCache {
  private readonly filePath: string

  constructor(baseDir: string, dataDir: string) {
    const dir = join(baseDir, dataDir)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, "domains.json")
  }

  load(): DomainCache | null {
    if (!existsSync(this.filePath)) return null
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as DomainCache
    } catch {
      return null
    }
  }

  save(cache: DomainCache): void {
    writeFileSync(this.filePath, JSON.stringify(cache, null, 2), "utf-8")
  }

  isValid(currentHash: string): boolean {
    const cached = this.load()
    return cached !== null && cached.structureHash === currentHash
  }
}
