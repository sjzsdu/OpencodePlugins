import { tool } from "@opencode-ai/plugin"
import type { EdictStore } from "../types"

const STATUS_DISPLAY: Record<string, string> = {
  received: "📥 已接收",
  planning: "📜 规划中",
  reviewing: "🔍 审核中",
  needs_approval: "⚠️ 待确认",
  denied: "🚫 已拒绝",
  rejected: "🔙 被封驳",
  dispatched: "📤 已派发",
  executing: "⚔️ 执行中",
  completed: "✅ 已完成",
  failed: "❌ 失败",
  halted: "🛑 已叫停",
}

export function createMemorialTool(store: EdictStore) {
  return tool({
    description: "查看历史旨意的执行记录和奏折",
    args: {
      id: tool.schema.string().optional().describe("旨意 ID，不填则列出全部"),
    },
    async execute(args) {
      if (args.id) {
        const edict = store.get(args.id)
        if (!edict) {
          return `未找到旨意: ${args.id}`
        }
        if (edict.memorial) {
          return edict.memorial
        }
        const status = STATUS_DISPLAY[edict.status] ?? edict.status
        return `旨意「${edict.title}」当前状态: ${status}\nID: ${edict.id}\n创建时间: ${new Date(edict.createdAt).toLocaleString()}`
      }

      const edicts = store.list()
      if (edicts.length === 0) {
        return "暂无旨意记录。"
      }

      const lines = ["# 旨意记录", ""]
      lines.push("| ID | 标题 | 状态 | 时间 |")
      lines.push("|---|------|------|------|")
      for (const e of edicts) {
        const status = STATUS_DISPLAY[e.status] ?? e.status
        const time = new Date(e.createdAt).toLocaleString()
        lines.push(`| ${e.id} | ${e.title} | ${status} | ${time} |`)
      }
      return lines.join("\n")
    },
  })
}
