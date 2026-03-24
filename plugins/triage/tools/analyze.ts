import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { OpencodeClient } from "sjz-opencode-sdk"
import type { TriageStore, TriageConfig } from "../types"
import { runAnalysisPipeline } from "../engine/pipeline"

export function createAnalyzeTool(
  client: OpencodeClient,
  store: TriageStore,
  config: TriageConfig,
  directory?: string,
) {
  return tool({
    description:
      "分析 Jira Ticket：获取 ticket 详情，分类为 Bug 或 Feature，探索代码库，输出分析结果或设计方案。Bug 路径会自动修复，Feature 路径会输出方案等待确认。",
    args: {
      ticketKey: z.string().describe("Jira ticket key, e.g. PROJ-123"),
    },
    async execute(args, context) {
      const task = store.create(args.ticketKey)

      context.metadata({
        title: `Triage: ${args.ticketKey}`,
        metadata: { taskId: task.id, status: "created" },
      })

      try {
        const parentSession = await client.session.create({
          body: { title: `Triage·${args.ticketKey}` },
          ...(directory ? { query: { directory } } : {}),
        })
        const parentSessionId = parentSession.data?.id

        const report = await runAnalysisPipeline(
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
        return `分析失败: ${message}\n\n任务 ID: ${task.id}`
      }
    },
  })
}
