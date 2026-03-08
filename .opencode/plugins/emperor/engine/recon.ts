import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import type { Edict, EmperorConfig } from "../types"

export interface ReconResult {
  /** Full project context report — injected into zhongshu prompt */
  fullContext: string
  /** Abbreviated summary — injected into menxia prompt */
  summary: string
  /** Git hash used as cache key */
  gitHash: string
  /** Whether this result was loaded from cache */
  cached: boolean
}

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

/**
 * Read the current git HEAD hash without child_process.
 * Resolves symbolic refs (e.g., "ref: refs/heads/main") to their commit hash.
 * Returns null if not a git repo or cannot read.
 */
function getGitHash(directory: string): string | null {
  try {
    const headPath = join(directory, ".git", "HEAD")
    if (!existsSync(headPath)) return null

    const headContent = readFileSync(headPath, "utf-8").trim()

    // Detached HEAD — already a hash
    if (!headContent.startsWith("ref: ")) {
      return headContent.slice(0, 12)
    }

    // Symbolic ref — resolve to hash
    const refPath = join(directory, ".git", headContent.slice(5))
    if (!existsSync(refPath)) return null

    return readFileSync(refPath, "utf-8").trim().slice(0, 12)
  } catch {
    return null
  }
}

/**
 * Extract a summary from the full recon report.
 * Takes only the first sections (技术栈 + 目录结构 + 架构概览) and truncates module details.
 */
function extractSummary(fullContext: string): string {
  const lines = fullContext.split("\n")
  const summaryLines: string[] = []
  let sectionDepth = 0
  let includedSections = 0
  const maxSections = 4 // 技术栈, 目录结构, 架构概览, 代码规范与模式

  for (const line of lines) {
    if (line.startsWith("## ")) {
      includedSections++
      if (includedSections > maxSections) {
        // Add a note about truncation and stop
        summaryLines.push("")
        summaryLines.push("（更多模块详情见完整侦察报告）")
        break
      }
      sectionDepth = 2
    }
    summaryLines.push(line)
  }

  return summaryLines.join("\n")
}

/**
 * Get the cache file path for a given git hash.
 */
function getCachePath(directory: string, config: EmperorConfig, gitHash: string): string {
  const cacheDir = join(directory, config.store.dataDir, config.recon.cacheDir)
  return join(cacheDir, `${gitHash}.md`)
}

/**
 * Try to load a cached recon result.
 */
function loadFromCache(directory: string, config: EmperorConfig, gitHash: string): string | null {
  try {
    const cachePath = getCachePath(directory, config, gitHash)
    if (existsSync(cachePath)) {
      return readFileSync(cachePath, "utf-8")
    }
  } catch {
    // Cache miss — will regenerate
  }
  return null
}

/**
 * Save recon result to cache.
 */
function saveToCache(directory: string, config: EmperorConfig, gitHash: string, content: string): void {
  try {
    const cacheDir = join(directory, config.store.dataDir, config.recon.cacheDir)
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true })
    }
    writeFileSync(getCachePath(directory, config, gitHash), content)
  } catch {
    // Non-fatal — caching is best-effort
  }
}

/**
 * Phase 0: 锦衣卫 project reconnaissance.
 *
 * Scans the project and generates a structured context report with mermaid diagrams.
 * Results are cached by git hash — same commit = same context, no re-scan.
 *
 * Output is layered:
 * - fullContext: Complete report → injected into 中书省 (planning) prompt
 * - summary: Abbreviated → injected into 门下省 (review) prompt
 */
export async function reconWithJinyiwei(
  client: OpencodeClient,
  edict: Edict,
  config: EmperorConfig,
  directory: string,
): Promise<ReconResult> {
  // Check if recon is disabled
  if (!config.recon.enabled) {
    return { fullContext: "", summary: "", gitHash: "", cached: false }
  }

  // Get git hash for cache key
  const gitHash = getGitHash(directory) ?? `no-git-${Date.now()}`

  // Try cache first
  const cached = loadFromCache(directory, config, gitHash)
  if (cached) {
    client.tui.showToast({ body: { message: "🔍 锦衣卫: 使用缓存侦察报告", variant: "info" } })
    return {
      fullContext: cached,
      summary: extractSummary(cached),
      gitHash,
      cached: true,
    }
  }

  // No cache — run jinyiwei agent
  client.tui.showToast({ body: { message: "🕵️ 锦衣卫侦察中...", variant: "info" } })

  const session = await client.session.create({
    body: { title: `锦衣卫·${edict.title}` },
  })
  const sessionId = session.data!.id

  const prompt = `请对当前项目进行全面侦察，生成项目上下文报告。

## 当前旨意（供参考，侦察时优先关注相关模块）
标题: ${edict.title}
内容: ${edict.content}

## 侦察要求
1. 先扫描项目根目录，识别技术栈和目录结构
2. 深入分析与旨意相关的模块，了解现有实现
3. 生成包含 mermaid 图表的结构化报告
4. 控制报告体量，突出重点，避免信息过载

请按照你的系统提示中规定的输出格式生成报告。`

  const response = await client.session.prompt({
    path: { id: sessionId },
    body: {
      agent: "jinyiwei",
      parts: [{ type: "text" as const, text: prompt }],
    },
  })

  const fullContext = extractText(response.data?.parts ?? [])

  // Cache the result
  saveToCache(directory, config, gitHash, fullContext)

  client.tui.showToast({ body: { message: "🕵️ 锦衣卫侦察完毕", variant: "success" } })

  return {
    fullContext,
    summary: extractSummary(fullContext),
    gitHash,
    cached: false,
  }
}
