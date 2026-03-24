import type { Part } from "sjz-opencode-sdk"

export function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
}

export function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {}
  const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1])
    } catch {}
  }
  const first = text.indexOf("{")
  const last = text.lastIndexOf("}")
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1))
    } catch {}
  }
  return null
}
