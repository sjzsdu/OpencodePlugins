import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { TaskStore, TaskStatus } from "../types"

const STATUS_DISPLAY: Record<string, string> = {
  received: "📥 已接收",
  analyzing: "🔍 分析中",
  planning: "📋 规划中",
  executing: "⚔️ 执行中",
  verifying: "🧪 验证中",
  fixing: "🔧 修复中",
  reviewing: "🔍 审查中",
  completed: "✅ 已完成",
  failed: "❌ 失败",
  halted: "🛑 已叫停",
}

export function createStatusTool(store: TaskStore) {
  return tool({
    description: "查看 Commander 任务的状态和历史记录",
    args: {
      task_id: z.string().optional().describe("任务 ID，不填则列出全部"),
      status: z.string().optional().describe("按状态过滤 (received, analyzing, planning, executing, verifying, fixing, reviewing, completed, failed, halted)"),
    },
    async execute(args) {
      if (args.task_id) {
        const task = store.get(args.task_id)
        if (!task) {
          return `未找到任务: ${args.task_id}`
        }

        const status = STATUS_DISPLAY[task.status] ?? task.status
        const lines = [
          `# 任务: ${task.title}`,
          "",
          `**ID**: ${task.id}`,
          `**状态**: ${status}`,
          `**优先级**: ${task.priority}`,
          `**复杂度**: ${task.complexity ?? "未分类"}`,
          `**创建时间**: ${new Date(task.createdAt).toLocaleString()}`,
          `**更新时间**: ${new Date(task.updatedAt).toLocaleString()}`,
          "",
          "## 需求",
          task.content,
        ]

        if (task.plan) {
          lines.push("", "## 计划", `**分析**: ${task.plan.analysis}`)
          lines.push("", "### 子任务")
          lines.push("| # | 标题 | 工作量 | 状态 |")
          lines.push("|---|------|--------|------|")
        for (const st of task.plan.subtasks) {
            const exec = task.executions.find((e) => e.subtaskIndex === st.index)
            const stStatus = exec?.status === "completed" ? "✅" : exec?.status === "failed" ? "❌" : "⏳"
            const rounds = exec?.fixAttempts.length ?? 0
            const roundNote = rounds > 1 ? ` (${rounds - 1} 轮修复)` : ""
            lines.push(`| ${st.index} | ${st.title} | ${st.effort} | ${stStatus}${roundNote} |`)
          }
        }

        // Sessions (pipeline tracking)
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

      const filter = args.status ? { status: args.status as TaskStatus } : undefined
      const tasks = store.list(filter)
      if (tasks.length === 0) {
        return args.status ? `没有状态为 "${args.status}" 的任务。` : "暂无任务记录。"
      }

      const lines = ["# Commander 任务记录", ""]
      lines.push("| ID | 标题 | 状态 | 复杂度 | 时间 |")
      lines.push("|---|------|------|--------|------|")
      for (const t of tasks) {
        const status = STATUS_DISPLAY[t.status] ?? t.status
        const time = new Date(t.createdAt).toLocaleString()
        lines.push(`| ${t.id} | ${t.title} | ${status} | ${t.complexity ?? "-"} | ${time} |`)
      }
      return lines.join("\n")
    },
  })
}
