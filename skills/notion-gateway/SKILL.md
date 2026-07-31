---
name: notion-gateway
description: Load when maintaining Fred's Notion knowledge, tickets, project records. Use for creating/updating/appending durable notes, or preserving artifacts beyond the current chat.
---

# Notion Knowledge SOP

Notion is the durable collaboration surface, not merely a place to store text. The goal is to keep shared knowledge and artifacts legible to Fred and future agents.

## Operating Posture

- Treat the live Notion workspace as source of truth; inspect it before acting when current state matters.
- Start with `ntn-gateway show`. Each child-database and page link resolves to its own line as `Name: <id>` (databases) or `Name [[page-id]]` (pages), preserving the name<->ID mapping.
- If working outside the `ntn-gateway` repo, still run `ntn-gateway show` before writes; the CLI should load env from the caller workspace or its package root, and `config_missing` means the runtime install/env is not prepared.
- One canonical home per rule, so the layers do not drift: this skill owns *how* to operate Notion (workflow, SOP, posture, gotchas); the live Gateway page owns *live routing* (database IDs, workspace-specific priorities, per-area notes). Cross-reference; do not duplicate.
- Keep the Gateway page to live routing, not a schema dump and not an SOP copy. Do not hard-code volatile IDs or priorities into this skill. If the Gateway page restates a rule that belongs here, treat this skill as authoritative and trim the page back to routing.
- Use official `ntn` or the Notion API only as a comparator or narrow escape hatch after the approved surface is identified.

## Knowledge And Artifact SOP

Choose the lightest durable action that preserves shared state:

- For a new task, decision, issue, project, book, note, or artifact: create a database page with validated properties and concise initial body content.
- For changed state: update database properties such as status, dates, assignees, tags, priority, or source links.
- For new evidence, logs, summaries, handoffs, or results: append body blocks to the relevant page.
- For broad, ambiguous, or schema-affecting changes: produce a dry-run plan before writing.
- To read the rows of a single database (the common "show me what's in X" first action), duplicate-check, or ad hoc search: use `ntn-gateway show` to find the approved data source, then run official `ntn datasources query <data-source-id>` (add `--filter ...`, `--sort ...`, `--limit ...`, `--plain`/`--json` as needed). This requires a logged-in `ntn` (run `ntn login`, or set `NOTION_WORKSPACE_ID`); without it the query fails with `No workspace selected`.
- Body content is Markdown in both directions: writes parse Markdown into native Notion blocks (headings, lists, to-dos, quotes, fenced code, dividers, nested lists, inline bold/italic/code/links), and `page get` returns the full body as clean Markdown in `content`. Write Markdown normally instead of pre-building Notion block JSON.
- For source links in page bodies, put the URL on its own paragraph or use `Source: [label](URL)`; the CLI converts source-only links into Notion bookmark blocks instead of plain Markdown or HTML.
- To make a real, clickable link to another Notion page in body content, write `[[page-id]]` (optionally `[[page-id|Label]]`); it becomes a native page mention rather than inert `[Name]` text, and `page get` round-trips it back to `[[page-id]]`. To relate pages structurally, set a relation property to an array of page IDs (`{"Related": ["<page-id>"]}`); the related data source must be shared with the integration. Never hand-write plain-text `[Name]` placeholders for links.
- `Agent Notes` is a lightweight status tracker, not a content store. Keep it to a few lines of hot operational state a future agent needs *before* opening the page: current status, next step, and preservation flags (e.g. "skip today's suggestions — Fred saved this for next month"). Substantive content — findings, logs, summaries, handoffs, decisions with reasoning, drafts — belongs in the page body via `block append`, never in this property. Discriminator: if it reads as a pointer to state, it is a note; if it reads as the work itself, it is body content. When a note starts to grow, move the substance to the body and leave a one-line pointer.
- For ambiguous or schema-affecting writes, run `--dry-run` first to preview the request (and, for select/multi_select, any options that would be newly created) before applying.
- Reuse existing `select`/`multi_select` options before inventing new ones. An unrecognized value fails closed with the live options in the error payload — read them and pick an existing fit (e.g. `high-priority`, not a new `urgent`). Only when none fits, re-run the same write with `--allow-new-options` to let Notion create the option by name. `status` options are UI-managed and cannot be created this way; a new status value always fails.

## Page Boundary

Notion pages are human-visible artifacts. Do not treat them like private scratch files.

- Append new information instead of rewriting existing human-authored body content.
- `page body replace` is the escape hatch for mid-page edits/reordering append cannot do, but it is destructive: it clears the body and recreates it from Markdown. Gate it behind `--dry-run` (preview the diff + warnings) then `--confirm`. It cannot reconstruct child_database/child_page/table/column/media blocks, so never replace a body that holds the database registry (the Gateway page) wholesale — append there instead.
- For intricate corrections, create a replacement or follow-up page and archive/delete the old page only when that workflow is supported and clearly safer.
- Validate live schema immediately before property-bearing creates or updates.
- If a write creates a reusable database or durable collaboration surface, add it to the Gateway page as an inline `@`-mention (not a link-to-page block) so future agents can discover its name and canonical data source ID. `ntn-gateway database create` returns this reminder too.

## Commands To Reach For

- Map: `ntn-gateway show`
- Schema: `ntn-gateway database schema <data-source-id>`
- Read page: `ntn-gateway page get <page-id>`
- Create page: `ntn-gateway page create --database <data-source-id> --title "..." [--properties @props.json] [--content <markdown>|stdin|--stdin]`
- Update properties: `ntn-gateway page properties update <page-id> --properties @props.json [--dry-run]`
- Append body: `ntn-gateway block append <page-id> (--content <markdown>|stdin|--stdin) [--dry-run]`
- Replace body (mid-page edit/reorder): `ntn-gateway page body replace <page-id> (--content <markdown>|stdin|--stdin) [--dry-run] [--confirm]`
- Roll up work across Gateway databases: `ntn-gateway aggregate pages --status "Not started,In progress" [--date-filter '{"start|end|created|edited":{"after":"YYYY-MM-DD","before":"YYYY-MM-DD"}}']` (run `--help` for field semantics)
- Read rows of one database: `ntn datasources query <data-source-id> [--filter ...] [--sort ...] [--limit N] [--plain|--json]` (needs `ntn login`)

Property JSON is a simple object keyed by live property names; the CLI coerces common scalar, date, and array values:

```json
{ "Status": "Not started", "Start Date": "2026-05-21", "Tags": ["Agent"] }
```

## Gotchas

- Generic Notion connectors are too broad for this workspace. Use them only after this SOP establishes the approved surface and canonical IDs.
- `ntn-gateway` has no `page search`, archive/deletion or single-database `rows` command by design; use official CLI like `ntn datasources query`. That command needs `ntn` logged in (`ntn login`, or `NOTION_WORKSPACE_ID` / `NOTION_API_TOKEN`); a bare token without a selected workspace yields `No workspace selected`. Confirm with `ntn doctor`.
- `ntn pages create` is Markdown-first and should not be used for rows that need database properties initialized.
- `page properties update` changes database properties only. Use `block append` for body changes.
- `--content` takes literal Markdown, not a path. To load a file, prefix `@` (`--content @notes.md`); a bare existing file path fails closed with `content_looks_like_path` so the file name is never written as body text.
- `page get` supports lightweight read modes (see `--help`) to verify an append or read one section/preview without pulling the whole body into context. Reach for them instead of a full read when you only need to confirm a change landed.
- `block append` and `page body replace` auto-chunk appends beyond Notion's 100-block limit; you can append arbitrarily many blocks in one command without hitting the API cap.
- Local tests must stay mocked; do not make test runs mutate the live Notion workspace.
- `record_migration/` is historical evidence, not the active product path.

## Skill Maintenance

When agents fail, update this skill with the durable gotcha, not with generic Notion instructions the model already knows. Keep the description as a routing trigger; change it only when real positive or negative examples show the skill loads at the wrong time.
