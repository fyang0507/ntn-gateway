---
name: notion-gateway
description: Load when maintaining Fred's Notion knowledge, tickets, project records. Use for creating/updating/appending durable notes, or preserving artifacts beyond the current chat.
---

# Notion Knowledge SOP

Notion is the durable collaboration surface, not merely a place to store text. The goal is to keep shared knowledge and artifacts legible to Fred and future agents.

## Operating Posture

- Treat the live Notion workspace as source of truth; inspect it before acting when current state matters.
- Start with `ntn-gateway show`. Database names are annotated inline with canonical data source IDs.
- Keep the Gateway page high-level: add durable locators or operating notes there only when future agents need them, not as a schema dump.
- Use official `ntn` or the Notion API only as a comparator or narrow escape hatch after the approved surface is identified.

## Knowledge And Artifact SOP

Choose the lightest durable action that preserves shared state:

- For a new task, decision, issue, project, book, note, or artifact: create a database page with validated properties and concise initial body content.
- For changed state: update database properties such as status, dates, assignees, tags, priority, or source links.
- For new evidence, logs, summaries, handoffs, or results: append body blocks to the relevant page.
- For broad, ambiguous, or schema-affecting changes: produce a dry-run plan before writing.
- For duplicate checks or ad hoc search: use `ntn-gateway show` to find the approved data source, then query that data source with official `ntn datasources query <data-source-id> --filter ...`.

## Page Boundary

Notion pages are human-visible artifacts. Do not treat them like private scratch files.

- Append new information instead of rewriting existing human-authored body content.
- For intricate corrections, create a replacement or follow-up page and archive/delete the old page only when that workflow is supported and clearly safer.
- Validate live schema immediately before property-bearing creates or updates.
- If a write creates a reusable database or durable collaboration surface, add its canonical data source ID back to the Gateway page so future agents can discover it.

## Commands To Reach For

- Map: `ntn-gateway show`
- Schema: `ntn-gateway database schema <data-source-id>`
- Read page: `ntn-gateway page get <page-id>`
- Create page: `ntn-gateway page create --database <data-source-id> --title "..." [--properties @props.json] [--content <markdown>|stdin|--stdin]`
- Update properties: `ntn-gateway page properties update <page-id> --properties @props.json [--dry-run]`
- Append body: `ntn-gateway block append <page-id> (--content <markdown>|stdin|--stdin) [--dry-run]`
- Roll up work: `ntn-gateway aggregate pages --status "Not started,In progress" [--since YYYY-MM-DD] [--until YYYY-MM-DD]`

Property JSON is a simple object keyed by live property names; the CLI coerces common scalar, date, and array values:

```json
{ "Status": "Not started", "Start Date": "2026-05-21", "Tags": ["Agent"] }
```

## Gotchas

- Generic Notion connectors are too broad for this workspace. Use them only after this SOP establishes the approved surface and canonical IDs.
- `ntn-gateway` has no `page search` command by design; ad hoc filtering belongs to official data-source query tooling.
- `ntn pages create` is Markdown-first and should not be used for rows that need database properties initialized.
- `page properties update` changes database properties only. Use `block append` for body changes.
- Local tests must stay mocked; do not make test runs mutate the live Notion workspace.
- `record_migration/` is historical evidence, not the active product path.

## Skill Maintenance

When agents fail, update this skill with the durable gotcha, not with generic Notion instructions the model already knows. Keep the description as a routing trigger; change it only when real positive or negative examples show the skill loads at the wrong time.
