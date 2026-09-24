# Ontology Atlas plugin

Brings a project's Atlas ontology into any Claude Code session: the Atlas MCP server (local,
stdio, no network) for the project's vault, and two skills, `atlas-orient` (read before work) and
`atlas-sync` (propose updates after a change, write only what the person approves).

## Vault

The launcher looks for the vault, first match wins: `OATLAS_VAULT`, `<project>/atlas` (what
`ontology-atlas init` creates), `<project>/docs/ontology`. With none of those, the server offers
one tool, `atlas_status`, that says where it looked and how to start a vault. It never creates one.

## Install

This directory holds the plugin's own files. `pnpm plugin:build` adds the server (unpacked from
the boot-verified `.mcpb` bundle) and writes a marketplace next to it:

```bash
pnpm plugin:build                          # → .tmp/atlas-plugin (marketplace + plugin), verified
claude --plugin-dir .tmp/atlas-plugin/plugins/ontology-atlas    # try it in a session
```

In Claude Code, `/plugin marketplace add <path or repo of the built marketplace>`, then
`/plugin install ontology-atlas@ontology-atlas`.

Writes go through the host's per-tool approval; the plugin grants no permissions in advance.
Set `OATLAS_READ_ONLY=1` for a read-only session, or `OATLAS_WRITE_CONSENT=1` to have the server
ask for consent itself on hosts that support it.
