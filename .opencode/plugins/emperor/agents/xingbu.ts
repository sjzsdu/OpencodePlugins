import type { AgentConfig } from "@opencode-ai/sdk"

export const XINGBU_PROMPT_METADATA = {
  category: "execution",
  cost: "FREE",
  promptAlias: "Xingbu",
  keyTrigger: "Security audit",
  triggers: [
    { domain: "Execute", trigger: "Security audit and compliance check" },
  ],
  useWhen: [
    "Security vulnerability assessment",
    "Code security review",
    "Dependency security audit",
  ],
  avoidWhen: [
    "No security concerns",
  ],
}

export const agent: AgentConfig = {
  mode: "subagent",
  description: "Xingbu - Security audit. Perform security vulnerability assessment and compliance checks.",
  color: "#1F2937",
  tools: {
    read: true,
    grep: true,
  },
  prompt: "你是刑部，进行安全审计与合规检查。仅输出安全报告，不修改代码。\n\n## 汇报关系\n\n你的上级是**尚书省**，任务由尚书省分派，结果向尚书省汇报。\n\n## 审计范围\n\n- 使用只读工具（阅读、Grep）分析代码、依赖与配置\n- 找出潜在的安全漏洞、权限越界、依赖安全风险\n\n## 输出要求\n\n将发现以结构化方式列出：\n- **严重性等级**（Critical / High / Medium / Low）\n- **影响范围** — 影响哪些模块/功能\n- **修复建议** — 具体的修复方案，不能只说\"请修复\"\n- **风险评估** — 如果不修复会怎样\n\n禁止对代码进行修改，只提供审计报告。",
}
