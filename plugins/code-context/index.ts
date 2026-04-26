import type { PluginModule } from "sjz-opencode-plugin"
import { execSync } from "node:child_process"
import { join } from "node:path"
import { createPluginLogger, findBinary, loadRemoteSkillContent, scheduleBackgroundTask, syncRemoteRepo } from "../shared/runtime"

const CODE_CONTEXT_GITHUB = "https://github.com/sjzsdu/code-context.git"
const GLOBAL_CODE_CONTEXT_DIR = join(process.env.HOME || "", ".code-context")
const CODE_CONTEXT_GO_INSTALL_TARGET = "github.com/sjzsdu/code-context/cmd/code-context@latest"
const CODE_CONTEXT_AGENT_NAME = "code-context-explorer"
const CODE_CONTEXT_COMMAND_NAME = "code-context"
const CODE_CONTEXT_AGENT_DESCRIPTION = "Explore and interpret the current project primarily through code-context CLI outputs, with emphasis on project structure and symbol understanding"

function getCodeContextBin(logger: ReturnType<typeof createPluginLogger>): string | null {
  return findBinary("code-context", [
    join(GLOBAL_CODE_CONTEXT_DIR, "code-context"),
    join(process.env.GOPATH || join(process.env.HOME || "", "go"), "bin", "code-context"),
  ], logger)
}

function ensureCodeContextBuilt(logger: ReturnType<typeof createPluginLogger>): string | null {
  const existingBin = getCodeContextBin(logger)
  if (existingBin) {
    return existingBin
  }

  try {
    logger("info", `Installing code-context via go install ${CODE_CONTEXT_GO_INSTALL_TARGET}`)
    execSync(`go install ${CODE_CONTEXT_GO_INSTALL_TARGET}`, {
      stdio: "ignore",
      timeout: 300_000,
    })
    return getCodeContextBin(logger)
  } catch (installError) {
    logger("warn", `go install failed, falling back to local build: ${String(installError)}`)
  }

  if (!syncRemoteRepo({ repoUrl: CODE_CONTEXT_GITHUB, globalDir: GLOBAL_CODE_CONTEXT_DIR, logger })) {
    return null
  }

  try {
    const binPath = join(GLOBAL_CODE_CONTEXT_DIR, "code-context")
    logger("info", `Building code-context binary into ${binPath}`)
    execSync(`go build -o "${binPath}" ./cmd/code-context`, {
      cwd: GLOBAL_CODE_CONTEXT_DIR,
      stdio: "ignore",
      timeout: 300_000,
    })
    return binPath
  } catch (buildError) {
    logger("error", `Failed to build code-context locally: ${String(buildError)}`)
    return null
  }
}

function runCodeContextIndex(directory: string, logger: ReturnType<typeof createPluginLogger>): void {
  const bin = ensureCodeContextBuilt(logger)
  if (!bin) {
    logger("warn", "Skipping automatic indexing because code-context binary is unavailable")
    return
  }

  try {
    logger("info", `Indexing workspace in ${directory}`)
    execSync(`"${bin}" index`, {
      cwd: directory,
      stdio: "ignore",
      timeout: 300_000,
    })
  } catch (error) {
    logger("error", `Workspace indexing failed for ${directory}: ${String(error)}`)
  }
}

const plugin: PluginModule = {
  id: "code-context",
  async server({ client, directory, registerSkill, registerCommand, registerAgent }) {
    const logger = createPluginLogger("code-context", client.app.log.bind(client.app))

    logger("info", "Code Context plugin initialized")

    scheduleBackgroundTask("code-context setup", () => {
      const synced = syncRemoteRepo({ repoUrl: CODE_CONTEXT_GITHUB, globalDir: GLOBAL_CODE_CONTEXT_DIR, logger })
      if (!synced) {
        logger("warn", "Repository sync was skipped or failed; continuing with available local assets")
      }
      runCodeContextIndex(directory, logger)
    }, logger)

    await registerAgent({
      name: CODE_CONTEXT_AGENT_NAME,
      description: CODE_CONTEXT_AGENT_DESCRIPTION,
      mode: "subagent",
      options: {},
    })

    await registerCommand({
      name: CODE_CONTEXT_COMMAND_NAME,
      description: "Explore the current project through code-context CLI material and interpret its symbols and structure",
      agent: CODE_CONTEXT_AGENT_NAME,
      template: `Explore the current project with the topic or question: $ARGUMENTS
Your primary source of truth must be the code-context CLI output for this workspace.
Focus on understanding and explaining the project by using code-context commands such as:
- "map" for project structure
- "search" for relevant symbols
- "find-def" for definitions
- "references" for symbol usage
- "context" for symbol profiles
- "explain" for file-level interpretation
- "trace" for call-chain understanding
- "snapshot" when a compact LLM context bundle helps
Explain the project and its symbols mainly from the evidence provided by these commands, and only use direct file reading when the CLI output clearly requires clarification.`,
    })

    const content = loadRemoteSkillContent({
      globalDir: GLOBAL_CODE_CONTEXT_DIR,
      skillName: "code-context",
      logger,
    })

    if (content) {
      try {
        await registerSkill({
          name: "code-context",
          description: "Code context system for AI agents - structural indexing, symbol search, definition lookup, impact analysis",
          content,
        })
      } catch (error) {
        logger("error", `Failed to register code-context skill: ${String(error)}`)
      }
    }

    return {
      config: async (openCodeConfig: any) => {
        const configAny = openCodeConfig as any
        if (!configAny.agent) {
          configAny.agent = {}
        }
        configAny.agent[CODE_CONTEXT_AGENT_NAME] = {
          description: CODE_CONTEXT_AGENT_DESCRIPTION,
          mode: "subagent",
          options: {},
        }
      },
    }
  },
}

export default plugin
