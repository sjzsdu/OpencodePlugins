import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import type { HiveEventBus } from "../eventbus/bus"
import type { Domain } from "../types"

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

export function createDispatchTool(
  eventBus: HiveEventBus,
  domains: Domain[],
  client: OpencodeClient,
  sessionToDomain: Map<string, string>,
) {
  return tool({
    description: `Queen专用：并行派发任务给多个Domain Agent执行。每个Agent独立在自己的领域内完成任务。`,
    args: {
      tasks: z.array(z.object({
        domain: z.string().describe("目标domain id"),
        instruction: z.string().describe("给该Domain Agent的具体指令"),
      })).describe("任务列表"),
    },
    async execute(args, context) {
      const results: Array<{ domain: string; status: string; response: string }> = []

      // Publish task_started events
      for (const task of args.tasks) {
        eventBus.publish({
          type: "task_started",
          source: task.domain,
          target: "*",
          payload: { message: `开始执行: ${task.instruction.substring(0, 100)}` },
        })
      }

      // Dispatch all tasks in parallel
      const taskResults = await Promise.allSettled(
        args.tasks.map(async (task) => {
          const domain = domains.find(d => d.id === task.domain)
          if (!domain) throw new Error(`未找到Domain: ${task.domain}`)

          const session = await client.session.create({
            body: { title: `Hive·${domain.name}·执行` },
          })
          const sessionId = session.data!.id
          sessionToDomain.set(sessionId, task.domain)

          const response = await client.session.prompt({
            path: { id: sessionId },
            body: {
              agent: task.domain,
              parts: [{ type: "text" as const, text: task.instruction }],
            },
          })

          return {
            domain: task.domain,
            response: extractText(response.data?.parts ?? []),
          }
        })
      )

      for (const result of taskResults) {
        if (result.status === "fulfilled") {
          results.push({
            domain: result.value.domain,
            status: "completed",
            response: result.value.response,
          })
          eventBus.publish({
            type: "task_completed",
            source: result.value.domain,
            target: "*",
            payload: { message: `任务完成` },
          })
        } else {
          const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
          results.push({
            domain: "unknown",
            status: "failed",
            response: errorMsg,
          })
        }
      }

      // Format response
      const lines = results.map(r =>
        `### @${r.domain} — ${r.status === "completed" ? "✅" : "❌"}\n${r.response}`
      )
      const successCount = results.filter(r => r.status === "completed").length
      return `# 🚀 并行执行结果\n\n` +
        `**成功**: ${successCount}/${results.length}\n\n` +
        lines.join("\n\n")
    },
  })
}
