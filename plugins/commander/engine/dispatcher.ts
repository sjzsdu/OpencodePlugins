import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import { extractText, parseJSON } from "../utils"
import type { Task, Subtask, Execution, FixAttempt, CommanderConfig } from "../types"

// Timeout utilities
function withTimeout<T>(promise: Promise<T>, ms: number, taskTitle: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`⏱️ 超时: "${taskTitle}" 执行超过 ${ms / 1000}s`)), ms),
    ),
  ])
}

// Sensitive pattern checker (with error handling for invalid regex)
function checkSensitivePatterns(text: string, patterns: string[]): string[] {
  const matched: string[] = []
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, "i")
      if (regex.test(text)) {
        matched.push(pattern)
      }
    } catch {
      // Skip invalid regex patterns
    }
  }
  return matched
}

// Parse Tester's JSON result with fallback
interface TesterResult {
  passed: boolean
  build?: { command: string; exitCode: number; output?: string; error?: string }
  tests?: { command: string; exitCode: number; passed?: number; failed?: number }
  files?: string[]
  issues?: Array<{ type: string; file?: string; error: string; fixable?: boolean }>
  summary: string
}

function parseTesterResult(text: string): TesterResult | null {
  const parsed = parseJSON(text)
  if (parsed && typeof parsed === "object" && "passed" in parsed) {
    return parsed as TesterResult
  }
  // Fallback: try to detect from emoji-based format
  const passed = text.includes("✅ 验证通过")
  const buildMatch = text.match(/构建[:：]\s*[^→]+→\s*退出码\s*(\d+)/)
  const testMatch = text.match(/测试[:：]\s*[^→]+→\s*(\d+)\s*个测试通过.*?(\d+)\s*个失败/)
  return {
    passed,
    build: buildMatch ? { command: "(detected)", exitCode: parseInt(buildMatch[1], 10) } : undefined,
    tests: testMatch ? { command: "(detected)", exitCode: 0, passed: parseInt(testMatch[1], 10), failed: parseInt(testMatch[2], 10) } : undefined,
    summary: passed ? "验证通过 (fallback)" : "验证失败 (fallback)",
  }
}

// extracted: use shared extractText from utils

/**
 * Group subtasks into execution waves based on dependencies (Kahn's algorithm).
 * Wave 0 = no dependencies, Wave N = depends on waves 0..N-1.
 * If cycle detected, remaining subtasks go into a single final wave.
 *
 * Reused from emperor/engine/dispatcher.ts — clean, generic algorithm.
 */
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
      // Cycle detected — put all remaining in one wave
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

/**
 * Execute a single subtask with the Coder↔Tester fix loop.
 *
 * Key design: Coder and Tester each maintain their own session across fix rounds.
 * Context accumulates within each session, enabling smarter fixes on each iteration.
 *
 * Flow:
 *   1. Create Coder session → prompt with subtask
 *   2. Create Tester session → prompt to verify
 *   3. If Tester passes → return success
 *   4. If Tester fails AND rounds < maxFixLoops:
 *      - Re-prompt Coder (SAME session) with failure context
 *      - Re-prompt Tester (SAME session) to re-verify
 *      - Loop
 *   5. If all rounds exhausted → return failure
 */
export async function executeSubtask(
  client: OpencodeClient,
  task: Task,
  subtask: Subtask,
  maxFixLoops: number,
  sessionContext: { parentSessionId?: string; directory?: string } | undefined,
  config?: CommanderConfig,
): Promise<Execution> {
  const execution: Execution = {
    subtaskIndex: subtask.index,
    coderSessionId: "",
    testerSessionId: "",
    status: "running",
    fixAttempts: [],
    startedAt: Date.now(),
  }

  // Create Coder session
  const coderSession = await client.session.create({
    body: {
      title: `Coder·${subtask.title}`,
      ...(sessionContext?.parentSessionId ? { parentID: sessionContext.parentSessionId } : {}),
    },
    ...(sessionContext?.directory ? { query: { directory: sessionContext.directory } } : {}),
  })
  execution.coderSessionId = coderSession.data!.id
  // Track coder session in task sessions if available
  if (task.sessions) {
    task.sessions.push({ sessionId: coderSession.data!.id, phase: "executing", agent: "coder", title: `Coder·${subtask.title}`, createdAt: Date.now() })
  }

  // Create Tester session
  const testerSession = await client.session.create({
    body: {
      title: `Tester·${subtask.title}`,
      ...(sessionContext?.parentSessionId ? { parentID: sessionContext.parentSessionId } : {}),
    },
    ...(sessionContext?.directory ? { query: { directory: sessionContext.directory } } : {}),
  })
  execution.testerSessionId = testerSession.data!.id
  // Track tester session in task sessions if available
  if (task.sessions) {
    task.sessions.push({ sessionId: testerSession.data!.id, phase: "verifying", agent: "tester", title: `Tester·${subtask.title}`, createdAt: Date.now() })
  }

  // --- Sensitive pattern check before execution ---
  const sensitivePatterns = config?.pipeline?.sensitivePatterns ?? []
  let detectedSensitivePatterns: string[] = []
  if (sensitivePatterns.length > 0) {
    const matched = checkSensitivePatterns(subtask.description, sensitivePatterns)
    if (matched.length > 0) {
      detectedSensitivePatterns = matched
      client.tui.showToast({
        body: {
          message: `⚠️ 敏感操作检测: "${subtask.title}" 匹配模式 [${matched.join(", ")}]`,
          variant: "warning",
        },
      })
    }
  }

  // --- Round 0: Initial implementation ---
  client.tui.showToast({
    body: {
      message: `⚔️ Coder: 正在实现 "${subtask.title}"`,
      variant: "info",
    },
  })

  const coderPrompt = `你正在执行一个任务的子任务。

## 任务背景
标题: ${task.title}
内容: ${task.content}

## 你的子任务
**${subtask.title}**

${subtask.description}

工作量评估: ${subtask.effort}

请实现以上子任务，完成后详细报告你做了什么。`

  const timeoutMs = config?.pipeline?.timeoutMs ?? 120000 // 2 min default
  const coderResponse = await withTimeout(
    client.session.prompt({
      path: { id: execution.coderSessionId },
      body: {
        agent: "coder",
        parts: [{ type: "text" as const, text: coderPrompt }],
      },
    }),
    timeoutMs,
    subtask.title,
  )
  const coderResult = extractText(coderResponse.data?.parts ?? [])

  // --- Tester verifies ---
  client.tui.showToast({
    body: {
      message: `🧪 Tester: 正在验证 "${subtask.title}"...`,
      variant: "info",
    },
  })

  // --- Check sensitive patterns in coder result ---
  const resultSensitive = checkSensitivePatterns(coderResult, sensitivePatterns)
  if (resultSensitive.length > 0) {
    detectedSensitivePatterns = [...new Set([...detectedSensitivePatterns, ...resultSensitive])]
    client.tui.showToast({
      body: {
        message: `⚠️ 结果包含敏感内容: [${resultSensitive.join(", ")}]`,
        variant: "warning",
      },
    })
  }

  // Store detected sensitive patterns in execution
  if (detectedSensitivePatterns.length > 0) {
    execution.sensitivePatterns = detectedSensitivePatterns
  }

  const testerPrompt = `请验证以下子任务的实现是否正确。

## 任务背景
标题: ${task.title}
内容: ${task.content}

## 子任务
**${subtask.title}**

${subtask.description}

## Coder 的实现报告
${coderResult}

请运行测试、构建验证，确认实现是否正确。
**重要**: 请输出严格的 JSON 格式结果，不要输出其他内容。`

  const testerResponse = await withTimeout(
    client.session.prompt({
      path: { id: execution.testerSessionId },
      body: {
        agent: "tester",
        parts: [{ type: "text" as const, text: testerPrompt }],
      },
    }),
    timeoutMs,
    `${subtask.title} (验证)`,
  )
  const testerResult = extractText(testerResponse.data?.parts ?? [])

  // Parse structured result instead of emoji check
  const parsedResult = parseTesterResult(testerResult)
  const passed = parsedResult?.passed ?? testerResult.includes("✅")
  const testExitCode = parsedResult?.tests?.exitCode ?? (passed ? 0 : 1)
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
      body: {
        message: `✅ 完成: "${subtask.title}"`,
        variant: "success",
      },
    })
    return execution
  }

  // --- Fix loop ---
  for (let round = 1; round <= maxFixLoops; round++) {
    client.tui.showToast({
      body: {
        message: `❌ Tester: 验证失败 (第 ${round} 轮修复)`,
        variant: "warning",
      },
    })

    // Re-prompt Coder with failure context (same session — context accumulates)
    client.tui.showToast({
      body: {
        message: `🔧 Coder: 正在修复 (第 ${round} 轮)...`,
        variant: "info",
      },
    })

    const fixPrompt = `Tester 报告验证失败，请修复问题。

## Tester 的反馈
${testerResult}

请分析失败原因，修复问题，然后报告你的修改。`

    const fixResponse = await withTimeout(
      client.session.prompt({
        path: { id: execution.coderSessionId },
        body: {
          agent: "coder",
          parts: [{ type: "text" as const, text: fixPrompt }],
        },
      }),
      timeoutMs,
      `${subtask.title} (修复 ${round}/${maxFixLoops})`,
    )
    const fixResult = extractText(fixResponse.data?.parts ?? [])

    // Re-prompt Tester to re-verify (same session — knows previous context)
    client.tui.showToast({
      body: {
        message: `🧪 Tester: 重新验证 (第 ${round} 轮)...`,
        variant: "info",
      },
    })

    const reVerifyPrompt = `Coder 已修复问题，请重新验证。

## Coder 的修复报告
${fixResult}

请重新运行测试和验证。
**重要**: 请输出严格的 JSON 格式结果，不要输出其他内容。`

    const reVerifyResponse = await withTimeout(
      client.session.prompt({
        path: { id: execution.testerSessionId },
        body: {
          agent: "tester",
          parts: [{ type: "text" as const, text: reVerifyPrompt }],
        },
      }),
      timeoutMs,
      `${subtask.title} (验证 ${round}/${maxFixLoops})`,
    )
    const reVerifyResult = extractText(reVerifyResponse.data?.parts ?? [])

    const reParsedResult = parseTesterResult(reVerifyResult)
    const fixPassed = reParsedResult?.passed ?? reVerifyResult.includes("✅")
    execution.fixAttempts.push({
      round,
      coderResult: fixResult,
      testerResult: reVerifyResult,
      passed: fixPassed,
    })

    if (fixPassed) {
      execution.status = "completed"
      execution.result = fixResult
      execution.completedAt = Date.now()
      client.tui.showToast({
        body: {
          message: `✅ 完成 (第 ${round} 轮修复后): "${subtask.title}"`,
          variant: "success",
        },
      })
      return execution
    }
  }

  // All fix rounds exhausted
  execution.status = "failed"
  execution.error = `经过 ${maxFixLoops} 轮修复仍未通过验证`
  execution.completedAt = Date.now()

  client.tui.showToast({
    body: {
      message: `❌ 失败: "${subtask.title}" (${maxFixLoops} 轮修复均未通过)`,
      variant: "error",
    },
  })

  return execution
}

/**
 * Sort subtasks into waves and execute each wave in parallel.
 * Shows toast progress per wave.
 */
export async function dispatchAll(
  client: OpencodeClient,
  task: Task,
  maxFixLoops: number,
  sessionContext?: { parentSessionId?: string; directory?: string },
  config?: CommanderConfig,
): Promise<Execution[]> {
  // Warn once if config is missing (sensitive checks may be disabled)
  if (!config) {
    client.tui.showToast({
      body: {
        message: `⚠️ 配置未传递，敏感词检查已禁用`,
        variant: "warning",
      },
    })
  }

  const plan = task.plan
  if (!plan) {
    throw new Error("Cannot dispatch without a plan")
  }

  const waves = topologicalSort(plan.subtasks)
  const allExecutions: Execution[] = []
  const totalSubtasks = plan.subtasks.length
  let completedCount = 0

  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    const wave = waves[waveIdx]
    const waveLabel = `Wave ${waveIdx + 1}/${waves.length}`

    // Toast: wave start
    const waveTitles = wave.map((st) => st.title).join("、")
    client.tui.showToast({
      body: {
        message: `📡 ${waveLabel} 开始: ${waveTitles} (${completedCount}/${totalSubtasks} 已完成)`,
        variant: "info",
      },
    })

    const settled = await Promise.allSettled(
      wave.map((subtask) => executeSubtask(client, task, subtask, maxFixLoops, sessionContext, config)),
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

    // Count results for this wave
    const waveCompleted = waveResults.filter((e) => e.status === "completed").length
    const waveFailed = waveResults.filter((e) => e.status === "failed").length
    completedCount += waveResults.length

    // Toast: wave complete
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
