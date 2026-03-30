# Sierra Command Center
### Multi-Industry AI Governance Platform

A production-grade AI intelligence platform that transforms raw customer friction logs into actionable governance packages — powered by a four-agent AI pipeline built on Google Gemini.

Live: **[sierra-command-strategy-center.up.railway.app](https://sierra-command-strategy-center.up.railway.app/)**

---

## Overview

Sierra Command Center runs a multi-agent AI pipeline over customer interaction logs, automatically clustering friction patterns, diagnosing root causes, projecting business impact, and generating production-ready policy change requests — all in real time.

The platform supports two operating modes, switchable from the header:

| Mode | Brand Context | Accent | Impact Label |
|------|--------------|--------|--------------|
| **FINTECH** | DBS · PayNow ⇄ DuitNow | Sierra Green `#00a86b` | Total SGD at Risk |
| **RECOMMERCE** | Carousell · Seller Friction Intelligence | Carousell Red `#e8002d` | Recoverable GMV |

---

## Features

### Multi-Mode Platform
- **FINTECH mode**: Models DBS cross-border payment friction (PayNow/DuitNow). 8 archetypes including KYC Timeout, FX Rate Lock, Duplicate Transaction, Payment Limit Block, and more.
- **RECOMMERCE mode**: Models Carousell marketplace seller friction. 8 archetypes including Listing Rejected, Photo Moderation Failure, Price Sync Failure, Boost Not Applied, Offer Ghosted, Payout Delayed, Category Mismatch, Sold Item Dispute.
- Mode switch resets all state, re-clusters data, and reruns the full pipeline under the new context.
- Per-mode CSS theming via CSS custom properties (`--color-accent`, `--color-bg`, etc.) applied dynamically via `applyTheme()`.

### Four-Agent AI Pipeline (Google Gemini)

Each friction cluster is processed through four sequential agents:

1. **Observer Agent** — Deterministic k-means clustering of friction logs into thematic groups using feature vectors (error code, latency, friction score, user tier, retry count). Produces labeled `FrictionCluster` objects with tier breakdowns and dominant error codes.

2. **Analyst Agent** — Diagnoses root cause, technical debt level, affected subsystem, engineering owner, and remediation time estimate. Produces a structured `InsightCard`. Mode-aware system prompts distinguish payment infrastructure (FINTECH) from marketplace platform (RECOMMERCE) context.

3. **Strategist Agent** — Projects business impact using value models (avg transaction value × cluster frequency × tier multiplier). Produces a `StrategicRecommendation` with priority score (P0–P3), quick wins, long-term fix, and annual loss in SGD/USD. RECOMMERCE uses Power Seller (2.2×) vs Individual (1.0×) tier multipliers.

4. **Architect Agent** — Generates a production `ChangeRequestPackage` containing:
   - Unified policy diff (context/add/remove lines)
   - Context injection rules (trigger, condition, instruction, tone, example)
   - Estimated ROI %
   - Governance notes and affected policy file
   - Chain-of-thought reasoning

AI agents activate on imported logs; base logs use fast deterministic fallbacks for instant load.

### Friction Heatmap
- 2D scatter plot of all friction logs plotted by latency (x) vs friction score (y).
- Color-coded by cluster with per-mode low-end gradient (warm cream for FINTECH, soft pink for RECOMMERCE).
- Hover reveals full log metadata. Click opens the Log Drawer.

### Cluster Panel
- Sidebar showing all active friction clusters ranked by priority.
- Displays: cluster label, dominant error code, average friction score, tier breakdown (Platinum/Gold or Power Seller/Individual), thinking indicator during AI processing.
- Click to select cluster and expand intelligence.

### Intelligence View
- Per-cluster deep-dive panel showing:
  - InsightCard: primary issue, affected subsystem, debt level, RCA detail, API path, owner, remediation estimate
  - StrategicRecommendation: title, rationale, action, priority, business/frustration scores, value projection (monthly + annual loss), quick wins, long-term fix
  - AI reasoning (chain-of-thought) inline for AI-generated outputs
  - AI call metadata: model, input/output chars, latency per agent

### Architect View
- Full-screen modal for reviewing and deploying ChangeRequestPackages.
- Policy diff viewer with syntax-highlighted add/remove/context lines.
- Context injection editor showing all trigger rules.
- One-click "Deploy to Sierra" — animated terminal output simulating validation + deployment, with ROI projection on success.

### Log Import
- Import friction logs from `.txt`, `.docx`, or `.pdf` files.
- Uploaded logs are parsed, assigned metadata (tier, HTTP status, latency, retry count), and injected into the live pipeline.
- The AI pipeline re-runs with `gemini-2.5-flash` for any cluster containing imported logs.
- Post-import result modal shows: cluster assignment (new vs existing), annual loss delta, priority, per-agent reasoning, and Gemini call stats (model, token counts, latency).
- 50 sample logs provided for demo use.

### Impact Banner
- Global header bar showing total annual loss at risk across all clusters.
- Mode-aware label ("Total SGD at Risk" vs "Recoverable GMV").
- Updates live as new logs are imported and pipeline results arrive.

### Status Bar
- Bottom bar showing: active mode, total logs, cluster count, pipeline completion state, AI call summary.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Build | Vite 8 (Rolldown) |
| State | Zustand |
| AI | Google Gemini (`gemini-2.5-flash`) |
| Styling | CSS custom properties + inline styles |
| Deployment | Railway (Nixpacks, Node.js 23, `serve`) |

---

## Architecture

```
src/
├── data/
│   ├── generateLogs.ts     # Seeded PRNG log generation for FINTECH + RECOMMERCE
│   └── logs.ts             # Mode-aware log factory
├── engine/
│   ├── observerAgent.ts    # K-means clustering, mode-aware feature vectors
│   ├── analystAgent.ts     # RCA diagnosis, InsightCard generation
│   ├── strategistAgent.ts  # Value projection, StrategicRecommendation
│   └── architectAgent.ts   # ChangeRequestPackage + policy diff generation
├── lib/
│   ├── aiClient.ts         # Gemini API wrapper with extractJson + fallback
│   └── theme.ts            # THEMES record + applyTheme() CSS var injection
├── store/
│   └── useAppStore.ts      # Zustand store: appMode, logs, clusters, pipelines, CRs
├── types/
│   └── index.ts            # All shared TypeScript interfaces
└── components/
    ├── layout/             # Header, StatusBar, ImpactBanner
    ├── clusters/           # ClusterPanel, ClusterCard
    ├── heatmap/            # FrictionHeatmap
    ├── intelligence/       # InsightCard, RecommendationCard
    ├── architect/          # ArchitectView, PolicyDiff, ContextInjections
    ├── logs/               # LogDrawer, LogDetail
    └── import/             # ImportModal, ImportResult
```

---

## Local Development

```bash
# Install dependencies
npm install

# Set environment variable
echo "VITE_GEMINI_API_KEY=your_key_here" > .env.local

# Start dev server
npm run dev
```

---

## Deployment (Railway)

The project deploys via Railway with Nixpacks. Key config:

**`nixpacks.toml`**
```toml
[phases.setup]
nixPkgs = ["nodejs_23"]

[phases.install]
cmds = ["rm -f package-lock.json", "npm install"]

[phases.build]
cmds = ["npm run build"]

[start]
cmd = "npm run start"
```

**`package.json`** start script: `serve dist -l tcp://0.0.0.0:8080`

Set Railway Target Port to **8080** under Networking settings.

Required environment variable: `VITE_GEMINI_API_KEY` — set in Railway service variables before deploy.
