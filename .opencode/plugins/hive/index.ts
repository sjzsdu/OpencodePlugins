import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { HiveEventBus } from "./eventbus/bus"
import { discoverDomains } from "./discovery/index"
import { generateAgents } from "./agents/index"
import { createEmitTool } from "./tools/emit"
import { createStatusTool } from "./tools/status"
import { createBroadcastTool } from "./tools/broadcast"
import { createNegotiateTool } from "./tools/negotiate"
import { createDispatchTool } from "./tools/dispatch"
import { createConfigHook } from "./hooks/config"
import { createSystemTransformHook } from "./hooks/system-transform"
import { createFileWatcherHook } from "./hooks/file-watcher"
import { createAutonomyHandler } from "./hooks/autonomy"
import { HiveStore } from "./store"

export const HivePlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory)
  const store = new HiveStore(directory, config.store.dataDir)

  // EventBus with persistence
  const eventBus = new HiveEventBus(
    (events) => store.saveEvents(events),
    () => store.loadEvents(),
  )
  eventBus.restore()

  // Session → Domain mapping
  const sessionToDomain = new Map<string, string>()

  // Discover domains
  const domains = await discoverDomains(directory, config, client)

  // Subscribe domains to EventBus
  for (const domain of domains) {
    eventBus.autoSubscribe(domain)
  }

  // Generate agent configs
  const agents = generateAgents(domains, config)

  // Set up autonomy handler
  const autonomyHandler = createAutonomyHandler(
    eventBus, domains, config, client, sessionToDomain,
  )

  client.tui.showToast({
    body: {
      message: `🐝 Hive initialized: ${domains.length} domains (${domains.map(d => d.id).join(", ")})`,
      variant: "info",
    },
  })

  return {
    config: createConfigHook(agents),

    "experimental.chat.system.transform": createSystemTransformHook(
      eventBus, sessionToDomain,
    ),

    "tool.execute.after": createFileWatcherHook(
      eventBus, domains, sessionToDomain, autonomyHandler,
    ),

    tool: {
      hive_emit: createEmitTool(eventBus, sessionToDomain),
      hive_status: createStatusTool(domains, eventBus),
      hive_broadcast: createBroadcastTool(eventBus, domains, client, sessionToDomain, config),
      hive_negotiate: createNegotiateTool(eventBus, domains, client, sessionToDomain),
      hive_dispatch: createDispatchTool(eventBus, domains, client, sessionToDomain),
    },
  }
}
