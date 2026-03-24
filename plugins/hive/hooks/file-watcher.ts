import type { HiveEventBus } from "../eventbus/bus"
import type { Domain, HiveConfig } from "../types"
import { reloadDomains } from "../discovery/index"

type AutonomyHandler = (changedDomainId: string, filePath: string) => Promise<void>

export function createFileWatcherHook(
  eventBus: HiveEventBus,
  domains: Domain[],
  sessionToDomain: Map<string, string>,
  autonomyHandler: AutonomyHandler,
  directory?: string,
  config?: HiveConfig,
  registerAgent?: (agent: any) => Promise<void>,
) {
  return async (
    input: {
      sessionID?: string
      tool: string
      callID?: string
      args: Record<string, unknown>
    },
    output: { title: string; output: string; metadata: any },
  ) => {
    const toolName = input.tool
    if (toolName !== "write" && toolName !== "edit") return

    const filePath = (input.args.filePath ?? input.args.path ?? "") as string
    if (!filePath) return

    if (filePath.endsWith(".hive/domains.json") && directory && config) {
      reloadDomains(directory, config, registerAgent)
      return
    }

    const ownerDomain = domains.find(d =>
      d.paths.some(p => filePath.includes(p))
    )

    const sourceDomain = input.sessionID ? sessionToDomain.get(input.sessionID) : undefined

    eventBus.publish({
      type: "file_changed",
      source: sourceDomain ?? "system",
      target: "*",
      payload: {
        message: `文件变更: ${filePath}`,
        data: {
          filePath,
          ownerDomain: ownerDomain?.id,
          changedBy: sourceDomain,
        },
      },
    })

    if (sourceDomain && ownerDomain && sourceDomain !== ownerDomain.id) {
      eventBus.publish({
        type: "conflict_detected",
        source: "system",
        target: ownerDomain.id,
        payload: {
          message: `⚠️ @${sourceDomain} 修改了你管辖范围内的文件: ${filePath}`,
          data: { filePath, changedBy: sourceDomain },
        },
      })
    }

    if (ownerDomain) {
      await autonomyHandler(ownerDomain.id, filePath).catch(() => {})
    }
  }
}
