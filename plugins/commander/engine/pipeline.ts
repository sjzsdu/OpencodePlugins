import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import type { ToolContext } from "@opencode-ai/plugin"
import type { Task, TaskStore, CommanderConfig, Plan, PipelineSession } from "../types"
import { classifyComplexity } from "./classifier"
import { dispatchAll } from "./dispatcher"
import { extractText, parseJSON } from "../utils"

// Shared helpers (extracted to utils.ts)

function parsePlan(text: string): Plan {
  const data = parseJSON(text)
  if (!data || typeof data !== "object") {
    throw new Error("Lead 输出格式错误：无法解析 JSON")
  }
  const obj = data as Record<string, unknown>
  if (!obj.analysis || !Array.isArray(obj.subtasks)) {
    throw new Error("Lead 输出格式错误：缺少 analysis 或 subtasks 字段")
  }
  return {
    analysis: String(obj.analysis),
    subtasks: obj.subtasks as Plan["subtasks"],
    risks: Array.isArray(obj.risks) ? (obj.risks as string[]) : [],
  }
}

function checkAbort(abort: AbortSignal): void {
  if (abort.aborted) {
    throw new Error("用户已叫停")
  }
}

/**
 * Main pipeline: Commander adaptive workflow.
 *
 * Phase 1: Lead analyzes and plans
 * Phase 1b: Trivial → Lead handles directly
 * Phase 2: Dispatch Coder(s) + Tester fix loops
 * Phase 3: Reviewer (complex only)
 * Phase 4: Lead summarizes
 */
export async function runPipeline(
  task: Task,
  context: ToolContext,
  client: OpencodeClient,
  store: TaskStore,
  config: CommanderConfig,
  directory?: string,
  parentSessionId?: string,
): Promise<string> {
  const sessions: PipelineSession[] = []
  // ========================================
  // Phase 1: Lead analyzes and plans
  // ========================================
  // Phase 1: Lead analyzes and plans
  // ========================================
  store.update(task.id, { status: "analyzing" })
  client.tui.showToast({ body: { message: "🔍 Lead: 分析需求中...", variant: "info" } })

  const leadSession = await client.session.create({
    body: {
      title: `Lead·${task.title}`,
      ...(parentSessionId ? { parentID: parentSessionId } : {}),
    },
    ...(directory ? { query: { directory } } : {}),
  })
  const leadSessionId = leadSession.data!.id
  sessions.push({ sessionId: leadSessionId, phase: "analyzing", agent: "lead", title: `Lead·${task.title}`, createdAt: Date.now() })

  const analyzePrompt = `请分析以下任务需求，探索代码库，制定执行计划。

## 任务
标题: ${task.title}
内容: ${task.content}
优先级: ${task.priority}

## 要求
1. 使用工具探索项目代码库，了解相关模块和技术栈
2. 分析需求的实现路径
3. 输出一个 JSON 格式的计划

请输出严格的 Plan JSON，格式如下：
\`\`\`json
{
  "analysis": "对需求和现有代码的分析总结",
  "subtasks": [
    {
      "index": 0,
      "title": "子任务标题",
      "description": "详细描述，包含具体文件路径、修改内容",
      "dependencies": [],
      "effort": "low | medium | high"
    }
  ],
  "risks": ["风险描述"]
}
\`\`\`

如果任务非常简单（如修改拼写错误），可以返回空的 subtasks 数组，表示你可以直接处理。`

  const analyzeResponse = await client.session.prompt({
    path: { id: leadSessionId },
    body: {
      agent: "lead",
      parts: [{ type: "text" as const, text: analyzePrompt }],
    },
  })

  const analyzeText = extractText(analyzeResponse.data?.parts ?? [])
  const plan = parsePlan(analyzeText)
  const complexity = classifyComplexity(plan)

  store.update(task.id, { status: "planning", plan, complexity })
  client.tui.showToast({
    body: {
      message: `📋 Lead: 计划就绪 (${plan.subtasks.length} 个子任务, ${complexity} 复杂度)`,
      variant: "info",
    },
  })

  checkAbort(context.abort)

  // ========================================
  // Phase 1b: Trivial — Lead handles directly
  // ========================================
  if (complexity === "trivial") {
    store.update(task.id, { status: "executing" })
    client.tui.showToast({ body: { message: "⚡ Lead: 直接处理 (trivial)...", variant: "info" } })

    const trivialPrompt = `这个任务很简单，请你直接实现。

## 任务
标题: ${task.title}
内容: ${task.content}

## 你的分析
${plan.analysis}

请直接完成实现并报告结果。`

    const trivialResponse = await client.session.prompt({
      path: { id: leadSessionId },
      body: {
        agent: "lead",
        parts: [{ type: "text" as const, text: trivialPrompt }],
      },
    })

    const result = extractText(trivialResponse.data?.parts ?? [])
    store.update(task.id, { report: result, status: "completed" })
    client.tui.showToast({ body: { message: "✅ Lead: 任务完成 (trivial)", variant: "success" } })
    return result
  }

  // ========================================
  // Phase 2: Dispatch Coder(s) + Tester fix loops
  // ========================================
  store.update(task.id, { status: "executing" })
  client.tui.showToast({ body: { message: "⚔️ 派发 Coder 执行中...", variant: "info" } })

  checkAbort(context.abort)

  const sessionContext = parentSessionId ? { parentSessionId, directory: directory ?? "" } : undefined
  const executions = await dispatchAll(client, task, config.pipeline.maxFixLoops, sessionContext)
  store.update(task.id, { executions })

  checkAbort(context.abort)

  // ========================================
  // Phase 3: Reviewer (complex only)
  // ========================================
  let reviewResult: string | undefined
  if (complexity === "complex" && config.pipeline.enableReviewer) {
    store.update(task.id, { status: "reviewing" })
    client.tui.showToast({ body: { message: "🔍 Reviewer: 审查代码中...", variant: "info" } })

    const reviewerSession = await client.session.create({
      body: {
        title: `Reviewer·${task.title}`,
        ...(parentSessionId ? { parentID: parentSessionId } : {}),
      },
      ...(directory ? { query: { directory } } : {}),
    })
    sessions.push({ sessionId: reviewerSession.data!.id, phase: "reviewing", agent: "reviewer", title: `Reviewer·${task.title}`, createdAt: Date.now() })

    const executionSummary = executions
      .map((exec) => {
        const subtask = plan.subtasks.find((s) => s.index === exec.subtaskIndex)
        const title = subtask?.title ?? `子任务 ${exec.subtaskIndex}`
        const status = exec.status === "completed" ? "✅ 完成" : "❌ 失败"
        const detail = exec.status === "completed" ? (exec.result ?? "") : (exec.error ?? "")
        return `### ${title}\n状态: ${status}\n${detail}`
      })
      .join("\n\n")

    const reviewPrompt = `请审查以下任务的代码实现。

## 任务背景
标题: ${task.title}
内容: ${task.content}

## 计划分析
${plan.analysis}

## Coder 执行结果
${executionSummary}

请进行全面的代码审查，包括代码质量、安全性和架构合理性。`

    const reviewResponse = await client.session.prompt({
      path: { id: reviewerSession.data!.id },
      body: {
        agent: "reviewer",
        parts: [{ type: "text" as const, text: reviewPrompt }],
      },
    })

    reviewResult = extractText(reviewResponse.data?.parts ?? [])
    checkAbort(context.abort)
  }

  // ========================================
  // Phase 4: Lead summarizes
  // ========================================
  client.tui.showToast({ body: { message: "📋 Lead: 生成报告中...", variant: "info" } })

  const executionSummary = executions
    .map((exec) => {
      const subtask = plan.subtasks.find((s) => s.index === exec.subtaskIndex)
      const title = subtask?.title ?? `子任务 ${exec.subtaskIndex}`
      const status = exec.status === "completed" ? "✅ 完成" : "❌ 失败"
      const rounds = exec.fixAttempts.length
      const roundNote = rounds > 1 ? ` (经 ${rounds - 1} 轮修复)` : ""
      const detail = exec.status === "completed" ? (exec.result ?? "") : (exec.error ?? "")
      return `### ${title}${roundNote}\n状态: ${status}\n${detail}`
    })
    .join("\n\n")

  const reviewBlock = reviewResult ? `\n## Reviewer 审查意见\n${reviewResult}\n` : ""

  const summaryPrompt = `所有子任务已执行完毕，请生成最终报告。

## 任务
标题: ${task.title}
内容: ${task.content}

## 计划
${plan.analysis}

## 执行结果
${executionSummary}
${reviewBlock}
## 报告要求
请生成完整的执行报告（Markdown 格式），包含：
1. 任务概述
2. 执行结果总结
3. ${reviewResult ? "审查意见响应\n4. " : ""}遗留问题和风险
${reviewResult ? "5" : "4"}. 总结评估

请直接输出报告内容。`

  const summaryResponse = await client.session.prompt({
    path: { id: leadSessionId },
    body: {
      agent: "lead",
      parts: [{ type: "text" as const, text: summaryPrompt }],
    },
  })

  const report = extractText(summaryResponse.data?.parts ?? [])
  // Persist pipeline sessions if any were created
  if (sessions.length > 0) {
    const current = store.get(task.id)
    const existing = current?.sessions ?? []
    store.update(task.id, { sessions: [...existing, ...sessions], report, status: "completed" })
  } else {
    store.update(task.id, { report, status: "completed" })
  }
  client.tui.showToast({ body: { message: "📋 Lead: 任务完成", variant: "success" } })

  return report
}
