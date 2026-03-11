import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { Domain } from "../types"
import type { HiveEventBus } from "../eventbus/bus"

export function createStatusTool(
  domains: Domain[],
  eventBus: HiveEventBus,
) {
  return tool({
    description: `查看Hive全局状态：已注册的Domain Agent、待处理事件、依赖关系。`,
    args: {
      detail: z.enum(["overview", "events", "domains"]).default("overview").describe("查看维度"),
    },
    async execute(args) {
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
      return `# 🐝 Hive Status\n\n` +
        `**Domains**: ${domains.length} (${domains.map(d => d.id).join(", ")})\n` +
        `**待处理事件**: ${pending.length}\n` +
        `**总事件数**: ${events.length}\n\n` +
        `## 依赖图\n` +
        domains
          .filter(d => d.dependencies.length > 0)
          .map(d => `${d.id} → ${d.dependencies.join(", ")}`)
          .join("\n") || "（无跨Domain依赖）"
    },
  })
}
