import type { AgentConfig } from "sjz-opencode-sdk"

export function createConfigHook(agents: Record<string, AgentConfig>) {
  return async (openCodeConfig: Record<string, unknown>) => {
    if (!openCodeConfig.agent) openCodeConfig.agent = {}
    const agentMap = openCodeConfig.agent as Record<string, AgentConfig>
    for (const [id, agentConfig] of Object.entries(agents)) {
      agentMap[id] = agentConfig
    }
  }
}
