# ntn-gateway Guidance

## Why This Repo Exists

`ntn-gateway` is a Gateway-scoped Notion operations CLI for coding agents working in Fred's Notion workspace.

It exists so agents have one deterministic, low-ambiguity way to inspect and update the workspace without rediscovering Notion structure, guessing database scope, or reaching around the user's intended collaboration boundary. The Gateway page is the boundary: it is the human-readable operating document and the only database registry this tool should trust.

This is not a generic Notion CLI. It is an agent-facing layer above the Notion API that normalizes workspace data, returns token-efficient JSON, validates writes against live schemas, and keeps reusable locators centered on canonical Notion IDs.

## Repo Shape

This repo's active product code lives in `bin/`, `src/`, `test/`, `docs/`, and `skills/`.

`record_migration/` is archived migration evidence. Read it for historical Notion shapes and edge cases, but do not route new product behavior through those scripts.

Use `docs/` for product decisions, implementation status, and phased design context. Use `skills/` for agent-facing companion instructions that should stay aligned with the CLI contract.

The consuming workspace owns installation of the complete `skills/notion-gateway/` and `skills/technical-reading-bookmark/` bundles; edit their source here. Build hooks must not read workspace configuration or install skills outside this checkout; tests use isolated fixtures.

## Operating Model

The CLI contract is Gateway-first:

- Load `NTN_GATEWAY_PAGE_ID` and `NOTION_API_KEY` from `.env` or the process environment.
- Start normal workspace operations from `ntn-gateway show`.
- Treat the Gateway page as the only database registry.
- Accept and emit canonical Notion IDs for reusable locators.
- Emit JSON by default, including stable `{ ok: false, error: { code, message, details? } }` errors.
- Keep tests mocked; local tests must not touch the live Notion workspace.

## Page Operation Boundary

Notion databases in this workspace are meant to be shared surfaces between humans and AI. Keep the normal AI write path narrow, legible, and easy for a human to audit:

- Create new database pages/tickets with validated properties and optional initial body content.
- Update database properties for state changes, assignments, dates, tags, and similar structured fields.
- Append new information to page bodies as blocks instead of rewriting existing human-authored content.

This is an intentional design boundary, not a missing generic Notion feature set. For intricate content changes, prefer creating a replacement or follow-up page and, when supported, deleting/archiving the old page over trying to perform fragile in-place body surgery. Add richer block editing only when a concrete workflow proves it is safer than this create/update/append model.

## Implementation Principles

- Prefer the official Notion JavaScript SDK for product code.
- Treat official `ntn` as a useful raw-operation comparator, not as a required implementation path.
- Fail closed when a target database, page, property, or option is outside the Gateway-approved scope.
- Validate schemas immediately before property-bearing writes.
- Use dry-run plans for broad, ambiguous, or schema-affecting changes.
- Preserve the Gateway page as a high-level operating document; do not turn it into an exhaustive schema dump.

## CLI Design Principles

The CLI is the agent interface, so its responses must teach the agent how to use it. Self-documenting output beats out-of-band documentation.

- Be token-efficient by default. Return the smallest payload an agent needs to act; gate full API echoes and full property dumps behind an explicit `--verbose` (alias `--format full`).
- Serialize JSON compactly by default. The agent is the primary consumer and parses minified JSON fine, so the default `json` format emits no pretty-print indentation (it is pure token overhead that scales with nesting depth and row count). Reserve indented, human-readable output for `--format human`. Note this only removes structural whitespace between tokens; newlines that are part of a string value (e.g. paragraph breaks in page `content`) stay escaped as `\n` and are unaffected.
- Carry behavioral guidance in the response, not in the skill doc. When the CLI hides detail or caps output, the response itself must say so and name the flag that reveals more (e.g. a terse `hint` pointing at `--verbose`, or a truncation `note` pointing at `--limit` and the narrowing filters). Do not document these affordances only in `skills/` — an agent reading the live output should never have to guess that an escape hatch exists.
- Protect the context window on reads. Unbounded fan-out (e.g. cross-database aggregation) must cap results with a sensible default, surface a `truncated` flag, and prefer the most relevant rows (most-recently-edited first) so a truncated sample is still useful.
- Keep `skills/` for workflow intent and durable gotchas, not for restating per-flag CLI behavior that `--help` and the response payload already convey.

## SKILL vs Gateway Page Boundary

These two surfaces document different things; keep them disjoint so neither goes stale by tracking the other's churn.

- `skills/` (SKILL.md) owns **general SOP and CLI usage** — how to operate: the workflow, the commands to reach for, and durable gotchas. This layer changes with the tool.
- The Gateway page owns **Notion/database-specific live context** — which databases exist, their conventions, per-area routing notes, and per-DB facts (e.g. that Connections is a people tracker excluded from work roll-ups). This layer changes with the workspace.
- Do **not** put CLI usage — command names, flags, JSON argument shapes — into the Gateway page. The CLI evolves independently and the page is a human-readable workspace document, not a tool manual; embedding flags there guarantees drift. State the Notion/db fact (the "what" and "why") and let the agent discover the "how" from `--help`, the skill, and self-documenting CLI responses.
- Keep the Gateway page **extremely concise** — like this CLAUDE.md/AGENTS.md, it is the highest level of context and is loaded in full by `ntn-gateway show` on every workspace operation, so its token cost is paid constantly. Record only non-obvious, durable context and gotchas. Omit anything self-explanatory or that `ntn-gateway database schema` already reports (property names, types, options). When you add a per-DB note, prune the same paragraph of redundancy in the same pass.
