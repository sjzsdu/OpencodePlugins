import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { HiveConfig, HiveUserConfig } from "./types"

const DEFAULTS: Omit<HiveConfig, "domains"> = {
  discovery: {
    model: "anthropic/claude-sonnet-4-20250514",
    autoRefresh: true,
  },
  coordination: {
    autonomyLevel: "full",
  },
  queen: {
    model: "anthropic/claude-sonnet-4-20250514",
  },
  store: {
    dataDir: ".hive",
  },
}

export function loadConfig(directory: string): HiveConfig {
  const configPath = join(directory, ".opencode", "hive.json")
  let userConfig: HiveUserConfig = {}

  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8")
      userConfig = JSON.parse(raw) as HiveUserConfig
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`[hive] Invalid JSON in ${configPath}, using defaults`)
    } else {
      console.warn(`[hive] Failed to load config: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    domains: userConfig.domains ?? {},
    discovery: { ...DEFAULTS.discovery, ...userConfig.discovery },
    coordination: { ...DEFAULTS.coordination, ...userConfig.coordination },
    queen: { ...DEFAULTS.queen, ...userConfig.queen },
    store: { ...DEFAULTS.store, ...userConfig.store },
  }
}
