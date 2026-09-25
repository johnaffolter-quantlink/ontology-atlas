---
id: beeadab1-5523-4581-bb67-2a0af30bc4c0
date: 2026-09-25
---
## 2026-09-25 — Atlas Current leaves the artifact as a local package with an audited forecast

**Why**: the owner asked for the Atlas Current artifact as a real, complete package and plugin, with responsive sizing and learning over the change history. The artifact hard-coded one checkout, took 43 s to build, and quoted a forecast no check had tested.
**Prior**: upholds 2026-09-24 "Atlas travels as a Claude Code plugin"; the app's canvas-2D renderer rule and 2026-09-08 "gateway hero is a lit three.js atlas" stand: this three.js view lives outside `src/`.
**Decision**: `packages/atlas-current` builds a static folder from any repo's vault and Git history (`build`, `audit`, `serve` on 127.0.0.1), vendoring pinned three/d3/lucide files; the plugin carries it with a skill and `/atlas-current`. The forecast ranks by expected tie rank and ships its audit; the page shows ranks and the audit's verdict.
**Dissent**: the audit finds the model no better than recency (MRR 0.395 vs 0.431) and near random on new work; shipping it still teaches readers to trust rings. The verdict line, hit/miss marks and `audit` answer this.
**Falsifier**: a build that fetches anything but fonts, an audit-flagged number shown without its flag, or a vault other than the project's.
**Owner**: repository owner
