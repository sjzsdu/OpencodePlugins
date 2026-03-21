import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { AnalystConfig, AnalystUserConfig, WeightConfig, WeightPreset } from "./types"
import { AGENTS } from "./agents"

/** 预设权重方案 */
const WEIGHT_PRESETS: Record<WeightPreset, WeightConfig> = {
  conservative: {
    "stock-fundamentalist": 0.35,
    "stock-technician": 0.15,
    "stock-industry": 0.15,
    "stock-sentiment": 0.15,
    "stock-chip": 0.20,
  },
  balanced: {
    "stock-fundamentalist": 0.30,
    "stock-technician": 0.25,
    "stock-industry": 0.15,
    "stock-sentiment": 0.15,
    "stock-chip": 0.15,
  },
  aggressive: {
    "stock-fundamentalist": 0.25,
    "stock-technician": 0.35,
    "stock-industry": 0.15,
    "stock-sentiment": 0.15,
    "stock-chip": 0.10,
  },
}

const DEFAULT_STORE: AnalystConfig["store"] = {
  dataDir: ".stock",
}

export function loadConfig(directory: string): AnalystConfig {
  const configPath = join(directory, ".opencode", "stock.json")
  let userConfig: AnalystUserConfig = {}

  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8")
      userConfig = JSON.parse(raw) as AnalystUserConfig
    }
  } catch {
    // 解析失败则使用默认值
  }

  // 合并 agent model 配置
  const agents: Record<string, AgentConfig> = {}
  for (const [id, agentDef] of Object.entries(AGENTS)) {
    const userModel = userConfig.agents?.[id]?.model
    agents[id] = userModel ? { ...agentDef, model: userModel } : { ...agentDef }
  }

  // 解析权重配置
  let weights: WeightConfig
  if (typeof userConfig.weights === "string") {
    weights = WEIGHT_PRESETS[userConfig.weights] ?? WEIGHT_PRESETS.balanced
  } else if (typeof userConfig.weights === "object") {
    weights = { ...WEIGHT_PRESETS.balanced, ...userConfig.weights }
  } else {
    weights = WEIGHT_PRESETS.balanced
  }

  return {
    agents,
    weights,
    store: { ...DEFAULT_STORE, ...userConfig.store },
  }
}
