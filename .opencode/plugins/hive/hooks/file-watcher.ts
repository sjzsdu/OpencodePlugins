import type { HiveEventBus } from "../eventbus/bus"
import type { Domain } from "../types"

type AutonomyHandler = (changedDomainId: string, filePath: string) => Promise<void>

export function createFileWatcherHook(
  eventBus: HiveEventBus,
  domains: Domain[],
  sessionToDomain: Map<string, string>,
  autonomyHandler: AutonomyHandler,
) {
  return async (
    input: {
      sessionID?: string
      tool: { name: string }
      args: Record<string, unknown>
    },
    output: { result: unknown },
  ) => {
    // Only intercept write/edit tools
    const toolName = input.tool.name
    if (toolName !== "write" && toolName !== "edit") return

    // Get file path from tool args
    const filePath = (input.args.filePath ?? input.args.path ?? "") as string
    if (!filePath) return

    // Determine which domain owns this file
    const ownerDomain = domains.find(d =>
      d.paths.some(p => filePath.includes(p))
    )

    // Determine who made the change
    const sourceDomain = input.sessionID ? sessionToDomain.get(input.sessionID) : undefined

    // Publish file_changed event
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

    // If a domain agent modified a file outside its own domain, detect potential conflict
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

    // Trigger autonomy handler for the affected domain
    if (ownerDomain) {
      await autonomyHandler(ownerDomain.id, filePath).catch(() => {
        // Autonomy handler failures are non-fatal
      })
    }
  }
}
