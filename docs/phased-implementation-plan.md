# Notion Gateway Phased Implementation Plan

Date: 2026-05-20

## Goal

Build `ntn-gateway` as a Gateway-scoped operations layer for Fred's Notion workspace.

The CLI should make agent collaboration safer by keeping the Gateway page as the only registry, returning normalized data, and hiding raw Notion resolver details behind one canonical ID in command input and output.

## Clarified Implementation Decisions

- Configuration: read `NTN_GATEWAY_PAGE_ID` and `NOTION_API_KEY` from `.env` or the process environment.
- Runtime: use the official Notion JavaScript SDK for programmatic operations.
- Relationship to `ntn`: keep official `ntn` as the agentic reference/backbone and raw-operation comparator, but do not force the product CLI through `ntn` when the SDK gives a clearer path to the source of truth.
- Gateway page stewardship: the Gateway page already exists and may be updated when needed, but it should stay a high-level operating document like `AGENTS.md`. Use progressive disclosure; avoid turning the page into an exhaustive schema dump or implementation manual.
- Build strategy: aim to implement the full end-to-end CLI surface in one coherent pass. If any part remains incomplete, document the gap clearly enough that a future agent can resume without rediscovery.

## Phase 0: Project Skeleton And Operating Rules

Purpose: make the repo safe for implementation.

Deliverables:

- Package skeleton with a runnable `ntn-gateway` command.
- Configuration loading for the Gateway page ID and Notion credentials.
- Official Notion JavaScript SDK integration.
- Shared command output contract: JSON by default, stable error shape, and optional human-readable mode only where useful.
- Local test harness with mocked Notion responses.
- Repo guidance that distinguishes active source code from archived migration scripts.

Acceptance:

- `ntn-gateway --help` runs locally.
- A command can emit structured success and error JSON.
- Tests run without touching the live Notion workspace.

## Phase 1: Gateway Discovery

Purpose: establish the Gateway as the single source of truth before any write commands exist.

Deliverables:

- `ntn-gateway show`
- Gateway parser that renders Gateway page content with resolved canonical data source IDs inline.
- Optional Gateway page update helper or documented manual update procedure, used only to keep the high-level operating page coherent.
- Cache-free first implementation unless live latency becomes painful.

Acceptance:

- `show` returns an agent-ready packet with the Gateway page, workspace rules, and exposed databases.
- Databases not exposed through the Gateway are absent from normal output.

## Phase 2: Read-Only Database And Page Operations

Purpose: make the tool useful for inspection while preserving low risk.

Deliverables:

- `ntn-gateway database schema <data-source-id>`
- `ntn-gateway page get <page-id>`
- Schema normalization for property types, writable fields, status/select options, relation fields, and date fields.
- Page normalization for compact properties, URL, parent data source, and body preview.

Acceptance:

- All read commands reject IDs outside the Gateway registry unless an explicit override is added later.
- Ad hoc database searches and duplicate checks are delegated to official `ntn datasources query --filter`, after `ntn-gateway show` identifies the Gateway-approved data source ID.
- `page get` is compact enough for agent context but keeps enough traceability to verify the source page.

## Phase 3: Safe Property-Bearing Writes

Purpose: add mutation only after schema-aware validation is in place.

Deliverables:

- `ntn-gateway page create --database <data-source-id> --title "..." [--properties @props.json] [--content <markdown>|stdin|--stdin]`
- `ntn-gateway page properties update <page-id> --properties @props.json --dry-run`
- `ntn-gateway block append <page-id> (--content <markdown>|stdin|--stdin)`
- SDK-backed JSON request-body generation equivalent to the reliable `ntn api v1/pages` path.
- Property validation against the live schema immediately before writes.
- Dry-run output showing the exact normalized change plan.

Acceptance:

- Property-bearing creates do not use `ntn pages create`.
- Writes fail closed when the target database is not Gateway-approved, when a property is unknown, or when an option value is invalid.
- Broad property updates have a dry-run path that is easy for a human to inspect.

## Phase 4: Aggregation

Purpose: support cross-database assistant workflows without each agent rebuilding query logic.

Deliverables:

- `ntn-gateway aggregate pages --status "..."`
- Date filters such as `--since` and `--until`.
- Cross-database normalization for commitments, completed work, stale work, and planning candidates.
- Optional filters for database, tag/task, starred, and owner only after the first aggregate is stable.

Acceptance:

- Aggregates start from `show` internally and only query exposed databases.
- Output groups results by workflow-relevant meaning, not by raw Notion API shape.
- The command remains deterministic and token-efficient for agent use.

## Phase 5: Deferred Workflow Presets

Purpose: avoid adding semantic wrappers until they do more than restate `aggregate pages`.

Decision:

- `morning-brief`, `evening-brief`, and `weekly-lookback` presets were removed from the active CLI surface.
- Agents should use `ntn-gateway aggregate pages` directly for briefings, planning, completed-work review, and stale-work checks.
- Reintroduce a workflow command only when a concrete routine needs behavior that cannot be expressed clearly through aggregate filters and normal page inspection.

## Phase 6: Companion Agent Skill

Purpose: make the CLI usable by future agents without rediscovering the operating model.

Deliverables:

- A Notion knowledge/artifact SOP skill that teaches agents to start from `ntn-gateway show`.
- Guidance to treat the Gateway as the only registry.
- Examples for add-page, update-page, search-inspect, and aggregate sequences.

Acceptance:

- A fresh agent can follow the skill and complete ordinary read/update tasks with the one-locator model.
- The skill routes property-bearing creates through `ntn-gateway`, not raw migration scripts or `ntn pages create`.

## Implementation Order

Although the intended build is end-to-end, keep the internal sequence disciplined:

1. Phase 0 and Phase 1 first, because every later command depends on Gateway discovery and output contracts.
2. Phase 2 next, because read-only behavior reveals schema and normalization issues before mutation risk exists.
3. Phase 3 only after read-only commands can prove the target database and schema.
4. Phase 4 after basic writes are stable, since aggregation should be composed from proven lower-level commands.
5. Phase 6 once the command shape has stopped moving enough for durable agent instructions.

At the end of each implementation pass, update this document or a nearby progress note with what is complete, what is partial, and the exact next command or file a future agent should inspect first.

## Non-Goals For The First Pass

- A generic Notion CLI.
- Multiple locator formats in command input/output.
- Direct operation on databases that are not exposed by the Gateway page.
- Replacing every historical migration script with reusable product code.
- Building a UI before the CLI contracts are stable.
