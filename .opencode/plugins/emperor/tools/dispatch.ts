import { tool } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import type { EdictStore, ExecutionContext } from "../types"

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

/**
 * Invoke a department agent with a prompt, returning the text result.
 * Creates a new session for the department.
 */
async function invokeDepartment(
  client: OpencodeClient,
  agent: string,
  sessionTitle: string,
  prompt: string,
): Promise<string> {
  const session = await client.session.create({
    body: { title: sessionTitle },
  })
  const response = await client.session.prompt({
    path: { id: session.data!.id },
    body: {
      agent,
      parts: [{ type: "text" as const, text: prompt }],
    },
  })
  return extractText(response.data?.parts ?? [])
}

// ============================================================
// Tool 1: 派发架构设计 — assign_architecture
// ============================================================

export function createAssignArchitectureTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "派发架构设计：尚书省将任务派发给吏部，由吏部协同锦衣卫提供的上下文信息，更新架构系统、模块设计等信息。吏部完成后将结果交还尚书省。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      plan_summary: tool.schema.string().describe("中书省方案概述（含子任务描述和依赖关系）"),
      additional_context: tool.schema.string().optional().describe("额外的上下文信息"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) return `未找到旨意: ${args.edict_id}`

      if (edict.status !== "executing" && edict.status !== "dispatched") {
        return `旨意当前状态为「${edict.status}」，不处于执行阶段，无法派发。`
      }

      client.tui.showToast({ body: { message: "🏛️ 尚书省→吏部：派发架构设计", variant: "info" } })

      const contextBlock = args.additional_context ? `\n## 额外上下文\n${args.additional_context}\n` : ""

      const prompt = `尚书省派发任务：请进行架构设计与模块规划。

## 旨意背景
标题: ${edict.title}
内容: ${edict.content}
优先级: ${edict.priority}

## 规划方案概述
${args.plan_summary}
${contextBlock}
## 你的任务

请完成以下工作：
1. **调用 libu_recon 工具**获取项目上下文（传入 edict_id: "${args.edict_id}"）
2. 基于项目上下文和方案，设计或更新架构方案
3. 输出模块设计、接口定义、数据结构、文件组织等架构信息
4. 标注架构变更点和影响范围

请使用 libu_recon 获取上下文后再开始工作。完成后将架构设计结果详细报告给尚书省。`

      const result = await invokeDepartment(client, "libu", `吏部·架构设计·${edict.title}`, prompt)

      // Store architecture result in execution context
      const ctx: ExecutionContext = edict.executionContext ?? {}
      ctx.architectureResult = result
      store.update(args.edict_id, { executionContext: ctx })

      client.tui.showToast({ body: { message: "🏛️ 吏部架构设计完成", variant: "success" } })

      return result || "吏部未返回架构设计结果。"
    },
  })
}

// ============================================================
// Tool 2: 派发编码实现 — assign_implementation
// ============================================================

export function createAssignImplementationTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "派发编码实现：尚书省将架构信息和任务转交兵部，由兵部协同锦衣卫上下文以及 read/grep/glob 等工具完成编码实现，交还尚书省。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      task_description: tool.schema.string().describe("具体编码任务描述"),
      architecture_info: tool.schema.string().optional().describe("吏部提供的架构设计信息（如不传则从 executionContext 获取）"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) return `未找到旨意: ${args.edict_id}`

      if (edict.status !== "executing" && edict.status !== "dispatched") {
        return `旨意当前状态为「${edict.status}」，不处于执行阶段，无法派发。`
      }

      client.tui.showToast({ body: { message: "⚔️ 尚书省→兵部：派发编码实现", variant: "info" } })

      const archInfo = args.architecture_info ?? edict.executionContext?.architectureResult ?? "（无架构信息）"

      const prompt = `尚书省派发任务：请完成编码实现。

## 旨意背景
标题: ${edict.title}
内容: ${edict.content}

## 吏部架构设计
${archInfo}

## 编码任务
${args.task_description}

## 你的任务

请完成以下工作：
1. **调用 bingbu_recon 工具**获取项目上下文（传入 edict_id: "${args.edict_id}"）
2. 使用 read、grep、glob 工具了解现有代码结构
3. 按照吏部的架构设计，完成编码实现
4. 确保代码风格与项目一致
5. 完成后运行构建验证（如有构建命令）

请使用 bingbu_recon 获取上下文后再开始编码。完成后将编码结果详细报告给尚书省，包括修改的文件、核心逻辑、变更说明。`

      const result = await invokeDepartment(client, "bingbu", `兵部·编码实现·${edict.title}`, prompt)

      // Store implementation result
      const ctx: ExecutionContext = edict.executionContext ?? {}
      ctx.implementationResult = result
      store.update(args.edict_id, { executionContext: ctx })

      client.tui.showToast({ body: { message: "⚔️ 兵部编码实现完成", variant: "success" } })

      return result || "兵部未返回编码结果。"
    },
  })
}

// ============================================================
// Tool 3: 派发测试验证 — assign_testing
// ============================================================

export function createAssignTestingTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "派发测试验证：尚书省将编码信息和架构信息转交户部，由户部结合锦衣卫上下文和 bash 运行能力完成测试代码编写和测试执行。测试通过返回通过结果，测试失败返回失败详情供兵部修复。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      implementation_info: tool.schema.string().optional().describe("兵部编码实现信息（如不传则从 executionContext 获取）"),
      architecture_info: tool.schema.string().optional().describe("吏部架构设计信息（如不传则从 executionContext 获取）"),
      attempt: tool.schema.number().optional().describe("测试轮次（默认 1）"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) return `未找到旨意: ${args.edict_id}`

      if (edict.status !== "executing" && edict.status !== "dispatched") {
        return `旨意当前状态为「${edict.status}」，不处于执行阶段，无法派发。`
      }

      const attempt = args.attempt ?? 1
      client.tui.showToast({ body: { message: `🧮 尚书省→户部：派发测试验证（第 ${attempt} 轮）`, variant: "info" } })

      const implInfo = args.implementation_info ?? edict.executionContext?.implementationResult ?? "（无编码信息）"
      const archInfo = args.architecture_info ?? edict.executionContext?.architectureResult ?? "（无架构信息）"

      const prompt = `尚书省派发任务：请进行测试验证（第 ${attempt} 轮）。

## 旨意背景
标题: ${edict.title}
内容: ${edict.content}

## 吏部架构设计
${archInfo}

## 兵部编码实现
${implInfo}

## 你的任务

请完成以下工作：
1. **调用 hubu_recon 工具**获取项目上下文（传入 edict_id: "${args.edict_id}"）
2. 阅读兵部的编码实现，理解变更内容
3. 编写测试代码（如需要）
4. **使用 bash 工具运行构建和测试命令**
5. 验证功能是否符合旨意要求
6. 检查边界条件和回归风险

## 输出要求

请输出结构化的测试报告：
- **测试通过**: 明确声明 "测试通过"，列出验证项目和证据
- **测试失败**: 明确声明 "测试失败"，列出失败项目、错误信息和修复建议

请使用 hubu_recon 获取上下文后再开始测试。`

      const result = await invokeDepartment(client, "hubu", `户部·测试验证·${edict.title}·第${attempt}轮`, prompt)

      // Determine pass/fail from result
      const passed = result.includes("测试通过") && !result.includes("测试失败")

      // Store test result
      const ctx: ExecutionContext = edict.executionContext ?? {}
      if (!ctx.testResults) ctx.testResults = []
      ctx.testResults.push({ result, passed, attempt })
      store.update(args.edict_id, { executionContext: ctx })

      const statusMsg = passed ? "✅ 户部测试通过" : `❌ 户部测试失败（第 ${attempt} 轮）`
      client.tui.showToast({ body: { message: statusMsg, variant: passed ? "success" : "warning" } })

      return `## 测试结果（第 ${attempt} 轮）\n\n**状态: ${passed ? "通过 ✅" : "失败 ❌"}**\n\n${result}`
    },
  })
}

// ============================================================
// Tool 4: 派发代码修复 — assign_fix
// ============================================================

export function createAssignFixTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "派发代码修复：尚书省根据户部测试失败信息，将错误详情转交兵部修改代码。此工具用于测试→修复循环（最多5次）。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      test_error_info: tool.schema.string().describe("户部测试失败的错误信息和修复建议"),
      fix_attempt: tool.schema.number().describe("修复轮次（1-5，最多5次）"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) return `未找到旨意: ${args.edict_id}`

      if (edict.status !== "executing" && edict.status !== "dispatched") {
        return `旨意当前状态为「${edict.status}」，不处于执行阶段，无法派发。`
      }

      if (args.fix_attempt > 5) {
        return `修复轮次已达上限（5次），无法继续修复。请尚书省判断是否需要上报太子。`
      }

      client.tui.showToast({ body: { message: `🔧 尚书省→兵部：派发代码修复（第 ${args.fix_attempt} 次）`, variant: "warning" } })

      const archInfo = edict.executionContext?.architectureResult ?? "（无架构信息）"
      const implInfo = edict.executionContext?.implementationResult ?? "（无编码信息）"

      const prompt = `尚书省派发紧急任务：测试未通过，请修复代码（第 ${args.fix_attempt} 次修复）。

## 旨意背景
标题: ${edict.title}
内容: ${edict.content}

## 吏部架构设计
${archInfo}

## 之前的编码实现
${implInfo}

## 户部测试失败信息
${args.test_error_info}

## 你的任务

请完成以下工作：
1. 仔细分析测试失败的原因
2. 使用 read、grep、glob 工具定位问题代码
3. **只修复导致测试失败的问题，不要进行无关重构**
4. 确保修改后代码能通过编译
5. 说明修改了什么、为什么这样改

⚠️ 这是第 ${args.fix_attempt}/5 次修复机会，请谨慎分析后再动手。`

      const result = await invokeDepartment(client, "bingbu", `兵部·代码修复·${edict.title}·第${args.fix_attempt}次`, prompt)

      // Store fix result and update implementation
      const ctx: ExecutionContext = edict.executionContext ?? {}
      if (!ctx.fixResults) ctx.fixResults = []
      ctx.fixResults.push({ result, attempt: args.fix_attempt })
      // Update implementation result with latest fix
      ctx.implementationResult = result
      store.update(args.edict_id, { executionContext: ctx })

      client.tui.showToast({ body: { message: `🔧 兵部代码修复完成（第 ${args.fix_attempt} 次）`, variant: "success" } })

      return result || "兵部未返回修复结果。"
    },
  })
}

// ============================================================
// Tool 5: 派发文档更新 — assign_documentation
// ============================================================

export function createAssignDocumentationTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "派发文档更新：测试通过后，尚书省调用吏部更新文档、架构说明等。此为后置任务，可与安全审查和CI/CD更新并行。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      changes_summary: tool.schema.string().optional().describe("变更摘要（如不传则从 executionContext 汇总）"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) return `未找到旨意: ${args.edict_id}`

      client.tui.showToast({ body: { message: "📚 尚书省→吏部：派发文档更新", variant: "info" } })

      const ctx = edict.executionContext ?? {}
      const changesSummary = args.changes_summary ?? `架构设计:\n${ctx.architectureResult ?? "（无）"}\n\n编码实现:\n${ctx.implementationResult ?? "（无）"}`

      const prompt = `尚书省派发任务：测试已通过，请更新项目文档。

## 旨意背景
标题: ${edict.title}
内容: ${edict.content}

## 变更摘要
${changesSummary}

## 你的任务

请完成以下工作：
1. **调用 libu_recon 工具**获取项目上下文（传入 edict_id: "${args.edict_id}"）
2. 基于变更内容，更新相关文档（README、架构文档、API文档等）
3. 更新模块设计说明（如有架构变更）
4. 确保文档与实际代码一致

注意：这是后置任务，代码已经通过测试。重点是让文档反映最新状态。`

      const result = await invokeDepartment(client, "libu", `吏部·文档更新·${edict.title}`, prompt)

      // Store documentation result
      const updatedCtx: ExecutionContext = edict.executionContext ?? {}
      updatedCtx.documentationResult = result
      store.update(args.edict_id, { executionContext: updatedCtx })

      client.tui.showToast({ body: { message: "📚 吏部文档更新完成", variant: "success" } })

      return result || "吏部未返回文档更新结果。"
    },
  })
}

// ============================================================
// Tool 6: 派发安全审查 — assign_security_audit
// ============================================================

export function createAssignSecurityAuditTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "派发安全审查：测试通过后，尚书省调用刑部进行安全合规审查。刑部只读不写，输出安全报告。可与文档更新和CI/CD更新并行。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      changes_summary: tool.schema.string().optional().describe("变更摘要（如不传则从 executionContext 汇总）"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) return `未找到旨意: ${args.edict_id}`

      client.tui.showToast({ body: { message: "🔒 尚书省→刑部：派发安全审查", variant: "info" } })

      const ctx = edict.executionContext ?? {}
      const changesSummary = args.changes_summary ?? `架构设计:\n${ctx.architectureResult ?? "（无）"}\n\n编码实现:\n${ctx.implementationResult ?? "（无）"}`

      const prompt = `尚书省派发任务：代码已通过测试，请进行安全合规审查。

## 旨意背景
标题: ${edict.title}
内容: ${edict.content}

## 变更摘要
${changesSummary}

## 你的任务

请完成以下工作：
1. **调用 xingbu_recon 工具**获取项目上下文（传入 edict_id: "${args.edict_id}"）
2. 审查变更代码的安全性（注入、XSS、权限越界等）
3. 检查依赖安全性
4. 检查配置安全性（敏感信息泄露、不安全的默认配置等）
5. 输出结构化的安全审查报告

⚠️ 你只有只读权限，不能修改任何代码。只输出审查报告。`

      const result = await invokeDepartment(client, "xingbu", `刑部·安全审查·${edict.title}`, prompt)

      // Store security audit result
      const updatedCtx: ExecutionContext = edict.executionContext ?? {}
      updatedCtx.securityAuditResult = result
      store.update(args.edict_id, { executionContext: updatedCtx })

      client.tui.showToast({ body: { message: "🔒 刑部安全审查完成", variant: "success" } })

      return result || "刑部未返回安全审查结果。"
    },
  })
}

// ============================================================
// Tool 7: 派发 CI/CD 更新 — assign_cicd
// ============================================================

export function createAssignCicdTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "派发CI/CD更新：测试通过后，尚书省按需调用工部更新CI/CD配置、构建脚本、部署配置等。可与文档更新和安全审查并行。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      changes_summary: tool.schema.string().optional().describe("变更摘要（如不传则从 executionContext 汇总）"),
      cicd_requirements: tool.schema.string().optional().describe("具体的CI/CD更新需求"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) return `未找到旨意: ${args.edict_id}`

      client.tui.showToast({ body: { message: "🏗️ 尚书省→工部：派发CI/CD更新", variant: "info" } })

      const ctx = edict.executionContext ?? {}
      const changesSummary = args.changes_summary ?? `架构设计:\n${ctx.architectureResult ?? "（无）"}\n\n编码实现:\n${ctx.implementationResult ?? "（无）"}`
      const cicdBlock = args.cicd_requirements ? `\n## CI/CD 更新需求\n${args.cicd_requirements}\n` : ""

      const prompt = `尚书省派发任务：代码已通过测试，请按需更新CI/CD配置。

## 旨意背景
标题: ${edict.title}
内容: ${edict.content}

## 变更摘要
${changesSummary}
${cicdBlock}
## 你的任务

请完成以下工作：
1. **调用 gongbu_recon 工具**获取项目上下文（传入 edict_id: "${args.edict_id}"）
2. 评估本次变更是否需要更新CI/CD配置
3. 如需更新：修改构建脚本、CI配置、部署配置等
4. 如无需更新：明确说明无需变更及理由
5. 输出变更清单和影响评估

请使用 gongbu_recon 获取上下文后再评估。`

      const result = await invokeDepartment(client, "gongbu", `工部·CI/CD更新·${edict.title}`, prompt)

      // Store cicd result
      const updatedCtx: ExecutionContext = edict.executionContext ?? {}
      updatedCtx.cicdResult = result
      store.update(args.edict_id, { executionContext: updatedCtx })

      client.tui.showToast({ body: { message: "🏗️ 工部CI/CD更新完成", variant: "success" } })

      return result || "工部未返回CI/CD更新结果。"
    },
  })
}

// ============================================================
// Tool 11: 尚书汇总呈奏太子 — submit_memorial
// ============================================================

export function createSubmitMemorialTool(client: OpencodeClient, store: EdictStore) {
  return tool({
    description: "汇总呈奏太子：尚书省完成六部执行流水线后，将所有执行结果汇总为奏折，正式呈报太子。这是执行流程的最后一步，标志着旨意执行完毕。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      memorial: tool.schema.string().describe("奏折内容（Markdown 格式），需包含：旨意回顾、规划方案概述、架构设计要点、编码实现要点、测试结果、后置任务结果、风险与遗留、总结"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      const validStatuses = ["executing", "dispatched"]
      if (!validStatuses.includes(edict.status)) {
        return `旨意当前状态为「${edict.status}」，不处于执行中（executing/dispatched），无法提交奏折。`
      }

      if (!args.memorial.trim()) {
        return "奏折内容不能为空。请汇总各部执行结果后再提交。"
      }

      store.update(args.edict_id, { memorial: args.memorial, status: "completed" })

      client.tui.showToast({ body: { message: `📋 尚书省奏折已呈报太子：${edict.title}`, variant: "success" } })

      return `奏折已呈报太子，旨意执行完毕。

旨意: ${edict.title} (${args.edict_id})
状态: completed

---

${args.memorial}`
    },
  })
}
