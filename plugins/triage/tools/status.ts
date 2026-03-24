import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { TriageStore, TriageStatus } from "../types"

const STATUS_DISPLAY: Record<string, string> = {
  received: "📥 已接收",
  fetching: "📡 获取中",
  triaging: "🏷️ 分类中",
  scouting: "🔭 探索中",
  investigating: "🔍 调查中",
  designing: "📐 设计中",
  awaiting: "⏳ 待确认",
  implementing: "⚔️ 实现中",
  verifying: "🧪 验证中",
  fixing: "🔧 修复中",
  updating_jira: "📝 更新 Jira",
  completed: "✅ 已完成",
  not_found: "🚫 未找到",
  failed: "❌ 失败",
  halted: "🛑 已叫停",
}

export function createStatusTool(store: TriageStore) {
  return tool({
    description: "查看 Triage 任务状态",
    args: {
      ticketKey: z
        .string()
        .optional()
        .describe("查看特定 ticket 的状态。不填则列出所有任务。"),
    },
    async execute(args) {
      if (args.ticketKey) {
        const task = store.getByTicketKey(args.ticketKey)
        if (!task) {
          return `未找到 ticket: ${args.ticketKey}`
        }

        const status = STATUS_DISPLAY[task.status] ?? task.status
        const lines = [
          `# Triage: ${task.ticketKey}`,
          "",
          `**ID**: ${task.id}`,
          `**状态**: ${status}`,
          `**创建时间**: ${new Date(task.createdAt).toLocaleString()}`,
          `**更新时间**: ${new Date(task.updatedAt).toLocaleString()}`,
          `**Jira 已更新**: ${task.jiraUpdated ? "是" : "否"}`,
        ]

        if (task.ticket) {
          lines.push(
            "",
            "## Ticket 信息",
            `**摘要**: ${task.ticket.summary}`,
            `**类型**: ${task.ticket.type}`,
            `**状态**: ${task.ticket.status}`,
            `**优先级**: ${task.ticket.priority}`,
          )
        }

        if (task.triageResult) {
          lines.push(
            "",
            "## 分类结果",
            `**类型**: ${task.triageResult.ticketType}`,
            `**置信度**: ${task.triageResult.confidence}`,
            `**理由**: ${task.triageResult.reasoning}`,
          )
        }

        if (task.architectResult) {
          lines.push(
            "",
            "## 设计方案",
            `**规模**: ${task.architectResult.ticketScale}`,
          )
          if (task.architectResult.plan.subtasks.length > 0) {
            lines.push("", "### 子任务")
            lines.push("| # | 标题 | 工作量 | 状态 |")
            lines.push("|---|------|--------|------|")
            for (const st of task.architectResult.plan.subtasks) {
              const exec = task.executions.find(
                (e) => e.subtaskIndex === st.index,
              )
              const stStatus =
                exec?.status === "completed"
                  ? "✅"
                  : exec?.status === "failed"
                    ? "❌"
                    : "⏳"
              const rounds = exec?.fixAttempts.length ?? 0
              const roundNote = rounds > 1 ? ` (${rounds - 1} 轮修复)` : ""
              lines.push(
                `| ${st.index} | ${st.title} | ${st.effort} | ${stStatus}${roundNote} |`,
              )
            }
          }
        }

        if (task.sessions && task.sessions.length > 0) {
          lines.push("", "## 会话")
          lines.push("| Agent | 阶段 | Session ID |")
          lines.push("|-------|------|-----------|")
          for (const s of task.sessions) {
            lines.push(`| ${s.agent} | ${s.phase} | ${s.sessionId} |`)
          }
        }

        if (task.report) {
          lines.push("", "## 报告", task.report)
        }

        return lines.join("\n")
      }

      const tasks = store.list()
      if (tasks.length === 0) {
        return "暂无 Triage 任务记录。"
      }

      const lines = ["# Triage 任务记录", ""]
      lines.push("| Ticket | 状态 | 类型 | 时间 |")
      lines.push("|--------|------|------|------|")
      for (const t of tasks) {
        const status = STATUS_DISPLAY[t.status] ?? t.status
        const ticketType = t.triageResult?.ticketType ?? "-"
        const time = new Date(t.createdAt).toLocaleString()
        lines.push(`| ${t.ticketKey} | ${status} | ${ticketType} | ${time} |`)
      }
      return lines.join("\n")
    },
  })
}
