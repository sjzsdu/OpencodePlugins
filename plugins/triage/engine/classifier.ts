import { parseJSON } from "../utils"
import type { TicketInfo, TriageResult, ScoutResult, DetectiveResult, ArchitectResult, Plan } from "../types"

function asRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    throw new Error("Expected JSON object")
  }
  return data as Record<string, unknown>
}

function findAllJSON(text: string): unknown[] {
  const results: unknown[] = []
  const fenceRegex = /```(?:json)?\s*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(text)) !== null) {
    try { results.push(JSON.parse(match[1].trim())) } catch {}
  }
  if (results.length > 0) return results

  const objRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g
  while ((match = objRegex.exec(text)) !== null) {
    try { results.push(JSON.parse(match[0])) } catch {}
  }
  return results
}

function buildTriageResult(obj: Record<string, unknown>): TriageResult {
  const ticketType = String(obj.ticketType)
  if (ticketType !== "bug" && ticketType !== "feature") {
    throw new Error(`Triage ticketType 无效: ${ticketType}，应为 "bug" 或 "feature"`)
  }

  const keyInfo = obj.keyInfo && typeof obj.keyInfo === "object" ? obj.keyInfo as Record<string, unknown> : {}

  return {
    ticketType,
    confidence: Number(obj.confidence),
    reasoning: String(obj.reasoning ?? ""),
    keyInfo: {
      errorMessage: keyInfo.errorMessage ? String(keyInfo.errorMessage) : undefined,
      stepsToReproduce: keyInfo.stepsToReproduce ? String(keyInfo.stepsToReproduce) : undefined,
      expectedBehavior: keyInfo.expectedBehavior ? String(keyInfo.expectedBehavior) : undefined,
      acceptanceCriteria: keyInfo.acceptanceCriteria ? String(keyInfo.acceptanceCriteria) : undefined,
      scope: keyInfo.scope ? String(keyInfo.scope) : undefined,
    },
  }
}

function buildTicketInfo(obj: Record<string, unknown>, rawOutput: string): TicketInfo {
  return {
    key: String(obj.key),
    type: String(obj.type ?? ""),
    summary: String(obj.summary ?? ""),
    description: String(obj.description ?? ""),
    status: String(obj.status ?? ""),
    priority: String(obj.priority ?? ""),
    assignee: obj.assignee ? String(obj.assignee) : undefined,
    reporter: obj.reporter ? String(obj.reporter) : undefined,
    labels: Array.isArray(obj.labels) ? obj.labels.map(String) : [],
    components: Array.isArray(obj.components) ? obj.components.map(String) : [],
    rawOutput,
  }
}

export function parseTriageResult(text: string): TriageResult {
  const jsons = findAllJSON(text)
  for (const json of jsons) {
    const obj = asRecord(json)
    if ("ticketType" in obj && "confidence" in obj) {
      return buildTriageResult(obj)
    }
  }

  const data = parseJSON(text)
  if (!data) throw new Error("Triage 输出格式错误：无法解析 JSON")
  const obj = asRecord(data)
  if (!obj.ticketType || !obj.confidence) {
    throw new Error("Triage 输出缺少 ticketType 或 confidence 字段")
  }
  return buildTriageResult(obj)
}

export function parseTicketInfo(text: string): TicketInfo {
  const jsons = findAllJSON(text)
  for (const json of jsons) {
    const obj = asRecord(json)
    if ("key" in obj && "summary" in obj) {
      return buildTicketInfo(obj, text)
    }
  }

  const data = parseJSON(text)
  if (!data) throw new Error("TicketInfo 输出格式错误：无法解析 JSON")
  const obj = asRecord(data)
  if (!obj.key || !obj.summary) {
    throw new Error("TicketInfo 输出缺少 key 或 summary 字段")
  }
  return buildTicketInfo(obj, text)
}

export function parseScoutResult(text: string): ScoutResult {
  const data = parseJSON(text)
  if (!data) throw new Error("Scout 输出格式错误：无法解析 JSON")
  const obj = asRecord(data)

  return {
    relevantFiles: Array.isArray(obj.relevantFiles) ? obj.relevantFiles.map(String) : [],
    architectureSummary: String(obj.architectureSummary ?? ""),
    codePatterns: String(obj.codePatterns ?? ""),
    techStack: String(obj.techStack ?? ""),
    rawAnalysis: String(obj.rawAnalysis ?? text),
  }
}

export function parseDetectiveResult(text: string): DetectiveResult {
  const data = parseJSON(text)
  if (!data) throw new Error("Detective 输出格式错误：无法解析 JSON")
  const obj = asRecord(data)

  if (typeof obj.exists !== "boolean") {
    throw new Error("Detective 结果缺少 exists 字段")
  }

  return {
    exists: obj.exists,
    evidence: String(obj.evidence ?? ""),
    location: obj.location ? String(obj.location) : undefined,
    rootCause: String(obj.rootCause ?? ""),
    reproductionSteps: obj.reproductionSteps ? String(obj.reproductionSteps) : undefined,
    suggestedFix: obj.suggestedFix ? String(obj.suggestedFix) : undefined,
  }
}

export function parseArchitectResult(text: string): ArchitectResult {
  const data = parseJSON(text)
  if (!data) throw new Error("Architect 输出格式错误：无法解析 JSON")
  const obj = asRecord(data)

  if (!obj.plan || typeof obj.plan !== "object") {
    throw new Error("Architect 结果缺少 plan 字段")
  }

  const planObj = asRecord(obj.plan)
  const subtasks = Array.isArray(planObj.subtasks)
    ? planObj.subtasks.map((s: unknown) => {
        const st = asRecord(s)
        return {
          index: Number(st.index ?? 0),
          title: String(st.title ?? ""),
          description: String(st.description ?? ""),
          files: Array.isArray(st.files) ? st.files.map(String) : [],
          dependencies: Array.isArray(st.dependencies) ? st.dependencies.map(Number) : [],
          effort: st.effort === "low" || st.effort === "medium" || st.effort === "high"
            ? (st.effort as "low" | "medium" | "high")
            : "medium",
        }
      })
    : []

  const plan: Plan = {
    analysis: String(planObj.analysis ?? ""),
    subtasks,
    risks: Array.isArray(planObj.risks) ? planObj.risks.map(String) : [],
  }

  return {
    analysis: String(obj.analysis ?? ""),
    plan,
    ticketScale: String(obj.ticketScale ?? "M"),
    styleNotes: String(obj.styleNotes ?? ""),
    rootCause: String(obj.rootCause ?? ""),
  }
}
