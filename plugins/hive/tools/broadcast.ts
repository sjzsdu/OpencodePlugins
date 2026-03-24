import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import type { HiveEventBus } from "../eventbus/bus"
import type { Domain, HiveConfig } from "../types"

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

export function createBroadcastTool(
  eventBus: HiveEventBus,
  domains: Domain[],
  client: OpencodeClient,
  sessionToDomain: Map<string, string>,
  config: HiveConfig,
) {
  return tool({
    description: `Queen专用：向所有Domain Agent广播需求，收集相关性评估。每个Agent会评估需求是否与自己的领域相关，并返回初步分析。`,
    args: {
      requirement: z.string().describe("需求描述"),
    },
    async execute(args, context) {
      const assessments: Array<{ domain: string; response: string }> = []

      const prompt = `以下是一个新的需求，请评估是否与你的领域相关，以及你需要做什么：

## 需求
${args.requirement}

请返回以下格式：
- **相关性**: 高/中/低/无
- **初步分析**: 你需要做什么（如果相关）
- **预估工作量**: 低/中/高
- **需要协调的Domain**: 如果需要其他Domain配合，列出domain id`

      // Broadcast to all domains in parallel
      const results = await Promise.allSettled(
        domains.map(async (domain) => {
          const session = await client.session.create({
            body: { title: `Hive·${domain.name}·感知` },
          })
          const sessionId = session.data!.id
          sessionToDomain.set(sessionId, domain.id)

          const response = await client.session.prompt({
            path: { id: sessionId },
            body: {
              agent: domain.id,
              parts: [{ type: "text" as const, text: prompt }],
            },
          })

          return {
            domain: domain.id,
            response: extractText(response.data?.parts ?? []),
          }
        })
      )

      for (const result of results) {
        if (result.status === "fulfilled") {
          assessments.push(result.value)
        }
      }

      // Publish broadcast event
      eventBus.publish({
        type: "requirement_broadcast",
        source: "queen",
        target: "*",
        payload: { message: args.requirement },
      })

      // Format response
      const lines = assessments.map(a =>
        `### @${a.domain}\n${a.response}`
      )
      return `# 📢 需求广播结果\n\n${lines.join("\n\n")}`
    },
  })
}
