import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import type { DepartmentId, Edict, Execution, Plan, Subtask } from "../types"
import { extractText } from "../utils"

const DEPT_NAMES: Record<DepartmentId, string> = {
  bingbu: "兵部",
  gongbu: "工部",
  lifebu: "礼部",
  xingbu: "刑部",
  hubu: "户部",
  libu: "吏部",
}

// extractText is now shared via ../utils

/**
 * Group subtasks into execution waves based on dependencies (Kahn's algorithm).
 * Wave 0 = no dependencies, Wave N = depends on waves 0..N-1.
 * If cycle detected, remaining subtasks go into a single final wave.
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

/** Execute a single subtask, with optional retry using the same session */
export async function executeSubtask(
  client: OpencodeClient,
  edict: Edict,
  subtask: Subtask,
  maxRetries: number = 0,
  sessionContext?: { parentSessionId?: string; directory?: string },
): Promise<Execution> {
  const deptName = DEPT_NAMES[subtask.department] ?? subtask.department
  const execution: Execution = {
    department: subtask.department,
    subtaskIndex: subtask.index,
    sessionId: "",
    status: "running",
    retryCount: 0,
    startedAt: Date.now(),
  }

  // Create/associate a session for this subtask
  const session = await client.session.create({
    body: { title: `${deptName}·${subtask.title}`, ...(sessionContext?.parentSessionId ? { parentID: sessionContext.parentSessionId } : {}) },
    ...(sessionContext?.directory ? { query: { directory: sessionContext.directory } } : {}),
  })
  execution.sessionId = session.data!.id
  // Track session under edict for pipeline progress
  if (!edict.sessions) edict.sessions = []
  edict.sessions.push({
    sessionId: execution.sessionId,
    phase: "executing" as const,
    department: subtask.department,
    title: `${deptName}·${subtask.title}`,
    createdAt: Date.now(),
  })

  // Toast: department started
  client.tui.showToast({
    body: {
      message: `⚔️ ${deptName} 开始执行: ${subtask.title}`,
      variant: "info",
    },
  })

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let prompt: string
      if (attempt === 0) {
        prompt = `你正在执行一个旨意的子任务。

## 旨意背景
标题: ${edict.title}
内容: ${edict.content}

## 你的任务
**${subtask.title}**

${subtask.description}

工作量评估: ${subtask.effort}

请执行以上任务并详细报告执行结果。`
      } else {
        // Retry prompt — includes previous failure context
        prompt = `上次执行失败，请重新尝试（第 ${attempt + 1} 次）。

## 上次失败原因
${execution.error ?? "未知错误"}

## 原始任务
**${subtask.title}**

${subtask.description}

请分析失败原因，调整方案后重新执行。`
      }

      const response = await client.session.prompt({
        path: { id: execution.sessionId },
        body: {
          agent: subtask.department,
          parts: [{ type: "text" as const, text: prompt }],
        },
      })

      execution.result = extractText(response.data?.parts ?? [])
      execution.status = "completed"
      execution.completedAt = Date.now()
      execution.retryCount = attempt

      // Toast: department completed
      client.tui.showToast({
        body: {
          message: `✅ ${deptName} 完成: ${subtask.title}`,
          variant: "success",
        },
      })

      return execution
    } catch (err) {
      execution.error = err instanceof Error ? err.message : String(err)
      execution.retryCount = attempt

      if (attempt < maxRetries) {
        client.tui.showToast({
          body: {
            message: `⚠️ ${deptName}「${subtask.title}」执行失败，重试中 (${attempt + 1}/${maxRetries})`,
            variant: "warning",
          },
        })
      }
    }
  }

  // All retries exhausted
  execution.status = "failed"
  execution.completedAt = Date.now()

  // Toast: department failed
  client.tui.showToast({
    body: {
      message: `❌ ${deptName} 失败: ${subtask.title}`,
      variant: "error",
    },
  })

  return execution
}

/**
 * Sort subtasks into waves and execute each wave in parallel.
 * Shows toast progress per wave and per department.
 * Failed subtasks are retried up to maxRetries times before being marked failed.
 */
export async function dispatchAndExecute(
  client: OpencodeClient,
  edict: Edict,
  plan: Plan,
  maxRetries: number = 0,
  sessionContext?: { parentSessionId?: string; directory?: string },
): Promise<Execution[]> {
  const waves = topologicalSort(plan.subtasks)
  const allExecutions: Execution[] = []
  const totalSubtasks = plan.subtasks.length
  let completedCount = 0

  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    const wave = waves[waveIdx]
    const waveLabel = `Wave ${waveIdx + 1}/${waves.length}`

    // Toast: wave start
    const waveDepts = wave.map((st) => DEPT_NAMES[st.department] ?? st.department).join("、")
    client.tui.showToast({
      body: {
        message: `📡 ${waveLabel} 开始执行: ${waveDepts} (${completedCount}/${totalSubtasks} 已完成)`,
        variant: "info",
      },
    })

    const settled = await Promise.allSettled(
      wave.map((subtask) => executeSubtask(client, edict, subtask, maxRetries, sessionContext)),
    )
    const waveExecutions: Execution[] = settled.map((result, idx) => {
      if (result.status === "fulfilled") return result.value
      const subtask = wave[idx]
      return {
        department: subtask.department,
        subtaskIndex: subtask.index,
        sessionId: "",
        status: "failed" as const,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        retryCount: 0,
        startedAt: Date.now(),
        completedAt: Date.now(),
      }
    })

    const waveCompleted = waveExecutions.filter((e) => e.status === "completed").length
    const waveFailed = waveExecutions.filter((e) => e.status === "failed").length
    completedCount += waveExecutions.length

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

    allExecutions.push(...waveExecutions)
  }

  return allExecutions
}
