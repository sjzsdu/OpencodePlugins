import { tool } from "@opencode-ai/plugin"
import type { OpencodeClient } from "sjz-opencode-sdk"
import type { EdictStore, EmperorConfig } from "../types"
import { runPipeline } from "../engine/pipeline"

export function createEdictTool(client: OpencodeClient, store: EdictStore, config: EmperorConfig, directory: string) {
  return tool({
    description: `下旨：将复杂任务交由三省六部协作完成。当用户需求涉及多个方面（如代码实现+文档+安全审查+基建）时使用。单一简单任务请直接处理，不要下旨。`,
    args: {
      title: tool.schema.string().describe("旨意标题，10字以内"),
      content: tool.schema.string().describe("旨意完整内容"),
      priority: tool.schema.enum(["urgent", "normal", "low"]).default("normal").describe("优先级"),
    },
    async execute(args, context) {
      const edict = store.create({
        title: args.title,
        content: args.content,
        priority: args.priority,
        status: "received",
      })

      // Create a pipeline parent session to track the overall edict execution context
      const parentSession = await client.session.create({
        body: { title: `三省六部·${args.title}` },
        // Directory context for the pipeline sessions
        query: { directory },
      })
      const parentSessionId = parentSession.data?.id ?? ""
      // Persist pipeline context in edict so downstream stages can continue the lineage
      store.update(edict.id, {
        executionContext: {
          pipelineSessionId: parentSessionId,
          pipelineDirectory: directory,
        },
      })

      context.metadata({ title: `下旨：${args.title}` })

      try {
        const memorial = await runPipeline(edict, context, client, store, config, directory, parentSessionId)
        return memorial
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        store.update(edict.id, { status: "failed" })
        return `旨意执行失败: ${message}\n\n旨意 ID: ${edict.id}`
      }
    },
  })
}
