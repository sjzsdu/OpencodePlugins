import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { TaskStore, CommanderConfig } from "../types"
import { runPipeline } from "../engine/pipeline"

export function createTaskTool(
  client: OpencodeClient,
  store: TaskStore,
  config: CommanderConfig,
  directory?: string,
) {
  return tool({
    description: `创建任务：将需求交由 Commander 团队（Lead + Coder + Tester + Reviewer）协作完成。适用于需要多步骤实现的任务。单一简单改动请直接处理，不要创建任务。`,
    args: {
      title: z.string().describe("任务标题，简洁明了"),
      content: z.string().describe("任务详细描述，包含需求、约束和验收标准"),
      priority: z.enum(["high", "normal", "low"]).default("normal").describe("优先级"),
    },
    async execute(args, context) {
      const task = store.create({
        title: args.title,
        content: args.content,
        priority: args.priority,
        status: "received",
      })

      context.metadata({ 
        title: `Commander: ${args.title}`,
        metadata: { taskId: task.id, status: "created" }
      })

      try {
        // Create a parent session for this task's pipeline and pass it down
        const parentSession = await client.session.create({
          body: { title: `Commander·${args.title}` },
          ...(directory ? { query: { directory } } : {}),
        })
        const parentSessionId = parentSession.data?.id
        const report = await runPipeline(task, context, client, store, config, directory, parentSessionId)
        return report
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        store.update(task.id, { status: "failed" })
        return `任务执行失败: ${message}\n\n任务 ID: ${task.id}`
      }
    },
  })
}
