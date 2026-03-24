import type { AgentConfig } from "sjz-opencode-sdk"

export type TicketType = "bug" | "feature"

export interface TicketInfo {
  key: string
  type: string
  summary: string
  description: string
  status: string
  priority: string
  assignee?: string
  reporter?: string
  labels: string[]
  components: string[]
  rawOutput: string
}

export interface TriageResult {
  ticketType: TicketType
  confidence: number
  reasoning: string
  keyInfo: {
    errorMessage?: string
    stepsToReproduce?: string
    expectedBehavior?: string
    acceptanceCriteria?: string
    scope?: string
  }
}

export interface ScoutResult {
  relevantFiles: string[]
  architectureSummary: string
  codePatterns: string
  techStack: string
  rawAnalysis: string
}

export interface DetectiveResult {
  exists: boolean
  evidence: string
  location?: string
  rootCause: string
  reproductionSteps?: string
  suggestedFix?: string
}

export interface ArchitectResult {
  analysis: string
  plan: Plan
  ticketScale: string
  styleNotes: string
  rootCause: string
}

export interface Plan {
  analysis: string
  subtasks: Subtask[]
  risks: string[]
}

export interface Subtask {
  index: number
  title: string
  description: string
  files: string[]
  dependencies: number[]
  effort: "low" | "medium" | "high"
}

export interface Execution {
  subtaskIndex: number
  coderSessionId: string
  testerSessionId: string
  status: "running" | "completed" | "failed"
  fixAttempts: FixAttempt[]
  result?: string
  error?: string
  startedAt: number
  completedAt?: number
}

export interface FixAttempt {
  round: number
  coderResult: string
  testerResult: string
  passed: boolean
}

export type TriageStatus =
  | "received"
  | "fetching"
  | "triaging"
  | "scouting"
  | "investigating"
  | "designing"
  | "awaiting"
  | "implementing"
  | "verifying"
  | "fixing"
  | "updating_jira"
  | "completed"
  | "not_found"
  | "failed"
  | "halted"

export type PipelinePhase =
  | "fetching"
  | "triaging"
  | "scouting"
  | "investigating"
  | "designing"
  | "implementing"
  | "verifying"
  | "updating_jira"
  | "completed"

export interface PipelineSession {
  sessionId: string
  phase: PipelinePhase
  agent: string
  title: string
  createdAt: number
}

export interface TriageTask {
  id: string
  ticketKey: string
  ticket?: TicketInfo
  triageResult?: TriageResult
  scoutResult?: ScoutResult
  detectiveResult?: DetectiveResult
  architectResult?: ArchitectResult
  status: TriageStatus
  executions: Execution[]
  report?: string
  sessions: PipelineSession[]
  jiraUpdated: boolean
  createdAt: number
  updatedAt: number
}

export interface TriageStore {
  create(ticketKey: string): TriageTask
  get(id: string): TriageTask | undefined
  getByTicketKey(ticketKey: string): TriageTask | undefined
  update(id: string, patch: Partial<TriageTask>): TriageTask
  list(filter?: { status?: TriageStatus }): TriageTask[]
  save(): void
}

export interface TriageUserConfig {
  agents?: Record<string, { model?: string }>
  pipeline?: Partial<TriageConfig["pipeline"]>
  store?: Partial<TriageConfig["store"]>
  jira?: Partial<TriageConfig["jira"]>
}

export interface TriageConfig {
  agents: Record<string, AgentConfig>
  pipeline: {
    maxFixLoops: number
  }
  store: {
    dataDir: string
  }
  jira: {
    scaleField: string
    rootCauseField: string
    autoTransition: boolean
  }
}
