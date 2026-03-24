import { tool } from "@opencode-ai/plugin"
import type { OpencodeClient } from "sjz-opencode-sdk"
import type { EdictStore } from "../types"

export function createHaltTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "叫停正在执行的旨意",
    args: {
      id: tool.schema.string().describe("要叫停的旨意 ID"),
      reason: tool.schema.string().optional().describe("叫停原因"),
    },
    async execute(args) {
      const edict = store.get(args.id)
      if (!edict) {
        return `未找到旨意: ${args.id}`
      }

      if (edict.status === "completed" || edict.status === "failed" || edict.status === "halted") {
        return `旨意「${edict.title}」已处于终态（${edict.status}），无法叫停。`
      }

      // Abort any active execution sessions
      for (const exec of edict.executions) {
        if (exec.status === "running" && exec.sessionId) {
          try {
            await client.session.abort({ path: { id: exec.sessionId } })
          } catch {
            // Session may already be finished
          }
        }
      }

      store.update(args.id, { status: "halted" })
      const reason = args.reason ? `\n原因: ${args.reason}` : ""
      return `已叫停旨意「${edict.title}」(${args.id})${reason}`
    },
  })
}
