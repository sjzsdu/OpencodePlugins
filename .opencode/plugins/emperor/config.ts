import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { EmperorConfig } from "./types"

const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  taizi: {
    mode: "primary",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Taizi - Entry triage and task routing",
  },
  zhongshu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Zhongshu - Task planning and decomposition",
    tools: { read: true, grep: true, glob: true },
  },
  menxia: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Menxia - Plan review and approval",
    tools: { read: true },
  },
  shangshu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Shangshu - Execution coordinator and dispatch",
    tools: { read: true },
  },
  bingbu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Bingbu - Code implementation",
  },
  gongbu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Gongbu - Infrastructure and DevOps",
  },
  lifebu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Lifebu - Documentation",
  },
  xingbu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Xingbu - Security audit",
    tools: { read: true, grep: true },
  },
  hubu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Hubu - Testing and data",
  },
  libu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Libu - Architecture and refactoring",
    tools: { read: true, grep: true, glob: true },
  },
  jinyiwei: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "Jinyiwei - Project reconnaissance and codebase analysis",
    tools: { read: true, grep: true, glob: true },
  },
}

const DEFAULT_CONFIG: EmperorConfig = {
  agents: DEFAULT_AGENTS,
  pipeline: {
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
  },
  recon: {
    enabled: true,
    cacheDir: "recon",
  },
  store: {
    dataDir: ".opencode/plugins/emperor/data",
  },
}

/**
 * Load Emperor configuration from .opencode/emperor.json.
 * Returns defaults if the file doesn't exist or is malformed.
 * Merges user overrides with defaults at the top level.
 * If config file doesn't exist, creates it with default values.
 */
export function loadConfig(directory: string): EmperorConfig {
  const configDir = join(directory, ".opencode")
  const configPath = join(configDir, "emperor.json")

  let userConfig: Partial<EmperorConfig> = {}
  
  // If config doesn't exist, create it with defaults
  if (!existsSync(configPath)) {
    try {
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true })
      }
      // Write default config to file
      writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2))
    } catch {
      // Ignore errors — will use defaults
    }
  }
  
  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8")
      userConfig = JSON.parse(raw) as Partial<EmperorConfig>
    }
  } catch {
    // Ignore parse errors — fall back to defaults
  }

  return {
    agents: userConfig.agents
      ? { ...DEFAULT_CONFIG.agents, ...userConfig.agents }
      : DEFAULT_CONFIG.agents,
    pipeline: userConfig.pipeline
      ? { ...DEFAULT_CONFIG.pipeline, ...userConfig.pipeline }
      : DEFAULT_CONFIG.pipeline,
    recon: userConfig.recon
      ? { ...DEFAULT_CONFIG.recon, ...userConfig.recon }
      : DEFAULT_CONFIG.recon,
    store: userConfig.store
      ? { ...DEFAULT_CONFIG.store, ...userConfig.store }
      : DEFAULT_CONFIG.store,
  }
}
