---
name: atlas-sync
description: After a meaningful code change, propose updates to the project's Atlas ontology and write only the ones the person approves. Use when a change adds, removes, renames or re-wires a domain, capability or element. Skip for typos, comments, formatting, lint and test fixtures.
---

# Keep Atlas in step with the code

Writing to the vault changes the team's shared meaning, so every write is proposed first and
made only with the person's approval.

1. Read before proposing: `get_concept` on each concept the change touches, and `find_backlinks`
   on anything renamed or removed.
2. Propose in sentences: which concept or relation to add or change, and the evidence (file
   paths, symbols) for it. Write only after the person approves that specific candidate.
3. New concepts and relations: `add_concept`, `add_relation` (or the plural forms for an approved
   batch).
4. Edits: `patch_concept` requires `expected_mtime` from a fresh `get_concept`; if it is refused
   as stale, re-read and re-propose rather than forcing.
5. `rename_concept`, `merge_concepts`, `delete_concept`: call without `confirm` first and show the
   person the dry-run; repeat with `confirm: true` only after they approve it. A code rename does
   not by itself authorize a vault rename.
6. Never call `git_snapshot`, `delete_concept`, `merge_concepts`, `connect_project_source`,
   `index_project` or `finalize_project_meaning` unless the person asks for that action.
7. After writing, `validate_vault` and report its result. A successful write, or
   `finalize_project_meaning`, records a change; it is not the team's acceptance of the meaning.
