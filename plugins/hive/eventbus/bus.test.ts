import { describe, expect, test, beforeEach } from "bun:test"
import { HiveEventBus } from "./bus"
import type { Domain, HiveEvent } from "../types"

describe("HiveEventBus", () => {
  let bus: HiveEventBus
  let persisted: HiveEvent[]

  const frontendDomain: Domain = {
    id: "frontend",
    name: "Frontend",
    description: "React frontend",
    paths: ["src/client/"],
    techStack: "React",
    responsibilities: "UI",
    interfaces: [],
    dependencies: ["backend"],
    conventions: [],
  }

  const backendDomain: Domain = {
    id: "backend",
    name: "Backend",
    description: "Express backend",
    paths: ["src/server/"],
    techStack: "Express",
    responsibilities: "API",
    interfaces: ["GET /api/users"],
    dependencies: [],
    conventions: [],
  }

  beforeEach(() => {
    persisted = []
    bus = new HiveEventBus(
      (events) => { persisted = events },
      () => [],
    )
    bus.autoSubscribe(frontendDomain)
    bus.autoSubscribe(backendDomain)
  })

  test("publish returns event id", () => {
    const id = bus.publish({
      type: "info",
      source: "frontend",
      target: "backend",
      payload: { message: "hello" },
    })
    expect(id).toMatch(/^evt_/)
  })

  test("targeted event delivered to correct domain", () => {
    bus.publish({
      type: "interface_proposal",
      source: "frontend",
      target: "backend",
      payload: { message: "Need GET /profile" },
    })
    const backendEvents = bus.consume("backend")
    const frontendEvents = bus.consume("frontend")
    expect(backendEvents).toHaveLength(1)
    expect(frontendEvents).toHaveLength(0)
  })

  test("broadcast delivered to all except source", () => {
    bus.publish({
      type: "requirement_broadcast",
      source: "queen",
      target: "*",
      payload: { message: "Add OAuth" },
    })
    expect(bus.consume("frontend")).toHaveLength(1)
    expect(bus.consume("backend")).toHaveLength(1)
  })

  test("consumed events not re-delivered", () => {
    bus.publish({
      type: "requirement_broadcast",
      source: "queen",
      target: "*",
      payload: { message: "test" },
    })
    bus.consume("frontend") // first consume
    expect(bus.consume("frontend")).toHaveLength(0) // second consume = empty
  })

  test("self-published events not delivered to self", () => {
    bus.publish({
      type: "task_completed",
      source: "frontend",
      target: "*",
      payload: { message: "done" },
    })
    expect(bus.consume("frontend")).toHaveLength(0)
  })

  test("persist called on publish", () => {
    bus.publish({
      type: "info",
      source: "frontend",
      target: "*",
      payload: { message: "test" },
    })
    expect(persisted.length).toBeGreaterThan(0)
  })
})
