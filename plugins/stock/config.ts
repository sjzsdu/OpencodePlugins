import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentConfig } from "sjz-opencode-sdk"
import type { AnalystConfig, AnalystUserConfig, WeightConfig, WeightPreset } from "./types"
import { AGENTS_GENERAL } from "./agents-general"
import { AGENTS_TECHNICAL } from "./agents-technical"

/** 预设权重方案 */
const WEIGHT_PRESETS: Record<WeightPreset, WeightConfig> = {
  conservative: {
    finance: 0.35,
    chart: 0.15,
    sector: 0.15,
    sentiment: 0.15,
    flow: 0.20,
  },
  balanced: {
    finance: 0.30,
    chart: 0.25,
    sector: 0.15,
    sentiment: 0.15,
    flow: 0.15,
  },
  aggressive: {
    finance: 0.25,
    chart: 0.35,
    sector: 0.15,
    sentiment: 0.15,
    flow: 0.10,
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

  const agents: Record<string, AgentConfig> = {}

  for (const [id, agentDef] of Object.entries(AGENTS_GENERAL)) {
    const userModel = userConfig.agents?.[id]?.model
    agents[id] = userModel ? { ...agentDef, model: userModel } : { ...agentDef }
  }
  for (const [id, agentDef] of Object.entries(AGENTS_TECHNICAL)) {
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
