import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import type { HiveEventBus } from "../eventbus/bus"
import type { Domain, HiveConfig } from "../types"

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

export function createAutonomyHandler(
  eventBus: HiveEventBus,
  domains: Domain[],
  config: HiveConfig,
  client: OpencodeClient,
  sessionToDomain: Map<string, string>,
) {
  return async (changedDomainId: string, filePath: string): Promise<void> => {
    const autonomyLevel = config.coordination.autonomyLevel

    // Passive mode: do nothing
    if (autonomyLevel === "passive") return

    // Find dependent domains
    const dependentDomains = domains.filter(d =>
      d.dependencies.includes(changedDomainId)
    )
    if (dependentDomains.length === 0) return

    
    const events = eventBus.getAll()
    const hasBreakingChange = events.some(e =>
      e.source === changedDomainId &&
      e.type === "breaking_change" &&
      e.status === "pending"
    )
    const hasConflict = events.some(e =>
      e.source === changedDomainId &&
      e.type === "conflict_detected" &&
      e.status === "pending"
    )
    if (!hasBreakingChange && !hasConflict) return

    for (const depDomain of dependentDomains) {
      if (autonomyLevel === "propose") {
        // Just notify, don't auto-execute
        eventBus.publish({
          type: "action_proposal",
          source: "system",
          target: depDomain.id,
          payload: {
            message: `@${changedDomainId} 发布了破坏性变更，你的领域可能需要适配。请检查并处理。`,
            data: { triggeredBy: changedDomainId, filePath },
          },
        })
        } else if (autonomyLevel === "full") {
        // Auto-execute adaptation
        eventBus.publish({
          type: "action_proposal",
          source: depDomain.id,
          target: "*",
          payload: {
            message: `自主适配: @${changedDomainId} 的破坏性变更`,
          },
        })

        try {
          const session = await client.session.create({
            body: { title: `Hive·${depDomain.name}·自主适配` },
          })
          const sessionId = session.data!.id
          sessionToDomain.set(sessionId, depDomain.id)
          const eventDesc = hasBreakingChange
            ? `@${changedDomainId} 发布了破坏性变更，涉及文件: ${filePath}`
            : `检测到冲突: 另一个域修改了你管辖范围内的文件: ${filePath}`

          const response = await client.session.prompt({
            path: { id: sessionId },
            body: {
              agent: depDomain.id,
              parts: [{ type: "text" as const, text: `${eventDesc}\n\n请：\n1. 检查你领域内受影响的代码\n2. 进行必要的适配修改\n3. 运行测试验证\n4. 通过 hive_emit 报告完成情况` }],
            },
          })

          const responseText = extractText(response.data?.parts ?? [])

          eventBus.publish({
            type: "action_completed",
            source: depDomain.id,
            target: "*",
            payload: {
              message: `自主适配完成: ${responseText.substring(0, 200)}`,
            },
          })
        } catch (err) {
          eventBus.publish({
            type: "task_failed",
            source: depDomain.id,
            target: "*",
            payload: {
              message: `自主适配失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          })
        }
      }
    }
  }
}
