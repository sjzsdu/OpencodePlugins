import type { PluginModule } from "sjz-opencode-plugin"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { loadConfig } from "./config"

const TONGSTOCK_GITHUB = "https://github.com/sjzsdu/tongstock.git"
const GLOBAL_TONGSTOCK_DIR = join(process.env.HOME || "", ".tongstock")

function loadSkillContent(name: string, pluginDir: string): string | null {
  const remotePath = join(GLOBAL_TONGSTOCK_DIR, "skills", name, "SKILL.md")
  if (existsSync(remotePath)) {
    try {
      return readFileSync(remotePath, "utf-8")
    } catch {}
  }

  const bundledPath = join(pluginDir, "skills", `${name}.md`)
  if (existsSync(bundledPath)) {
    try {
      return readFileSync(bundledPath, "utf-8")
    } catch {}
  }

  return null
}

function syncTongstockRepo(): void {
  setImmediate(() => {
    try {
      if (!existsSync(GLOBAL_TONGSTOCK_DIR)) {
        execSync(`git clone "${TONGSTOCK_GITHUB}" "${GLOBAL_TONGSTOCK_DIR}"`, {
          stdio: "ignore",
          timeout: 120_000,
        })
      } else if (existsSync(join(GLOBAL_TONGSTOCK_DIR, ".git"))) {
        execSync("git pull --ff-only", {
          cwd: GLOBAL_TONGSTOCK_DIR,
          stdio: "ignore",
          timeout: 30_000,
        })
      }
    } catch {}
  })
}

const plugin: PluginModule = {
  id: "stock",
  async server({ client, directory, registerSkill, registerCommand }) {
    const config = loadConfig(directory)
    const pluginDir = import.meta.dir

    syncTongstockRepo()

    client.app.log({ body: { service: "stock", level: "info", message: "📊 Stock plugin initialized" } })

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
      const content = loadSkillContent(skill.name, pluginDir)
      if (content) {
        try {
          await registerSkill({ name: skill.name, description: skill.description, content })
        } catch (e) {
          console.error(`[stock] Failed to register ${skill.name} skill:`, e)
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
