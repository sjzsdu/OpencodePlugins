import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Part } from "sjz-opencode-sdk"
import type { HiveEventBus } from "./eventbus/bus"
import type { Domain, HiveConfig, PipelineState, PipelineLog, PipelinePhase, PipelineSession } from "./types"

function partitionByConnectedComponents(
  relevantDomains: string[],
  domainMap: Map<string, Domain>,
): string[][] {
  const parent = new Map<string, string>()
  const relevantSet = new Set(relevantDomains)

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }

  function union(a: string, b: string) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const id of relevantDomains) parent.set(id, id)
  for (const id of relevantDomains) {
    const domain = domainMap.get(id)
    if (!domain) continue
    for (const dep of domain.dependencies) {
      if (relevantSet.has(dep)) union(id, dep)
    }
  }

  const groups = new Map<string, string[]>()
  for (const id of relevantDomains) {
    const root = find(id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(id)
  }
  return [...groups.values()]
}

export interface PipelineContext {
  parentSessionId?: string
  directory?: string
  onProgress?: (message: string) => void
}

export class HivePipeline {
  private currentPipeline: PipelineState | null = null
  private runningPromise: Promise<string> | null = null

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

  isRunning(): boolean {
    return this.currentPipeline?.status === "running"
  }

  async start(requirement: string, context?: PipelineContext): Promise<string> {
    if (this.isRunning()) {
      return "Pipeline 已在运行中，请用 hive_status detail:pipeline 查看进度。"
    }
    this.runningPromise = this.run(requirement, context)
    this.runningPromise.catch(() => {})

    const sessionList = this.currentPipeline?.sessions ?? []
    const lines = [
      `# 🚀 Hive Pipeline 已启动`,
      ``,
      `**需求**: ${requirement}`,
      `**域数量**: ${this.domains.length}`,
      ``,
      `Pipeline 正在后台运行。`,
      `- 用 **hive_status detail:pipeline** 查看实时进度`,
      `- 用 **hive_status detail:pipeline** 获取最终报告`,
      `- 各域 Session 已创建，可在 TUI Session 列表中查看`,
    ]
    return lines.join("\n")
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

  private trackSession(sessionId: string, domain: string, phase: PipelinePhase, title: string) {
    if (!this.currentPipeline) return
    this.currentPipeline.sessions.push({ sessionId, domain, phase, title })
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

  async run(requirement: string, context?: PipelineContext): Promise<string> {
    const parentSessionId = context?.parentSessionId
    const directory = context?.directory
    const progress = context?.onProgress ?? (() => {})

    const id = `pipeline-${Date.now()}`
    const startedAt = Date.now()
    this.currentPipeline = {
      id,
      requirement,
      status: "running",
      startedAt,
      logs: [],
      sessions: [],
      assessments: [],
      dispatched: [],
      verified: [],
    }

    try {
    return await this._execute(requirement, parentSessionId, directory, progress, startedAt)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      this.currentPipeline!.status = "failed"
      this.currentPipeline!.completedAt = Date.now()
      this.log("complete", `❌ Pipeline 崩溃: ${errMsg}`)
      this.eventBus.publish({
        type: "pipeline_failed",
        source: "queen",
        target: "*",
        payload: { message: `Pipeline failed: ${errMsg}` },
      })
      this.runningPromise = null
      return `# ❌ Hive Pipeline Failed\n\n${errMsg}`
    }
  }

  private async _execute(
    requirement: string,
    parentSessionId: string | undefined,
    directory: string | undefined,
    progress: (message: string) => void,
    startedAt: number,
  ): Promise<string> {

    this.eventBus.publish({
      type: "pipeline_started",
      source: "queen",
      target: "*",
      payload: { message: `Pipeline started for: ${requirement}` },
    })

    // Phase 1: Assess (parallel)
    // Track per-domain assess sessions for potential reuse
    const assessSessionMap = new Map<string, string>()
    progress(`🔍 评估中... (0/${this.domains.length})`)
    this.log("assess", `🔍 开始评估 ${this.domains.length} 个域...`)
    const assessResults = await Promise.allSettled(
      this.domains.map(async (domain) => {
        const assessTitle = `Hive·${domain.name}·评估`
        const session = await this.client.session.create({
          body: { title: assessTitle, parentID: parentSessionId },
          query: { directory },
        })
        const sessionId = session.data!.id
        this.sessionToDomain.set(sessionId, domain.id)
        assessSessionMap.set(domain.id, sessionId)
        this.trackSession(sessionId, domain.id, "assess", assessTitle)
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
        const done = this.currentPipeline!.assessments.length
        progress(`🔍 评估中... (${done}/${this.domains.length})`)
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
      const hasProject = this.domains.some(d => d.id === "project")
      if (hasProject) {
        const projectAssessment = this.currentPipeline!.assessments.find(a => a.domain === "project")
        if (projectAssessment) {
          projectAssessment.relevance = "高"
          projectAssessment.analysis = projectAssessment.analysis || "兜底：无专业域认领此需求，由 project 域处理"
        } else {
          this.currentPipeline!.assessments.push({ domain: "project", relevance: "高", analysis: "兜底：无专业域认领此需求", workload: "中" })
        }
        relevant.push(this.currentPipeline!.assessments.find(a => a.domain === "project")!)
        relevantDomains.push("project")
        this.log("filter", `⚡ 无专业域认领，project 域兜底`)
      } else {
        this.currentPipeline!.status = "completed"
        this.currentPipeline!.completedAt = Date.now()
        this.eventBus.publish({ type: "pipeline_completed", source: "queen", target: "*", payload: { message: `Pipeline completed: no relevant domains` } })
        const duration = (Date.now() - startedAt) / 1000
        return `# Hive Pipeline\n\n没有发现相关域。耗时 ${duration.toFixed(2)}s`
      }
    }

    // Phase 3: Negotiate (real dialog between dependent domains)
    const domainMap = new Map<string, Domain>()
    this.domains.forEach((d) => domainMap.set(d.id, d))
    const assessmentMap = new Map<string, typeof relevant[0]>()
    relevant.forEach((a) => assessmentMap.set(a.domain, a))

    // Determine if we are in single-domain mode (for short-circuit)
    const singleDomain = relevantDomains.length === 1

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

    if (depPairs.length > 0 && !singleDomain) {
      progress(`🤝 协商中... (0/${depPairs.length})`)
      this.log("negotiate", `🤝 开始协商 ${depPairs.length} 对域间接口...`)
      const negotiateResults = await Promise.allSettled(
        depPairs.map(async (pair) => {
          const dependerAssessment = assessmentMap.get(pair.depender)!
          const providerAssessment = assessmentMap.get(pair.provider)!
          const reqTitle = `Hive·${pair.depender}·协商·需求方`
          const reqSession = await this.client.session.create({
            body: { title: reqTitle, parentID: parentSessionId },
            query: { directory },
          })
          this.sessionToDomain.set(reqSession.data!.id, pair.depender)
          this.trackSession(reqSession.data!.id, pair.depender, "negotiate", reqTitle)
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

          const provTitle = `Hive·${pair.provider}·协商·提供方`
          const provSession = await this.client.session.create({
            body: { title: provTitle, parentID: parentSessionId },
            query: { directory },
          })
          this.sessionToDomain.set(provSession.data!.id, pair.provider)
          this.trackSession(provSession.data!.id, pair.provider, "negotiate", provTitle)
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
          progress(`🤝 协商中... (${negotiations.size}/${depPairs.length})`)
          this.log("negotiate", `✅ ${pair.depender} ↔ ${pair.provider} 协商完成`, pair.depender)
        }),
      )
      for (const result of negotiateResults) {
        if (result.status === "rejected") {
          const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
          this.log("negotiate", `❌ 协商失败: ${errMsg}`)
        }
      }
    } else {
      if (singleDomain) {
        this.log("negotiate", `⚡ 单域模式，跳过协商`)
      } else {
        this.log("negotiate", `⏭️ 无跨域依赖，跳过协商`)
      }
    }

    // Phase 4: Dispatch (partition-parallel)
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

    const partitions = partitionByConnectedComponents(relevantDomains, domainMap)
    if (partitions.length > 1) {
      this.log("dispatch", `🔀 ${partitions.length} 个独立分区并行执行: [${partitions.map(p => p.join(",")).join(" | ")}]`)
    }

    const dispatchPartition = async (partitionIds: string[], pIdx: number) => {
      const pLabel = partitions.length > 1 ? `[P${pIdx + 1}] ` : ""
      const partSet = new Set(partitionIds)

      const partDeps = new Map<string, string[]>()
      this.domains.forEach((d) => {
        if (!partSet.has(d.id)) return
        partDeps.set(d.id, d.dependencies.filter((dep) => partSet.has(dep)))
      })
      const partAdj = new Map<string, string[]>()
      this.domains.forEach((d) => {
        if (!partSet.has(d.id)) return
        partAdj.set(d.id, [])
      })
      this.domains.forEach((d) => {
        if (!partSet.has(d.id)) return
        d.dependencies.forEach((dep) => {
          if (partSet.has(dep)) {
            const arr = partAdj.get(dep) ?? []
            arr.push(d.id)
            partAdj.set(dep, arr)
          }
        })
      })

      const partIndegree = new Map<string, number>()
      partitionIds.forEach((id) => partIndegree.set(id, (partDeps.get(id) ?? []).length))
      let queue = partitionIds.filter((id) => (partDeps.get(id) ?? []).length === 0)
      const waves: string[][] = []
      while (queue.length > 0) {
        const thisWave = [...queue]
        waves.push(thisWave)
        const next: string[] = []
        for (const u of thisWave) {
          for (const v of partAdj.get(u) ?? []) {
            const cnt = (partIndegree.get(v) ?? 0) - 1
            partIndegree.set(v, cnt)
            if (cnt === 0) next.push(v)
          }
        }
        queue = next
      }

      this.log("dispatch", `${pLabel}${waves.length} 个波次: ${waves.map(w => w.join(",")).join(" → ")}`)

      for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
        const wave = waves[waveIdx]
        this.log("dispatch", `${pLabel}Wave ${waveIdx + 1}/${waves.length}: ${wave.join(", ")}`)

        const waveResults = await Promise.allSettled(
          wave.map(async (domainId) => {
            const domain = this.domains.find((d) => d.id === domainId)!
            const execTitle = `Hive·${domain.name}·执行`
            let sessionId: string
            const existingSessionId = assessSessionMap.get(domainId)
            if (existingSessionId) {
              sessionId = existingSessionId
            } else {
              const session = await this.client.session.create({
                body: { title: execTitle, parentID: parentSessionId },
                query: { directory },
              })
              sessionId = session.data!.id
              assessSessionMap.set(domainId, sessionId)
            }
            this.sessionToDomain.set(sessionId, domainId)
            this.trackSession(sessionId, domainId, "dispatch", execTitle)
            this.currentPipeline!.dispatched.push({ domain: domainId, status: "running", sessionId })
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
            const dispatched = this.currentPipeline!.dispatched.filter((d) => d.status === "completed" || d.status === "failed").length
            progress(`🚀 执行中... (${dispatched}/${relevantDomains.length}) ${pLabel}✅ @${domainId}`)
            this.log("dispatch", `${pLabel}✅ @${domainId} 执行完成`, domainId)
          } else {
            const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
            this.log("dispatch", `${pLabel}❌ Wave ${waveIdx + 1} 中有域执行失败: ${errMsg}`)
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
    }

    progress(`🚀 执行中... (0/${relevantDomains.length})`)
    this.log("dispatch", `🚀 开始执行 ${relevantDomains.length} 个域 (${partitions.length} 个分区)...`)
    await Promise.allSettled(partitions.map((p, i) => dispatchPartition(p, i)))

    // Phase 5: Verify
    const succeeded = this.currentPipeline!.dispatched.filter((d) => d.status === "completed")
    if (succeeded.length > 0) {
      progress(`🔍 验证中... (0/${succeeded.length})`)
      this.log("verify", `🔍 开始验证 ${succeeded.length} 个域的修改...`)

      const verifyResults = await Promise.allSettled(
        succeeded.map(async (d) => {
          const domain = this.domains.find((dom) => dom.id === d.domain)!
          const verifyTitle = `Hive·${domain.name}·验证`
          const verifySession = await this.client.session.create({
            body: { title: verifyTitle, parentID: parentSessionId },
            query: { directory },
          })
          const verifySessionId = verifySession.data!.id
          this.sessionToDomain.set(verifySessionId, d.domain)
          this.trackSession(verifySessionId, d.domain, "verify", verifyTitle)

          const verifyPrompt = [
            `请验证你刚才的代码修改是否正确。`,
            ``,
            `## 你的修改摘要`,
            d.response?.substring(0, 800) ?? "（无摘要）",
            ``,
            `## 验证步骤`,
            `1. 运行构建命令，确认编译通过`,
            `2. 运行相关测试，确认测试通过`,
            `3. 检查是否有遗漏的修改`,
            ``,
            `## 返回格式（严格按此格式）`,
            `- **构建结果**: 通过/失败`,
            `- **测试结果**: 通过/失败`,
            `- **变更文件**: 列出所有修改/创建的文件路径`,
            `- **问题**: 如有问题，描述具体问题`,
          ].join("\n")

          const resp = await this.client.session.prompt({
            path: { id: verifySessionId },
            body: { agent: d.domain, parts: [{ type: "text" as const, text: verifyPrompt }] },
          })
          const text = this.extractText(resp.data?.parts ?? [])
          const buildPassed = /构建结果[:：]?\s*通过/i.test(text) ? true : /构建结果[:：]?\s*失败/i.test(text) ? false : null
          const testsPassed = /测试结果[:：]?\s*通过/i.test(text) ? true : /测试结果[:：]?\s*失败/i.test(text) ? false : null
          const issues = buildPassed === false || testsPassed === false ? text : ""

          // Push into verify state
          this.currentPipeline!.verified.push({ domain: d.domain, buildPassed, testsPassed, issues })
          const done = this.currentPipeline!.verified.length
          progress(`🔍 验证中... (${done}/${succeeded.length})`)
          this.log("verify", `${buildPassed !== false && testsPassed !== false ? "✅" : "❌"} @${d.domain} 验证完成`, d.domain)
          return { domain: d.domain, buildPassed, testsPassed, issues }
        }),
      )

      for (const result of verifyResults) {
        if (result.status === "rejected") {
          const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
          this.log("verify", `❌ 验证异常: ${errMsg}`)
        }
      }
    }

    // Compute verification summary (after verify phase has populated verified[])
    const verifyLines = this.currentPipeline!.verified.map((v) => {
      const bIcon = v.buildPassed === true ? "✅" : v.buildPassed === false ? "❌" : "⏭️"
      const tIcon = v.testsPassed === true ? "✅" : v.testsPassed === false ? "❌" : "⏭️"
      return `- @${v.domain}: 构建${bIcon} 测试${tIcon}${v.issues ? ` — ${v.issues.substring(0, 100)}` : ""}`
    })

    // Phase 6: Report
    progress(`📋 生成报告...`)
    const end = Date.now()
    const duration = (end - startedAt) / 1000
    this.currentPipeline!.status = "completed"
    this.currentPipeline!.completedAt = end


    const perDomainLines = this.currentPipeline!.dispatched.map((d) => {
      const icon = d.status === "completed" ? "✅" : "❌"
      const sessionRef = d.sessionId ? `\n  Session: \`${d.sessionId}\`` : ""
      return `### ${icon} @${d.domain}${sessionRef}\n${d.response?.substring(0, 300) ?? "无输出"}`
    })

    const negotiationLines = [...negotiations.values()].map(
      (n) => `- **${n.depender} → ${n.provider}**: ${n.response.substring(0, 100)}`,
    )

    const sessionsByPhase = {
      assess: this.currentPipeline!.sessions.filter((s) => s.phase === "assess"),
      negotiate: this.currentPipeline!.sessions.filter((s) => s.phase === "negotiate"),
      dispatch: this.currentPipeline!.sessions.filter((s) => s.phase === "dispatch"),
    }
    const sessionLines: string[] = []
    for (const [phase, sessions] of Object.entries(sessionsByPhase)) {
      if (sessions.length === 0) continue
      sessionLines.push(
        `**${phase}**`,
        ...sessions.map((s) => `- @${s.domain}: \`${s.sessionId}\` (${s.title})`),
      )
    }

    const finalSucceeded = this.currentPipeline!.dispatched.filter((d) => d.status === "completed")
    const report = [
      `# Hive Pipeline Report`,
      ``,
      `- **需求**: ${requirement}`,
      `- **相关域**: ${relevantDomains.length} (${relevantDomains.join(", ")})`,
      `- **成功**: ${finalSucceeded.length}/${this.currentPipeline!.dispatched.length}`,
      `- **耗时**: ${duration.toFixed(1)}s`,
      `- **创建 Sessions**: ${this.currentPipeline!.sessions.length}`,
      ``,
      negotiationLines.length > 0 ? `## 接口协商\n${negotiationLines.join("\n")}` : "",
      verifyLines.length > 0 ? `## 验证结果\n${verifyLines.join("\n")}` : "",
      ``,
      `## 执行结果`,
      ...perDomainLines,
      ``,
      `## Sessions（可在 TUI 中切换查看详情）`,
      ...sessionLines,
    ].filter(Boolean).join("\n\n")

    this.eventBus.publish({
      type: "pipeline_completed",
      source: "queen",
      target: "*",
      payload: { message: `Pipeline completed: ${finalSucceeded.length}/${this.currentPipeline!.dispatched.length} succeeded`, data: { requirement, domains: relevantDomains } },
    })
    this.eventBus.cleanup()
    this.runningPromise = null
    return report
  }
}

export type { PipelineState }
