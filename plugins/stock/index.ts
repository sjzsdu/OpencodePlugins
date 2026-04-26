import type { PluginModule } from "sjz-opencode-plugin"
import { createPluginLogger, loadSkillContent, scheduleBackgroundTask, syncRemoteRepo } from "../shared/runtime"
import { join } from "node:path"
import { loadConfig } from "./config"

const TONGSTOCK_GITHUB = "https://github.com/sjzsdu/tongstock.git"
const GLOBAL_TONGSTOCK_DIR = join(process.env.HOME || "", ".tongstock")
const STOCK_COMMAND_AGENT_NAME = "stock-command"
const STOCK_COMMAND_NAME = "stock"
const STOCK_COMMAND_AGENT_DESCRIPTION = "Single-entry A-share analysis orchestrator that routes dimensions dynamically and generates Markdown by default, with optional HTML reports based on user intent"

const plugin: PluginModule = {
  id: "stock",
  async server(input) {
    const { client, directory } = input
    const config = loadConfig(directory)
    const pluginDir = import.meta.dir
    const logger = createPluginLogger("stock", client.app.log.bind(client.app))

    scheduleBackgroundTask("tongstock sync", () => {
      syncRemoteRepo({ repoUrl: TONGSTOCK_GITHUB, globalDir: GLOBAL_TONGSTOCK_DIR, logger })
    }, logger)

    logger("info", "Stock plugin initialized")

    try {
      await input.registerAgent({
        name: STOCK_COMMAND_AGENT_NAME,
        description: STOCK_COMMAND_AGENT_DESCRIPTION,
        mode: "subagent",
        options: {},
      })
    } catch (error) {
      logger("error", `Failed to register public stock agent ${STOCK_COMMAND_AGENT_NAME}: ${String(error)}`)
      throw error
    }

    try {
      await input.registerCommand({
        name: STOCK_COMMAND_NAME,
        description: "单入口 A 股分析 - 默认生成 Markdown 报告，可按意图切换为 HTML 报告",
        agent: STOCK_COMMAND_AGENT_NAME,
        subtask: true,
        template: `@stock $ARGUMENTS`,
      })
    } catch (error) {
      logger("error", `Failed to register stock command ${STOCK_COMMAND_NAME}: ${String(error)}`)
      throw error
    }

    const skills = [
      { name: "tongstock-cli", description: "TDX (通达信) CLI/HTTP API for Chinese A-share market data" },
      { name: "tongstock-workflow", description: "Pre-built workflows for Chinese A-share analysis" },
    ]

    for (const skill of skills) {
      const content = loadSkillContent({
        globalDir: GLOBAL_TONGSTOCK_DIR,
        pluginDir,
        skillName: skill.name,
        logger,
      })
      if (content) {
        try {
          await input.registerSkill({ name: skill.name, description: skill.description, content })
        } catch (error) {
          logger("error", `Failed to register ${skill.name} skill: ${String(error)}`)
        }
      }
    }

    return {
      config: async (openCodeConfig: any) => {
        const configAny = openCodeConfig as any
        if (!configAny.agent) {
          configAny.agent = {}
        }
        configAny.agent[STOCK_COMMAND_AGENT_NAME] = {
          ...config.agents.stock,
          name: STOCK_COMMAND_AGENT_NAME,
          description: STOCK_COMMAND_AGENT_DESCRIPTION,
          mode: "subagent",
          options: {},
        }
        for (const [id, agentConfig] of Object.entries(config.agents)) {
          configAny.agent[id] = agentConfig
        }
      },
    }
  },
}

export default plugin

