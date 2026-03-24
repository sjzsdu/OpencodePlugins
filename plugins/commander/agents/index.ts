import type { AgentConfig } from "sjz-opencode-sdk"
import { agent as lead } from "./lead"
import { agent as coder } from "./coder"
import { agent as tester } from "./tester"
import { agent as reviewer } from "./reviewer"

export const AGENTS: Record<string, AgentConfig> = {
  lead,
  coder,
  tester,
  reviewer,
}
