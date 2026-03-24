import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { OpencodeClient } from "sjz-opencode-sdk"
import type { TriageStore, TriageConfig } from "../types"
import { runImplementPipeline } from "../engine/pipeline"

export function createImplementTool(
  client: OpencodeClient,
  store: TriageStore,
  config: TriageConfig,
  directory?: string,
) {
  return tool({
    description:
      "实现已确认的 Feature 方案：基于 jira_analyze 生成的设计方案开始编码实现。需要先运行 jira_analyze 获得方案。",
    args: {
      ticketKey: z.string().describe("Jira ticket key, e.g. PROJ-123"),
    },
    async execute(args, context) {
      const task = store.getByTicketKey(args.ticketKey)

      if (!task) {
        return `未找到 ticket ${args.ticketKey} 的分析记录，请先运行 jira_analyze 分析 ticket`
      }

      if (task.status !== "awaiting") {
        return `当前状态不支持实现: ${task.status}（需要状态为 awaiting）`
      }

      context.metadata({
        title: `Triage: ${args.ticketKey} (实现)`,
        metadata: { taskId: task.id, status: "implementing" },
      })

      try {
        const parentSession = await client.session.create({
          body: { title: `Triage·${args.ticketKey}·实现` },
          ...(directory ? { query: { directory } } : {}),
        })
        const parentSessionId = parentSession.data?.id

        const report = await runImplementPipeline(
          task,
          context,
          client,
          store,
          config,
          directory,
          parentSessionId,
        )
        return report
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        store.update(task.id, { status: "failed" })
        return `实现失败: ${message}\n\n任务 ID: ${task.id}`
      }
    },
  })
}
