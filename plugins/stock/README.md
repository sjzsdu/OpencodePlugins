# Stock — Multi-Agent Stock Analysis Plugin

An [OpenCode](https://opencode.ai) plugin that performs multi-dimensional A-share stock analysis using parallel AI agents. Each agent specializes in one analysis dimension, scores 0-100, and a coordinator aggregates weighted results into a comprehensive HTML report.

## Architecture

```
User: @coordinator 分析 000001
                ↓
         Coordinator (验证股票 + 并发调度)
                ↓ task() × 5 (parallel)
  ┌─────────┬──────────┬──────────┬──────────┐
  ↓         ↓          ↓          ↓          ↓
 finance   chart    sector    sentiment    flow
 30%       25%        15%        15%        15%
  ↓         ↓          ↓          ↓          ↓
  └─────────┴──────────┴──────────┴──────────┘
                ↓
         Reporter (生成 HTML 报告)
                ↓
     .stock/reports/<code>.html + 可选 PDF
```

## Agents

| Agent | Role | Weight | Key Output |
|-------|------|--------|------------|
| **coordinator** | Orchestrator (primary) | — | 验证 + 调度 + 聚合 |
| **finance** | Fundamentals + valuation | 30% | PE/PB 估值判断, 合理价格区间, 股息率 |
| **chart** | Technical analysis | 25% | 趋势方向, 支撑/阻力位, 买卖信号 |
| **sector** | Industry & business | 15% | 行业地位, 竞争格局, 前景 |
| **sentiment** | Sentiment & news | 15% | 研报评级, 概念热点, 媒体情绪 |
| **flow** | Capital flow & chips | 15% | 股东集中度, 机构持仓, 资金流向 |
| **reporter** | HTML report generator | — | SVG 雷达图, 人性化解读, 投资建议 |

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
@coordinator 分析 000001
@coordinator 分析 600519 贵州茅台
```

## Report Output

The plugin generates professional HTML reports at `.stock/reports/<code>.html` containing:

- **Score gauge** — CSS conic-gradient circular score display
- **Radar chart** — SVG 5-dimension visualization
- **Dimension cards** — Each with progress bar + narrative interpretation
- **Bullish/Bearish** — Side-by-side color-coded sections
- **Investment advice** — Tailored for conservative/balanced/aggressive investors
- **PDF export** — `agent-browser open file://path && agent-browser pdf output.pdf`

## Configuration

Create `.opencode/stock.json` (optional — all settings have defaults):

```json
{
  "weights": "balanced",
  "agents": {
    "coordinator": { "model": "anthropic/claude-sonnet-4-20250514" },
    "finance": { "model": "anthropic/claude-sonnet-4-20250514" },
    "chart": { "model": "anthropic/claude-sonnet-4-20250514" }
  }
}
```

### Weight Presets

| Preset | Finance | Chart | Sector | Sentiment | Flow |
|--------|---------|-------|--------|-----------|------|
| **conservative** | 35% | 15% | 15% | 15% | 20% |
| **balanced** (default) | 30% | 25% | 15% | 15% | 15% |
| **aggressive** | 25% | 35% | 15% | 15% | 10% |

Custom weights:

```json
{
  "weights": {
    "finance": 0.40,
    "chart": 0.20,
    "sector": 0.15,
    "sentiment": 0.10,
    "flow": 0.15
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

## Scoring System

Each sub-agent returns a structured JSON score with extended fields:

### finance agent output
```json
{
  "agent": "finance",
  "score": 78,
  "confidence": 0.85,
  "reasoning": "从财务数据来看，该公司净资产收益率持续维持在12%以上...",
  "valuation": {
    "pe_assessment": "合理",
    "fair_price_range": "25-30 元",
    "dividend_yield": "3.2%",
    "risk_alerts": ["负债率偏高"]
  }
}
```

### chart agent output
```json
{
  "agent": "chart",
  "score": 65,
  "confidence": 0.80,
  "reasoning": "从日线图来看，该股近期呈现出明确的上升趋势...",
  "technicals": {
    "trend": "上升趋势",
    "support": "12.5",
    "resistance": "14.8",
    "signal": "买入",
    "multi_timeframe": "日线周线同向多头"
  }
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
│   ├── fundamentalist.ts # 💰 Finance + valuation (30%)
│   ├── technician.ts     # 📈 Chart + signals (25%)
│   ├── industry.ts       # 🏭 Sector + business (15%)
│   ├── sentiment.ts      # 📰 Sentiment + news (15%)
│   ├── chip.ts           # 🎯 Capital flow (15%)
│   └── report-generator.ts # 📄 HTML report with visualization
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
- **PDF export**: agent-browser (Playwright-based)

## License

MIT
