import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { JsonEdictStore } from "./store"
import { createEdictTool } from "./tools/edict"
import { createMemorialTool } from "./tools/memorial"
import { createHaltTool } from "./tools/halt"

export const EmperorPlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory)
  const store = new JsonEdictStore(directory, config.store.dataDir)

  client.app.log({ body: { service: "emperor", level: "info", message: "⚔️ Emperor plugin initialized" } })

  return {
    config: async (openCodeConfig) => {
      const configAny = openCodeConfig as any
      if (!configAny.agent) {
        configAny.agent = {}
      }
      for (const [id, agentConfig] of Object.entries(config.agents)) {
        configAny.agent[id] = agentConfig
      }
    },
    tool: {
      "edict": createEdictTool(client, store, config, directory),
      "memorial": createMemorialTool(store),
      "halt": createHaltTool(client, store),
    },
  }
}
