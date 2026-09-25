# Atlas Current

A local, time-aware picture of an Atlas vault and the Git history behind it. One command reads the
repository on your machine and writes a folder that opens in any browser:

- **Map** and **Tiers**: the vault's domains, capabilities and elements with their relations.
- **Time**: every commit that changed a concept page as a slice in a volume, worldlines threading
  each concept through its changes, and a forecast slice in front of the present.
- **Trace**: routes down to views, contracts and meaning (for repositories shaped like this one).
- **Studio**: a lit three.js stage of the same graph.
- **Review / Build / Decide / Sources**: drift between pages and code, suggested relations, commits
  that moved code without touching meaning.

Nothing is uploaded. The build reads files and `git log`; `serve` listens on 127.0.0.1 only.

## Use

```sh
pnpm --dir packages/atlas-current install          # three, d3, lucide (pinned)
node packages/atlas-current/bin/atlas-current.mjs build --repo .   # writes ./.atlas-current
node packages/atlas-current/bin/atlas-current.mjs serve            # http://127.0.0.1:4173/
node packages/atlas-current/bin/atlas-current.mjs audit --repo .   # the forecast's checks
```

| Flag | Meaning |
|---|---|
| `--vault <dir>` | vault folder; default `atlas`, then `docs/ontology` |
| `--ref <ref>` | history to read; default `HEAD` |
| `--out <dir>` | output folder; default `<repo>/.atlas-current` |
| `--code-graph <file>` | a code-graph-rag export (`{concepts, edges, unverified, source}`) for call edges |
| `--services <file>` | optional Railway services for the Live panel: `[{key, label, role, projectId, serviceId}]`, kept out of source |
| `--cdn` | one self-contained HTML file that loads its libraries from pinned CDN URLs |
| `--keep-data` | also write the extracted `data.json` |

The Claude Code plugin in `plugins/ontology-atlas` carries this package as `current/` with an
`atlas-current` skill and `/atlas-current` command, so an agent session can build and open it for
whatever project it is in.

The build takes about 4 s on this repository (7,210 commits): one `git log` pass is indexed by
file, and the only content diff is limited to the concepts' own pages and implementation files.

## The forecast, and why it says "not better than recency"

After each commit a small causal model ranks which concepts change next from four readable
signals: recency, co-change, vault and code relations, and repeats. Weights are fitted on the first
60% of the history; every reported score comes from the remaining 40%.

`audit` reruns the same model with one assumption removed at a time. On this repository at
`origin/main` (316 commits touching a concept, 126 held out) it reports:

| Check | Result |
|---|---|
| Hold-out MRR, model vs recency | 0.395 vs 0.431; model minus recency 95% interval −0.076 to +0.004 |
| Same search under an optimistic tie rule | 0.608: the rule rewarded scores that tie 92 of 95 concepts at zero |
| Probabilities vs always guessing the 3% base rate | Brier skill −0.23: the page shows ranks, not percentages |
| Targets that changed before their concept page existed | 57%: today's labels reach into the past |
| Work that did not change in the last 5 commits | MRR 0.061 vs 0.054 for a random ranking |

So the forecast is shown as a ranked guess with hits and misses marked, and the legend states the
audit's verdict. It is honest about persistence, not a claim of foresight.

## Layout

- `bin/atlas-current.mjs`: `build`, `audit`, `serve`.
- `lib/build-data.mjs`: runs the extractors; `lib/assemble.mjs`: page plus data plus libraries.
- `extract/`: `vault`, `code`, `timeline`, `semantic`, `trace`, `forecast`, `forecast-audit`.
- `app/`: the page, its script, the three.js studio, the live layer and the vault parser.
- `test/atlas-current.test.mjs`: end to end on a throwaway Git repository.
  `test/render-smoke.mjs <dir>` opens a build in headless Chromium and fails on any page error
  (`SMOKE_CHROMIUM=<path>` when the installed browser does not match Playwright's build).

To remove it, delete `packages/atlas-current` and the plugin's `current/` staging; nothing else
depends on it.
