import type { AgentConfig } from "@opencode-ai/sdk"

/** 分析师 Agent ID */
export type AnalystId = "finance" | "chart" | "sector" | "sentiment" | "flow"

/** 权重配置预设 */
export type WeightPreset = "conservative" | "balanced" | "aggressive"

/** 各分析师权重 */
export type WeightConfig = Record<AnalystId, number>

/** 单个分析师的评分结果 */
export interface AnalysisScore {
  agent: AnalystId
  score: number        // 0-100
  confidence: number   // 0.0-1.0
  summary: string
  bullish: string[]
  bearish: string[]
  reasoning: string
}

/** 用户配置（tongstock-analyst.json） */
export interface AnalystUserConfig {
  agents?: Record<string, { model?: string }>
  weights?: Partial<WeightConfig> | WeightPreset
  store?: Partial<AnalystConfig["store"]>
}

/** 内部完整配置 */
export interface AnalystConfig {
  agents: Record<string, AgentConfig>
  weights: WeightConfig
  store: {
    dataDir: string
  }
}
