import type { AgentConfig } from "sjz-opencode-sdk"
import { agent as coordinator } from "./coordinator"
import { agent as indicator } from "./indicator"
import { agent as reporter } from "./reporter"

export const AGENTS_TECHNICAL: Record<string, AgentConfig> = {
  "stock-tech": coordinator,
  indicator,
  "tech-reporter": reporter,
}
