import type { PluginModule } from "sjz-opencode-plugin"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"

const CODE_CONTEXT_GITHUB = "https://github.com/sjzsdu/code-context.git"
const GLOBAL_CODE_CONTEXT_DIR = join(process.env.HOME || "", ".code-context")

function loadSkillContent(name: string, pluginDir: string): string | null {
  const remotePath = join(GLOBAL_CODE_CONTEXT_DIR, "skills", name, "SKILL.md")
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

function getCodeContextBin(): string | null {
  const pathBin = execSync("which code-context", { encoding: "utf-8" }).trim()
  if (pathBin && existsSync(pathBin)) {
    return pathBin
  }

  const localBin = join(GLOBAL_CODE_CONTEXT_DIR, "code-context")
  if (existsSync(localBin)) {
    return localBin
  }

  const gopathBin = join(process.env.GOPATH || join(process.env.HOME || "", "go"), "bin", "code-context")
  if (existsSync(gopathBin)) {
    return gopathBin
  }

  return null
}

function ensureCodeContextBuilt(): void {
  const existingBin = getCodeContextBin()
  if (existingBin) {
    return
  }

  setImmediate(() => {
    try {
      execSync(`go install github.com/sjzsdu/code-context/cmd/code-context@latest`, {
        stdio: "inherit",
        timeout: 300_000,
      })
    } catch {
      try {
        const binPath = join(GLOBAL_CODE_CONTEXT_DIR, "code-context")
        execSync(`go build -o "${binPath}" ./cmd/code-context`, {
          cwd: GLOBAL_CODE_CONTEXT_DIR,
          stdio: "inherit",
          timeout: 300_000,
        })
      } catch (e) {
        console.error("[code-context] Failed to build code-context:", e)
      }
    }
  })
}

function syncCodeContextRepo(): void {
  setImmediate(() => {
    try {
      if (!existsSync(GLOBAL_CODE_CONTEXT_DIR)) {
        execSync(`git clone "${CODE_CONTEXT_GITHUB}" "${GLOBAL_CODE_CONTEXT_DIR}"`, {
          stdio: "ignore",
          timeout: 120_000,
        })
      } else if (existsSync(join(GLOBAL_CODE_CONTEXT_DIR, ".git"))) {
        execSync("git pull --ff-only", {
          cwd: GLOBAL_CODE_CONTEXT_DIR,
          stdio: "ignore",
          timeout: 30_000,
        })
      }
    } catch {}
  })
}

function autoIndexCodebase(directory: string): void {
  const bin = getCodeContextBin()
  if (!bin) {
    ensureCodeContextBuilt()
    return
  }

  setImmediate(() => {
    try {
      execSync(`"${bin}" index`, {
        cwd: directory,
        stdio: "ignore",
        timeout: 300_000,
      })
    } catch {}
  })
}

const plugin: PluginModule = {
  id: "code-context",
  async server({ client, directory, registerSkill, registerCommand, registerAgent }) {
    const pluginDir = import.meta.dir

    syncCodeContextRepo()
    ensureCodeContextBuilt()

    client.app.log({ body: { service: "code-context", level: "info", message: "🔍 Code Context plugin initialized" } })

    autoIndexCodebase(directory)

    await registerAgent({
      name: "code-analyzer",
      description: "Code analysis agent using code-context for structural indexing, symbol search, definition lookup, impact analysis",
      mode: "subagent",
      options: {},
    })

    await registerCommand({
      name: "code-analyze",
      description: "Analyze code structure and generate context for a feature/topic",
      agent: "code-analyzer",
      template: `Analyze the codebase for topic: $ARGUMENTS
Use the code-context skill with:
1. "search" to find related symbols
2. "snapshot" to generate LLM context  
3. "map" to show project structure`,
    })

    await registerCommand({
      name: "code-impact",
      description: "Analyze change impact - what files might break if you modify a file",
      agent: "code-analyzer",
      template: `Analyze change impact for: $ARGUMENTS
Use code-context skill with "diff_impact" to find:
- Dependencies
- Dependent files
- Recommended test files`,
    })

    await registerCommand({
      name: "code-explore",
      description: "Explore code - find definitions, references, understand code flow",
      agent: "code-analyzer",
      template: `Explore code for: $ARGUMENTS
Use code-context skill with:
1. "find_def" to find definition
2. "find_refs" to find all references
3. "context" for symbol profile
4. "trace" to trace call chains`,
    })

    const content = loadSkillContent("code-context", pluginDir)
    if (content) {
      try {
        await registerSkill({
          name: "code-context",
          description: "Code context system for AI agents - structural indexing, symbol search, definition lookup, impact analysis",
          content,
        })
      } catch (e) {
        console.error("[code-context] Failed to register code-context skill:", e)
      }
    }

    return {
      config: async (openCodeConfig: any) => {
        const configAny = openCodeConfig as any
        if (!configAny.agent) {
          configAny.agent = {}
        }
        configAny.agent["code-analyzer"] = {
          description: "Code analysis agent using code-context for structural indexing, symbol search, definition lookup, impact analysis",
          mode: "subagent",
          options: {},
        }
      },
    }
  },
}

export default plugin