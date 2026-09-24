---
name: atlas-orient
description: Read the project's Atlas ontology before unfamiliar or meaningful work, so you know what the code builds, why it is shaped that way, and what a change could affect. Use before editing code you have not read in this session, before renaming anything, and when asked what depends on what.
---

# Orient with Atlas

The `ontology-atlas` MCP server reads this project's vault: Markdown files whose frontmatter is
the ontology (domains, capabilities, elements and their relations). It is reviewed product
meaning, not a generated index; treat what it says as the team's current understanding.

1. Call `connection_info` once. It names the vault path and server version. If the only tool
   available is `atlas_status`, this project has no vault: tell the person what it reports and
   continue without Atlas. Do not create a vault unless they ask.
2. `list_kinds`, then a narrow `list_concepts` (filter by kind or text) to find the concepts your
   task touches. Avoid dumping the whole vault.
3. `get_concept` on each one you will rely on: read its description, relations and source
   paths before reading the code they point to.
4. Before renaming or moving code, `find_backlinks` on the concept to see what refers to it.
   To explain how two things connect, `find_path` between them.
5. Say which concepts you used. If the code contradicts the vault, report the difference; do not
   silently prefer either.
