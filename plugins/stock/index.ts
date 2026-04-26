import type { PluginModule } from "sjz-opencode-plugin"
import { createPluginLogger, loadSkillContent, scheduleBackgroundTask, syncRemoteRepo } from "../shared/runtime"
import { join } from "node:path"
import { loadConfig } from "./config"

const TONGSTOCK_GITHUB = "https://github.com/sjzsdu/tongstock.git"
const GLOBAL_TONGSTOCK_DIR = join(process.env.HOME || "", ".tongstock")

const plugin: PluginModule = {
  id: "stock",
  async server({ client, directory, registerSkill, registerCommand }) {
    const config = loadConfig(directory)
    const pluginDir = import.meta.dir
    const logger = createPluginLogger("stock", client.app.log)

    scheduleBackgroundTask("tongstock sync", () => {
      syncRemoteRepo({ repoUrl: TONGSTOCK_GITHUB, globalDir: GLOBAL_TONGSTOCK_DIR, logger })
    }, logger)

    logger("info", "Stock plugin initialized")

    await registerCommand({
      name: "stock",
      description: "单入口 A 股分析 - 按输入动态选择维度并统一生成 HTML 报告",
      agent: "stock",
      template: `@stock $ARGUMENTS`,
    })

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
          await registerSkill({ name: skill.name, description: skill.description, content })
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
        for (const [id, agentConfig] of Object.entries(config.agents)) {
          configAny.agent[id] = agentConfig
        }
      },
    }
  },
}

export default plugin

