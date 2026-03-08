import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import type { DepartmentId, Edict, Plan, Review } from "../types"

const regexCache = new Map<string, RegExp>()

function getRegex(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern)
  if (cached) return cached
  try {
    const regex = new RegExp(pattern, "i")
    regexCache.set(pattern, regex)
    return regex
  } catch {
    return null
  }
}

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

function parseJSON(text: string): unknown {
  // Try direct parse
  try {
    return JSON.parse(text)
  } catch {}
  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1])
    } catch {}
  }
  // Try finding first { to last }
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1))
    } catch {}
  }
  return null
}

function parseReview(text: string): Review {
  const data = parseJSON(text)
  if (!data || typeof data !== "object") {
    throw new Error("门下省输出格式错误：无法解析 JSON")
  }
  const obj = data as Record<string, unknown>
  const verdict = obj.verdict
  if (verdict !== "approve" && verdict !== "reject") {
    throw new Error(`门下省输出格式错误：verdict 必须为 "approve" 或 "reject"，实际为 "${String(verdict)}"`)
  }
  return {
    verdict,
    reasons: Array.isArray(obj.reasons) ? (obj.reasons as string[]) : [],
    suggestions: Array.isArray(obj.suggestions) ? (obj.suggestions as string[]) : [],
    sensitiveOps: Array.isArray(obj.sensitiveOps) ? (obj.sensitiveOps as string[]) : [],
  }
}

const DEPT_DISPLAY: Record<string, string> = {
  bingbu: "兵部",
  gongbu: "工部",
  lifebu: "礼部",
  xingbu: "刑部",
  hubu: "户部",
  libu: "吏部",
}

/** Check if plan includes all mandatory departments */
export function checkMandatoryDepartments(
  plan: Plan,
  mandatoryDepartments: DepartmentId[],
): string[] {
  if (mandatoryDepartments.length === 0) return []

  const planDepartments = new Set(plan.subtasks.map((s) => s.department))
  const missing: string[] = []

  for (const dept of mandatoryDepartments) {
    if (!planDepartments.has(dept)) {
      const displayName = DEPT_DISPLAY[dept] ?? dept
      missing.push(`规划方案缺少必要部门「${displayName}」（${dept}）的任务——涉及代码改动时，必须包含测试验证环节`)
    }
  }

  return missing
}

/** Scan subtask descriptions for sensitive operation patterns */
export function detectSensitiveOps(plan: Plan, patterns: string[]): string[] {
  const detected: string[] = []
  for (const pattern of patterns) {
    const regex = getRegex(pattern)
    if (!regex) continue
    for (const subtask of plan.subtasks) {
      if (regex.test(subtask.title) || regex.test(subtask.description)) {
        detected.push(`"${subtask.title}" 匹配敏感模式: ${pattern}`)
        break
      }
    }
  }
  return detected
}

/** Send the plan to 门下省 for review, enforcing mandatory departments */
export async function reviewWithMenxia(
  client: OpencodeClient,
  edict: Edict,
  plan: Plan,
  sensitivePatterns: string[],
  mandatoryDepartments: DepartmentId[] = [],
  projectContext?: string,
): Promise<Review> {
  // Pre-check: mandatory department enforcement (code-level, before AI review)
  const missingDepts = checkMandatoryDepartments(plan, mandatoryDepartments)
  if (missingDepts.length > 0) {
    // Auto-reject without even asking menxia — this is a structural violation
    return {
      verdict: "reject",
      reasons: missingDepts,
      suggestions: missingDepts.map((reason) => {
        const match = reason.match(/「(.+?)」（(.+?)）/)
        if (match) {
          return `请为「${match[1]}」（${match[2]}）分配至少一个子任务，确保实现后有验证环节`
        }
        return "请确保所有必要部门都有对应的子任务"
      }),
      sensitiveOps: [],
    }
  }

  // Code-level sensitive ops detection
  const codeSensitiveOps = detectSensitiveOps(plan, sensitivePatterns)

  // Create session for menxia
  const session = await client.session.create({
    body: { title: `门下省·审核·${edict.title}` },
  })
  const sessionId = session.data!.id

  const contextBlock = projectContext
    ? `\n## 项目上下文摘要（锦衣卫侦察报告）\n${projectContext}\n`
    : ""

  const prompt = `请审核以下旨意的规划方案。
${contextBlock}
## 旨意
标题: ${edict.title}
内容: ${edict.content}
优先级: ${edict.priority}

## 中书省规划方案
${JSON.stringify(plan, null, 2)}

## 审核要点提醒
1. **用户体验**：方案是否考虑了最终用户的使用场景？analysis 中是否有用户场景分析？
2. **技术选型**：analysis 中是否说明了技术选型的理由？选型是否以用户体验为导向？
3. **测试覆盖**：方案是否包含户部（hubu）的测试验证任务？
4. **完备性**：所有需求点是否都有对应子任务？
5. **风险识别**：安全、兼容性、性能风险是否被充分识别？
6. **与现有代码的一致性**：方案是否与项目现有架构和规范一致？

请严格按照你的审核标准进行评审，输出符合 Review 接口的 JSON。`

  const response = await client.session.prompt({
    path: { id: sessionId },
    body: {
      agent: "menxia",
      parts: [{ type: "text" as const, text: prompt }],
    },
  })

  const text = extractText(response.data?.parts ?? [])
  const review = parseReview(text)

  // Merge code-detected sensitive ops
  if (codeSensitiveOps.length > 0) {
    review.sensitiveOps = [...new Set([...review.sensitiveOps, ...codeSensitiveOps])]
  }

  return review
}
