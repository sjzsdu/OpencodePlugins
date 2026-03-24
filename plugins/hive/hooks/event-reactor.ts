import type { OpencodeClient } from "sjz-opencode-sdk"
import type { HiveEventBus } from "../eventbus/bus"
import type { Domain, EventType } from "../types"

const REACTIVE_EVENT_TYPES: ReadonlySet<EventType> = new Set([
  "breaking_change",
  "conflict_detected",
])

export function createEventReactorHook(
  eventBus: HiveEventBus,
  domains: Domain[],
  client: OpencodeClient,
  sessionToDomain: Map<string, string>,
) {
  const processed = new Set<string>()
  let pipelineRunning = false

  eventBus.onEvent((event) => {
    if (event.type === "pipeline_started") pipelineRunning = true
    if (event.type === "pipeline_completed" || event.type === "pipeline_failed") pipelineRunning = false
  })

  return async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => {
    if (input.tool !== "write" && input.tool !== "edit") return
    if (pipelineRunning) return

    const allEvents = eventBus.getAll()
    for (const domain of domains) {
      const reactive = allEvents.filter(e =>
        e.status === "pending"
        && !e.consumed.includes(domain.id)
        && e.source !== domain.id
        && (e.target === domain.id || e.target === "*")
        && REACTIVE_EVENT_TYPES.has(e.type)
        && !processed.has(e.id),
      )
      if (reactive.length === 0) continue

      for (const event of reactive) {
        processed.add(event.id)
        try {
          const session = await client.session.create({
            body: { title: `Hive·${domain.name}·响应·${event.type}` },
          })
          sessionToDomain.set(session.data!.id, domain.id)

          await client.session.prompt({
            path: { id: session.data!.id },
            body: {
              agent: domain.id,
              parts: [{
                type: "text" as const,
                text: [
                  `你收到了一个需要立即响应的事件：`,
                  ``,
                  `**类型**: ${event.type}`,
                  `**来源**: @${event.source}`,
                  `**内容**: ${event.payload.message}`,
                  ``,
                  `请：`,
                  `1. 评估对你领域的影响`,
                  `2. 如果需要修改代码，立即执行`,
                  `3. 通过 hive_emit 报告处理结果`,
                ].join("\n"),
              }],
            },
          })
        } catch {
          // skip failed reactions
        }
      }
    }
  }
}
