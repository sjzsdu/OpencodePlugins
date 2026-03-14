import type { HiveEvent, EventType, Domain } from "../types"

function generateEventId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `evt_${timestamp}_${random}`
}

// Events that ALL domains auto-subscribe to
const GLOBAL_EVENT_TYPES: EventType[] = [
  "requirement_broadcast",
  "conflict_detected",
  "file_changed",
  "action_proposal",
]

export class HiveEventBus {
  private events: HiveEvent[] = []
  private listeners: Array<(event: HiveEvent) => void> = []
  private subscriptions: Map<string, Set<EventType>> = new Map()
  // domainId → Set<EventType>

  constructor(
    private persistFn: (events: HiveEvent[]) => void,
    private restoreFn: () => HiveEvent[],
  ) {}

  restore(): void {
    this.events = this.restoreFn()
  }

  autoSubscribe(domain: Domain): void {
    const types = new Set<EventType>(GLOBAL_EVENT_TYPES)

    // Subscribe to events from dependencies
    // (breaking_change, interface_proposal, task_completed, dependency_updated)
    if (domain.dependencies.length > 0) {
      types.add("breaking_change")
      types.add("interface_proposal")
      types.add("interface_accepted")
      types.add("interface_rejected")
      types.add("task_completed")
      types.add("task_failed")
      types.add("dependency_updated")
    }

    // All domains get these
    types.add("help_request")
    types.add("info")

    this.subscriptions.set(domain.id, types)
  }

  publish(event: Omit<HiveEvent, "id" | "timestamp" | "consumed" | "status">): string {
    const id = generateEventId()
    const full: HiveEvent = {
      ...event,
      id,
      timestamp: Date.now(),
      consumed: [],
      status: "pending",
    }
    this.events.push(full)
    for (const listener of this.listeners) {
      try {
        listener(full)
      } catch {
        // ignore listener errors
      }
    }
    this.persistFn(this.events)
    return id
  }

  onEvent(callback: (event: HiveEvent) => void): () => void {
    this.listeners.push(callback)
    return () => {
      const idx = this.listeners.indexOf(callback)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  consume(domainId: string): HiveEvent[] {
    const subs = this.subscriptions.get(domainId)
    if (!subs) return []

    const result: HiveEvent[] = []

    for (const event of this.events) {
      if (event.status === "expired") continue
      // Skip already consumed by this domain
      if (event.consumed.includes(domainId)) continue
      // Skip self-published events
      if (event.source === domainId) continue

      // Match: targeted to this domain, OR broadcast matching subscription
      const isTargeted = event.target === domainId
      const isBroadcastMatch = event.target === "*" && subs.has(event.type)

      if (isTargeted || isBroadcastMatch) {
        event.consumed.push(domainId)
        result.push(event)
      }
    }

    // Update status for fully consumed events
    for (const event of this.events) {
      if (event.status === "pending" && event.consumed.length > 0) {
        // Check if all subscribed domains have consumed
        const allConsumed = [...this.subscriptions.keys()]
          .filter(id => id !== event.source) // exclude source
          .every(id => event.consumed.includes(id))
        if (allConsumed) {
          event.status = "consumed"
        }
      }
    }

    this.persistFn(this.events)
    return result
  }

  getAll(): HiveEvent[] {
    return [...this.events]
  }

  cleanup(maxAgeMs: number = 3600_000): void {
    const cutoff = Date.now() - maxAgeMs
    this.events = this.events.filter(e => {
      if (e.timestamp < cutoff && (e.status === "consumed" || e.status === "expired")) {
        return false
      }
      // Mark old pending events as expired
      if (e.timestamp < cutoff && e.status === "pending") {
        e.status = "expired"
      }
      return true
    })
    this.persistFn(this.events)
  }
}
