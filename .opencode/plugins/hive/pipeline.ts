import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import type { HiveEventBus } from "./eventbus/bus"
import type { Domain, HiveConfig, PipelineState, PipelineLog, PipelinePhase } from "./types"

// Hive pipeline engine
export class HivePipeline {
  private currentPipeline: PipelineState | null = null

  constructor(
    private eventBus: HiveEventBus,
    private domains: Domain[],
    private client: OpencodeClient,
    private sessionToDomain: Map<string, string>,
    private config: HiveConfig
  ) {}

  getState(): PipelineState | null {
    return this.currentPipeline
  }

  // Helpers
  private log(phase: PipelinePhase, message: string, domain?: string) {
    if (!this.currentPipeline) return
    this.currentPipeline.logs.push({ timestamp: Date.now(), phase, message, domain })
    this.eventBus.publish({
      type: "pipeline_phase",
      source: "queen",
      target: "*",
      payload: { message, data: { phase, domain } },
    })
  }

  private extractText(parts: Part[]): string {
    return parts
      .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n")
  }

  private parseRelevance(text: string): { relevance: string; analysis: string; workload: string } {
    let relevance = "中"
    let analysis = ""
    let workload = ""
    // Try to extract relevance from lines mentioning 相关性 or relevance
    const lines = text.split(/\n/).map((l) => l.trim())
    for (const line of lines) {
      const m = line.match(/相关性[:：]?\s*([高中低无])/i)
      if (m) {
        relevance = m[1]
        break
      }
    }
    const a = text.match(/初步分析[:：]?\s*([\s\S]*?)(?:$|\n)/i)
    if (a && a[1]) analysis = a[1].trim()
    if (!analysis) {
      // fallback: heuristic from lines with  分析 or analysis
      const a2 = lines.find((l) => /分析|analysis/i.test(l))
      if (a2) analysis = a2
    }
    const w = text.match(/预估工作量[:：]?\s*([\s\S]*?)(?:$|\n)/i)
    if (w && w[1]) workload = w[1].trim()
    if (!workload) {
      const w2 = lines.find((l) => /工作量|workload|work load/i.test(l))
      if (w2) workload = w2
    }
    if (!analysis) analysis = text
    if (!workload) workload = "中"
    if (!/^[高中低无]$/.test(relevance)) relevance = "中"
    return { relevance, analysis, workload }
  }

  async run(requirement: string): Promise<string> {
    // initialize pipeline state
    const id = `pipeline-${Date.now()}`
    const startedAt = Date.now()
    this.currentPipeline = {
      id,
      requirement,
      status: "running",
      startedAt,
      logs: [],
      assessments: [],
      dispatched: [],
    }

    // announce start
    this.eventBus.publish({
      type: "pipeline_started",
      source: "queen",
      target: "*",
      payload: { message: `Pipeline started for: ${requirement}` },
    })

    // Phase 1: Assess (parallel)
    this.log("assess", `🔍 开始评估 ${this.domains.length} 个域...`)
    const assessResults = await Promise.allSettled(
      this.domains.map(async (domain) => {
        const session = await this.client.session.create({ body: { title: `Hive·${domain.name}·评估` } })
        const sessionId = session.data!.id
        this.sessionToDomain.set(sessionId, domain.id)
        const prompt = [
          `以下是一个新的需求，请评估是否与你的领域相关，以及你需要做什么：`,
          ``,
          `## 需求`,
          requirement,
          ``,
          `请返回以下格式：`,
          `- **相关性**: 高/中/低/无`,
          `- **初步分析**: 你需要做什么（如果相关）`,
          `- **预估工作量**: 低/中/高`,
          `- **需要协调的Domain**: 如果需要其他Domain配合，列出domain id`,
        ].join("\n")
        const resp = await this.client.session.prompt({
          path: { id: sessionId },
          body: { agent: domain.id, parts: [{ type: "text" as const, text: prompt }] },
        })
        const text = this.extractText(resp.data?.parts ?? [])
        const { relevance, analysis, workload } = this.parseRelevance(text)
        this.currentPipeline!.assessments.push({ domain: domain.id, relevance, analysis, workload })
        this.log("assess", `✅ @${domain.id} 评估完成: ${relevance}相关`, domain.id)
        return { domain: domain.id, relevance, analysis, workload }
      }),
    )
    for (const result of assessResults) {
      if (result.status === "rejected") {
        const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
        this.log("assess", `❌ 某个域评估失败: ${errMsg}`)
      }
    }

    // Phase 2: Filter
    const relevant = this.currentPipeline!.assessments.filter((a) => a.relevance !== "低" && a.relevance !== "无")
    const relevantDomains = relevant.map((r) => r.domain)
    this.log("filter", `筛选出 ${relevantDomains.length} 个相关域: ${relevantDomains.join(", ") || "无"}`)
    if (relevantDomains.length === 0) {
      this.currentPipeline!.status = "completed"
      this.currentPipeline!.completedAt = Date.now()
      this.eventBus.publish({ type: "pipeline_completed", source: "queen", target: "*", payload: { message: `Pipeline completed: no relevant domains` } })
      const duration = (Date.now() - startedAt) / 1000
      return `# Hive Pipeline\n\n没有发现相关域。耗时 ${duration.toFixed(2)}s`
    }

    // Phase 3: Negotiate (real dialog between dependent domains)
    const domainMap = new Map<string, Domain>()
    this.domains.forEach((d) => domainMap.set(d.id, d))
    const assessmentMap = new Map<string, typeof relevant[0]>()
    relevant.forEach((a) => assessmentMap.set(a.domain, a))

    // Find dependency pairs where BOTH sides are relevant
    const depPairs: Array<{ depender: string; provider: string }> = []
    for (const a of relevant) {
      const domain = domainMap.get(a.domain)
      if (!domain) continue
      for (const dep of domain.dependencies) {
        if (assessmentMap.has(dep)) {
          depPairs.push({ depender: a.domain, provider: dep })
        }
      }
    }

    // negotiation results: keyed by "depender->provider"
    const negotiations = new Map<string, { depender: string; provider: string; request: string; response: string }>()

    if (depPairs.length > 0) {
      this.log("negotiate", `🤝 开始协商 ${depPairs.length} 对域间接口...`)
      for (const pair of depPairs) {
        const dependerAssessment = assessmentMap.get(pair.depender)!
        const providerAssessment = assessmentMap.get(pair.provider)!
        try {
          // Step 1: Ask depender what it needs from provider
          const reqSession = await this.client.session.create({
            body: { title: `Hive·${pair.depender}·协商·需求方` },
          })
          this.sessionToDomain.set(reqSession.data!.id, pair.depender)
          const reqResp = await this.client.session.prompt({
            path: { id: reqSession.data!.id },
            body: {
              agent: pair.depender,
              parts: [{
                type: "text" as const,
                text: [
                  `你正在实现以下需求，需要与 @${pair.provider} 协商接口。`,
                  ``,
                  `## 原始需求`,
                  requirement,
                  ``,
                  `## 你的分析`,
                  dependerAssessment.analysis,
                  ``,
                  `## @${pair.provider} 的计划`,
                  providerAssessment.analysis,
                  ``,
                  `请描述你需要 @${pair.provider} 提供什么：`,
                  `- 具体的接口/方法/数据结构`,
                  `- 期望的参数和返回值`,
                  `- 任何约束条件`,
                ].join("\n"),
              }],
            },
          })
          const requestText = this.extractText(reqResp.data?.parts ?? [])

          // Step 2: Ask provider to confirm what it will provide
          const provSession = await this.client.session.create({
            body: { title: `Hive·${pair.provider}·协商·提供方` },
          })
          this.sessionToDomain.set(provSession.data!.id, pair.provider)
          const provResp = await this.client.session.prompt({
            path: { id: provSession.data!.id },
            body: {
              agent: pair.provider,
              parts: [{
                type: "text" as const,
                text: [
                  `@${pair.depender} 需要你提供以下接口，请确认你将提供的规格。`,
                  ``,
                  `## 原始需求`,
                  requirement,
                  ``,
                  `## @${pair.depender} 的接口需求`,
                  requestText,
                  ``,
                  `请回复：`,
                  `1. 你将提供的具体接口定义（函数签名、数据结构、API端点等）`,
                  `2. 如需调整，说明调整内容和原因`,
                ].join("\n"),
              }],
            },
          })
          const responseText = this.extractText(provResp.data?.parts ?? [])

          const key = `${pair.depender}->${pair.provider}`
          negotiations.set(key, {
            depender: pair.depender,
            provider: pair.provider,
            request: requestText,
            response: responseText,
          })

          this.eventBus.publish({
            type: "interface_proposal",
            source: pair.depender,
            target: pair.provider,
            payload: { message: requestText.substring(0, 500) },
          })
          this.eventBus.publish({
            type: "interface_accepted",
            source: pair.provider,
            target: pair.depender,
            payload: { message: responseText.substring(0, 500) },
          })
          this.log("negotiate", `✅ ${pair.depender} ↔ ${pair.provider} 协商完成`, pair.depender)
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          this.log("negotiate", `❌ ${pair.depender} ↔ ${pair.provider} 协商失败: ${errMsg}`, pair.depender)
        }
      }
    } else {
      this.log("negotiate", `⏭️ 无跨域依赖，跳过协商`)
    }

    // Phase 4: Dispatch (parallel waves respecting dependencies)
    const relevantSet = new Set<string>(relevantDomains)
    const internalDeps = new Map<string, string[]>()
    this.domains.forEach((d) => {
      if (!relevantSet.has(d.id)) return
      internalDeps.set(d.id, d.dependencies.filter((dep) => relevantSet.has(dep)))
    })
    const adj = new Map<string, string[]>()
    this.domains.forEach((d) => {
      if (!relevantSet.has(d.id)) return
      adj.set(d.id, [])
    })
    this.domains.forEach((d) => {
      if (!relevantSet.has(d.id)) return
      d.dependencies.forEach((dep) => {
        if (relevantSet.has(dep)) {
          const arr = adj.get(dep) ?? []
          arr.push(d.id)
          adj.set(dep, arr)
        }
      })
    })
    const indegree = new Map<string, number>()
    relevantDomains.forEach((id) => indegree.set(id, (internalDeps.get(id) ?? []).length))
    let queueWave = relevantDomains.filter((id) => (internalDeps.get(id) ?? []).length === 0)
    const waves: string[][] = []
    while (queueWave.length > 0) {
      const thisWave = [...queueWave]
      waves.push(thisWave)
      const next: string[] = []
      for (const u of thisWave) {
        for (const v of adj.get(u) ?? []) {
          const cnt = (indegree.get(v) ?? 0) - 1
          indegree.set(v, cnt)
          if (cnt === 0) next.push(v)
        }
      }
      queueWave = next
    }

    // Build per-domain instruction
    const buildInstruction = (domainId: string): string => {
      const assessment = assessmentMap.get(domainId)
      const otherAssessments = relevant
        .filter((a) => a.domain !== domainId)
        .map((a) => `- @${a.domain}: ${a.analysis.substring(0, 120)}`)

      const relatedNegotiations: string[] = []
      for (const [, neg] of negotiations) {
        if (neg.depender === domainId) {
          relatedNegotiations.push(
            `### 你向 @${neg.provider} 提出的需求\n${neg.request.substring(0, 300)}\n\n### @${neg.provider} 确认提供\n${neg.response.substring(0, 300)}`,
          )
        }
        if (neg.provider === domainId) {
          relatedNegotiations.push(
            `### @${neg.depender} 向你提出的需求\n${neg.request.substring(0, 300)}\n\n### 你承诺提供\n${neg.response.substring(0, 300)}`,
          )
        }
      }

      const parts = [
        `请在你的领域内完成以下需求的实现。`,
        ``,
        `## 原始需求`,
        requirement,
        ``,
        `## 你的评估分析`,
        assessment?.analysis ?? "（无评估）",
        ``,
        `## 其他相关域的计划（供参考）`,
        otherAssessments.length > 0 ? otherAssessments.join("\n") : "无",
      ]

      if (relatedNegotiations.length > 0) {
        parts.push(``, `## 接口协商结果`, ...relatedNegotiations)
      }

      parts.push(
        ``,
        `## 执行要求`,
        `1. 按照你的评估分析执行实现`,
        `2. 严格遵守接口协商结果（如有）`,
        `3. 完成后通过 hive_emit 通知变更`,
      )

      return parts.join("\n")
    }

    // Execute waves sequentially, domains within wave in parallel
    this.log("dispatch", `🚀 开始执行 ${waves.length} 个波次...`)
    for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
      const wave = waves[waveIdx]
      this.log("dispatch", `Wave ${waveIdx + 1}/${waves.length}: ${wave.join(", ")}`)

      const waveResults = await Promise.allSettled(
        wave.map(async (domainId) => {
          const domain = this.domains.find((d) => d.id === domainId)!
          this.currentPipeline!.dispatched.push({ domain: domainId, status: "running" })
          const session = await this.client.session.create({ body: { title: `Hive·${domain.name}·执行` } })
          const sessionId = session.data!.id
          this.sessionToDomain.set(sessionId, domainId)
          const instruction = buildInstruction(domainId)
          const resp = await this.client.session.prompt({
            path: { id: sessionId },
            body: { agent: domainId, parts: [{ type: "text" as const, text: instruction }] },
          })
          return { domainId, text: this.extractText(resp.data?.parts ?? []) }
        }),
      )

      for (const result of waveResults) {
        if (result.status === "fulfilled") {
          const { domainId, text } = result.value
          const entry = this.currentPipeline!.dispatched.find((d) => d.domain === domainId)
          if (entry) {
            entry.status = "completed"
            entry.response = text
          }
          this.log("dispatch", `✅ @${domainId} 执行完成`, domainId)
        } else {
          const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
          this.log("dispatch", `❌ Wave ${waveIdx + 1} 中有域执行失败: ${errMsg}`)
          // Mark any still-running entries as failed
          for (const domainId of wave) {
            const entry = this.currentPipeline!.dispatched.find((d) => d.domain === domainId && d.status === "running")
            if (entry) {
              entry.status = "failed"
              entry.response = errMsg
            }
          }
        }
      }
    }

    // Phase 5: Report
    const end = Date.now()
    const duration = (end - startedAt) / 1000
    this.currentPipeline!.status = "completed"
    this.currentPipeline!.completedAt = end

    const succeeded = this.currentPipeline!.dispatched.filter((d) => d.status === "completed")
    const failed = this.currentPipeline!.dispatched.filter((d) => d.status === "failed")

    const perDomainLines = this.currentPipeline!.dispatched.map((d) => {
      const icon = d.status === "completed" ? "✅" : "❌"
      return `### ${icon} @${d.domain}\n${d.response?.substring(0, 300) ?? "无输出"}`
    })

    const negotiationLines = [...negotiations.values()].map(
      (n) => `- **${n.depender} → ${n.provider}**: ${n.response.substring(0, 100)}`,
    )

    const report = [
      `# Hive Pipeline Report`,
      ``,
      `- **需求**: ${requirement}`,
      `- **相关域**: ${relevantDomains.length} (${relevantDomains.join(", ")})`,
      `- **成功**: ${succeeded.length}/${this.currentPipeline!.dispatched.length}`,
      `- **耗时**: ${duration.toFixed(1)}s`,
      ``,
      negotiationLines.length > 0 ? `## 接口协商\n${negotiationLines.join("\n")}` : "",
      ``,
      `## 执行结果`,
      ...perDomainLines,
    ].filter(Boolean).join("\n\n")

    this.eventBus.publish({
      type: "pipeline_completed",
      source: "queen",
      target: "*",
      payload: { message: `Pipeline completed: ${succeeded.length}/${this.currentPipeline!.dispatched.length} succeeded`, data: { requirement, domains: relevantDomains } },
    })
    this.eventBus.cleanup()
    return report
  }
}

export type { PipelineState }
