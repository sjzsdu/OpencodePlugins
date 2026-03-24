import type { OpencodeClient } from "sjz-opencode-sdk"
import type { ToolContext } from "sjz-opencode-sdk"
import type {
  TriageTask,
  TriageStore,
  TriageConfig,
  PipelineSession,
  Subtask,
  Execution,
} from "../types"
import { parseTriageResult, parseTicketInfo, parseScoutResult, parseDetectiveResult, parseArchitectResult } from "./classifier"
import { dispatchAll } from "./dispatcher"
import { extractText } from "../utils"

function checkAbort(abort: AbortSignal): void {
  if (abort.aborted) {
    throw new Error("用户已叫停")
  }
}

export async function runAnalysisPipeline(
  task: TriageTask,
  context: ToolContext,
  client: OpencodeClient,
  store: TriageStore,
  config: TriageConfig,
  directory?: string,
  parentSessionId?: string,
): Promise<string> {
  const sessions: PipelineSession[] = []

  // ========================================
  // Phase 1: Triage
  // ========================================
  store.update(task.id, { status: "triaging" })
  client.tui.showToast({ body: { message: "🎯 Triage: 读取与分类工单…", variant: "info" } })

  const triageSession = await client.session.create({
    body: {
      title: `Triage·${task.ticketKey}`,
      ...(parentSessionId ? { parentID: parentSessionId } : {}),
    },
    ...(directory ? { query: { directory } } : {}),
  })
  const triageSessionId = triageSession.data!.id
  sessions.push({ sessionId: triageSessionId, phase: "triaging", agent: "triage", title: `Triage·${task.ticketKey}`, createdAt: Date.now() })

  const triagePrompt = `请获取 Jira 工单 ${task.ticketKey} 的信息，对其进行分类。

## 要求
1. 使用 Jira 工具获取工单详情
2. 判断这是一个 Bug 还是 Feature
3. 输出两段 JSON：

**分类结果:**
\`\`\`json
{
  "ticketType": "bug" | "feature",
  "confidence": 0.0-1.0,
  "reasoning": "判断理由",
  "keyInfo": {
    "errorMessage": "错误信息（Bug时）",
    "stepsToReproduce": "复现步骤（Bug时）",
    "expectedBehavior": "期望行为（Bug时）",
    "acceptanceCriteria": "验收标准（Feature时）",
    "scope": "影响范围"
  }
}
\`\`\`

**工单信息:**
\`\`\`json
{
  "key": "PROJ-123",
  "type": "Bug/Story/Task",
  "summary": "标题",
  "description": "描述",
  "status": "状态",
  "priority": "优先级",
  "assignee": "处理人",
  "reporter": "报告人",
  "labels": [],
  "components": []
}
\`\`\``

  const triageResponse = await client.session.prompt({
    path: { id: triageSessionId },
    body: {
      agent: "triage",
      parts: [{ type: "text" as const, text: triagePrompt }],
    },
  })
  const triageText = extractText(triageResponse.data?.parts ?? [])
  const triageResult = parseTriageResult(triageText)
  const ticketInfo = parseTicketInfo(triageText)

  store.update(task.id, { ticket: ticketInfo, triageResult })
  client.tui.showToast({
    body: { message: `🎯 Triage: 这是一个 ${triageResult.ticketType === "bug" ? "Bug" : "Feature"}`, variant: "info" },
  })

  checkAbort(context.abort)

  // ========================================
  // Phase 2: Scout
  // ========================================
  store.update(task.id, { status: "scouting" })
  client.tui.showToast({ body: { message: "🔍 Scout: 探索代码库…", variant: "info" } })

  const scoutSession = await client.session.create({
    body: {
      title: `Scout·${task.ticketKey}`,
      ...(parentSessionId ? { parentID: parentSessionId } : {}),
    },
    ...(directory ? { query: { directory } } : {}),
  })
  const scoutSessionId = scoutSession.data!.id
  sessions.push({ sessionId: scoutSessionId, phase: "scouting", agent: "scout", title: `Scout·${task.ticketKey}`, createdAt: Date.now() })

  const scoutPrompt = `请探索代码库，找到与以下工单相关的代码。

## 工单信息
Key: ${ticketInfo.key}
类型: ${triageResult.ticketType}
标题: ${ticketInfo.summary}
描述: ${ticketInfo.description}

## 分类关键信息
${triageResult.reasoning}
${triageResult.keyInfo.errorMessage ? `错误信息: ${triageResult.keyInfo.errorMessage}` : ""}
${triageResult.keyInfo.scope ? `影响范围: ${triageResult.keyInfo.scope}` : ""}

## 要求
请输出 JSON:
\`\`\`json
{
  "relevantFiles": ["相关文件路径列表"],
  "architectureSummary": "项目架构概述",
  "codePatterns": "代码模式和约定",
  "techStack": "技术栈",
  "rawAnalysis": "详细分析"
}
\`\`\``

  const scoutResponse = await client.session.prompt({
    path: { id: scoutSessionId },
    body: {
      agent: "scout",
      parts: [{ type: "text" as const, text: scoutPrompt }],
    },
  })
  const scoutResult = parseScoutResult(extractText(scoutResponse.data?.parts ?? []))
  store.update(task.id, { scoutResult })
  client.tui.showToast({ body: { message: "🔍 Scout: 已探索代码库", variant: "info" } })

  checkAbort(context.abort)

  const existing = store.get(task.id)
  const allSessions = [...(existing?.sessions ?? []), ...sessions]

  // ========================================
  // Phase 3a (Bug): Detective
  // ========================================
  if (triageResult.ticketType === "bug") {
    store.update(task.id, { status: "investigating", sessions: allSessions })
    client.tui.showToast({ body: { message: "🕵️ Detective: 调查 Bug 根因…", variant: "info" } })

    const detectiveSession = await client.session.create({
      body: {
        title: `Detective·${task.ticketKey}`,
        ...(parentSessionId ? { parentID: parentSessionId } : {}),
      },
      ...(directory ? { query: { directory } } : {}),
    })
    const detectiveSessionId = detectiveSession.data!.id
    const detectiveSessions: PipelineSession[] = [
      { sessionId: detectiveSessionId, phase: "investigating", agent: "detective", title: `Detective·${task.ticketKey}`, createdAt: Date.now() },
    ]

    const detectivePrompt = `请基于 Scout 的代码库探索结果，深入调查 Bug 的根因。

## 工单信息
Key: ${ticketInfo.key}
标题: ${ticketInfo.summary}
描述: ${ticketInfo.description}
${triageResult.keyInfo.errorMessage ? `错误信息: ${triageResult.keyInfo.errorMessage}` : ""}
${triageResult.keyInfo.stepsToReproduce ? `复现步骤: ${triageResult.keyInfo.stepsToReproduce}` : ""}

## Scout 发现
相关文件: ${scoutResult.relevantFiles.join(", ")}
架构: ${scoutResult.architectureSummary}
代码模式: ${scoutResult.codePatterns}

## 要求
请输出 JSON:
\`\`\`json
{
  "exists": true/false,
  "evidence": "证据描述",
  "location": "Bug 所在文件和行号",
  "rootCause": "根因分析",
  "reproductionSteps": "复现步骤",
  "suggestedFix": "修复建议"
}
\`\`\``

    const detectiveResponse = await client.session.prompt({
      path: { id: detectiveSessionId },
      body: {
        agent: "detective",
        parts: [{ type: "text" as const, text: detectivePrompt }],
      },
    })
    const detectiveResult = parseDetectiveResult(extractText(detectiveResponse.data?.parts ?? []))

    const currentTask = store.get(task.id)
    store.update(task.id, {
      detectiveResult,
      sessions: [...(currentTask?.sessions ?? []), ...detectiveSessions],
    })

    if (!detectiveResult.exists) {
      store.update(task.id, { status: "not_found" })
      client.tui.showToast({ body: { message: "🕵️ Detective: Bug 未在代码中发现", variant: "warning" } })

      const report = `# Triage 报告: ${ticketInfo.key}

## 分类
类型: Bug
置信度: ${triageResult.confidence}

## 调查结论
**Bug 未在代码中发现**

${detectiveResult.evidence}

### 根因分析
${detectiveResult.rootCause}

### 建议
该 Bug 可能与环境配置、外部依赖或数据问题有关，建议进一步排查。`

      store.update(task.id, { report })
      return report
    }

    client.tui.showToast({ body: { message: "🕵️ Detective: 已定位 Bug，进入修复流程", variant: "success" } })
    return runImplementPipeline(task, context, client, store, config, directory, parentSessionId)
  }

  // ========================================
  // Phase 3b (Feature): Architect
  // ========================================
  store.update(task.id, { status: "designing", sessions: allSessions })
  client.tui.showToast({ body: { message: "📐 Architect: 设计实现方案…", variant: "info" } })

  const architectSession = await client.session.create({
    body: {
      title: `Architect·${task.ticketKey}`,
      ...(parentSessionId ? { parentID: parentSessionId } : {}),
    },
    ...(directory ? { query: { directory } } : {}),
  })
  const architectSessionId = architectSession.data!.id
  const architectSessions: PipelineSession[] = [
    { sessionId: architectSessionId, phase: "designing", agent: "architect", title: `Architect·${task.ticketKey}`, createdAt: Date.now() },
  ]

  const architectPrompt = `请基于 Scout 的探索结果，为以下 Feature 设计实现方案。

## 工单信息
Key: ${ticketInfo.key}
标题: ${ticketInfo.summary}
描述: ${ticketInfo.description}
${triageResult.keyInfo.acceptanceCriteria ? `验收标准: ${triageResult.keyInfo.acceptanceCriteria}` : ""}
${triageResult.keyInfo.scope ? `影响范围: ${triageResult.keyInfo.scope}` : ""}

## Scout 发现
相关文件: ${scoutResult.relevantFiles.join(", ")}
架构: ${scoutResult.architectureSummary}
代码模式: ${scoutResult.codePatterns}
技术栈: ${scoutResult.techStack}

## 要求
请输出 JSON:
\`\`\`json
{
  "analysis": "需求分析",
  "plan": {
    "analysis": "技术方案分析",
    "subtasks": [
      {
        "index": 0,
        "title": "子任务标题",
        "description": "详细描述",
        "files": ["涉及文件"],
        "dependencies": [],
        "effort": "low | medium | high"
      }
    ],
    "risks": ["风险"]
  },
  "ticketScale": "XS | S | M | L | XL",
  "styleNotes": "代码风格要求",
  "rootCause": "需求根源分析"
}
\`\`\``

  const architectResponse = await client.session.prompt({
    path: { id: architectSessionId },
    body: {
      agent: "architect",
      parts: [{ type: "text" as const, text: architectPrompt }],
    },
  })
  const architectResult = parseArchitectResult(extractText(architectResponse.data?.parts ?? []))

  const currentForArchitect = store.get(task.id)
  store.update(task.id, {
    architectResult,
    status: "awaiting",
    sessions: [...(currentForArchitect?.sessions ?? []), ...architectSessions],
  })
  client.tui.showToast({ body: { message: "📐 Architect: 设计方案已生成", variant: "info" } })

  const planSummary = architectResult.plan.subtasks
    .map((st) => `${st.index + 1}. **${st.title}** (${st.effort}) — ${st.description}`)
    .join("\n")

  return `# Feature 设计方案: ${ticketInfo.key}

## 分析
${architectResult.analysis}

## 规模评估: ${architectResult.ticketScale}

## 实现计划 (${architectResult.plan.subtasks.length} 个子任务)
${planSummary}

## 风险
${architectResult.plan.risks.map((r) => `- ${r}`).join("\n") || "无"}

## 代码风格
${architectResult.styleNotes}

---
*方案已生成，等待确认。使用 \`jira_implement\` 工具开始实现。*`
}

export async function runImplementPipeline(
  task: TriageTask,
  context: ToolContext,
  client: OpencodeClient,
  store: TriageStore,
  config: TriageConfig,
  directory?: string,
  parentSessionId?: string,
): Promise<string> {
  const freshTask = store.get(task.id)!

  // ========================================
  // Phase 4: Implementation
  // ========================================
  store.update(task.id, { status: "implementing" })
  client.tui.showToast({ body: { message: "🧩 实现阶段开始…", variant: "info" } })

  let subtasks: Subtask[]

  if (freshTask.detectiveResult?.suggestedFix) {
    subtasks = [{
      index: 0,
      title: `修复 ${freshTask.ticketKey}`,
      description: `根据 Detective 的分析修复 Bug。

根因: ${freshTask.detectiveResult.rootCause}
位置: ${freshTask.detectiveResult.location ?? "见 evidence"}
修复建议: ${freshTask.detectiveResult.suggestedFix}
证据: ${freshTask.detectiveResult.evidence}`,
      files: freshTask.detectiveResult.location ? [freshTask.detectiveResult.location] : [],
      dependencies: [],
      effort: "medium",
    }]
  } else if (freshTask.architectResult?.plan) {
    subtasks = freshTask.architectResult.plan.subtasks
  } else {
    store.update(task.id, { status: "failed", report: "没有可执行的实现计划" })
    return "没有可执行的实现计划"
  }

  checkAbort(context.abort)

  const sessionContext = parentSessionId ? { parentSessionId, directory: directory ?? "" } : undefined
  const executions = await dispatchAll(client, freshTask, subtasks, config.pipeline.maxFixLoops, sessionContext)

  const currentAfterExec = store.get(task.id)
  store.update(task.id, { executions: [...(currentAfterExec?.executions ?? []), ...executions] })

  checkAbort(context.abort)

  // ========================================
  // Phase 5: Jira Update
  // ========================================
  if (config.jira.autoTransition) {
    store.update(task.id, { status: "updating_jira" })
    client.tui.showToast({ body: { message: "📝 更新 Jira 工单…", variant: "info" } })

    const rootCause = freshTask.detectiveResult?.rootCause ?? freshTask.architectResult?.rootCause ?? ""
    const ticketScale = freshTask.architectResult?.ticketScale ?? estimateBugScale(executions)

    const jiraSession = await client.session.create({
      body: {
        title: `JiraUpdate·${freshTask.ticketKey}`,
        ...(parentSessionId ? { parentID: parentSessionId } : {}),
      },
      ...(directory ? { query: { directory } } : {}),
    })

    const jiraUpdatePrompt = `请更新 Jira 工单 ${freshTask.ticketKey} 的以下字段：

1. **${config.jira.rootCauseField}**: ${rootCause}
2. **${config.jira.scaleField}**: ${ticketScale}
3. 如果适用，请将工单状态流转到下一个合适的状态

请使用 Jira 工具完成更新。`

    try {
      await client.session.prompt({
        path: { id: jiraSession.data!.id },
        body: {
          agent: "triage",
          parts: [{ type: "text" as const, text: jiraUpdatePrompt }],
        },
      })

      store.update(task.id, { jiraUpdated: true })
      client.tui.showToast({ body: { message: "📝 Jira 工单已更新", variant: "success" } })
    } catch (err) {
      client.tui.showToast({
        body: { message: `⚠️ Jira 更新失败: ${err instanceof Error ? err.message : String(err)}`, variant: "warning" },
      })
    }
  }

  checkAbort(context.abort)

  // ========================================
  // Phase 6: Summary
  // ========================================
  const ticket = freshTask.ticket
  const completedExecs = executions.filter((e) => e.status === "completed")
  const failedExecs = executions.filter((e) => e.status === "failed")
  const isBug = !!freshTask.detectiveResult

  const executionSummary = executions
    .map((exec) => {
      const st = subtasks.find((s) => s.index === exec.subtaskIndex)
      const title = st?.title ?? `子任务 ${exec.subtaskIndex}`
      const status = exec.status === "completed" ? "✅ 完成" : "❌ 失败"
      const rounds = exec.fixAttempts.length
      const roundNote = rounds > 1 ? ` (经 ${rounds - 1} 轮修复)` : ""
      const detail = exec.status === "completed" ? (exec.result ?? "") : (exec.error ?? "")
      return `### ${title}${roundNote}\n状态: ${status}\n${detail}`
    })
    .join("\n\n")

  const report = `# Triage 报告: ${ticket?.key ?? freshTask.ticketKey}

## 工单信息
- 类型: ${isBug ? "Bug" : "Feature"}
- 标题: ${ticket?.summary ?? freshTask.ticketKey}
- 优先级: ${ticket?.priority ?? "N/A"}

${isBug ? `## Bug 调查
- 根因: ${freshTask.detectiveResult?.rootCause ?? "N/A"}
- 位置: ${freshTask.detectiveResult?.location ?? "N/A"}
- 证据: ${freshTask.detectiveResult?.evidence ?? "N/A"}` : `## Feature 设计
- 分析: ${freshTask.architectResult?.analysis ?? "N/A"}
- 规模: ${freshTask.architectResult?.ticketScale ?? "N/A"}`}

## 执行结果
- 总计: ${executions.length} 个子任务
- 成功: ${completedExecs.length}
- 失败: ${failedExecs.length}

${executionSummary}

## Jira 更新
${freshTask.jiraUpdated || config.jira.autoTransition ? "✅ 已更新" : "未更新"}

## 总结
${failedExecs.length === 0 ? "所有子任务均已成功完成。" : `${failedExecs.length} 个子任务失败，可能需要人工介入。`}`

  store.update(task.id, { report, status: "completed" })
  client.tui.showToast({ body: { message: `📋 Triage 完成: ${freshTask.ticketKey}`, variant: "success" } })

  return report
}

function estimateBugScale(executions: Execution[]): string {
  const totalRounds = executions.reduce((sum, e) => sum + e.fixAttempts.length, 0)
  if (executions.length <= 1 && totalRounds <= 1) return "S"
  if (executions.length <= 2 && totalRounds <= 3) return "M"
  return "L"
}
