import { tool } from "@opencode-ai/plugin"
import type { EdictStore } from "../types"

export function createEdictStatusTool(store: EdictStore) {
  return tool({
    description: "查看旨意的实时执行状态和会话",
    args: {
      id: tool.schema.string().optional().describe("旨意 ID，不填则显示最近活跃的旨意"),
    },
    async execute(args) {
      // Determine which edict to show
      const edict = args.id ? store.get(args.id) : store.list().slice().sort((a,b)=>b.createdAt-a.createdAt)[0]
      if (!edict) return "未找到任何旨意。"

      const sesses = (edict.sessions ?? [])
      const total = edict.executions.length
      const completed = edict.executions.filter((e) => e.status === "completed").length
      const inProgress = edict.executions.filter((e) => e.status === "running").length

      const lines = [
        `旨意: ${edict.title} (${edict.id})`,
        `状态: ${edict.status}`,
        `进度: ${completed}/${total} 完成, 进行中: ${inProgress}`,
      ]
      if (sesses.length > 0) {
        lines.push("\n会话记录:")
        sesses.forEach((s) => {
          lines.push(`- [${s.phase}] ${s.title} (${s.sessionId})创造于 ${new Date(s.createdAt).toLocaleString()}`)
        })
      }

      return lines.join("\n")
    },
  })
}
