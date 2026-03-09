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

/** The 7 concern-area facets that 锦衣卫 produces */
export type ReconFacetId = "architecture" | "techstack" | "api-surface" | "testing" | "security" | "cicd" | "conventions"

/** Manifest stored alongside facet files — tracks cache freshness */
export interface ReconManifest {
  /** Git commit hash of the last scan */
  gitHash: string
  /** Timestamp of the last full scan */
  lastFullScanAt: number
  /** Number of incremental updates since last full scan (resets to 0 on full scan) */
  incrementalCount: number
  /** Per-facet metadata */
  facets: Partial<Record<ReconFacetId, { updatedAt: number; size: number }>>
}

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
  executionContext?: ExecutionContext
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
  retryCount: number
  startedAt?: number
  completedAt?: number
}

/** Tracks inter-department handoff state during 尚书省→六部 execution pipeline */
export interface ExecutionContext {
  /** 吏部 architecture/module design result */
  architectureResult?: string
  /** 兵部 implementation result */
  implementationResult?: string
  /** 户部 test results with pass/fail per attempt */
  testResults?: Array<{ result: string; passed: boolean; attempt: number }>
  /** 兵部 fix results per attempt */
  fixResults?: Array<{ result: string; attempt: number }>
  /** 吏部 documentation update result (post-pass) */
  documentationResult?: string
  /** 刑部 security audit result (post-pass) */
  securityAuditResult?: string
  /** 工部 CI/CD update result (post-pass) */
  cicdResult?: string
}

export interface EdictStore {
  create(input: Omit<Edict, "id" | "createdAt" | "updatedAt" | "executions">): Edict
  get(id: string): Edict | undefined
  update(id: string, patch: Partial<Edict>): Edict
  list(filter?: { status?: EdictStatus }): Edict[]
  save(): void
}

/** User-facing configuration (what goes in emperor.json) */
export interface EmperorUserConfig {
  agents?: Record<string, { model?: string }>
  pipeline?: Partial<EmperorConfig['pipeline']>
  recon?: Partial<EmperorConfig['recon']>
  store?: Partial<EmperorConfig['store']>
}

/** Internal full configuration (code defaults + user overrides) */
export interface EmperorConfig {
  agents: Record<string, AgentConfig>
  pipeline: {
    maxReviewAttempts: number
    maxSubtaskRetries: number
    sensitivePatterns: string[]
    mandatoryDepartments: DepartmentId[]
    requirePostVerification: boolean
  }
  recon: {
    enabled: boolean
    cacheDir: string
    /** Full rebuild after N incremental updates (default: 10) */
    maxIncrementalUpdates: number
    /** File patterns that trigger full facet rebuild when changed (not incremental patch) */
    forceRebuildPatterns: string[]
  }
  store: {
    dataDir: string
  }
}
