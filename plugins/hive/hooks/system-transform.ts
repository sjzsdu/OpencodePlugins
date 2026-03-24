import type { HiveEventBus } from "../eventbus/bus"

export function createSystemTransformHook(
  eventBus: HiveEventBus,
  sessionToDomain: Map<string, string>,
) {
  return async (
    input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ) => {
    if (!input.sessionID) return
    const domainId = sessionToDomain.get(input.sessionID)
    if (!domainId) return

    const pending = eventBus.consume(domainId)
    if (pending.length === 0) return

    const formatted = pending.map(e =>
      `[${e.source}] (${e.type}) ${e.payload.message}`
    ).join("\n")

    output.system.push(
      `\n## 📬 来自其他Domain的通知\n\n${formatted}\n\n请根据以上通知评估是否需要采取行动。`
    )
  }
}
