import type { AgentConfig } from "sjz-opencode-sdk"

// --- State Machine ---

export type TaskStatus =
  | "received"    // Task created
  | "analyzing"   // Lead exploring codebase
  | "planning"    // Lead creating plan
  | "executing"   // Coder(s) working
  | "verifying"   // Tester running
  | "fixing"      // Coder fixing after test failure
  | "reviewing"   // Reviewer auditing (complex only)
  | "completed"   // Done
  | "failed"      // Unrecoverable error
  | "halted"      // User stopped

// Pipeline tracking types
export type PipelinePhase = "analyzing" | "planning" | "executing" | "verifying" | "reviewing" | "completed"

export interface PipelineSession {
  sessionId: string
  phase: PipelinePhase
  agent: string
  title: string
  createdAt: number
}

export type Complexity = "trivial" | "simple" | "standard" | "complex"

// --- Task and Plan ---

export interface Task {
  id: string
  title: string
  content: string
  priority: "high" | "normal" | "low"
  status: TaskStatus
  complexity?: Complexity
  plan?: Plan
  executions: Execution[]
  report?: string
  sessions?: PipelineSession[]
  createdAt: number
  updatedAt: number
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
  dependencies: number[]
  effort: "low" | "medium" | "high"
}

// --- Execution ---

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

// --- Store ---

export interface TaskStore {
  create(input: Omit<Task, "id" | "createdAt" | "updatedAt" | "executions">): Task
  get(id: string): Task | undefined
  update(id: string, patch: Partial<Task>): Task
  list(filter?: { status?: TaskStatus }): Task[]
  save(): void
}

// --- Config ---

export interface CommanderUserConfig {
  agents?: Record<string, { model?: string }>
  pipeline?: Partial<CommanderConfig["pipeline"]>
  store?: Partial<CommanderConfig["store"]>
}

export interface CommanderConfig {
  agents: Record<string, AgentConfig>
  pipeline: {
    maxFixLoops: number
    enableReviewer: boolean
    sensitivePatterns: string[]
  }
  store: {
    dataDir: string
  }
}
