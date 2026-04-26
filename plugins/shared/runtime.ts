import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

type LogLevel = "info" | "warn" | "error"

export type PluginLogger = (level: LogLevel, message: string) => void

export function createPluginLogger(service: string, appLogger?: { (entry: { body: { service: string, level: LogLevel, message: string } }): void } | undefined): PluginLogger {
  const boundAppLogger = appLogger?.bind?.((appLogger as any).owner ?? null) ?? appLogger
  return (level, message) => {
    try {
      boundAppLogger?.({ body: { service, level, message } })
    } catch {
      // Fall back to console logging if the host logger cannot be invoked safely.
    }
    const formatted = `[${service}] ${message}`
    if (level === "error") {
      console.error(formatted)
      return
    }
    if (level === "warn") {
      console.warn(formatted)
      return
    }
    console.log(formatted)
  }
}

export function loadRemoteSkillContent(options: {
  globalDir: string
  skillName: string
  logger: PluginLogger
}): string | null {
  const { globalDir, skillName, logger } = options
  const remotePath = join(globalDir, "skills", skillName, "SKILL.md")
  if (existsSync(remotePath)) {
    try {
      return readFileSync(remotePath, "utf-8")
    } catch (error) {
      logger("warn", `Failed to read remote skill content from ${remotePath}: ${String(error)}`)
      return null
    }
  }

  logger("warn", `Remote skill content for ${skillName} was not found at ${remotePath}`)
  return null
}

export function loadSkillContent(options: {
  globalDir: string
  pluginDir: string
  skillName: string
  logger: PluginLogger
}): string | null {
  const { globalDir, pluginDir, skillName, logger } = options
  const remotePath = join(globalDir, "skills", skillName, "SKILL.md")
  if (existsSync(remotePath)) {
    try {
      return readFileSync(remotePath, "utf-8")
    } catch (error) {
      logger("warn", `Failed to read remote skill content from ${remotePath}: ${String(error)}`)
    }
  }

  const bundledPath = join(pluginDir, "skills", `${skillName}.md`)
  if (existsSync(bundledPath)) {
    try {
      return readFileSync(bundledPath, "utf-8")
    } catch (error) {
      logger("warn", `Failed to read bundled skill content from ${bundledPath}: ${String(error)}`)
    }
  }

  logger("warn", `Skill content for ${skillName} was not found in ${remotePath} or ${bundledPath}`)
  return null
}

export function scheduleBackgroundTask(taskName: string, task: () => void | Promise<void>, logger: PluginLogger): void {
  setImmediate(() => {
    Promise.resolve(task()).catch((error) => {
      logger("error", `${taskName} failed: ${String(error)}`)
    })
  })
}

export function syncRemoteRepo(options: {
  repoUrl: string
  globalDir: string
  logger: PluginLogger
}): boolean {
  const { repoUrl, globalDir, logger } = options

  try {
    if (!existsSync(globalDir)) {
      logger("info", `Cloning ${repoUrl} into ${globalDir}`)
      execSync(`git clone "${repoUrl}" "${globalDir}"`, {
        stdio: "ignore",
        timeout: 120_000,
      })
      return true
    }

    if (existsSync(join(globalDir, ".git"))) {
      logger("info", `Updating repository in ${globalDir}`)
      execSync("git pull --ff-only", {
        cwd: globalDir,
        stdio: "ignore",
        timeout: 30_000,
      })
      return true
    }

    logger("warn", `${globalDir} exists but is not a git repository; skipping sync`)
    return false
  } catch (error) {
    logger("error", `Repository sync failed for ${globalDir}: ${String(error)}`)
    return false
  }
}

export function findBinary(binaryName: string, additionalPaths: string[], logger: PluginLogger): string | null {
  try {
    const pathBin = execSync(`which ${binaryName}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    if (pathBin && existsSync(pathBin)) {
      return pathBin
    }
  } catch {
    logger("info", `${binaryName} was not found in PATH`)
  }

  for (const candidate of additionalPaths) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}
