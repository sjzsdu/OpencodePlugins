import type { Plugin } from "sjz-opencode-sdk"
import { loadConfig } from "./config"
import { JsonTriageStore } from "./store"
import { createAnalyzeTool } from "./tools/analyze"
import { createImplementTool } from "./tools/implement"
import { createStatusTool } from "./tools/status"

export const TriagePlugin: Plugin = async ({
  client,
  directory,
  registerCommand,
}) => {
  const config = loadConfig(directory)
  const store = new JsonTriageStore(directory, config.store.dataDir)

  client.app.log({
    body: {
      service: "triage",
      level: "info",
      message: "🎯 Triage plugin initialized",
    },
  })

  try {
    await registerCommand({
      name: "jira",
      description: "分析 Jira Ticket (Bug 分诊/Feature 方案)",
      template: "请使用 jira_analyze 工具分析 ticket $1。\n\n用户补充: $ARGUMENTS",
    })
    await registerCommand({
      name: "jira-go",
      description: "实现已确认的 Feature 方案",
      template: "请使用 jira_implement 工具实现已确认的方案, ticket key 为 $1。\n\n用户补充: $ARGUMENTS",
    })
  } catch (e) {
    client.app.log({
      body: {
        service: "triage",
        level: "warn",
        message: `Failed to register commands: ${e instanceof Error ? e.message : String(e)}`,
      },
    })
  }

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
    "tool.execute.before": async (
      { tool: toolID, sessionID, callID },
      output,
    ) => {
      if (toolID.startsWith("jira_")) {
        client.app.log({
          body: {
            service: "triage",
            level: "debug",
            message: `Tool ${toolID} executing in session ${sessionID}`,
          },
        })
      }
    },
    "tool.execute.after": async (
      { tool: toolID, sessionID, callID, args },
      output,
    ) => {
      if (toolID === "jira_analyze" && output.metadata?.taskId) {
        client.app.log({
          body: {
            service: "triage",
            level: "info",
            message: `Task ${output.metadata.taskId} ${output.metadata?.status || "created"}`,
          },
        })
      }
    },
    tool: {
      jira_analyze: createAnalyzeTool(client, store, config, directory),
      jira_implement: createImplementTool(client, store, config, directory),
      jira_status: createStatusTool(store),
    },
  }
}
