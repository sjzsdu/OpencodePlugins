import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { TriageConfig, TriageUserConfig } from "./types"
import { AGENTS } from "./agents"

const DEFAULT_PIPELINE: TriageConfig["pipeline"] = {
  maxFixLoops: 3,
}

const DEFAULT_STORE: TriageConfig["store"] = {
  dataDir: ".triage",
}

const DEFAULT_JIRA: TriageConfig["jira"] = {
  scaleField: "Ticket Scale",
  rootCauseField: "Root Cause",
  autoTransition: true,
}

export function loadConfig(directory: string): TriageConfig {
  const configPath = join(directory, ".opencode", "triage.json")

  let userConfig: TriageUserConfig = {}

  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8")
      userConfig = JSON.parse(raw) as TriageUserConfig
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn(`[triage] Invalid JSON in ${configPath}, using defaults`)
    } else {
      console.warn(`[triage] Failed to load config: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const agents: TriageConfig["agents"] = {}
  for (const [id, agentDef] of Object.entries(AGENTS)) {
    const userModel = userConfig.agents?.[id]?.model
    agents[id] = userModel ? { ...agentDef, model: userModel } : { ...agentDef }
  }

  return {
    agents,
    pipeline: { ...DEFAULT_PIPELINE, ...userConfig.pipeline },
    store: { ...DEFAULT_STORE, ...userConfig.store },
    jira: { ...DEFAULT_JIRA, ...userConfig.jira },
  }
}
