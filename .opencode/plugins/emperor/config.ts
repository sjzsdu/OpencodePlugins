import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { EmperorConfig, EmperorUserConfig } from "./types"
import { AGENTS } from "./agents"

const DEFAULT_PIPELINE: EmperorConfig["pipeline"] = {
  maxReviewAttempts: 3,
  maxSubtaskRetries: 1,
  sensitivePatterns: [
    "删除|remove|delete|drop",
    "数据库.*迁移|migration",
    "密钥|secret|credential|password",
    "生产环境|production|deploy",
    "权限|permission|auth.*config",
  ],
  mandatoryDepartments: ["hubu"],
  requirePostVerification: true,
}

const DEFAULT_RECON: EmperorConfig["recon"] = {
  enabled: true,
  cacheDir: "recon",
}

const DEFAULT_STORE: EmperorConfig["store"] = {
  dataDir: ".opencode/plugins/emperor/data",
}

/**
 * Load Emperor configuration from .opencode/emperor.json.
 * Returns defaults if the file doesn't exist or is malformed.
 * Users only need to specify what they want to override — everything has sensible defaults.
 */
export function loadConfig(directory: string): EmperorConfig {
  const configPath = join(directory, ".opencode", "emperor.json")

  let userConfig: EmperorUserConfig = {}

  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8")
      userConfig = JSON.parse(raw) as EmperorUserConfig
    }
  } catch {
    // Ignore parse errors — fall back to defaults
  }

  // Merge user model choices into agent definitions from agents/
  const agents: Record<string, AgentConfig> = {}
  for (const [id, agentDef] of Object.entries(AGENTS)) {
    const userModel = userConfig.agents?.[id]?.model
    agents[id] = userModel ? { ...agentDef, model: userModel } : { ...agentDef }
  }

  return {
    agents,
    pipeline: { ...DEFAULT_PIPELINE, ...userConfig.pipeline },
    recon: { ...DEFAULT_RECON, ...userConfig.recon },
    store: { ...DEFAULT_STORE, ...userConfig.store },
  }
}
