# Stock — Multi-Agent Stock Analysis Plugin

An [OpenCode](https://opencode.ai) plugin that performs multi-dimensional A-share stock analysis using parallel AI agents. Each agent specializes in one analysis dimension, scores 0-100, and a coordinator aggregates weighted results into a comprehensive report.

## Architecture

```
User: @stock-coordinator 分析 000001
                ↓
         Coordinator (验证股票 + 并发调度)
                ↓ task() × 5 (parallel)
  ┌─────────┬──────────┬──────────┬──────────┐
  ↓         ↓          ↓          ↓          ↓
基本面     技术面     行业主营    舆情市场    筹码资金
 30%       25%        15%        15%        15%
  ↓         ↓          ↓          ↓          ↓
  └─────────┴──────────┴──────────┴──────────┘
                ↓
       加权评分 + 综合报告
```

## Agents

| Agent | Role | Weight | Data Source |
|-------|------|--------|-------------|
| **stock-coordinator** | Orchestrator (primary) | — | `quote` (验证) |
| **stock-fundamentalist** | Fundamentals | 30% | `finance`, `xdxr`, F10 财务分析 |
| **stock-technician** | Technical analysis | 25% | `kline` (day/week/60m), `quote` |
| **stock-industry** | Industry & business | 15% | F10 公司概况/经营分析/行业分析, `block` |
| **stock-sentiment** | Sentiment & news | 15% | F10 最新提示/研报评级/热点题材/公告/报道 |
| **stock-chip** | Capital flow & chips | 15% | `finance`, `quote`, F10 股东研究/机构持股/资金动向 |

## Data Source

All market data is fetched via [tongstock-cli](https://github.com/sjzsdu/tongstock) (TDX protocol). Skills are **auto-downloaded** from the repo on first run (`~/.tongstock/`), with bundled fallbacks.

## Quick Start

### 1. Prerequisites

```bash
# Install tongstock-cli
git clone https://github.com/sjzsdu/tongstock.git
cd tongstock
go build -o tongstock-cli ./cmd/cli
sudo mv tongstock-cli /usr/local/bin/
```

### 2. Register Plugin

In `.opencode/opencode.json`:

```json
{
  "plugin": [
    "./plugins/stock/index.ts"
  ]
}
```

### 3. Use

```
@stock-coordinator 分析 000001
@stock-coordinator 分析 600519 贵州茅台
```

## Output Example

```markdown
# 📊 平安银行 (000001) 综合分析报告

## 综合评分: 72/100 ⭐⭐⭐⭐

| 维度 | 得分 | 权重 | 加权分 | 置信度 |
|------|------|------|--------|--------|
| 基本面 | 78 | 30% | 23.4 | 0.85 |
| 技术面 | 65 | 25% | 16.3 | 0.80 |
| 行业主营 | 72 | 15% | 10.8 | 0.75 |
| 舆情市场 | 70 | 15% | 10.5 | 0.70 |
| 筹码资金 | 68 | 15% | 10.2 | 0.80 |
| **合计** | — | 100% | **71.2** | — |
```

## Configuration

Create `.opencode/stock.json` (optional — all settings have defaults):

```json
{
  "weights": "balanced",
  "agents": {
    "stock-coordinator": { "model": "anthropic/claude-sonnet-4-20250514" },
    "stock-fundamentalist": { "model": "anthropic/claude-sonnet-4-20250514" }
  }
}
```

### Weight Presets

| Preset | Fundamentals | Technical | Industry | Sentiment | Chips |
|--------|-------------|-----------|----------|-----------|-------|
| **conservative** | 35% | 15% | 15% | 15% | 20% |
| **balanced** (default) | 30% | 25% | 15% | 15% | 15% |
| **aggressive** | 25% | 35% | 15% | 15% | 10% |

Custom weights:

```json
{
  "weights": {
    "stock-fundamentalist": 0.40,
    "stock-technician": 0.20,
    "stock-industry": 0.15,
    "stock-sentiment": 0.10,
    "stock-chip": 0.15
  }
}
```

## Skill Auto-Download

On first load, the plugin clones [sjzsdu/tongstock](https://github.com/sjzsdu/tongstock) to `~/.tongstock/` and reads skills from `~/.tongstock/skills/`. On subsequent loads, it runs `git pull --ff-only` to sync.

```
Skill loading priority:
1. ~/.tongstock/skills/<name>/SKILL.md  (remote, auto-updated)
2. plugins/stock/skills/<name>.md       (bundled fallback)
```

If both fail (no network + no bundled file), the plugin logs an error but continues — agents can still function using their embedded CLI commands.

## Scoring System

Each sub-agent returns a structured JSON score:

```json
{
  "agent": "stock-fundamentalist",
  "score": 78,
  "confidence": 0.85,
  "summary": "ROE 12.5%，连续3年分红，但资产负债率偏高",
  "bullish": ["净利润稳定增长", "分红历史良好"],
  "bearish": ["负债率偏高", "PE 高于行业均值"],
  "reasoning": "..."
}
```

Score ranges:

| Range | Meaning |
|-------|---------|
| 90-100 | Excellent — strong buy signal |
| 75-89 | Good — worth attention |
| 60-74 | Average — hold/neutral |
| 40-59 | Weak — caution advised |
| 0-39 | Poor — avoid |

## Directory Structure

```
.opencode/plugins/stock/
├── index.ts              # Plugin entry (skill download + agent registration)
├── config.ts             # Weight presets + config loader
├── types.ts              # TypeScript types
├── agents/
│   ├── index.ts          # AGENTS export map
│   ├── coordinator.ts    # 📊 Orchestrator (primary)
│   ├── fundamentalist.ts # 💰 Fundamentals (30%)
│   ├── technician.ts     # 📈 Technical (25%)
│   ├── industry.ts       # 🏭 Industry (15%)
│   ├── sentiment.ts      # 📰 Sentiment (15%)
│   └── chip.ts           # 🎯 Capital flow (15%)
├── skills/               # Bundled fallback skills
│   ├── tongstock-cli.md
│   └── tongstock-workflow.md
└── README.md
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Plugin SDK**: sjz-opencode-sdk
- **Data**: tongstock-cli (TDX protocol, A-share only)

## License

MIT
