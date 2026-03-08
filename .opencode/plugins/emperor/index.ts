import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "./config"
import { JsonEdictStore } from "./store"
import { PROMPTS } from "./agents/prompts"
import { createEdictTool } from "./tools/edict"
import { createMemorialTool } from "./tools/memorial"
import { createHaltTool } from "./tools/halt"

// Get the directory where this plugin is located
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SKILLS_PATH = path.resolve(__dirname, "../skills")

export const EmperorPlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory)
  const store = new JsonEdictStore(directory, config.store.dataDir)

  client.app.log({ body: { service: "emperor", level: "info", message: "⚔️ Emperor plugin initialized" } })

  return {
    config: async (openCodeConfig) => {
      // Cast to any to access skills property (SDK may not have it in type definitions yet)
      const configAny = openCodeConfig as any

      // Inject Emperor skills paths
      if (!configAny.skills) {
        configAny.skills = {}
      }
      if (!configAny.skills.paths) {
        configAny.skills.paths = []
      }
      // Add Emperor's skills path if not already present
      if (!configAny.skills.paths.includes(SKILLS_PATH)) {
        configAny.skills.paths.push(SKILLS_PATH)
        client.app.log({ 
          body: { 
            service: "emperor", 
            level: "info", 
            message: `📚 Emperor skills loaded from: ${SKILLS_PATH}` 
          } 
        })
      }

      // Configure agents with Emperor prompts
      if (!configAny.agent) {
        configAny.agent = {}
      }
      for (const [id, agentConfig] of Object.entries(config.agents)) {
        // Inject the real prompt from prompts.ts if available
        const prompt = PROMPTS[id]
        if (prompt && (!agentConfig.prompt || agentConfig.prompt.startsWith("TODO"))) {
          agentConfig.prompt = prompt
        }
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
