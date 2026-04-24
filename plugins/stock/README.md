# Stock — Single-Entry HTML Stock Analysis Plugin

An [OpenCode](https://opencode.ai) plugin for Chinese A-share analysis with a **single public entrypoint**. Users provide a natural-language request like `分析 601688` or `分析 601688 技术面`, and the plugin dynamically selects relevant analysis dimensions, incorporates target-price/probability analysis, then **always generates an HTML report**.

## Public Entry

Only one public command is exposed:

```text
@stock 分析 601688
@stock 分析 601688 一月
@stock 分析 601688 技术面
@stock 分析 601688 基本面+资金面
@stock 分析 601688 目标价和概率
@stock 分析 601688 短线
```

## Architecture

```text
User input
  ↓
stock (single orchestrator)
  ↓
parse code / period / style / dimensions
  ↓
parallel subagents
  ├─ finance
  ├─ chart
  ├─ sector
  ├─ sentiment
  ├─ flow
  └─ stock-investment-analyzer
  ↓
reporter
  ↓
.stock/reports/YYYY-MM-DD/<code>.html
```

## Internal Agents

| Agent | Role |
|---|---|
| `stock` | 单入口总协调器 |
| `finance` | 基本面分析 |
| `chart` | 技术面分析 |
| `sector` | 行业面分析 |
| `sentiment` | 情绪/舆情分析 |
| `flow` | 资金/筹码分析 |
| `stock-investment-analyzer` | 目标价、上涨/下跌概率、盈亏比分析 |
| `reporter` | 动态 HTML 报告生成 |

## Scoring Model

The orchestrator now computes:

- `baseScore`: weighted score from enabled core dimensions
- `investmentAdjustment`: target-price/probability adjustment
- `styleAdjustment`: style-based adjustment (short-term, long-term, value, conservative)
- `conflictPenalty`: penalty for conflicting signals
- `finalScore`: final 0-100 score used for recommendation level

Recommendation levels:

- 85-100: 强烈看多
- 75-84: 偏多
- 65-74: 中性偏多
- 55-64: 观望
- 40-54: 偏空
- 0-39: 回避

## Report Output

Every request produces an HTML report at:

```text
.stock/reports/YYYY-MM-DD/<股票代码>.html
```

The report includes:

- 综合评分与结论等级
- 评分拆解（baseScore / investmentAdjustment / styleAdjustment / conflictPenalty / finalScore）
- 动态维度图表
- 各维度详细分析卡片
- 目标价与概率分析区块
- 关键利好、关键风险、当前分歧
- 操作建议与免责声明

## Prerequisites

```bash
git clone https://github.com/sjzsdu/tongstock.git
cd tongstock
go build -o tongstock-cli ./cmd/cli
sudo mv tongstock-cli /usr/local/bin/
```

## Register Plugin

In `.opencode/opencode.json`:

```json
{
  "plugin": [
    "./plugins/stock/index.ts"
  ]
}
```

## Optional Config

Create `.opencode/stock.json`:

```json
{
  "weights": "balanced",
  "agents": {
    "stock": { "model": "anthropic/claude-sonnet-4-20250514" },
    "finance": { "model": "anthropic/claude-sonnet-4-20250514" },
    "chart": { "model": "anthropic/claude-sonnet-4-20250514" }
  }
}
```

### Weight Presets

| Preset | Finance | Chart | Sector | Sentiment | Flow |
|--------|---------|-------|--------|-----------|------|
| conservative | 35% | 15% | 15% | 15% | 20% |
| balanced | 30% | 25% | 15% | 15% | 15% |
| aggressive | 25% | 35% | 15% | 15% | 10% |

## Skill Loading

The plugin auto-loads tongstock skills from `~/.tongstock/skills/` with bundled fallbacks.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Data: tongstock-cli
- Output: HTML report

## License

MIT
