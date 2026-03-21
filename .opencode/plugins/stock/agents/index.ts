import type { AgentConfig } from "@opencode-ai/sdk"
import { agent as coordinator } from "./coordinator"
import { agent as fundamentalist } from "./fundamentalist"
import { agent as technician } from "./technician"
import { agent as industry } from "./industry"
import { agent as sentiment } from "./sentiment"
import { agent as chip } from "./chip"

export const AGENTS: Record<string, AgentConfig> = {
  "stock-coordinator": coordinator,
  "stock-fundamentalist": fundamentalist,
  "stock-technician": technician,
  "stock-industry": industry,
  "stock-sentiment": sentiment,
  "stock-chip": chip,
}
