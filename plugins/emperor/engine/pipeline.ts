import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import type { ToolContext } from "@opencode-ai/plugin"
import type { Edict, EdictStore, EmperorConfig, Execution, Plan } from "../types"
import type { PipelineSession } from "../types"
import { reviewWithMenxia } from "./reviewer"
import { dispatchAndExecute, executeSubtask } from "./dispatcher"
import { reconWithJinyiwei } from "./recon"
import { extractText, parseJSON } from "../utils"

const DEPT_DISPLAY: Record<string, string> = {
  bingbu: "兵部",
  gongbu: "工部",
  lifebu: "礼部",
  xingbu: "刑部",
  hubu: "户部",
  libu: "吏部",
}

// Shared utility functions extracted to utils.ts

function parsePlan(text: string, attempt: number): Plan {
  const data = parseJSON(text)
  if (!data || typeof data !== "object") {
    throw new Error("中书省输出格式错误：无法解析 JSON")
  }
  const obj = data as Record<string, unknown>
  if (!obj.analysis || !Array.isArray(obj.subtasks)) {
    throw new Error("中书省输出格式错误：缺少 analysis 或 subtasks 字段")
  }
  return {
    analysis: String(obj.analysis),
    subtasks: obj.subtasks as Plan["subtasks"],
    risks: Array.isArray(obj.risks) ? (obj.risks as string[]) : [],
    attempt: typeof obj.attempt === "number" ? obj.attempt : attempt,
  }
}

/** Phase 1a: 中书省 creates a plan */
export async function planWithZhongshu(
  client: OpencodeClient,
  edict: Edict,
  attempt: number,
  rejectionReasons?: string[],
  projectContext?: string,
  sessionContext?: { parentSessionId?: string; directory?: string },
): Promise<Plan> {
  const session = await client.session.create({
    body: { title: `中书省·${edict.title}`, ...(sessionContext?.parentSessionId ? { parentID: sessionContext.parentSessionId } : {}) },
    ...(sessionContext?.directory ? { query: { directory: sessionContext.directory } } : {}),
  })
  const sessionId = session.data!.id

  let prompt: string
  const contextBlock = projectContext
    ? `\n## 项目上下文（锦衣卫侦察报告）\n${projectContext}\n`
    : ""

  if (attempt === 1) {
    prompt = `请规划以下旨意，拆解为可执行的子任务。
${contextBlock}
标题: ${edict.title}
内容: ${edict.content}
优先级: ${edict.priority}

重要提醒：
1. 请先分析用户场景和技术选型，再拆解子任务
2. 必须包含户部（hubu）测试验证任务
3. 技术选型需说明理由，优先考虑用户体验
4. 如果有项目上下文，请充分利用已有代码结构和技术栈信息

请输出严格的 Plan JSON。`
  } else {
    prompt = `上次规划方案被门下省封驳，原因如下：
${rejectionReasons?.map((r) => `- ${r}`).join("\n") ?? "（无具体原因）"}

请重新规划以下旨意（第 ${attempt} 次尝试）：
${contextBlock}
标题: ${edict.title}
内容: ${edict.content}
优先级: ${edict.priority}

重要提醒：
1. 请认真对待封驳原因，针对性改进
2. 必须包含户部（hubu）测试验证任务
3. 技术选型需说明理由，优先考虑用户体验
4. 如果有项目上下文，请充分利用已有代码结构和技术栈信息

请输出严格的 Plan JSON，注意改进被指出的问题。`
  }

  const response = await client.session.prompt({
    path: { id: sessionId },
    body: {
      agent: "zhongshu",
      parts: [{ type: "text" as const, text: prompt }],
    },
  })

  const text = extractText(response.data?.parts ?? [])
  return parsePlan(text, attempt)
}

function checkAbort(abort: AbortSignal): void {
  if (abort.aborted) {
    throw new Error("用户已叫停")
  }
}

/**
 * Phase 2: 尚书省 coordinates execution.
 *
 * Shangshu has a persistent session with two touchpoints:
 * - Turn 1 (pre-dispatch): Receives the approved plan, prepares execution strategy
 * - Turn 2 (post-dispatch): Receives all execution results, generates memorial (奏折)
 *
 * The actual dispatch uses code-based topological sort + parallel execution for efficiency.
 * Shangshu provides the AI intelligence layer on top.
 */
export async function shangshuCoordinate(
  client: OpencodeClient,
  edict: Edict,
  plan: Plan,
  config: EmperorConfig,
  sessionContext?: { parentSessionId?: string; directory?: string },
): Promise<{ executions: Execution[]; memorial: string; sessions: PipelineSession[] }> {
  // Create shangshu session — persistent across both turns
  const session = await client.session.create({
    body: { title: `尚书省·${edict.title}`, ...(sessionContext?.parentSessionId ? { parentID: sessionContext.parentSessionId } : {}) },
    ...(sessionContext?.directory ? { query: { directory: sessionContext.directory } } : {}),
  })
  const shangshuSessionId = session.data!.id
  let sessions: PipelineSession[] = []
  sessions.push({ sessionId: shangshuSessionId, phase: "dispatching" as const, title: `尚书省·${edict.title}`, createdAt: Date.now() })

  // --- Turn 1: Pre-dispatch — shangshu reviews execution strategy ---
  const preDispatchPrompt = `门下省已准奏以下规划方案，请审视执行策略。

## 旨意
标题: ${edict.title}
内容: ${edict.content}
优先级: ${edict.priority}

## 门下省准奏的规划方案
${JSON.stringify(plan, null, 2)}

请审视此方案的执行策略：
1. 子任务的依赖关系是否正确？哪些可以并行？
2. 有没有执行层面的风险点需要注意？
3. 各部门之间需要什么协调？

简要回复你的执行策略和注意事项。`

  await client.session.prompt({
    path: { id: shangshuSessionId },
    body: {
      agent: "shangshu",
      parts: [{ type: "text" as const, text: preDispatchPrompt }],
    },
  })

  // --- Code-based dispatch: topological sort + parallel execution ---
  // This is shangshu's "下达" to the six departments, implemented efficiently via code
  client.tui.showToast({ body: { message: "⚔️ 尚书省调度六部执行中...", variant: "info" } })
  const executions = await dispatchAndExecute(
    client,
    edict,
    plan,
    config.pipeline.maxSubtaskRetries,
    sessionContext,
  )

  // --- Post-execution verification (if enabled) ---
  if (config.pipeline.requirePostVerification) {
    client.tui.showToast({ body: { message: "🔬 户部执行后验证中...", variant: "info" } })

    const verificationSubtask = {
      index: plan.subtasks.length,
      department: "hubu" as const,
      title: "执行后综合验证",
      description: buildVerificationDescription(edict, plan, executions),
      dependencies: [],
      effort: "medium" as const,
    }
    const verification = await executeSubtask(client, edict, verificationSubtask, 0, sessionContext)
    executions.push(verification)
  }

  // --- Turn 2: Post-dispatch — shangshu generates memorial (奏折) ---
  client.tui.showToast({ body: { message: "📋 尚书省汇总奏折中...", variant: "info" } })

  const failedExecs = executions.filter((e) => e.status === "failed")
  const retriedExecs = executions.filter((e) => e.retryCount > 0)

  const executionSummary = executions.map((exec) => {
    const subtask = plan.subtasks.find((s) => s.index === exec.subtaskIndex)
    const dept = DEPT_DISPLAY[exec.department] ?? exec.department
    const title = subtask?.title ?? (exec.subtaskIndex >= plan.subtasks.length ? "执行后综合验证" : `子任务 ${exec.subtaskIndex}`)
    const status = exec.status === "completed" ? "✅ 完成" : "❌ 失败"
    const retryNote = exec.retryCount > 0 ? ` (经 ${exec.retryCount} 次重试)` : ""
    const detail = exec.status === "completed" ? (exec.result ?? "（无详细输出）") : (exec.error ?? "未知错误")
    return `### ${dept}: ${title}${retryNote}\n状态: ${status}\n${detail}`
  }).join("\n\n")

  // Build failure analysis section for shangshu
  let failureAnalysisBlock = ""
  if (failedExecs.length > 0) {
    const failDetails = failedExecs.map((e) => {
      const subtask = plan.subtasks.find((s) => s.index === e.subtaskIndex)
      const dept = DEPT_DISPLAY[e.department] ?? e.department
      return `- ${dept}「${subtask?.title ?? `子任务 ${e.subtaskIndex}`}」: ${e.error ?? "未知错误"} (已重试 ${e.retryCount} 次)`
    }).join("\n")
    failureAnalysisBlock = `

## 失败分析请求
以下子任务在重试后仍然失败，请分析可能的原因并给出建议：
${failDetails}

请在奏折中增加一个「失败分析与建议」章节，包含：
1. 每个失败任务的可能原因（代码问题 vs 测试问题 vs 环境问题）
2. 建议的修复方案
3. 是否需要用户重新下旨`
  }

  let retryStatsBlock = ""
  if (retriedExecs.length > 0) {
    retryStatsBlock = `\n\n## 重试统计\n共有 ${retriedExecs.length} 个子任务经过重试，其中 ${retriedExecs.filter((e) => e.status === "completed").length} 个重试后成功，${failedExecs.length} 个仍然失败。`
  }

  const postDispatchPrompt = `六部执行已完成，请汇总以下结果，生成奏折呈报太子。

## 各部执行结果

${executionSummary}${retryStatsBlock}${failureAnalysisBlock}

## 奏折要求

请生成完整奏折，包含以下部分：
1. **旨意回顾** — 原始需求概述
2. **规划方案概述** — 中书省方案的核心思路
3. **执行结果** — 各部门的执行详情和状态
${failedExecs.length > 0 ? "4. **失败分析与建议** — 失败原因分析、归因判断、修复建议\n5. **风险与遗留** — 未解决的问题、潜在风险\n6. **总结** — 整体评估：成功率、质量判断、后续建议" : "4. **风险与遗留** — 未解决的问题、潜在风险\n5. **总结** — 整体评估：成功率、质量判断、后续建议"}

请直接输出奏折内容（Markdown格式），不需要JSON。`

  const memorialResponse = await client.session.prompt({
    path: { id: shangshuSessionId },
    body: {
      agent: "shangshu",
      parts: [{ type: "text" as const, text: postDispatchPrompt }],
    },
  })

  let memorial = extractText(memorialResponse.data?.parts ?? [])

  // Fallback: if shangshu returns empty, use template-based memorial
  if (!memorial.trim()) {
    memorial = formatMemorial(edict, plan, executions)
  }

  return { executions, memorial, sessions }
}

/** Build a description for post-execution verification */
function buildVerificationDescription(edict: Edict, plan: Plan, executions: Execution[]): string {
  const completedResults = executions
    .filter((e) => e.status === "completed" && e.result)
    .map((e) => {
      const subtask = plan.subtasks.find((s) => s.index === e.subtaskIndex)
      const dept = DEPT_DISPLAY[e.department] ?? e.department
      return `### ${dept}: ${subtask?.title ?? `子任务 ${e.subtaskIndex}`}\n${e.result}`
    })
    .join("\n\n")

  const failedResults = executions
    .filter((e) => e.status === "failed")
    .map((e) => {
      const subtask = plan.subtasks.find((s) => s.index === e.subtaskIndex)
      const dept = DEPT_DISPLAY[e.department] ?? e.department
      return `- ${dept}: ${subtask?.title ?? `子任务 ${e.subtaskIndex}`} — 失败: ${e.error ?? "未知错误"}`
    })
    .join("\n")

  return `对以下旨意的执行结果进行综合验证。

## 旨意
标题: ${edict.title}
内容: ${edict.content}

## 各部执行结果
${completedResults}

${failedResults ? `## 失败任务\n${failedResults}` : ""}

## 验证要求
1. 运行构建命令（build），确认代码编译通过
2. 运行测试命令（test），确认测试通过
3. 从用户角度验证功能是否符合旨意要求
4. 检查各部执行结果是否完整、一致
5. 识别可能遗漏的问题或回归风险

输出完整的验证报告。`
}

/**
 * Main pipeline: 三省六部 complete workflow.
 *
 * Phase 1: 中书省 Planning + 门下省 Review (retry loop)
 * Phase 2: 尚书省 Coordination + 六部 Execution + 奏折
 */
export async function runPipeline(
  edict: Edict,
  context: ToolContext,
  client: OpencodeClient,
  store: EdictStore,
  config: EmperorConfig,
  directory: string,
  parentSessionId?: string,
): Promise<string> {
  const sessionContext = { parentSessionId, directory } as const
  let plan: Plan | undefined
  let rejectionReasons: string[] | undefined

  // ========================================
  // Phase 0: 锦衣卫 Reconnaissance
  // ========================================
  store.update(edict.id, { status: "reconnaissance" })
  const recon = await reconWithJinyiwei(client, edict, config, directory)
  if (recon.fullContext) {
    store.update(edict.id, { projectContext: recon.fullContext })
  }

  // ========================================
  // Phase 1: 中书省 Planning + 门下省 Review
  // ========================================
  const maxAttempts = config.pipeline.maxReviewAttempts
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    checkAbort(context.abort)

    // --- 1a: 中书省 plans ---
    store.update(edict.id, { status: "planning" })
    client.tui.showToast({ body: { message: `📜 中书省规划中...（第 ${attempt} 次）`, variant: "info" } })

    try {
      plan = await planWithZhongshu(client, edict, attempt, rejectionReasons, recon.fullContext || undefined, sessionContext)
    } catch (err) {
      if (attempt === maxAttempts) {
        store.update(edict.id, { status: "failed" })
        throw new Error(`中书省规划失败: ${err instanceof Error ? err.message : String(err)}`)
      }
      continue
    }

    // --- 1b: 门下省 reviews ---
    store.update(edict.id, { plan, status: "reviewing" })
    checkAbort(context.abort)

    client.tui.showToast({ body: { message: "🔍 门下省审核中...", variant: "info" } })
    const review = await reviewWithMenxia(
      client,
      edict,
      plan,
      config.pipeline.sensitivePatterns,
      config.pipeline.mandatoryDepartments,
      recon.summary || undefined,
      sessionContext,
    )
    store.update(edict.id, { review })

    if (review.verdict === "approve") {
      // --- Sensitive ops check ---
      if (review.sensitiveOps.length > 0) {
        store.update(edict.id, { status: "needs_approval" })
        client.tui.showToast({ body: { message: "⚠️ 检测到敏感操作，需要您确认", variant: "warning" } })
        try {
          await context.ask({
            permission: "edict.sensitive",
            patterns: review.sensitiveOps,
            always: [],
            metadata: {
              edictId: edict.id,
              sensitiveOps: review.sensitiveOps,
            },
          })
        } catch {
          store.update(edict.id, { status: "denied" })
          throw new Error("用户拒绝执行含敏感操作的旨意")
        }
      }
      client.tui.showToast({ body: { message: "✅ 门下省准奏", variant: "success" } })
      break
    }

    // Rejected
    client.tui.showToast({ body: { message: `🚫 门下省封驳（第 ${attempt} 次）`, variant: "warning" } })
    rejectionReasons = review.reasons
    store.update(edict.id, { status: "rejected" })

    if (attempt === maxAttempts) {
      store.update(edict.id, { status: "failed" })
      throw new Error(`规划方案连续 ${maxAttempts} 次被门下省封驳`)
    }
  }

  if (!plan) {
    store.update(edict.id, { status: "failed" })
    throw new Error("规划阶段未生成有效方案")
  }

  // ========================================
  // Phase 2: 尚书省 Coordination + 六部 Execution
  // ========================================
  checkAbort(context.abort)
  store.update(edict.id, { status: "dispatched" })
  client.tui.showToast({ body: { message: "📋 尚书省接旨调度...", variant: "info" } })

  store.update(edict.id, { status: "executing" })
  const { executions, memorial, sessions } = await shangshuCoordinate(client, edict, plan, config, sessionContext)
  store.update(edict.id, { executions, memorial, status: "completed" })
  // Persist pipeline sessions to edict state
  if (sessions && sessions.length > 0) {
    const current = store.get(edict.id)
    const existingSessions = current?.sessions ?? []
    store.update(edict.id, { sessions: [...existingSessions, ...sessions] })
  }

  client.tui.showToast({ body: { message: "📋 奏折已归档", variant: "success" } })

  return memorial
}

/**
 * Fallback memorial formatter (used when shangshu AI generation is empty).
 * Kept as a utility but no longer the primary memorial generator.
 */
export function formatMemorial(edict: Edict, plan: Plan, executions: Execution[]): string {
  const lines: string[] = []

  lines.push(`# 奏折：${edict.title}`)
  lines.push("")
  lines.push("## 旨意")
  lines.push(edict.content)
  lines.push("")

  lines.push("## 规划方案（中书省）")
  lines.push(`**分析：** ${plan.analysis}`)
  lines.push("")
  lines.push("### 子任务")
  lines.push("| # | 部门 | 任务 | 状态 |")
  lines.push("|---|------|------|------|")
  for (const st of plan.subtasks) {
    const exec = executions.find((e) => e.subtaskIndex === st.index)
    const statusIcon = exec?.status === "completed" ? "✅ 完成" : exec?.status === "failed" ? "❌ 失败" : "⏳ 未执行"
    const dept = DEPT_DISPLAY[st.department] ?? st.department
    lines.push(`| ${st.index} | ${dept} | ${st.title} | ${statusIcon} |`)
  }
  lines.push("")

  if (plan.risks.length > 0) {
    lines.push("### 风险评估")
    for (const risk of plan.risks) {
      lines.push(`- ${risk}`)
    }
    lines.push("")
  }

  lines.push("## 执行结果")
  for (const exec of executions) {
    const subtask = plan.subtasks.find((s) => s.index === exec.subtaskIndex)
    const dept = DEPT_DISPLAY[exec.department] ?? exec.department
    const title = subtask?.title ?? `子任务 ${exec.subtaskIndex}`
    lines.push(`### ${dept}: ${title}`)
    if (exec.status === "completed" && exec.result) {
      lines.push(exec.result)
    } else if (exec.status === "failed") {
      lines.push(`❌ 执行失败: ${exec.error ?? "未知错误"}`)
    }
    lines.push("")
  }

  const completed = executions.filter((e) => e.status === "completed").length
  const total = executions.length
  lines.push("## 总结")
  lines.push(`成功: ${completed}/${total} 个子任务完成`)
  if (completed < total) {
    const failed = executions.filter((e) => e.status === "failed")
    for (const f of failed) {
      const dept = DEPT_DISPLAY[f.department] ?? f.department
      lines.push(`- ${dept} 执行失败: ${f.error ?? "未知错误"}`)
    }
  }

  return lines.join("\n")
}
