import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import type { HivePipeline } from "../pipeline"

export function createRunTool(pipeline: HivePipeline) {
  return tool({
    description: `一键执行完整的Hive流水线：自动广播评估→筛选相关域→协商接口→并行派发执行→汇总报告。收到用户需求后直接调用此工具。`,
    args: {
      requirement: z.string().describe("用户的完整需求描述"),
    },
    async execute(args, context) {
      return pipeline.start(args.requirement, {
        parentSessionId: context.sessionID,
        directory: context.directory,
      })
    },
  })
}
