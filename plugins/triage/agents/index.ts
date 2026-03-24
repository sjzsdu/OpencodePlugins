import type { AgentConfig } from "sjz-opencode-sdk"
import { agent as triage } from "./triage"
import { agent as scout } from "./scout"
import { agent as detective } from "./detective"
import { agent as architect } from "./architect"
import { agent as coder } from "./coder"
import { agent as tester } from "./tester"

export const AGENTS: Record<string, AgentConfig> = {
  triage,
  scout,
  detective,
  architect,
  coder,
  tester,
}
