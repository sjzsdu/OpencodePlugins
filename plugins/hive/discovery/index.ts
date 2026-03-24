import type { Domain, HiveConfig } from "../types"
import { DiscoveryCache } from "./cache"
import { mergeDomains } from "./merger"
import { generateAgents, toAgent } from "../agents/index"

function registerAllAgents(domains: Domain[], config: HiveConfig, registerAgent: (agent: any) => Promise<void>): void {
  const agents = generateAgents(domains, config)

  if (agents["queen"]) {
    registerAgent(toAgent(agents["queen"]))
  }

  for (const domain of domains) {
    if (agents[domain.id] && !domain.disabled) {
      registerAgent(toAgent(agents[domain.id]))
    }
  }
}

export function discoverDomains(
  directory: string,
  config: HiveConfig,
  registerAgent?: (agent: any) => Promise<void>,
): Domain[] {
  const cache = new DiscoveryCache(directory, config.store.dataDir)
  const cached = cache.load()

  if (!cached || !cached.domains || cached.domains.length === 0) {
    console.log("[hive] No domains found. Run 'hive-init' to create domains.json")
    return []
  }

  const domains = mergeDomains(cached.domains, config.domains)

  if (registerAgent) {
    registerAllAgents(domains, config, registerAgent)
  }

  return domains
}

export function reloadDomains(
  directory: string,
  config: HiveConfig,
  registerAgent?: (agent: any) => Promise<void>,
): Domain[] {
  const cache = new DiscoveryCache(directory, config.store.dataDir)
  const cached = cache.load()

  if (!cached || !cached.domains || cached.domains.length === 0) {
    return []
  }

  const domains = mergeDomains(cached.domains, config.domains)

  if (registerAgent) {
    registerAllAgents(domains, config, registerAgent)
  }

  return domains
}

export { DiscoveryCache } from "./cache"
export { mergeDomains } from "./merger"
