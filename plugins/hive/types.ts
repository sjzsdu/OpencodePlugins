// === Domain ===

export interface Domain {
  id: string
  name: string
  description: string
  paths: string[]
  techStack: string
  responsibilities: string
  interfaces: string[]
  dependencies: string[]  // other domain ids
  conventions: string[]
  disabled?: boolean
}

// === Events ===

export type EventType =
  | "requirement_broadcast"
  | "relevance_response"
  | "interface_proposal"
  | "interface_accepted"
  | "interface_rejected"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "file_changed"
  | "breaking_change"
  | "dependency_updated"
  | "action_proposal"
  | "action_completed"
  | "help_request"
  | "conflict_detected"
  | "info"
  | "pipeline_started"
  | "pipeline_phase"
  | "pipeline_completed"
  | "pipeline_failed"

export interface HiveEvent {
  id: string
  type: EventType
  source: string
  target: string  // domain id or "*"
  payload: {
    message: string
    data?: unknown
  }
  timestamp: number
  consumed: string[]
  status: "pending" | "consumed" | "expired"
}

// === Discovery Cache ===

export interface DomainCache {
  structureHash: string
  discoveredAt: number
  source: "static" | "llm" | "user"
  domains: Domain[]
}

// === Config ===

export type AutonomyLevel = "passive" | "propose" | "full"

export interface HiveUserConfig {
  domains?: Record<string, Partial<Domain> & { disabled?: boolean }>
  discovery?: {
    model?: string
    autoRefresh?: boolean
  }
  coordination?: {
    autonomyLevel?: AutonomyLevel
  }
  queen?: {
    model?: string
  }
  store?: {
    dataDir?: string
  }
}

export interface HiveConfig {
  domains: Record<string, Partial<Domain> & { disabled?: boolean }>
  discovery: {
    model?: string
    autoRefresh: boolean
  }
  coordination: {
    autonomyLevel: AutonomyLevel
  }
  queen: {
    model?: string
  }
  store: {
    dataDir: string
  }
}

// === Pipeline (Hive) types ===

// Phases for the new automated Hive pipeline
export type PipelinePhase = "assess" | "filter" | "negotiate" | "dispatch" | "verify" | "complete"

export interface PipelineLog {
  timestamp: number
  phase: PipelinePhase
  message: string
  domain?: string
  detail?: string
}

export interface PipelineSession {
  sessionId: string
  domain: string
  phase: PipelinePhase
  title: string
}

export interface PipelineState {
  id: string
  requirement: string
  status: "running" | "completed" | "failed"
  startedAt: number
  completedAt?: number
  logs: PipelineLog[]
  sessions: PipelineSession[]
  assessments: Array<{ domain: string; relevance: string; analysis: string; workload: string }>
  dispatched: Array<{ domain: string; status: "pending" | "running" | "completed" | "failed"; sessionId?: string; response?: string }>
  verified: Array<{ domain: string; buildPassed: boolean | null; testsPassed: boolean | null; issues: string }>
}

// Structured completion data emitted by domain workers via hive_emit task_completed
export interface StructuredCompletion {
  changedFiles: string[]
  createdFiles: string[]
  testsPassed: boolean | null  // null = not run
  buildPassed: boolean | null
  summary: string
  failureType?: "transient" | "fixable" | "needs_replan" | "escalate"
}
