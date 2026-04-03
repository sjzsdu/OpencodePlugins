import type { PluginModule } from "sjz-opencode-plugin"
import { existsSync, readdirSync, statSync, readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"

const SUPERPOWERS_GITHUB = "https://github.com/obra/superpowers"
const GLOBAL_SUPERPOWERS_DIR = join(process.env.HOME || "", ".superpowers")

const loadFileContent = (filePath: string): string | null => {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, "utf-8")
    }
  } catch (e) {
  }
  return null
}

interface Frontmatter {
  name?: string
  description?: string
  model?: string
  mode?: string
  [key: string]: string | undefined
}

const parseFrontmatter = (content: string): { frontmatter: Frontmatter; body: string } => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  const lines = match[1].split("\n")
  const body = match[2]
  const frontmatter: Frontmatter = {}

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const colonIdx = line.indexOf(":")
    if (colonIdx > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      const key = line.slice(0, colonIdx).trim()
      const rest = line.slice(colonIdx + 1).trim()

      if (rest === "|") {
        const blockLines: string[] = []
        i++
        while (i < lines.length && (lines[i].startsWith(" ") || lines[i] === "")) {
          blockLines.push(lines[i].replace(/^ {2}/, ""))
          i++
        }
        frontmatter[key] = blockLines.join(" ").trim()
      } else {
        frontmatter[key] = rest.replace(/^["']|["']$/g, "")
        i++
      }
    } else {
      i++
    }
  }

  return { frontmatter, body }
}

interface AgentEntry {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  prompt: string
}

const loadAgents = (): AgentEntry[] => {
  const agentsDir = join(GLOBAL_SUPERPOWERS_DIR, "agents")
  if (!existsSync(agentsDir)) return []
  try {
    return readdirSync(agentsDir)
      .filter((f) => f.endsWith(".md"))
      .flatMap((agentFile) => {
        const rawContent = loadFileContent(join(agentsDir, agentFile))
        if (!rawContent) return []
        const { frontmatter, body } = parseFrontmatter(rawContent)
        return [
          {
            name: frontmatter.name || agentFile.replace(".md", ""),
            description: frontmatter.description,
            mode: (frontmatter.mode ?? "subagent") as "subagent" | "primary" | "all",
            prompt: body.trim(),
          },
        ]
      })
  } catch (e) {
    return []
  }
}

const cloneSuperpowers = (): void => {
  execSync(`git clone "${SUPERPOWERS_GITHUB}" "${GLOBAL_SUPERPOWERS_DIR}"`, {
    stdio: "ignore",
    timeout: 120000,
  })
}

const plugin: PluginModule = {
  id: "superpower",
  async server({ registerSkill, registerCommand }) {
    if (!existsSync(GLOBAL_SUPERPOWERS_DIR)) {
      try {
        cloneSuperpowers()
      } catch (e) {
        return {}
      }
    }

    const agents = loadAgents()

    const skillsDir = join(GLOBAL_SUPERPOWERS_DIR, "skills")
    if (existsSync(skillsDir)) {
      try {
        const skills = readdirSync(skillsDir)
        for (const skillName of skills) {
          const skillPath = join(skillsDir, skillName)
          if (!statSync(skillPath).isDirectory()) continue

          const rawContent = loadFileContent(join(skillPath, "SKILL.md"))
          if (!rawContent) continue

          const { frontmatter } = parseFrontmatter(rawContent)
          const description = frontmatter.description || skillName

          try {
            await registerSkill({
              name: `superpowers/${skillName}`,
              description,
              content: rawContent,
            })
          } catch (e) {
          }
        }
      } catch (e) {
      }
    }

    const commandsDir = join(GLOBAL_SUPERPOWERS_DIR, "commands")
    if (existsSync(commandsDir)) {
      try {
        const commands = readdirSync(commandsDir)
        for (const cmdFile of commands) {
          if (!cmdFile.endsWith(".md")) continue

          const cmdPath = join(commandsDir, cmdFile)
          const rawContent = loadFileContent(cmdPath)
          if (!rawContent) continue

          const { frontmatter, body } = parseFrontmatter(rawContent)
          const commandName = frontmatter.name || cmdFile.replace(".md", "")
          const description = frontmatter.description || commandName

          try {
            await registerCommand({
              name: commandName,
              description,
              agent: commandName,
              template: body.trim(),
            })
          } catch (e) {
          }
        }
      } catch (e) {
      }
    }

    return {
      config: async (openCodeConfig) => {
        const cfg = openCodeConfig as any
        if (!cfg.agent) cfg.agent = {}
        for (const agent of agents) {
          cfg.agent[agent.name] = {
            description: agent.description,
            mode: agent.mode,
            prompt: agent.prompt,
          }
        }
      },
    }
  },
}

export default plugin
