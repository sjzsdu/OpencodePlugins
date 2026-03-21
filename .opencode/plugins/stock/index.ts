import type { Plugin } from "sjz-opencode-sdk"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { loadConfig } from "./config"

const TONGSTOCK_GITHUB = "https://github.com/sjzsdu/tongstock.git"
const GLOBAL_TONGSTOCK_DIR = join(process.env.HOME || "", ".tongstock")

/**
 * Load skill content with fallback chain:
 * 1. Remote repo (~/.tongstock/skills/<name>/SKILL.md)
 * 2. Bundled fallback (plugins/stock/skills/<name>.md)
 */
function loadSkillContent(name: string, pluginDir: string): string | null {
  // Try remote first
  const remotePath = join(GLOBAL_TONGSTOCK_DIR, "skills", name, "SKILL.md")
  if (existsSync(remotePath)) {
    try {
      return readFileSync(remotePath, "utf-8")
    } catch { /* fall through */ }
  }

  // Fallback to bundled
  const bundledPath = join(pluginDir, "skills", `${name}.md`)
  if (existsSync(bundledPath)) {
    try {
      return readFileSync(bundledPath, "utf-8")
    } catch { /* fall through */ }
  }

  return null
}

/**
 * Clone or pull the tongstock repo for latest skills.
 */
function syncTongstockRepo(): void {
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
  } catch {
    // Clone/pull failed — will fall back to bundled skills
  }
}

export const StockPlugin: Plugin = async ({ client, directory, registerSkill }) => {
  const config = loadConfig(directory)
  const pluginDir = import.meta.dir

  // Sync remote skills repo (non-blocking on failure)
  syncTongstockRepo()

  client.app.log({ body: { service: "stock", level: "info", message: "📊 Stock Analyst plugin initialized" } })

  // Register skills with remote → bundled fallback
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
    } else {
      console.error(`[stock] Skill ${skill.name} not found (neither remote nor bundled)`)
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
