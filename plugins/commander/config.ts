import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentConfig } from "sjz-opencode-sdk"
import type { CommanderConfig, CommanderUserConfig } from "./types"
import { AGENTS } from "./agents"

const DEFAULT_PIPELINE: CommanderConfig["pipeline"] = {
  maxFixLoops: 3,
  enableReviewer: true,
  sensitivePatterns: [
    "删除|remove|delete|drop",
    "数据库.*迁移|migration",
    "密钥|secret|credential|password",
    "生产环境|production|deploy",
    "权限|permission|auth.*config",
  ],
}

const DEFAULT_STORE: CommanderConfig["store"] = {
  dataDir: ".commander",
}

export function loadConfig(directory: string): CommanderConfig {
  const configPath = join(directory, ".opencode", "commander.json")

  let userConfig: CommanderUserConfig = {}

  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8")
      userConfig = JSON.parse(raw) as CommanderUserConfig
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`[commander] Invalid JSON in ${configPath}, using defaults`)
    } else {
      console.warn(`[commander] Failed to load config: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const agents: Record<string, AgentConfig> = {}
  for (const [id, agentDef] of Object.entries(AGENTS)) {
    const userModel = userConfig.agents?.[id]?.model
    agents[id] = userModel ? { ...agentDef, model: userModel } : { ...agentDef }
  }

  return {
    agents,
    pipeline: { ...DEFAULT_PIPELINE, ...userConfig.pipeline },
    store: { ...DEFAULT_STORE, ...userConfig.store },
  }
}
