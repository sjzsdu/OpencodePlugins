import { tool } from "@opencode-ai/plugin"
import type { OpencodeClient } from "sjz-opencode-sdk"
import type { EdictStore, EmperorConfig, Plan, Review } from "../types"
import { shangshuCoordinate } from "../engine/pipeline"

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {}
  const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1])
    } catch {}
  }
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1))
    } catch {}
  }
  return null
}

// ============================================================
// Tool 4: 提交方案评审 — submit_plan
// ============================================================

export function createSubmitPlanTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "提交方案评审：中书省将规划方案提交给门下省审核。方案必须是符合 Plan 接口的 JSON（含 analysis, subtasks, risks, attempt 字段）。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      plan: tool.schema.string().describe("规划方案 JSON（符合 Plan 接口：{ analysis, subtasks, risks, attempt }）"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      // Validate edict is in a state that accepts plans
      const validStatuses = ["received", "reconnaissance", "planning", "rejected"]
      if (!validStatuses.includes(edict.status)) {
        return `旨意当前状态为「${edict.status}」，不接受新方案提交。只有 received/planning/rejected 状态下可提交。`
      }

      // Parse and validate plan JSON
      const data = parseJSON(args.plan)
      if (!data || typeof data !== "object") {
        return "方案格式错误：无法解析 JSON。请提供符合 Plan 接口的 JSON。\n\n期望格式：\n```json\n{\n  \"analysis\": \"场景分析 + 技术选型理由\",\n  \"subtasks\": [{\"index\": 0, \"department\": \"bingbu\", \"title\": \"\", \"description\": \"\", \"dependencies\": [], \"effort\": \"medium\"}],\n  \"risks\": [\"风险1\"],\n  \"attempt\": 1\n}\n```"
      }
      const obj = data as Record<string, unknown>
      if (!obj.analysis || !Array.isArray(obj.subtasks)) {
        return "方案格式错误：缺少 analysis 或 subtasks 字段。"
      }

      const plan: Plan = {
        analysis: String(obj.analysis),
        subtasks: obj.subtasks as Plan["subtasks"],
        risks: Array.isArray(obj.risks) ? (obj.risks as string[]) : [],
        attempt: typeof obj.attempt === "number" ? obj.attempt : (edict.plan?.attempt ?? 0) + 1,
      }

      // Validate subtasks have required fields
      for (const st of plan.subtasks) {
        if (st.index === undefined || !st.department || !st.title) {
          return `子任务格式错误：每个子任务必须包含 index, department, title, description, dependencies, effort 字段。\n问题子任务: ${JSON.stringify(st)}`
        }
      }

      // Store the plan and update status to reviewing
      store.update(args.edict_id, { plan, status: "reviewing" })

      client.tui.showToast({ body: { message: `📜 中书省方案已提交，等待门下省审核`, variant: "info" } })

      const subtaskSummary = plan.subtasks
        .map((st) => `  - [${st.index}] ${st.department}: ${st.title} (${st.effort})`)
        .join("\n")

      return `方案已提交至门下省审核。

旨意: ${edict.title} (${args.edict_id})
状态: reviewing
规划尝试: 第 ${plan.attempt} 次
子任务数: ${plan.subtasks.length}

子任务列表:
${subtaskSummary}

风险识别: ${plan.risks.length > 0 ? plan.risks.join("；") : "无"}

门下省将进行审核，请等待审核结果。`
    },
  })
}

// ============================================================
// Tool 5: 驳回方案 — reject_plan
// ============================================================

export function createRejectPlanTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "驳回方案：门下省驳回中书省的规划方案，附带驳回理由和改进建议。驳回后中书省需根据反馈修订方案后重新提交。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      reasons: tool.schema.string().describe("驳回理由，JSON 数组格式如 [\"理由1\", \"理由2\"]，或逗号分隔的字符串"),
      suggestions: tool.schema.string().optional().describe("改进建议，JSON 数组格式如 [\"建议1\", \"建议2\"]，或逗号分隔的字符串"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      if (edict.status !== "reviewing") {
        return `旨意当前状态为「${edict.status}」，不处于审核中（reviewing），无法驳回。`
      }

      if (!edict.plan) {
        return `旨意没有待审核的方案，无法驳回。`
      }

      // Parse reasons
      let reasons: string[]
      try {
        const parsed = JSON.parse(args.reasons)
        reasons = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)]
      } catch {
        reasons = args.reasons.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      }

      if (reasons.length === 0) {
        return "驳回必须提供至少一条理由。"
      }

      // Parse suggestions
      let suggestions: string[] = []
      if (args.suggestions) {
        try {
          const parsed = JSON.parse(args.suggestions)
          suggestions = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)]
        } catch {
          suggestions = args.suggestions.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        }
      }

      const review: Review = {
        verdict: "reject",
        reasons,
        suggestions,
        sensitiveOps: [],
      }

      store.update(args.edict_id, { review, status: "rejected" })

      client.tui.showToast({ body: { message: `🚫 门下省封驳：${edict.title}`, variant: "warning" } })

      const reasonsText = reasons.map((r, i) => `  ${i + 1}. ${r}`).join("\n")
      const suggestionsText = suggestions.length > 0
        ? `\n\n改进建议：\n${suggestions.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`
        : ""

      return `方案已驳回。

旨意: ${edict.title} (${args.edict_id})
状态: rejected
规划尝试: 第 ${edict.plan.attempt} 次

驳回理由：
${reasonsText}${suggestionsText}

中书省需根据以上反馈修订方案，然后使用 submit_plan 工具重新提交。`
    },
  })
}

// ============================================================
// Tool 6: 通过方案 — approve_plan
// ============================================================

export function createApprovePlanTool(client: OpencodeClient, store: EdictStore, config: EmperorConfig) {
  return tool({
    description: "通过方案：门下省审核通过中书省的方案，转交尚书省调度六部执行。如检测到敏感操作需一并标记，将请求皇帝（用户）确认。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      sensitive_ops: tool.schema.string().optional().describe("检测到的敏感操作列表，JSON 数组格式如 [\"涉及删除操作\"]，无则不填"),
    },
    async execute(args, context) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      if (edict.status !== "reviewing") {
        return `旨意当前状态为「${edict.status}」，不处于审核中（reviewing），无法通过。`
      }

      if (!edict.plan) {
        return `旨意没有待审核的方案，无法通过。`
      }

      // Parse sensitive ops
      let sensitiveOps: string[] = []
      if (args.sensitive_ops) {
        try {
          const parsed = JSON.parse(args.sensitive_ops)
          sensitiveOps = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)]
        } catch {
          sensitiveOps = args.sensitive_ops.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        }
      }

      // Store approval review
      const review: Review = {
        verdict: "approve",
        reasons: [],
        suggestions: [],
        sensitiveOps,
      }
      store.update(args.edict_id, { review })

      // Handle sensitive ops — require user confirmation
      if (sensitiveOps.length > 0) {
        store.update(args.edict_id, { status: "needs_approval" })
        client.tui.showToast({ body: { message: "⚠️ 检测到敏感操作，需要皇帝（用户）确认", variant: "warning" } })
        try {
          await context.ask({
            permission: "edict.sensitive",
            patterns: sensitiveOps,
            always: [],
            metadata: {
              edictId: args.edict_id,
              sensitiveOps,
            },
          })
        } catch {
          store.update(args.edict_id, { status: "denied" })
          return `皇帝（用户）拒绝执行含敏感操作的旨意「${edict.title}」。\n\n旨意 ID: ${args.edict_id}\n状态: denied`
        }
      }

      client.tui.showToast({ body: { message: `✅ 门下省准奏：${edict.title}`, variant: "success" } })

      // Forward to 尚书省 for execution
      store.update(args.edict_id, { status: "dispatched" })
      client.tui.showToast({ body: { message: "📋 尚书省接旨，调度六部执行中...", variant: "info" } })

      try {
        store.update(args.edict_id, { status: "executing" })

        // Re-fetch edict to get latest state
        const latestEdict = store.get(args.edict_id)!
        const { executions, memorial } = await shangshuCoordinate(client, latestEdict, latestEdict.plan!, config)

        store.update(args.edict_id, { executions, memorial, status: "completed" })
        client.tui.showToast({ body: { message: "📋 奏折已归档", variant: "success" } })

        return memorial
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        store.update(args.edict_id, { status: "failed" })
        return `尚书省执行失败: ${message}\n\n旨意 ID: ${args.edict_id}`
      }
    },
  })
}
