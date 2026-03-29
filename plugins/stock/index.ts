import type { Plugin } from "sjz-opencode-sdk"
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

export const StockPlugin: Plugin = async ({ client, directory, registerSkill, registerCommand }) => {
  const config = loadConfig(directory)
  const pluginDir = import.meta.dir

  syncTongstockRepo()

  client.app.log({ body: { service: "stock", level: "info", message: "📊 Stock Analyst plugin initialized" } })

  await registerCommand({
    name: "stock-general",
    description: "综合分析A股股票 - 5维度深度分析（基本面、技术面、行业、舆情、筹码）",
    template: `@stock-general $ARGUMENTS`,
  })

  await registerCommand({
    name: "stock-tech",
    description: "技术分析A股股票 - 纯技术指标分析（MA、MACD、KDJ、BOLL、RSI）",
    template: `@stock-tech $ARGUMENTS`,
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
}
