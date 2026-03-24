import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { HiveEventBus } from "../eventbus/bus"
import type { EventType } from "../types"

export function createEmitTool(
  eventBus: HiveEventBus,
  sessionToDomain: Map<string, string>,
) {
  return tool({
    description: `发布事件到其他Domain Agent。用于通知接口变更、请求协助、宣告任务完成等。其他Agent会在下次交互时自动收到你的消息。`,
    args: {
      type: z.enum([
        "interface_proposal", "interface_accepted", "interface_rejected",
        "task_started", "task_completed", "task_failed",
        "breaking_change", "action_proposal", "action_completed",
        "help_request", "info",
      ]).describe("事件类型"),
      target: z.string().describe('目标domain id，或 "*" 广播给所有'),
      message: z.string().describe("事件内容，要具体到其他Agent能据此行动"),
      data: z.any().optional().describe("结构化数据（如接口定义）"),
    },
    async execute(args, context) {
      const source = sessionToDomain.get(context.sessionID)
      if (!source) return "❌ 无法识别当前Domain Agent身份"

      const eventId = eventBus.publish({
        type: args.type as EventType,
        source,
        target: args.target,
        payload: { message: args.message, data: args.data },
      })
      const targetDesc = args.target === "*" ? "所有Domain" : args.target
      return `✅ 事件已发布 (${eventId}) [${args.type}] → ${targetDesc}`
    },
  })
}
