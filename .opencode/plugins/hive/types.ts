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
