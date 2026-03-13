import type { Agent, AgentConfig } from "@opencode-ai/sdk"
import type { Domain, HiveConfig } from "../types"
import { buildDomainPrompt, buildQueenPrompt } from "./prompts"

const COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
]

const defaultPermission: Agent["permission"] = {
  edit: "allow",
  bash: { "*": "allow" },
}

export function generateAgents(
  domains: Domain[],
  config: HiveConfig,
): Record<string, AgentConfig> {
  const agents: Record<string, AgentConfig> = {}

  const queenConfig: AgentConfig = {
    name: "queen",
    description: "Hive Coordinator — analyzes requirements, coordinates domain agents",
    mode: "primary",
    color: "#F59E0B",
    prompt: buildQueenPrompt(domains),
  }
  if (config.queen.model) {
    queenConfig.model = config.queen.model
  }
  agents["queen"] = queenConfig

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i]
    agents[domain.id] = {
      name: domain.id,
      description: `${domain.name} — ${domain.description}`,
      mode: "all",
      color: COLORS[i % COLORS.length],
      prompt: buildDomainPrompt(domain),
    }
  }

  return agents
}

export function toAgent(config: AgentConfig): Agent {
  const name = typeof config.name === "string" ? config.name : "unknown"
  return {
    name,
    description: config.description,
    mode: config.mode || "all",
    builtIn: false,
    color: config.color,
    prompt: config.prompt,
    permission: defaultPermission,
    tools: config.tools || { read: true, write: true, edit: true, bash: true, grep: true, glob: true },
    options: {},
  }
}
