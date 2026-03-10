import { tool } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { TaskStore } from "../types"

export function createHaltTool(client: OpencodeClient, store: TaskStore) {
  return tool({
    description: "叫停正在执行的 Commander 任务",
    args: {
      task_id: tool.schema.string().describe("要叫停的任务 ID"),
      reason: tool.schema.string().optional().describe("叫停原因"),
    },
    async execute(args) {
      const task = store.get(args.task_id)
      if (!task) {
        return `未找到任务: ${args.task_id}`
      }

      if (task.status === "completed" || task.status === "failed" || task.status === "halted") {
        return `任务「${task.title}」已处于终态（${task.status}），无法叫停。`
      }

      // Abort any active execution sessions
      for (const exec of task.executions) {
        if (exec.status === "running") {
          for (const sessionId of [exec.coderSessionId, exec.testerSessionId]) {
            if (sessionId) {
              try {
                await client.session.abort({ path: { id: sessionId } })
              } catch {
                // Session may already be finished
              }
            }
          }
        }
      }

      store.update(args.task_id, { status: "halted" })
      const reason = args.reason ? `\n原因: ${args.reason}` : ""
      return `已叫停任务「${task.title}」(${args.task_id})${reason}`
    },
  })
}
