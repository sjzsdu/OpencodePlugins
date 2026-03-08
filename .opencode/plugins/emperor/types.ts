import type { AgentConfig } from "@opencode-ai/sdk"

/** Status union type — the state machine */
export type EdictStatus =
  | "received"       // 太子分拣完毕，进入流程
  | "reconnaissance" // 锦衣卫侦察中
  | "planning"       // 中书省规划中
  | "reviewing"      // 门下省审核中
  | "needs_approval" // 敏感操作，等待用户确认
  | "denied"         // 用户拒绝
  | "rejected"       // 门下省封驳
  | "dispatched"     // 尚书省已派发
  | "executing"      // 六部执行中
  | "completed"      // 全部完成
  | "failed"         // 执行失败
  | "halted"         // 用户叫停

export type DepartmentId = "bingbu" | "gongbu" | "lifebu" | "xingbu" | "hubu" | "libu"

export interface Edict {
  id: string
  title: string
  content: string
  priority: "urgent" | "normal" | "low"
  status: EdictStatus
  createdAt: number
  updatedAt: number
  plan?: Plan
  review?: Review
  executions: Execution[]
  memorial?: string
  projectContext?: string
}

export interface Plan {
  analysis: string
  subtasks: Subtask[]
  risks: string[]
  attempt: number
}

export interface Subtask {
  index: number
  department: DepartmentId
  title: string
  description: string
  dependencies: number[]
  effort: "low" | "medium" | "high"
}

export interface Review {
  verdict: "approve" | "reject"
  reasons: string[]
  suggestions: string[]
  sensitiveOps: string[]
}

export interface Execution {
  department: DepartmentId
  subtaskIndex: number
  sessionId: string
  status: "pending" | "running" | "completed" | "failed"
  result?: string
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface EdictStore {
  create(input: Omit<Edict, "id" | "createdAt" | "updatedAt" | "executions">): Edict
  get(id: string): Edict | undefined
  update(id: string, patch: Partial<Edict>): Edict
  list(filter?: { status?: EdictStatus }): Edict[]
  save(): void
}

/** Emperor plugin configuration shape (stored in .opencode/emperor.json) */
export interface EmperorConfig {
  agents: Record<string, AgentConfig>
  pipeline: {
    maxReviewAttempts: number
    sensitivePatterns: string[]
    mandatoryDepartments: DepartmentId[]
    requirePostVerification: boolean
  }
  recon: {
    enabled: boolean
    cacheDir: string
  }
  store: {
    dataDir: string
  }
}
