import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { Domain } from "../types"
import type { HiveEventBus } from "../eventbus/bus"
import type { HivePipeline } from "../pipeline"

export function createStatusTool(
  domains: Domain[],
  eventBus: HiveEventBus,
  pipeline: HivePipeline,
) {
  return tool({
    description: `查看Hive全局状态：已注册的Domain Agent、待处理事件、依赖关系。`,
    args: {
      detail: z.enum(["overview", "events", "domains", "pipeline"]).default("overview").describe("查看维度"),
    },
    async execute(args) {
      if (args.detail === "pipeline") {
        const state = pipeline.getState()
        if (!state) return "# 📊 Pipeline\n\n当前没有运行中或已完成的流水线。请先调用 hive_run 启动。"

        const statusIcon = state.status === "running" ? "🔄 运行中" : state.status === "completed" ? "✅ 已完成" : "❌ 失败"
        const duration = ((state.completedAt || Date.now()) - state.startedAt) / 1000

        const logLines = state.logs.map(l => {
          const ts = new Date(l.timestamp).toLocaleTimeString()
          const domainTag = l.domain ? ` [@${l.domain}]` : ""
          return `[${ts}]${domainTag} ${l.message}`
        })

        const assessLines = state.assessments.map(a =>
          `- @${a.domain}: ${a.relevance}相关 | ${a.analysis.substring(0, 80)}`
        )

        const dispatchLines = state.dispatched.map(d => {
          const icon = d.status === "completed" ? "✅" : d.status === "failed" ? "❌" : d.status === "running" ? "🔄" : "⏳"
          const sid = d.sessionId ? ` (\`${d.sessionId}\`)` : ""
          return `- ${icon} @${d.domain}: ${d.status}${sid}`
        })

        const sessionLines = state.sessions.map(s =>
          `- [${s.phase}] @${s.domain}: \`${s.sessionId}\` — ${s.title}`
        )

        return `# 📊 Pipeline ${statusIcon}\n\n` +
          `**需求**: ${state.requirement}\n` +
          `**状态**: ${state.status} | **耗时**: ${duration.toFixed(1)}s\n` +
          `**Sessions**: ${state.sessions.length}\n\n` +
          `## 评估结果\n${assessLines.join("\n") || "无"}\n\n` +
          `## 执行状态\n${dispatchLines.join("\n") || "无"}\n\n` +
          `## 所有 Sessions\n${sessionLines.join("\n") || "无"}\n\n` +
          `## 执行日志\n\`\`\`\n${logLines.join("\n")}\n\`\`\``
      }

      if (args.detail === "domains") {
        const lines = domains.map(d =>
          `### ${d.name} (@${d.id})\n` +
          `- 管辖: ${d.paths.join(", ")}\n` +
          `- 技术栈: ${d.techStack}\n` +
          `- 依赖: ${d.dependencies.join(", ") || "无"}\n` +
          `- 接口: ${d.interfaces.join(", ") || "无"}`
        )
        return `# 🐝 Hive Domains\n\n${lines.join("\n\n")}`
      }

      if (args.detail === "events") {
        const events = eventBus.getAll()
        const pending = events.filter(e => e.status === "pending")
        const consumed = events.filter(e => e.status === "consumed")
        const lines = pending.map(e =>
          `- [${e.type}] ${e.source} → ${e.target}: ${e.payload.message}`
        )
        return `# 📬 Hive Events\n\n` +
          `**待处理**: ${pending.length}\n` +
          `**已消费**: ${consumed.length}\n\n` +
          (lines.length > 0 ? `## 待处理事件\n${lines.join("\n")}` : "无待处理事件")
      }

      // overview
      const events = eventBus.getAll()
      const pending = events.filter(e => e.status === "pending")
      const pipelineState = pipeline?.getState?.() as any
      const pipelineInfo = pipelineState
        ? `**流水线**: ${pipelineState.status} (${pipelineState.requirement?.substring(0, 50) ?? ''})\n`
        : `**流水线**: 空闲\n`
      return `# 🐝 Hive Status\n\n` +
        `**Domains**: ${domains.length} (${domains.map(d => d.id).join(", ")})\n` +
        `**待处理事件**: ${pending.length}\n` +
        `**总事件数**: ${events.length}\n\n` +
        pipelineInfo +
        `## 依赖图\n` +
        domains
          .filter(d => d.dependencies.length > 0)
          .map(d => `${d.id} → ${d.dependencies.join(", ")}`)
          .join("\n") || "（无跨Domain依赖）"
    },
  })
}
