import type { AgentConfig } from "@opencode-ai/sdk"
import { agent as taizi } from "./taizi"
import { agent as zhongshu } from "./zhongshu"
import { agent as menxia } from "./menxia"
import { agent as shangshu } from "./shangshu"
import { agent as bingbu } from "./bingbu"
import { agent as gongbu } from "./gongbu"
import { agent as lifebu } from "./lifebu"
import { agent as xingbu } from "./xingbu"
import { agent as hubu } from "./hubu"
import { agent as libu } from "./libu"
import { agent as jinyiwei } from "./jinyiwei"

export const AGENTS: Record<string, AgentConfig> = {
  taizi,
  zhongshu,
  menxia,
  shangshu,
  bingbu,
  gongbu,
  lifebu,
  xingbu,
  hubu,
  libu,
  jinyiwei,
}
