import type { OpencodeClient } from "sjz-opencode-sdk"
import { extractText } from "../utils"
import type { TriageTask, Subtask, Execution } from "../types"

export function topologicalSort(subtasks: Subtask[]): Subtask[][] {
  if (subtasks.length === 0) return []

  const waves: Subtask[][] = []
  const completed = new Set<number>()
  let remaining = [...subtasks]

  while (remaining.length > 0) {
    const wave = remaining.filter((st) =>
      st.dependencies.every((dep) => completed.has(dep)),
    )

    if (wave.length === 0) {
      waves.push(remaining)
      break
    }

    waves.push(wave)
    for (const st of wave) {
      completed.add(st.index)
    }
    remaining = remaining.filter((st) => !completed.has(st.index))
  }

  return waves
}

export async function executeSubtask(
  client: OpencodeClient,
  task: TriageTask,
  subtask: Subtask,
  maxFixLoops: number,
  sessionContext?: { parentSessionId?: string; directory?: string },
): Promise<Execution> {
  const execution: Execution = {
    subtaskIndex: subtask.index,
    coderSessionId: "",
    testerSessionId: "",
    status: "running",
    fixAttempts: [],
    startedAt: Date.now(),
  }

  const coderSession = await client.session.create({
    body: {
      title: `Coder·${task.ticketKey}·${subtask.title}`,
      ...(sessionContext?.parentSessionId ? { parentID: sessionContext.parentSessionId } : {}),
    },
    ...(sessionContext?.directory ? { query: { directory: sessionContext.directory } } : {}),
  })
  execution.coderSessionId = coderSession.data!.id
  if (task.sessions) {
    task.sessions.push({ sessionId: coderSession.data!.id, phase: "implementing", agent: "triage-coder", title: `Coder·${subtask.title}`, createdAt: Date.now() })
  }

  const testerSession = await client.session.create({
    body: {
      title: `Tester·${task.ticketKey}·${subtask.title}`,
      ...(sessionContext?.parentSessionId ? { parentID: sessionContext.parentSessionId } : {}),
    },
    ...(sessionContext?.directory ? { query: { directory: sessionContext.directory } } : {}),
  })
  execution.testerSessionId = testerSession.data!.id
  if (task.sessions) {
    task.sessions.push({ sessionId: testerSession.data!.id, phase: "verifying", agent: "triage-tester", title: `Tester·${subtask.title}`, createdAt: Date.now() })
  }

  client.tui.showToast({
    body: { message: `⚔️ Coder: 正在实现 "${subtask.title}"`, variant: "info" },
  })

  const coderPrompt = `你正在修复/实现一个 Jira Ticket 的子任务。

## Ticket
${task.ticketKey}${task.ticket ? ` - ${task.ticket.summary}` : ""}

## 你的子任务
**${subtask.title}**

${subtask.description}

涉及文件: ${subtask.files.join(", ") || "由你判断"}
工作量评估: ${subtask.effort}

请实现以上子任务，完成后详细报告你做了什么。`

  const coderResponse = await client.session.prompt({
    path: { id: execution.coderSessionId },
    body: {
      agent: "triage-coder",
      parts: [{ type: "text" as const, text: coderPrompt }],
    },
  })
  const coderResult = extractText(coderResponse.data?.parts ?? [])

  client.tui.showToast({
    body: { message: `🧪 Tester: 正在验证 "${subtask.title}"...`, variant: "info" },
  })

  const testerPrompt = `请验证以下子任务的实现是否正确。

## Ticket
${task.ticketKey}${task.ticket ? ` - ${task.ticket.summary}` : ""}

## 子任务
**${subtask.title}**

${subtask.description}

## Coder 的实现报告
${coderResult}

请运行测试、构建验证，确认实现是否正确。最后给出明确的结论：
- 如果通过，以 "✅ 验证通过" 开头
- 如果失败，以 "❌ 验证失败" 开头，并详细说明失败原因`

  const testerResponse = await client.session.prompt({
    path: { id: execution.testerSessionId },
    body: {
      agent: "triage-tester",
      parts: [{ type: "text" as const, text: testerPrompt }],
    },
  })
  let testerResult = extractText(testerResponse.data?.parts ?? [])

  const passed = testerResult.includes("✅")
  execution.fixAttempts.push({
    round: 0,
    coderResult,
    testerResult,
    passed,
  })

  if (passed) {
    execution.status = "completed"
    execution.result = coderResult
    execution.completedAt = Date.now()
    client.tui.showToast({
      body: { message: `✅ 完成: "${subtask.title}"`, variant: "success" },
    })
    return execution
  }

  for (let round = 1; round <= maxFixLoops; round++) {
    client.tui.showToast({
      body: { message: `❌ Tester: 验证失败 (第 ${round} 轮修复)`, variant: "warning" },
    })

    client.tui.showToast({
      body: { message: `🔧 Coder: 正在修复 (第 ${round} 轮)...`, variant: "info" },
    })

    const fixPrompt = `Tester 报告验证失败，请修复问题。

## Tester 的反馈
${testerResult}

请分析失败原因，修复问题，然后报告你的修改。`

    const fixResponse = await client.session.prompt({
      path: { id: execution.coderSessionId },
      body: {
        agent: "triage-coder",
        parts: [{ type: "text" as const, text: fixPrompt }],
      },
    })
    const fixResult = extractText(fixResponse.data?.parts ?? [])

    client.tui.showToast({
      body: { message: `🧪 Tester: 重新验证 (第 ${round} 轮)...`, variant: "info" },
    })

    const reVerifyPrompt = `Coder 已修复问题，请重新验证。

## Coder 的修复报告
${fixResult}

请重新运行测试和验证。给出明确结论：
- 如果通过，以 "✅ 验证通过" 开头
- 如果失败，以 "❌ 验证失败" 开头，并详细说明失败原因`

    const reVerifyResponse = await client.session.prompt({
      path: { id: execution.testerSessionId },
      body: {
        agent: "triage-tester",
        parts: [{ type: "text" as const, text: reVerifyPrompt }],
      },
    })
    testerResult = extractText(reVerifyResponse.data?.parts ?? [])

    const fixPassed = testerResult.includes("✅")
    execution.fixAttempts.push({
      round,
      coderResult: fixResult,
      testerResult,
      passed: fixPassed,
    })

    if (fixPassed) {
      execution.status = "completed"
      execution.result = fixResult
      execution.completedAt = Date.now()
      client.tui.showToast({
        body: { message: `✅ 完成 (第 ${round} 轮修复后): "${subtask.title}"`, variant: "success" },
      })
      return execution
    }
  }

  execution.status = "failed"
  execution.error = `经过 ${maxFixLoops} 轮修复仍未通过验证`
  execution.completedAt = Date.now()

  client.tui.showToast({
    body: { message: `❌ 失败: "${subtask.title}" (${maxFixLoops} 轮修复均未通过)`, variant: "error" },
  })

  return execution
}

export async function dispatchAll(
  client: OpencodeClient,
  task: TriageTask,
  subtasks: Subtask[],
  maxFixLoops: number,
  sessionContext?: { parentSessionId?: string; directory?: string },
): Promise<Execution[]> {
  const waves = topologicalSort(subtasks)
  const allExecutions: Execution[] = []
  const totalSubtasks = subtasks.length
  let completedCount = 0

  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    const wave = waves[waveIdx]
    const waveLabel = `Wave ${waveIdx + 1}/${waves.length}`

    const waveTitles = wave.map((st) => st.title).join("、")
    client.tui.showToast({
      body: {
        message: `📡 ${waveLabel} 开始: ${waveTitles} (${completedCount}/${totalSubtasks} 已完成)`,
        variant: "info",
      },
    })

    const settled = await Promise.allSettled(
      wave.map((subtask) => executeSubtask(client, task, subtask, maxFixLoops, sessionContext)),
    )
    const waveResults: Execution[] = settled.map((r, idx) => {
      if (r.status === "fulfilled") return r.value
      const subtask = wave[idx]
      return {
        subtaskIndex: subtask.index,
        coderSessionId: "",
        testerSessionId: "",
        status: "failed" as const,
        fixAttempts: [],
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        startedAt: Date.now(),
        completedAt: Date.now(),
      }
    })

    const waveCompleted = waveResults.filter((e) => e.status === "completed").length
    const waveFailed = waveResults.filter((e) => e.status === "failed").length
    completedCount += waveResults.length

    if (waveFailed > 0) {
      client.tui.showToast({
        body: {
          message: `⚠️ ${waveLabel} 完成: ${waveCompleted} 成功, ${waveFailed} 失败 (${completedCount}/${totalSubtasks})`,
          variant: "warning",
        },
      })
    } else {
      client.tui.showToast({
        body: {
          message: `✅ ${waveLabel} 完成: ${waveCompleted}/${wave.length} 成功 (${completedCount}/${totalSubtasks})`,
          variant: "success",
        },
      })
    }

    allExecutions.push(...waveResults)
  }

  return allExecutions
}
