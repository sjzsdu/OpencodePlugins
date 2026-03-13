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

export function createNegotiateTool(
  eventBus: HiveEventBus,
  domains: Domain[],
  client: OpencodeClient,
  sessionToDomain: Map<string, string>,
) {
  return tool({
    description: `协调两个Domain Agent协商接口定义。请求方提出需求，提供方评估并确认或拒绝。`,
    args: {
      requester: z.string().describe("请求方domain id"),
      provider: z.string().describe("提供方domain id"),
      topic: z.string().describe("协商主题，如'用户认证API接口定义'"),
    },
    async execute(args, context) {
      const requesterDomain = domains.find(d => d.id === args.requester)
      const providerDomain = domains.find(d => d.id === args.provider)
      if (!requesterDomain) return `❌ 未找到Domain: ${args.requester}`
      if (!providerDomain) return `❌ 未找到Domain: ${args.provider}`

      // Step 1: Ask requester for interface spec
      const reqSession = await client.session.create({
        body: { title: `Hive·${requesterDomain.name}·协商·需求方` },
      })
      sessionToDomain.set(reqSession.data!.id, args.requester)

      const reqResponse = await client.session.prompt({
        path: { id: reqSession.data!.id },
        body: {
          agent: args.requester,
          parts: [{ type: "text" as const, text: `你需要与 @${args.provider} 协商以下接口：

## 主题
${args.topic}

请描述你对这个接口的需求：
- 需要什么数据/功能
- 期望的调用方式
- 参数和返回值格式
- 任何约束条件` }],
        },
      })
      const requesterSpec = extractText(reqResponse.data?.parts ?? [])

      // Step 2: Ask provider to evaluate
      const provSession = await client.session.create({
        body: { title: `Hive·${providerDomain.name}·协商·提供方` },
      })
      sessionToDomain.set(provSession.data!.id, args.provider)

      const provResponse = await client.session.prompt({
        path: { id: provSession.data!.id },
        body: {
          agent: args.provider,
          parts: [{ type: "text" as const, text: `@${args.requester} 提出了以下接口需求，请评估：

## 主题
${args.topic}

## 需求方提出的规格
${requesterSpec}

请回复：
1. **能否提供**: 是/否/需要调整
2. **具体的接口定义**: 如果同意，给出最终的接口规格
3. **如需调整**: 说明需要调整的部分和原因` }],
        },
      })
      const providerResponse = extractText(provResponse.data?.parts ?? [])

      // Step 3: Publish negotiation events
      eventBus.publish({
        type: "interface_proposal",
        source: args.requester,
        target: args.provider,
        payload: { message: `${args.topic}\n\n${requesterSpec}` },
      })

      // Determine if accepted based on provider response
      const accepted = providerResponse.toLowerCase().includes("是") ||
        providerResponse.toLowerCase().includes("同意") ||
        providerResponse.toLowerCase().includes("accept")

      eventBus.publish({
        type: accepted ? "interface_accepted" : "interface_rejected",
        source: args.provider,
        target: args.requester,
        payload: { message: providerResponse },
      })

      return `# 🤝 接口协商: ${args.topic}\n\n` +
        `## 需求方 (@${args.requester})\n${requesterSpec}\n\n` +
        `## 提供方 (@${args.provider})\n${providerResponse}\n\n` +
        `**结果**: ${accepted ? "✅ 达成一致" : "⚠️ 需要进一步协商"}`
    },
  })
}
