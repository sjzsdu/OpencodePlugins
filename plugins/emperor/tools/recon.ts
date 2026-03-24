import { tool } from "@opencode-ai/plugin"
import type { OpencodeClient } from "sjz-opencode-sdk"
import type { EdictStore, EmperorConfig } from "../types"
import { getReconForRole, forceFullScan, createJinyiweiSession } from "../engine/recon"

// ============================================================
// Tool 1: 太子侦察 — taizi_recon
// ============================================================

export function createTaiziReconTool(client: OpencodeClient, store: EdictStore, config: EmperorConfig, directory: string) {
  return tool({
    description: "太子侦察：获取项目架构层面的高层概览，用于接收需求后的初步了解和需求梳理。从锦衣卫缓存的侦察报告中读取太子所需的关注面。",
    args: {
      edict_id: tool.schema.string().optional().describe("旨意 ID（如已创建）"),
      force_rebuild: tool.schema.boolean().optional().describe("是否强制全量重建侦察报告（默认 false）"),
    },
    async execute(args) {
      // 创建可见的子会话（实验性）
      let sessionInfo = ""
      try {
        const session = await createJinyiweiSession(client, "太子侦察")
        if (session?.id) {
          sessionInfo = `\n\n> 📍 会话 ID: ${session.id}\n> 💡 提示: 按 Ctrl+X ↓ 可切换到此子会话查看进度`
          client.tui.showToast({ 
            body: { 
              message: `🕵️ 太子侦察会话已创建: ${session.id}`, 
              variant: "info" 
            } 
          })
        }
      } catch {
        // 继续执行，不阻塞
      }

      try {
        if (args.force_rebuild) {
          await forceFullScan(client, config, directory)
        }

        const { context, gitHash, cached } = await getReconForRole(client, config, directory, "taizi")

        if (!context) {
          return "锦衣卫侦察报告为空。\n\n可能原因：\n1. 项目目录不正确\n2. recon 功能未启用（检查 emperor.json 中 recon.enabled）\n3. jinyiwei agent 未正确配置\n\n可尝试：使用 force_rebuild: true 参数强制重建" + sessionInfo
        }

        let edictBlock = ""
        if (args.edict_id) {
          const edict = store.get(args.edict_id)
          if (edict) {
            edictBlock = `\n\n---\n\n## 当前旨意\n标题: ${edict.title}\n内容: ${edict.content}\n优先级: ${edict.priority}`
          }
        }

        return `${context}${edictBlock}\n\n---\nGit: ${gitHash} | Cached: ${cached}${sessionInfo}`
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return `执行出错: ${msg}\n\n请检查：\n1. jinyiwei agent 是否已注册\n2. 项目是否是有效的 git 仓库`
      }
    },
  })
}

// ============================================================
// Tool 2: 中书省侦察 — zhongshu_recon
// ============================================================

export function createZhongshuReconTool(client: OpencodeClient, store: EdictStore, config: EmperorConfig, directory: string) {
  return tool({
    description: "中书省侦察：获取详细技术上下文用于制定规划方案。从锦衣卫缓存中读取架构总览、技术栈、代码规范三个关注面。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      force_rebuild: tool.schema.boolean().optional().describe("是否强制全量重建侦察报告（默认 false）"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      // 创建可见的子会话
      let sessionInfo = ""
      try {
        const session = await createJinyiweiSession(client, "中书省侦察")
        if (session?.id) {
          sessionInfo = `\n\n> 📍 会话 ID: ${session.id}`
          client.tui.showToast({ 
            body: { 
              message: `🕵️ 中书省侦察会话已创建: ${session.id}`, 
              variant: "info" 
            } 
          })
        }
      } catch {}

      if (args.force_rebuild) {
        await forceFullScan(client, config, directory)
      }

      const { context, gitHash } = await getReconForRole(client, config, directory, "zhongshu")

      if (!context) {
        return "锦衣卫侦察报告为空。请确认项目目录正确且 recon 已启用。" + sessionInfo
      }

      return `${context}\n\n---\n\n## 当前旨意\n标题: ${edict.title}\n内容: ${edict.content}\n优先级: ${edict.priority}\n\n---\nGit: ${gitHash}${sessionInfo}`
    },
  })
}

// ============================================================
// Tool 3: 门下省侦察 — menxia_recon
// ============================================================

export function createMenxiaReconTool(client: OpencodeClient, store: EdictStore, config: EmperorConfig, directory: string) {
  return tool({
    description: "门下省侦察：获取审核所需的关键信息。从锦衣卫缓存中读取架构总览，安全配置、接口定义三个关注面。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
      force_rebuild: tool.schema.boolean().optional().describe("是否强制全量重建侦察报告（默认 false）"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      if (args.force_rebuild) {
        await forceFullScan(client, config, directory)
      }

      const { context, gitHash } = await getReconForRole(client, config, directory, "menxia")

      if (!context) {
        return "锦衣卫侦察报告为空。请确认项目目录正确且 recon 已启用。"
      }

      const planBlock = edict.plan
        ? `\n\n## 待审核的规划方案\n${JSON.stringify(edict.plan, null, 2)}`
        : ""

      return `${context}${planBlock}\n\n---\nGit: ${gitHash}`
    },
  })
}

// ============================================================
// Tool 4: 吏部侦察 — libu_recon
// ============================================================

export function createLibuReconTool(client: OpencodeClient, store: EdictStore, config: EmperorConfig, directory: string) {
  return tool({
    description: "吏部侦察：获取架构设计和文档更新所需的项目上下文。从锦衣卫缓存中读取架构总览、代码规范两个关注面。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      const { context, gitHash } = await getReconForRole(client, config, directory, "libu")

      if (!context) {
        return "锦衣卫侦察报告为空。请确认项目目录正确且 recon 已启用。"
      }

      return `${context}\n\n---\n## 当前旨意\n标题: ${edict.title}\n内容: ${edict.content}\n\n---\nGit: ${gitHash}`
    },
  })
}

// ============================================================
// Tool 5: 兵部侦察 — bingbu_recon
// ============================================================

export function createBingbuReconTool(client: OpencodeClient, store: EdictStore, config: EmperorConfig, directory: string) {
  return tool({
    description: "兵部侦察：获取编码实现所需的项目上下文。从锦衣卫缓存中读取技术栈、代码规范、架构总览三个关注面。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      const { context, gitHash } = await getReconForRole(client, config, directory, "bingbu")

      if (!context) {
        return "锦衣卫侦察报告为空。请确认项目目录正确且 recon 已启用。"
      }

      return `${context}\n\n---\n## 当前旨意\n标题: ${edict.title}\n内容: ${edict.content}\n\n---\nGit: ${gitHash}`
    },
  })
}

// ============================================================
// Tool 6: 户部侦察 — hubu_recon
// ============================================================

export function createHubuReconTool(client: OpencodeClient, store: EdictStore, config: EmperorConfig, directory: string) {
  return tool({
    description: "户部侦察：获取测试验证所需的项目上下文。从锦衣卫缓存中读取测试体系、技术栈两个关注面。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      const { context, gitHash } = await getReconForRole(client, config, directory, "hubu")

      if (!context) {
        return "锦衣卫侦察报告为空。请确认项目目录正确且 recon 已启用。"
      }

      return `${context}\n\n---\n## 当前旨意\n标题: ${edict.title}\n内容: ${edict.content}\n\n---\nGit: ${gitHash}`
    },
  })
}

// ============================================================
// Tool 7: 刑部侦察 — xingbu_recon
// ============================================================

export function createXingbuReconTool(client: OpencodeClient, store: EdictStore, config: EmperorConfig, directory: string) {
  return tool({
    description: "刑部侦察：获取安全审计所需的项目上下文。从锦衣卫缓存中读取安全配置关注面。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      const { context, gitHash } = await getReconForRole(client, config, directory, "xingbu")

      if (!context) {
        return "锦衣卫侦察报告为空。请确认项目目录正确且 recon 已启用。"
      }

      return `${context}\n\n---\n## 当前旨意\n标题: ${edict.title}\n内容: ${edict.content}\n\n---\nGit: ${gitHash}`
    },
  })
}

// ============================================================
// Tool 8: 工部侦察 — gongbu_recon
// ============================================================

export function createGongbuReconTool(client: OpencodeClient, store: EdictStore, config: EmperorConfig, directory: string) {
  return tool({
    description: "工部侦察：获取CI/CD和基础设施更新所需的项目上下文。从锦衣卫缓存中读取CI/CD与基建、技术栈两个关注面。",
    args: {
      edict_id: tool.schema.string().describe("旨意 ID"),
    },
    async execute(args) {
      const edict = store.get(args.edict_id)
      if (!edict) {
        return `未找到旨意: ${args.edict_id}`
      }

      const { context, gitHash } = await getReconForRole(client, config, directory, "gongbu")

      if (!context) {
        return "锦衣卫侦察报告为空。请确认项目目录正确且 recon 已启用。"
      }

      return `${context}\n\n---\n## 当前旨意\n标题: ${edict.title}\n内容: ${edict.content}\n\n---\nGit: ${gitHash}`
    },
  })
}
