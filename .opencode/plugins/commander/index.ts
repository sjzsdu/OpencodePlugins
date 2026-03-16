import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { JsonTaskStore } from "./store"
import { createTaskTool } from "./tools/task"
import { createStatusTool } from "./tools/status"
import { createHaltTool } from "./tools/halt"

export const CommanderPlugin: Plugin = async ({ client, project, directory, worktree, serverUrl, $ }) => {
  const config = loadConfig(directory)
  const store = new JsonTaskStore(directory, config.store.dataDir)

  client.app.log({ body: { service: "commander", level: "info", message: "🎖️ Commander plugin initialized" } })

  return {
    config: async (openCodeConfig) => {
      const configAny = openCodeConfig
      if (!configAny.agent) {
        configAny.agent = {}
      }
      for (const [id, agentConfig] of Object.entries(config.agents)) {
        configAny.agent[id] = agentConfig
      }
    },
    "tool.execute.before": async ({ tool: toolID, sessionID, callID }, output) => {
      if (toolID.startsWith("cmd_")) {
        client.app.log({ 
          body: { 
            service: "commander", 
            level: "debug", 
            message: `Tool ${toolID} executing in session ${sessionID}` 
          } 
        })
      }
    },
    "tool.execute.after": async ({ tool: toolID, sessionID, callID, args }, output) => {
      if (toolID === "cmd_task" && output.metadata?.taskId) {
        client.app.log({ 
          body: { 
            service: "commander", 
            level: "info", 
            message: `Task ${output.metadata.taskId} ${output.metadata?.status || "created"}` 
          } 
        })
      }
    },
    tool: {
      cmd_task: createTaskTool(client, store, config, directory),
      cmd_status: createStatusTool(store),
      cmd_halt: createHaltTool(client, store),
    },
  }
}
