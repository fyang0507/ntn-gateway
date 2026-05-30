# ntn-gateway Guidance

## Why This Repo Exists

`ntn-gateway` is a Gateway-scoped Notion operations CLI for coding agents working in Fred's Notion workspace.

It exists so agents have one deterministic, low-ambiguity way to inspect and update the workspace without rediscovering Notion structure, guessing database scope, or reaching around the user's intended collaboration boundary. The Gateway page is the boundary: it is the human-readable operating document and the only database registry this tool should trust.

This is not a generic Notion CLI. It is an agent-facing layer above the Notion API that normalizes workspace data, returns token-efficient JSON, validates writes against live schemas, and keeps reusable locators centered on canonical Notion IDs.

## Repo Shape

This repo's active product code lives in `bin/`, `src/`, `test/`, `docs/`, and `skills/`.

`record_migration/` is archived migration evidence. Read it for historical Notion shapes and edge cases, but do not route new product behavior through those scripts.

Use `docs/` for product decisions, implementation status, and phased design context. Use `skills/` for agent-facing companion instructions that should stay aligned with the CLI contract.

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
