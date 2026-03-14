import type { Agent, AgentConfig } from "sjz-opencode-sdk"
import type { Domain, HiveConfig } from "../types"
import { buildDomainPrompt, buildQueenPrompt } from "./prompts"

const COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
]

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
    tools: { read: true, write: true, edit: true, bash: true, grep: false, glob: false, webfetch: false, task: false, todo: false, question: true },
  }
  if (config.queen.model) {
    queenConfig.model = config.queen.model
  }
  agents["queen"] = queenConfig

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i]
    // Ensure paths is always an array
    if (!domain.paths) {
      domain.paths = []
    }
    agents[domain.id] = {
      name: domain.id,
      description: `${domain.name} — ${domain.description}`,
      mode: "all",
      color: COLORS[i % COLORS.length],
      prompt: buildDomainPrompt(domain),
      tools: { read: true, write: true, edit: true, bash: true, grep: true, glob: true, task: true, todo: true },
    }
  }

  return agents
}

export function toAgent(config: AgentConfig): Agent {
  const name = typeof config.name === "string" ? config.name : "unknown"
  // PermissionRuleset format for V2 registerAgent API (old Agent type expects config-style)
  const allPermissions = [
    "edit", "bash", "read", "write", "webfetch", "grep", "glob", "list",
    "task", "todowrite", "todoread", "skill", "lsp", "websearch",
    "codesearch", "question", "doom_loop", "external_directory",
  ]
  const permission = allPermissions.map(p => ({
    permission: p, pattern: "*", action: "allow",
  })) as unknown as Agent["permission"]
  return {
    name,
    description: config.description,
    mode: config.mode || "all",
    builtIn: false,
    color: config.color,
    prompt: config.prompt,
    permission,
    tools: config.tools || { read: true, write: true, edit: true, bash: true, grep: true, glob: true },
    options: {},
  }
}
