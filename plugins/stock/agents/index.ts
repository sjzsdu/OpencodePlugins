import type { AgentConfig } from "sjz-opencode-sdk"
import { agent as coordinator } from "./coordinator"
import { agent as fundamentalist } from "./fundamentalist"
import { agent as technician } from "./technician"
import { agent as industry } from "./industry"
import { agent as sentiment } from "./sentiment"
import { agent as chip } from "./chip"
import { agent as reporter } from "./report-generator"

export const AGENTS: Record<string, AgentConfig> = {
  stock: coordinator,
  finance: fundamentalist,
  chart: technician,
  sector: industry,
  sentiment,
  flow: chip,
  reporter,
}
