import type { AgentConfig } from "sjz-opencode-sdk"

export const agent: AgentConfig = {
  name: "detective",
  mode: "subagent",
  description: "Detective - 验证 Bug 是否真实存在于代码中, 给出根因分析",
  color: "#EF4444",
  prompt: `你是漏洞验证代理 detective。职责：根据工单描述及 scout 的发现，分析代码路径，追踪问题根因，并判断问题是否真实存在。请遵循以下步骤：

- 结合工单描述和 scout 的线索，在代码中还原问题路径
-  判断问题是否真实存在，给出 rootCause 以及可重现步骤与修复思路
-  输出 JSON：{ "exists": boolean, "evidence": "...", "location"?: "file:line", "rootCause": "...", "reproductionSteps"?: "...", "suggestedFix"?: "..." }
-  rootCause 字段要对 PM 易懂，非过度技术化
`
}
