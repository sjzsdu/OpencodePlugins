import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./config"
import { JsonEdictStore } from "./store"
import { createEdictTool } from "./tools/edict"
import { createMemorialTool } from "./tools/memorial"
import { createHaltTool } from "./tools/halt"
import { createTaiziReconTool, createZhongshuReconTool, createMenxiaReconTool, createLibuReconTool, createBingbuReconTool, createHubuReconTool, createXingbuReconTool, createGongbuReconTool } from "./tools/recon"
import { createSubmitPlanTool, createRejectPlanTool, createApprovePlanTool } from "./tools/workflow"
import { createEdictStatusTool } from "./tools/status"
import { createAssignArchitectureTool, createAssignImplementationTool, createAssignTestingTool, createAssignFixTool, createAssignDocumentationTool, createAssignSecurityAuditTool, createAssignCicdTool, createSubmitMemorialTool } from "./tools/dispatch"

export const EmperorPlugin: Plugin = async ({ client, directory }) => {
  const config = loadConfig(directory)
  const store = new JsonEdictStore(directory, config.store.dataDir)

  client.app.log({ body: { service: "emperor", level: "info", message: "⚔️ Emperor plugin initialized" } })

  return {
    config: async (openCodeConfig) => {
      const configAny = openCodeConfig as any
      if (!configAny.agent) {
        configAny.agent = {}
      }
      for (const [id, agentConfig] of Object.entries(config.agents)) {
        configAny.agent[id] = agentConfig
      }
    },
    tool: {
      // === 原有工具 ===
      "edict": createEdictTool(client, store, config, directory),
      "memorial": createMemorialTool(store),
      "halt": createHaltTool(client, store),
      // === 锦衣卫侦察工具（各省视角） ===
      "taizi_recon": createTaiziReconTool(client, store, config, directory),
      "zhongshu_recon": createZhongshuReconTool(client, store, config, directory),
      "menxia_recon": createMenxiaReconTool(client, store, config, directory),
      // === 三省流转工具 ===
      "submit_plan": createSubmitPlanTool(client, store),
      "reject_plan": createRejectPlanTool(client, store),
      "approve_plan": createApprovePlanTool(client, store, config),
      // === 锦衣卫侦察工具（六部视角） ===
      "libu_recon": createLibuReconTool(client, store, config, directory),
      "bingbu_recon": createBingbuReconTool(client, store, config, directory),
      "hubu_recon": createHubuReconTool(client, store, config, directory),
      "xingbu_recon": createXingbuReconTool(client, store, config, directory),
      "gongbu_recon": createGongbuReconTool(client, store, config, directory),
      // === 尚书省派发工具 ===
      "assign_architecture": createAssignArchitectureTool(client, store),
      "assign_implementation": createAssignImplementationTool(client, store),
      "assign_testing": createAssignTestingTool(client, store),
      "assign_fix": createAssignFixTool(client, store),
      "assign_documentation": createAssignDocumentationTool(client, store),
      "assign_security_audit": createAssignSecurityAuditTool(client, store),
      "assign_cicd": createAssignCicdTool(client, store),
      // === 尚书省呈奏工具 ===
      "submit_memorial": createSubmitMemorialTool(client, store),
      // === Edict status ===
      "edict_status": createEdictStatusTool(store),
    },
  }
}
