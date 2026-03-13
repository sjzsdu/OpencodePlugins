import type { OpencodeClient } from "sjz-opencode-sdk"
import type { Domain } from "../types"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

function gatherProjectContext(directory: string): string {
  const parts: string[] = []

  // README
  const readmePath = join(directory, "README.md")
  if (existsSync(readmePath)) {
    const content = readFileSync(readmePath, "utf-8")
    parts.push(`## README.md\n${content.substring(0, 2000)}`)
  }

  // package.json
  const pkgPath = join(directory, "package.json")
  if (existsSync(pkgPath)) {
    const content = readFileSync(pkgPath, "utf-8")
    parts.push(`## package.json\n${content.substring(0, 1000)}`)
  }

  return parts.join("\n\n")
}

function extractText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
    .map(p => p.text)
    .join("\n")
}

export async function analyzeWithLLM(
  client: OpencodeClient,
  directory: string,
  staticDomains: Domain[],
  model?: string,
): Promise<Domain[]> {
  const context = gatherProjectContext(directory)
  const staticSummary = staticDomains.map(d =>
    `- ${d.id}: paths=${d.paths.join(",")}, techStack=${d.techStack}`
  ).join("\n")

  const prompt = `你是一个项目架构分析专家。请分析以下项目结构并返回domain列表。

## 静态扫描结果（作为参考）
${staticSummary || "（无静态扫描结果）"}

## 项目信息
${context || "（无额外信息）"}

请返回一个JSON数组，每个元素包含以下字段:
- id: string (唯一标识，小写字母+下划线)
- name: string (显示名称)
- description: string (一句话描述)
- paths: string[] (关联的文件路径)
- techStack: string (技术栈)
- responsibilities: string (职责描述)
- interfaces: string[] (对外暴露的接口)
- dependencies: string[] (依赖的其他domain的id)
- conventions: string[] (代码约定)

只返回JSON数组，不要其他内容。`

  try {
    const session = await client.session.create({
      body: { title: "Hive·域发现·LLM分析" },
    })
    const sessionId = session.data!.id

    const response = await client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: "default",
        parts: [{ type: "text" as const, text: prompt }],
      },
    })

    const responseText = extractText(response.data?.parts ?? [])

    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.warn("[hive] LLM response did not contain valid JSON array, using static results")
      return staticDomains
    }

    const parsed = JSON.parse(jsonMatch[0]) as Domain[]
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return staticDomains
    }

    return parsed
  } catch (err) {
    console.warn(`[hive] LLM analysis failed: ${err}`)
    return staticDomains
  }
}
