import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Part } from "@opencode-ai/sdk"
import type { Edict, EmperorConfig, ReconFacetId, ReconManifest } from "../types"

// ============================================================
// Constants
// ============================================================

/** All 7 concern-area facets */
export const RECON_FACET_IDS: ReconFacetId[] = [
  "architecture", "techstack", "api-surface", "testing", "security", "cicd", "conventions",
]

/** Facet metadata — what each facet covers and what file patterns affect it */
const FACET_META: Record<ReconFacetId, { title: string; description: string; triggerPatterns: string[] }> = {
  architecture: {
    title: "架构总览",
    description: "目录结构、模块依赖、分层架构、核心组件关系",
    triggerPatterns: ["src/", "lib/", "app/", "packages/", "index."],
  },
  techstack: {
    title: "技术栈",
    description: "语言、框架、构建工具、依赖版本、运行时配置",
    triggerPatterns: ["package.json", "tsconfig", "Cargo.toml", "go.mod", "pyproject.toml", "pom.xml"],
  },
  "api-surface": {
    title: "接口定义",
    description: "暴露的API接口、路由定义、类型导出、数据结构",
    triggerPatterns: ["routes/", "api/", "types/", "schema/", "graphql/", "proto/"],
  },
  testing: {
    title: "测试体系",
    description: "测试框架、测试命令、测试目录结构、覆盖率配置",
    triggerPatterns: ["test/", "tests/", "__tests__/", "spec/", "jest.config", "vitest.config", "*.test.", "*.spec."],
  },
  security: {
    title: "安全配置",
    description: "认证鉴权模式、敏感数据处理、依赖安全、权限控制",
    triggerPatterns: ["auth/", "security/", ".env", "credentials", "permission/", "middleware/"],
  },
  cicd: {
    title: "CI/CD与基建",
    description: "构建脚本、CI流水线、部署配置、Docker、环境变量",
    triggerPatterns: [".github/", ".gitlab-ci", "Dockerfile", "docker-compose", "Makefile", ".circleci/", "scripts/"],
  },
  conventions: {
    title: "代码规范",
    description: "命名习惯、文件组织约定、错误处理模式、日志方式",
    triggerPatterns: [".eslintrc", ".prettierrc", "src/", "lib/", ".editorconfig"],
  },
}

/** Which facets each role (三省六部) consumes */
const ROLE_FACETS: Record<string, ReconFacetId[]> = {
  taizi: ["architecture"],
  zhongshu: ["architecture", "techstack", "conventions"],
  menxia: ["architecture", "security", "api-surface"],
  libu: ["architecture", "conventions"],
  bingbu: ["techstack", "conventions", "architecture"],
  hubu: ["testing", "techstack"],
  xingbu: ["security"],
  gongbu: ["cicd", "techstack"],
}

/** Delimiter used to split facets in jinyiwei's single-response output */
const FACET_DELIMITER_PREFIX = "<!-- FACET:"
const FACET_DELIMITER_SUFFIX = " -->"

// ============================================================
// Return types
// ============================================================

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

// ============================================================
// Utilities
// ============================================================

function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

/**
 * Read the current git HEAD hash without child_process.
 * Resolves symbolic refs (e.g., "ref: refs/heads/main") to their commit hash.
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
 * Get list of changed files between two commits using git diff.
 * Returns empty array on failure.
 */
function getChangedFiles(directory: string, fromHash: string, toHash: string): string[] {
  try {
    const output = execSync(`git diff --name-only ${fromHash}..${toHash}`, {
      cwd: directory,
      encoding: "utf-8",
      timeout: 10_000,
    })
    return output.trim().split("\n").filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Get detailed diff content between two commits for specific file paths.
 * Used to feed jinyiwei during incremental updates.
 */
function getDiffContent(directory: string, fromHash: string, toHash: string, paths: string[]): string {
  try {
    const pathArgs = paths.length > 0 ? `-- ${paths.map((p) => `"${p}"`).join(" ")}` : ""
    const output = execSync(`git diff ${fromHash}..${toHash} --stat ${pathArgs}`, {
      cwd: directory,
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024, // 1MB
    })
    return output.trim()
  } catch {
    return "(git diff failed)"
  }
}

// ============================================================
// Manifest management
// ============================================================

function getReconDir(directory: string, config: EmperorConfig): string {
  return join(directory, config.store.dataDir, config.recon.cacheDir)
}

function getManifestPath(directory: string, config: EmperorConfig): string {
  return join(getReconDir(directory, config), "manifest.json")
}

function getFacetPath(directory: string, config: EmperorConfig, facetId: ReconFacetId): string {
  return join(getReconDir(directory, config), `${facetId}.md`)
}

function loadManifest(directory: string, config: EmperorConfig): ReconManifest | null {
  try {
    const path = getManifestPath(directory, config)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf-8")) as ReconManifest
  } catch {
    return null
  }
}

function saveManifest(directory: string, config: EmperorConfig, manifest: ReconManifest): void {
  try {
    const dir = getReconDir(directory, config)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(getManifestPath(directory, config), JSON.stringify(manifest, null, 2), "utf-8")
  } catch {
    // Non-fatal
  }
}

function saveFacet(directory: string, config: EmperorConfig, facetId: ReconFacetId, content: string): void {
  try {
    const dir = getReconDir(directory, config)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(getFacetPath(directory, config, facetId), content, "utf-8")
  } catch {
    // Non-fatal
  }
}

function loadFacet(directory: string, config: EmperorConfig, facetId: ReconFacetId): string | null {
  try {
    const path = getFacetPath(directory, config, facetId)
    if (!existsSync(path)) return null
    return readFileSync(path, "utf-8")
  } catch {
    return null
  }
}

// ============================================================
// Facet analysis: which facets are affected by changed files
// ============================================================

/**
 * Determine which facets are affected by a list of changed files.
 * Uses trigger patterns from FACET_META + force-rebuild patterns from config.
 */
function getAffectedFacets(changedFiles: string[], config: EmperorConfig): Set<ReconFacetId> {
  const affected = new Set<ReconFacetId>()

  // Check if any force-rebuild pattern matches → rebuild ALL facets
  const forceRebuildAll = changedFiles.some((file) =>
    config.recon.forceRebuildPatterns.some((pattern) => matchFilePattern(file, pattern)),
  )
  if (forceRebuildAll) {
    for (const id of RECON_FACET_IDS) affected.add(id)
    return affected
  }

  // Map each changed file to affected facets via trigger patterns
  for (const file of changedFiles) {
    for (const [facetId, meta] of Object.entries(FACET_META) as [ReconFacetId, (typeof FACET_META)[ReconFacetId]][]) {
      if (meta.triggerPatterns.some((pattern) => matchFilePattern(file, pattern))) {
        affected.add(facetId)
      }
    }
  }

  // Source files that didn't match specific facets → architecture + conventions as fallback
  const unmatchedSourceFiles = changedFiles.filter(
    (file) => !file.startsWith(".") && (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".py") || file.endsWith(".go") || file.endsWith(".rs")),
  )
  if (unmatchedSourceFiles.length > 0) {
    affected.add("architecture")
    affected.add("conventions")
  }

  return affected
}

/** Simple file pattern matching: supports prefix (dir/) and contains (substring) */
function matchFilePattern(file: string, pattern: string): boolean {
  // Glob-like wildcard at end: "src/" matches "src/foo/bar.ts"
  if (pattern.endsWith("/")) return file.startsWith(pattern) || file.includes(`/${pattern}`)
  // Glob-like wildcard: "*.test." matches "foo.test.ts"
  if (pattern.startsWith("*.")) return file.includes(pattern.slice(1))
  // Glob-like wildcard at end: ".github/workflows/*" matches ".github/workflows/ci.yml"
  if (pattern.endsWith("*")) return file.startsWith(pattern.slice(0, -1))
  // Exact or contains match
  return file === pattern || file.includes(pattern)
}

// ============================================================
// Full scan — invoke jinyiwei once, parse into 7 facets
// ============================================================

function buildFullScanPrompt(): string {
  const facetInstructions = RECON_FACET_IDS.map((id) => {
    const meta = FACET_META[id]
    return `### ${FACET_DELIMITER_PREFIX}${id}${FACET_DELIMITER_SUFFIX}\n**${meta.title}** — ${meta.description}`
  }).join("\n\n")

  return `请对当前项目进行全面侦察，并按以下 7 个关注面分别输出结构化 Markdown 报告。

## 重要格式要求

你的输出必须包含以下 7 个分隔符，每个分隔符后面紧跟该关注面的完整报告内容：

${facetInstructions}

## 侦察流程

1. 先扫描项目根目录（package.json、tsconfig.json 等配置文件）
2. 扫描目录结构（glob 主要目录）
3. 深入阅读核心代码文件
4. 按 7 个关注面分别整理输出

## 每个关注面的报告要求

- 使用 Markdown 格式
- 包含 mermaid 图表（如适用）
- 内容详实但避免冗余
- 使用中文

## 格式示例

${FACET_DELIMITER_PREFIX}architecture${FACET_DELIMITER_SUFFIX}
# 架构总览
...你的架构分析内容...

${FACET_DELIMITER_PREFIX}techstack${FACET_DELIMITER_SUFFIX}
# 技术栈
...你的技术栈分析内容...

（以此类推，必须包含全部 7 个关注面）`
}

/**
 * Parse jinyiwei's full-scan response into individual facet contents.
 * Returns a map of facetId → content. Missing facets will not be in the map.
 */
function parseFacetResponse(text: string): Partial<Record<ReconFacetId, string>> {
  const result: Partial<Record<ReconFacetId, string>> = {}

  for (let i = 0; i < RECON_FACET_IDS.length; i++) {
    const currentId = RECON_FACET_IDS[i]
    const currentDelimiter = `${FACET_DELIMITER_PREFIX}${currentId}${FACET_DELIMITER_SUFFIX}`
    const startIdx = text.indexOf(currentDelimiter)

    if (startIdx === -1) continue

    const contentStart = startIdx + currentDelimiter.length

    // Find the next delimiter (or end of text)
    let contentEnd = text.length
    for (let j = i + 1; j < RECON_FACET_IDS.length; j++) {
      const nextDelimiter = `${FACET_DELIMITER_PREFIX}${RECON_FACET_IDS[j]}${FACET_DELIMITER_SUFFIX}`
      const nextIdx = text.indexOf(nextDelimiter, contentStart)
      if (nextIdx !== -1) {
        contentEnd = nextIdx
        break
      }
    }

    const content = text.slice(contentStart, contentEnd).trim()
    if (content.length > 0) {
      result[currentId] = content
    }
  }

  return result
}

async function runFullScan(
  client: OpencodeClient,
  config: EmperorConfig,
  directory: string,
  gitHash: string,
): Promise<ReconManifest> {
  client.tui.showToast({ body: { message: "🕵️ 锦衣卫全面侦察中（全量扫描）...", variant: "info" } })

  const session = await client.session.create({
    body: { title: "锦衣卫·全量侦察" },
  })
  const sessionId = session.data!.id

  const response = await client.session.prompt({
    path: { id: sessionId },
    body: {
      agent: "jinyiwei",
      parts: [{ type: "text" as const, text: buildFullScanPrompt() }],
    },
  })

  const text = extractText(response.data?.parts ?? [])
  const facets = parseFacetResponse(text)

  // Check for missing facets — request them individually in the same session
  const missingFacets = RECON_FACET_IDS.filter((id) => !facets[id])
  for (const missingId of missingFacets) {
    const meta = FACET_META[missingId]
    const followUp = await client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: "jinyiwei",
        parts: [{
          type: "text" as const,
          text: `你的上一次输出中缺少了「${meta.title}」关注面。请补充输出这个关注面的完整报告。\n\n关注面: ${meta.title}\n内容范围: ${meta.description}\n\n请直接输出报告内容（Markdown格式），不需要分隔符。`,
        }],
      },
    })
    const missingContent = extractText(followUp.data?.parts ?? [])
    if (missingContent.trim()) {
      facets[missingId] = missingContent.trim()
    }
  }

  // Save all facets to disk
  const now = Date.now()
  const manifest: ReconManifest = {
    gitHash,
    lastFullScanAt: now,
    incrementalCount: 0,
    facets: {},
  }

  for (const [id, content] of Object.entries(facets) as [ReconFacetId, string][]) {
    saveFacet(directory, config, id, content)
    manifest.facets[id] = { updatedAt: now, size: content.length }
  }

  saveManifest(directory, config, manifest)

  client.tui.showToast({ body: { message: `🕵️ 锦衣卫全量侦察完毕（${Object.keys(facets).length}/7 个关注面）`, variant: "success" } })

  return manifest
}

// ============================================================
// Incremental update — git diff → selective facet update
// ============================================================

async function runIncrementalUpdate(
  client: OpencodeClient,
  config: EmperorConfig,
  directory: string,
  oldManifest: ReconManifest,
  newGitHash: string,
): Promise<ReconManifest> {
  const changedFiles = getChangedFiles(directory, oldManifest.gitHash, newGitHash)

  if (changedFiles.length === 0) {
    // No actual file changes — just update hash
    const updated = { ...oldManifest, gitHash: newGitHash }
    saveManifest(directory, config, updated)
    return updated
  }

  const affectedFacets = getAffectedFacets(changedFiles, config)

  if (affectedFacets.size === 0) {
    // Changes don't affect any facet — update hash only
    const updated = { ...oldManifest, gitHash: newGitHash }
    saveManifest(directory, config, updated)
    return updated
  }

  client.tui.showToast({
    body: {
      message: `🕵️ 锦衣卫增量更新中（${affectedFacets.size} 个关注面受影响）...`,
      variant: "info",
    },
  })

  // Get diff summary for context
  const diffSummary = getDiffContent(directory, oldManifest.gitHash, newGitHash, [])

  // Create a single session for all incremental updates
  const session = await client.session.create({
    body: { title: "锦衣卫·增量更新" },
  })
  const sessionId = session.data!.id

  const now = Date.now()
  const updatedManifest: ReconManifest = {
    ...oldManifest,
    gitHash: newGitHash,
    incrementalCount: oldManifest.incrementalCount + 1,
    facets: { ...oldManifest.facets },
  }

  for (const facetId of affectedFacets) {
    const meta = FACET_META[facetId]
    const oldContent = loadFacet(directory, config, facetId) ?? "(此关注面尚无历史报告)"

    const updatePrompt = `项目代码已从 ${oldManifest.gitHash} 更新到 ${newGitHash}。请根据以下变更信息，更新「${meta.title}」关注面的侦察报告。

## 变更概览
\`\`\`
${diffSummary}
\`\`\`

## 变更文件列表
${changedFiles.map((f) => `- ${f}`).join("\n")}

## 当前报告内容
${oldContent}

## 更新要求
1. 请先用 read/grep/glob 工具查看变更涉及的文件，了解具体改动
2. 根据实际改动更新报告内容
3. 保持报告的完整性 — 输出更新后的**完整报告**（不是仅补丁）
4. 使用 Markdown 格式，包含 mermaid 图表（如适用）
5. 如果变更对此关注面没有实质影响，输出原报告内容即可

请直接输出更新后的完整报告。`

    const response = await client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: "jinyiwei",
        parts: [{ type: "text" as const, text: updatePrompt }],
      },
    })

    const newContent = extractText(response.data?.parts ?? [])
    if (newContent.trim()) {
      saveFacet(directory, config, facetId, newContent.trim())
      updatedManifest.facets[facetId] = { updatedAt: now, size: newContent.trim().length }
    }
  }

  saveManifest(directory, config, updatedManifest)

  client.tui.showToast({
    body: {
      message: `🕵️ 锦衣卫增量更新完毕（更新了 ${affectedFacets.size} 个关注面）`,
      variant: "success",
    },
  })

  return updatedManifest
}

// ============================================================
// Public API: ensure facets are up-to-date
// ============================================================

/**
 * Ensure all facet files are up-to-date for the current git state.
 * Decides between full scan vs incremental update automatically.
 *
 * Returns the manifest after ensuring freshness.
 */
export async function ensureReconFresh(
  client: OpencodeClient,
  config: EmperorConfig,
  directory: string,
): Promise<ReconManifest> {
  if (!config.recon.enabled) {
    return { gitHash: "", lastFullScanAt: 0, incrementalCount: 0, facets: {} }
  }

  const gitHash = getGitHash(directory) ?? `no-git-${Date.now()}`
  const manifest = loadManifest(directory, config)

  // Case 1: No manifest → full scan needed
  if (!manifest) {
    return runFullScan(client, config, directory, gitHash)
  }

  // Case 2: Same hash → cached and fresh
  if (manifest.gitHash === gitHash) {
    client.tui.showToast({ body: { message: "🕵️ 锦衣卫: 侦察报告已是最新", variant: "info" } })
    return manifest
  }

  // Case 3: Too many incremental updates → full rebuild
  if (manifest.incrementalCount >= config.recon.maxIncrementalUpdates) {
    client.tui.showToast({
      body: { message: `🕵️ 已累积 ${manifest.incrementalCount} 次增量更新，执行全量重建...`, variant: "info" },
    })
    return runFullScan(client, config, directory, gitHash)
  }

  // Case 4: Missing facets → full rebuild
  const hasFacetFiles = RECON_FACET_IDS.every((id) => manifest.facets[id])
  if (!hasFacetFiles) {
    return runFullScan(client, config, directory, gitHash)
  }

  // Case 5: Incremental update
  return runIncrementalUpdate(client, config, directory, manifest, gitHash)
}

/**
 * Get assembled recon context for a specific role (三省 or 六部).
 *
 * Ensures facets are fresh, then concatenates the relevant facet files for the role.
 * If no mapping exists for the role, returns all facets.
 */
export async function getReconForRole(
  client: OpencodeClient,
  config: EmperorConfig,
  directory: string,
  role: string,
): Promise<{ context: string; gitHash: string; cached: boolean }> {
  const manifest = await ensureReconFresh(client, config, directory)

  const facetIds = ROLE_FACETS[role] ?? RECON_FACET_IDS
  const sections: string[] = []

  for (const id of facetIds) {
    const content = loadFacet(directory, config, id)
    if (content) {
      const meta = FACET_META[id]
      sections.push(`## ${meta.title}\n\n${content}`)
    }
  }

  const context = sections.length > 0
    ? `# 锦衣卫侦察报告（${role} 视角）\n\nGit: ${manifest.gitHash} | 关注面: ${facetIds.join(", ")}\n\n${sections.join("\n\n---\n\n")}`
    : ""

  return {
    context,
    gitHash: manifest.gitHash,
    cached: manifest.lastFullScanAt > 0,
  }
}

/**
 * Force a full rebuild of all facets, regardless of cache state.
 */
export async function forceFullScan(
  client: OpencodeClient,
  config: EmperorConfig,
  directory: string,
): Promise<ReconManifest> {
  const gitHash = getGitHash(directory) ?? `no-git-${Date.now()}`
  return runFullScan(client, config, directory, gitHash)
}

// ============================================================
// Backward-compatible API (used by pipeline.ts)
// ============================================================

/**
 * Phase 0: 锦衣卫 project reconnaissance.
 *
 * Now backed by the faceted cache system:
 * - fullContext = zhongshu facets (architecture + techstack + conventions)
 * - summary = menxia facets (architecture + security + api-surface)
 *
 * Ensures facets are fresh before assembling.
 */
export async function reconWithJinyiwei(
  client: OpencodeClient,
  edict: Edict,
  config: EmperorConfig,
  directory: string,
): Promise<ReconResult> {
  if (!config.recon.enabled) {
    return { fullContext: "", summary: "", gitHash: "", cached: false }
  }

  // Ensure facets are up-to-date
  const manifest = await ensureReconFresh(client, config, directory)

  // Assemble zhongshu context (full planning context)
  const zhongshuResult = await getReconForRole(client, config, directory, "zhongshu")

  // Assemble menxia context (review summary)
  const menxiaResult = await getReconForRole(client, config, directory, "menxia")

  return {
    fullContext: zhongshuResult.context,
    summary: menxiaResult.context,
    gitHash: manifest.gitHash,
    cached: manifest.lastFullScanAt > 0 && manifest.gitHash === manifest.gitHash,
  }
}
