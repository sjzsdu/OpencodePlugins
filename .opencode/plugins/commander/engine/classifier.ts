import type { Plan, Complexity } from "../types"

/** Classify task complexity based on the plan Lead creates */
export function classifyComplexity(plan: Plan): Complexity {
  const { subtasks, risks } = plan

  if (subtasks.length === 0) return "trivial"
  if (subtasks.length === 1 && subtasks[0].effort === "low") return "simple"

  const hasHighEffort = subtasks.some((s) => s.effort === "high")
  const hasRisks = risks.length > 0
  const hasManySubtasks = subtasks.length >= 4

  if (hasHighEffort || (hasRisks && hasManySubtasks)) return "complex"
  return "standard"
}
