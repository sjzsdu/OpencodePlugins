import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { EmperorConfig } from "./types"

const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  taizi: {
    mode: "primary",
    prompt: "TODO: Add system prompt in Task 3",
    description: "太子·入口分拣",
  },
  zhongshu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "中书省·规划",
    tools: { read: true, grep: true, glob: true },
  },
  menxia: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "门下省·审核",
    tools: { read: true },
  },
  bingbu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "兵部·代码实现",
  },
  gongbu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "工部·基建",
  },
  lifebu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "礼部·文档",
  },
  xingbu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "刑部·安全审计",
    tools: { read: true, grep: true },
  },
  hubu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "户部·数据与测试",
  },
  libu: {
    mode: "subagent",
    prompt: "TODO: Add system prompt in Task 3",
    description: "吏部·架构与重构",
    tools: { read: true, grep: true, glob: true },
  },
}

const DEFAULT_CONFIG: EmperorConfig = {
  agents: DEFAULT_AGENTS,
  pipeline: {
    maxReviewAttempts: 3,
    sensitivePatterns: [
      "删除|remove|delete|drop",
      "数据库.*迁移|migration",
      "密钥|secret|credential|password",
      "生产环境|production|deploy",
      "权限|permission|auth.*config",
    ],
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
    store: userConfig.store
      ? { ...DEFAULT_CONFIG.store, ...userConfig.store }
      : DEFAULT_CONFIG.store,
  }
}
