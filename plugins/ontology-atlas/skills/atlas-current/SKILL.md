---
name: atlas-current
description: Build and open Atlas Current, a local, time-aware 3D picture of this project's Atlas vault and its Git history (map, tiers, commit-by-commit time view with a change forecast, route trace, studio). Use when the person asks to see how the ontology or codebase changed over time, what is likely to change next, or wants a visual of the vault to share or review.
---

# Atlas Current

Atlas Current reads the project's vault and Git history on this machine and writes a static folder
that opens in any browser. Nothing is uploaded; `serve` listens on 127.0.0.1 only.

1. Build it for the open project:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/current/bin/atlas-current.mjs" build --repo "${CLAUDE_PROJECT_DIR}"
   ```

   It finds the vault in `./atlas` or `./docs/ontology` (pass `--vault <dir>` otherwise) and writes
   `.atlas-current/` in the project. Tell the person that folder is generated and belongs in
   `.gitignore`; do not commit it for them. Add `--code-graph <file>` if they have a code-graph-rag
   export, and `--cdn` for one self-contained HTML file that loads its libraries from pinned CDNs.
2. Open it:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/current/bin/atlas-current.mjs" serve --dir "${CLAUDE_PROJECT_DIR}/.atlas-current"
   ```

   Give the person the printed `http://127.0.0.1:<port>/` address. The server runs until stopped;
   run it in the background and stop it when they are done.
3. Before you repeat any forecast number, run the audit and report its flags with it:

   ```sh
   node "${CLAUDE_PLUGIN_ROOT}/current/bin/atlas-current.mjs" audit --repo "${CLAUDE_PROJECT_DIR}"
   ```

   The forecast is a small causal model (recency, co-change, relations, repeats). The audit reruns
   it with each assumption removed: tie handling, calibration against the base rate, concepts that
   did not exist yet, today's relations, repeated work, commit order, several splits, and a
   bootstrap interval against recency. If the interval includes zero, say the forecast is not
   better than "what changed recently", whatever the headline number is.

The page is read-only. Changing the ontology still goes through the `atlas-sync` skill and the MCP
server's reviewed writes.
