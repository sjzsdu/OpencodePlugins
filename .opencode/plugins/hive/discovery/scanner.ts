import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, basename } from "node:path"
import type { Domain } from "../types"

interface ScanResult {
  structureHash: string
  domains: Domain[]
}

function createDomain(partial: Partial<Domain> & { id: string; paths: string[] }): Domain {
  return {
    name: partial.name ?? partial.id,
    description: partial.description ?? `Domain: ${partial.id}`,
    techStack: partial.techStack ?? "",
    responsibilities: partial.responsibilities ?? "",
    interfaces: partial.interfaces ?? [],
    dependencies: partial.dependencies ?? [],
    conventions: partial.conventions ?? [],
    ...partial,
  }
}

function detectTechStack(directory: string): Record<string, boolean> {
  const pkgPath = join(directory, "package.json")
  if (!existsSync(pkgPath)) return {}
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    return {
      react: "react" in allDeps,
      vue: "vue" in allDeps,
      angular: "@angular/core" in allDeps,
      express: "express" in allDeps,
      fastify: "fastify" in allDeps,
      hono: "hono" in allDeps,
      next: "next" in allDeps,
      prisma: "@prisma/client" in allDeps || "prisma" in allDeps,
    }
  } catch {
    return {}
  }
}

function resolveWorkspaces(directory: string, workspaces: string[] | { packages: string[] }): Domain[] {
  const patterns = Array.isArray(workspaces) ? workspaces : (workspaces.packages ?? [])
  const domains: Domain[] = []

  for (const pattern of patterns) {
    if (!pattern) continue // Skip undefined patterns
    // Simple glob resolution: "packages/*" → list dirs in packages/
    const base = pattern.replace(/\/?\*$/, "")
    const dirPath = join(directory, base)
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) continue

    const entries = readdirSync(dirPath)
    for (const entry of entries) {
      const entryPath = join(dirPath, entry)
      if (!statSync(entryPath).isDirectory()) continue

      const pkgJsonPath = join(entryPath, "package.json")
      let name = entry
      let description = `Workspace package: ${entry}`
      if (existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"))
          name = pkg.name ?? entry
          description = pkg.description ?? description
        } catch { /* ignore */ }
      }

      domains.push(createDomain({
        id: entry,
        name,
        description,
        paths: [`${base}/${entry}/`],
      }))
    }
  }

  return domains
}

function resolvePnpmWorkspaces(directory: string, pnpmPath: string): Domain[] {
  try {
    const content = readFileSync(pnpmPath, "utf-8")
    // Simple YAML parsing for packages list
    const packages: string[] = []
    let inPackages = false
    for (const line of content.split("\n")) {
      if (line.trim() === "packages:") {
        inPackages = true
        continue
      }
      if (inPackages && line && line.trim().startsWith("- ")) {
        const pkg = line.trim().replace(/^- ['"]?/, "").replace(/['"]?$/, "")
        if (pkg) packages.push(pkg)
      } else if (inPackages && line && !line.startsWith(" ") && !line.startsWith("\t") && line.trim() !== "") {
        inPackages = false
      }
    }
    return resolveWorkspaces(directory, packages)
  } catch {
    return []
  }
}

function detectByStructure(directory: string): Domain[] {
  const domains: Domain[] = []
  const tech = detectTechStack(directory)

  // Frontend detection
  const frontendPaths = ["src/client", "src/frontend", "client", "frontend"]
  for (const fp of frontendPaths) {
    if (existsSync(join(directory, fp)) && statSync(join(directory, fp)).isDirectory()) {
      let techStack = "Frontend"
      if (tech.react) techStack = "React"
      else if (tech.vue) techStack = "Vue"
      else if (tech.angular) techStack = "Angular"
      else if (tech.next) techStack = "Next.js"

      domains.push(createDomain({
        id: "frontend",
        name: "Frontend",
        description: "Frontend application",
        paths: [`${fp}/`],
        techStack,
        responsibilities: "UI rendering and user interaction",
      }))
      break
    }
  }

  // Backend detection
  const backendPaths = ["src/server", "src/backend", "server", "backend", "src/api"]
  for (const bp of backendPaths) {
    if (existsSync(join(directory, bp)) && statSync(join(directory, bp)).isDirectory()) {
      let techStack = "Backend"
      if (tech.express) techStack = "Express"
      else if (tech.fastify) techStack = "Fastify"
      else if (tech.hono) techStack = "Hono"

      domains.push(createDomain({
        id: "backend",
        name: "Backend",
        description: "Backend API server",
        paths: [`${bp}/`],
        techStack,
        responsibilities: "API endpoints and business logic",
      }))
      break
    }
  }

  // Apps detection
  const appsDir = join(directory, "apps")
  if (existsSync(appsDir) && statSync(appsDir).isDirectory()) {
    const entries = readdirSync(appsDir)
    for (const entry of entries) {
      if (!statSync(join(appsDir, entry)).isDirectory()) continue
      if (domains.some(d => d.id === entry)) continue
      domains.push(createDomain({
        id: entry,
        name: entry,
        description: `App: ${entry}`,
        paths: [`apps/${entry}/`],
      }))
    }
  }

  // Packages detection
  const pkgsDir = join(directory, "packages")
  if (existsSync(pkgsDir) && statSync(pkgsDir).isDirectory()) {
    const entries = readdirSync(pkgsDir)
    for (const entry of entries) {
      if (!statSync(join(pkgsDir, entry)).isDirectory()) continue
      if (domains.some(d => d.id === entry)) continue
      domains.push(createDomain({
        id: entry,
        name: entry,
        description: `Package: ${entry}`,
        paths: [`packages/${entry}/`],
      }))
    }
  }

  // Infra detection
  const infraSignals = [".github/workflows", "Dockerfile", "docker-compose.yml", "docker-compose.yaml"]
  const hasInfra = infraSignals.some(s => existsSync(join(directory, s)))
  if (hasInfra) {
    const infraPaths: string[] = []
    if (existsSync(join(directory, ".github"))) infraPaths.push(".github/")
    if (existsSync(join(directory, "Dockerfile"))) infraPaths.push("Dockerfile")
    if (existsSync(join(directory, "docker-compose.yml"))) infraPaths.push("docker-compose.yml")
    if (existsSync(join(directory, "docker-compose.yaml"))) infraPaths.push("docker-compose.yaml")
    domains.push(createDomain({
      id: "infra",
      name: "Infrastructure",
      description: "CI/CD and deployment configuration",
      paths: infraPaths,
      techStack: "DevOps",
      responsibilities: "Build, test, and deployment pipelines",
    }))
  }

  // Docs detection
  if (existsSync(join(directory, "docs")) && statSync(join(directory, "docs")).isDirectory()) {
    domains.push(createDomain({
      id: "docs",
      name: "Documentation",
      description: "Project documentation",
      paths: ["docs/"],
      responsibilities: "Documentation and guides",
    }))
  }

  return domains
}

export function computeStructureHash(directory: string): string {
  const signals: string[] = []

  // Top-level directories
  try {
    const entries = readdirSync(directory)
      .filter(e => {
        try { return statSync(join(directory, e)).isDirectory() } catch { return false }
      })
      .sort()
    signals.push(...entries)
  } catch { /* empty */ }

  // Key config files
  const configFiles = ["package.json", "pnpm-workspace.yaml", "Dockerfile", "docker-compose.yml"]
  for (const cf of configFiles) {
    if (existsSync(join(directory, cf))) signals.push(`file:${cf}`)
  }

  // Simple hash: join and convert to hex
  const str = signals.join("|")
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0")
}

export function scanProject(directory: string): ScanResult {
  const domains: Domain[] = []

  // 1. Check package.json workspaces
  const pkgPath = join(directory, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      if (pkg.workspaces) {
        domains.push(...resolveWorkspaces(directory, pkg.workspaces))
      }
    } catch { /* ignore */ }
  }

  // 2. Check pnpm-workspace.yaml
  const pnpmPath = join(directory, "pnpm-workspace.yaml")
  if (existsSync(pnpmPath) && domains.length === 0) {
    domains.push(...resolvePnpmWorkspaces(directory, pnpmPath))
  }

  // 3. Heuristic directory detection (if no workspaces found)
  if (domains.length === 0) {
    domains.push(...detectByStructure(directory))
  }

  // 4. Compute structure hash
  const structureHash = computeStructureHash(directory)

  return { structureHash, domains }
}
