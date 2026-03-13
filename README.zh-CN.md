# Emperor — OpenCode 多智能体协作插件集

一组 [OpenCode](https://opencode.ai) 插件，让多个 AI Agent 协作完成软件开发任务。

## 插件

| 插件 | Agent 数 | 模式 | 适用场景 | 文档 |
|------|---------|------|---------|------|
| [**Commander**](.opencode/plugins/commander/) | 4 | 单指挥官，快速迭代，Coder↔Tester 修复循环 | 大多数开发任务 | [README](.opencode/plugins/commander/README.md) |
| [**Emperor**](.opencode/plugins/emperor/) | 11 | 三省六部，制衡审核 | 需要严格多阶段审查的任务 | [README](.opencode/plugins/emperor/README.md) |
| [**Hive**](.opencode/plugins/hive/) | 动态 | 域自动发现、EventBus 协调、自主执行 | 大型多域项目 | [设计文档](docs/plans/2026-03-11-hive-plugin-design.md) |

### Commander — 自适应 4 Agent 团队

```
用户任务 → Lead（分析规划）→ Coder（实现）↔ Tester（验证）→ [Reviewer] → 报告
```

- **Lead** 探索代码库，制定计划，自适应复杂度分类（trivial / simple / standard / complex）
- **Coder↔Tester 修复循环**：Tester 失败 → Coder 在同一 session 修复（上下文积累）→ Tester 重新验证 → 最多 N 轮
- **Reviewer** 仅在复杂任务时介入
- 独立子任务并行波次调度

### Emperor — 11 Agent 治理体系（三省六部）

```
下旨 → 太子 → 锦衣卫侦察 → 中书省（规划）→ 门下省（审核/封驳）→ 尚书省 → 六部（并行执行）→ 奏折
```

- 完整治理模型：规划、审核封驳、并行执行、后置验证
- 锦衣卫侦察，git-hash 智能缓存
- 强制部门参与（户部测试必参与）
- 敏感操作检测，人工确认

### Hive — 动态域 Agent 协调系统

```
启动 → 扫描项目 → 发现域 → 创建域 Agent + Queen → EventBus 协调 → 自主执行
```

- **域发现**: 静态项目扫描 + LLM 分析增强 + 用户配置合并
- **EventBus**: 发布/订阅事件系统，Agent 间通信
- **Queen 协调者**: 广播需求、协商接口、并行派发任务
- **自主执行**: 域 Agent 可自动适配依赖域的破坏性变更

## 快速开始

### 1. 注册插件

在 `.opencode/opencode.json` 中：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./plugins/commander/index.ts",
    "./plugins/emperor/index.ts"
  ]
}
```

可选其一或两个都启用。

### 2. 使用

**Commander：**

```
@lead 给项目添加用户认证系统，包括 JWT token、刷新机制和角色权限控制
```

**Emperor：**

```
@taizi 给项目添加用户认证系统，包括 JWT token、刷新机制和角色权限控制
```

### 3. 配置（可选）

- Commander: `.opencode/commander.json` — [配置文档](.opencode/plugins/commander/README.md#配置)
- Emperor: `.opencode/emperor.json` — [配置文档](.opencode/plugins/emperor/README.md#配置)

## 项目结构

```
.
├── .opencode/
│   ├── opencode.json                    # 插件注册
│   ├── package.json                     # 插件 SDK 依赖
│   ├── commander.json                   # Commander 配置（可选）
│   ├── emperor.json                     # Emperor 配置（可选）
│   └── plugins/
│       ├── commander/                   # Commander 插件
│       │   ├── index.ts                 # 入口
│       │   ├── agents/                  # 4 个 Agent 定义
│       │   ├── engine/                  # 流水线、分类器、调度器
│       │   └── tools/                   # cmd_task, cmd_status, cmd_halt
│       └── emperor/                     # Emperor 插件
│           ├── index.ts                 # 入口
│           ├── agents/                  # 11 个 Agent 定义
│           ├── engine/                  # 流水线、侦察、审核、调度
│           ├── tools/                   # 下旨、奏折、叫停
│           └── skills/                  # 内置技能
├── package.json                         # 构建工具（私有）
├── tsconfig.json                        # TypeScript 配置
├── .hive/                              # Hive 运行时数据（events.json, domains.json）
└── .github/workflows/
    ├── ci.yml                           # 类型检查 + 测试（触发条件：.hive/, .opencode/plugins/**, tsconfig.json, package.json）
    └── npm-publish.yml                  # 基于 Tag 的选择性发布
```

## 开发

```bash
# 安装依赖
bun install && bun install --cwd .opencode

# 类型检查
bun run build

# 运行测试
bun test
```

## 发布

每个插件通过 git tag 独立发布到 npm：

```bash
# Commander
git tag commander-v0.1.0 && git push --tags

# Emperor
git tag emperor-v0.5.1 && git push --tags
```

| 包名 | 说明 |
|------|------|
| `opencode-plugin-commander` | Commander 插件 |
| `opencode-plugin-emperor` | Emperor 插件 |

## 技术栈

- **运行时**: Bun
- **语言**: TypeScript (strict mode)
- **插件 SDK**: @opencode-ai/plugin
- **存储**: JSON 文件持久化

## 许可证

MIT

---

[English](./README.md)
