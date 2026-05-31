# ntn-gateway Implementation Progress

Date: 2026-05-20

## 2026-05-31 Dual Markdown ↔ Notion-Block Body Content (#1)

- Body content is now a true Markdown ↔ Notion-block boundary in both directions, fixing the prior behavior where `## heading`/`- bullet` were stored as literal paragraph text and reads returned only a truncated `body_preview`.
- New `src/markdown.js` owns the conversion. Write path (`page create --content`, `block append`) parses Markdown into native Notion blocks: headings (1–3), bulleted/numbered lists, to-dos, quotes, fenced code (with language normalization to Notion's enum), dividers, indentation-nested list children, and inline bold/italic/strikethrough/code/links. Source-only URL paragraphs still become bookmark blocks; raw Notion block JSON still passes through unchanged.
- Read path (`page get`) recursively fetches the block tree (capped depth) and returns the full body as clean Markdown in a new `content` field; `body_preview` is retained for a quick glance.
- The inline rich-text/source-link helpers moved from `io.js` into `src/markdown.js`; `io.js` re-exports `parseRichText`/`sourceUrlFromParagraph` for compatibility. This also preserves link labels on the read path, addressing the shared root cause behind #2 for page bodies.
- Read-path serialization fidelity follow-ups: consecutive numbered list items render with sequential ordinals (`1.`, `2.`, `3.`), resetting per list and per nesting level; and a *labeled* source link (`[Label](URL)` or `Source: [Label](URL)`) is now written as a Notion bookmark with the label stored in the block `caption`, so it still renders as a human-friendly bookmark card and the label survives the Markdown round-trip. Bare source URLs remain caption-less bookmarks.
- Verified live in the `Life misc.` data source: created a multi-format showcase page (headings, nested lists, numbered list, to-dos, multi-line quote, fenced code, divider, bare + labeled source links, inline bold/italic/strikethrough/code/links), read it back as clean Markdown, confirmed both follow-up fixes, then archived the test pages.

## 2026-05-25 Input Contract Follow-Up

- `page create` and `block append` now share the same Markdown body input contract: `--content <markdown>`, `--content @file.md`, piped stdin, or explicit `--stdin`.
- This mirrors the local `ntn pages` content-source model while preserving Gateway-specific property validation, dry-run plans, and a noninteractive explicit-stdin escape hatch.
- `block append` still requires a body source because appending an empty body is not useful; `page create` can omit body content and create a property-bearing page only.

## 2026-05-25 Show Output Follow-Up

- `show.gateway` now returns only the canonical Gateway page `id` plus edit metadata; the Notion URL duplicates the same encoded page ID and is no longer part of the normal output.
- `show.databases` was removed from the public response because approved database locators now live inline in `show.content`; `show.unresolved_databases` omits parser source labels when unresolved references remain.
- `show.content` now renders the Gateway page with resolved canonical data source IDs inline next to the relevant database names/headings, so the Gateway guidance and approved locators can be consumed together without a separate registry section.
- `show` and the internal registry path resolve Gateway database references in parallel, avoiding one round trip per database stacked sequentially.

## Complete In This Pass

- Phase 0 project skeleton with `ntn-gateway` bin entry, `.env`/environment config loading, official Notion JavaScript SDK integration, JSON output, stable JSON errors, mocked tests, and repo guidance that marks `record_migration/` as archived evidence.
- Phase 1 discovery command: `show`, with a Gateway parser for page metadata, rendered Gateway page content, database mentions, table rows, and `link_to_page` database links resolved to canonical data source IDs.
- Phase 2 read-only commands: `database schema` and `page get`, including Gateway scope checks and compact page/schema normalization.
- Phase 3 safe writes: `page create`, `page properties update`, and `block append`, with live schema validation before property-bearing writes and dry-run change plans.
- Phase 4 aggregation: `aggregate pages` queries only Gateway-exposed databases, supports status and date filters, filters status values against each live schema, and groups normalized pages into workflow-oriented buckets.
- Phase 5 workflow presets were removed from the active CLI surface because they were thin wrappers around `aggregate pages`.
- Phase 6 companion skill draft in `skills/notion-knowledge-sop/SKILL.md`.

## Known Constraints

- Gateway database extraction is intentionally heuristic because Gateway page formatting can vary. It handles child database blocks, table rows, and plain text rows containing Notion IDs.
- Notion `alias` blocks are exposed by the public API only as `unsupported` blocks with `block_type: alias`; they do not include the linked target ID. To make an alias-backed database operable through `ntn-gateway`, add a normal database mention/link or canonical ID row alongside it.
- `page search` was removed from the active CLI surface because official `ntn datasources query --filter` offers the comprehensive schema-aware query path for ad hoc searches.
- Aggregation chooses the first status/select property and first date property in each schema for generic filtering. Database-specific aggregation refinements can be layered in after observing live Gateway schemas.
- `database create` is proposal-only and requires `--dry-run`; new databases should be created in Notion, exposed on the Gateway page, then operated through canonical data source IDs.

## Historical Live Smoke Test Note

Read-only live smoke tests on 2026-05-20 confirmed that `.env` credentials can retrieve the Gateway page. The current Notion integration cannot retrieve the referenced Writing database:

```text
Could not find database with ID: 23d9782c-4f4a-801f-9520-ccc9cf94c8c6. Make sure the relevant pages and databases are shared with your integration "fred-agent".
```

Until that database is shared with the integration, `ntn-gateway show` will return it under `unresolved_databases`, and normal commands will not treat it as approved.

This was resolved on 2026-05-21 after rechecking access and fixing the database-mention resolver: `Writing` now resolves to data source `23d9782c-4f4a-808c-b507-000b338ab4a6`.

## Next Verification Commands

```bash
npm test
npm run check
node bin/ntn-gateway.js --help
```

For live verification after credentials are available:

```bash
node bin/ntn-gateway.js show
```

## Verification On 2026-05-20

- `npm test` passed with 11 mocked Notion tests covering discovery, scoped reads, property validation, dry-run writes, block append planning, aggregation, and the then-current workflow wrappers.
- `npm run check` passed JavaScript syntax checks.
- `node bin/ntn-gateway.js --help` ran locally.
- Live `show` and `databases` reached the Gateway page through the configured Notion integration, but no databases were available to operate on because the only parsed database mention, `Writing`, returned Notion `object_not_found` for the integration. The CLI correctly kept normal registry output empty and reported the inaccessible item under `unresolved_databases`.

## Verification On 2026-05-21

- `npm test` passed with 15 mocked Notion tests covering linked database discovery, scoped reads, property validation, dry-run writes, block append planning, aggregation status-option filtering, and the then-current workflow wrappers.
- `npm run check` passed JavaScript syntax checks.
- `node bin/ntn-gateway.js --help` ran locally.
- Live `node bin/ntn-gateway.js show` returned Gateway page markdown and four approved data source IDs: Technical Projects, Home Improvement, Books, and Life misc.
- Live `database schema`, the then-current `page search`, `page get`, `aggregate pages`, the then-current workflow wrappers, `page create --dry-run`, `page properties update --dry-run`, and `block append --dry-run` all completed against approved data sources/pages without writing.
- Follow-up check later on 2026-05-21 showed raw Notion access to `Writing` was available. `ntn-gateway` was patched to treat database mentions as database IDs and resolve their canonical data source IDs. `Writing` now appears in `show` with data source ID `23d9782c-4f4a-808c-b507-000b338ab4a6`.

## Completion Audit On 2026-05-21

- Phase 0 is complete: package skeleton, executable bin, `.env`/environment config, official SDK client, JSON success/error output, mocked tests, and repo guidance all exist and are verified by `npm test`, `npm run check`, and `node bin/ntn-gateway.js --help`.
- Phase 1 is complete for the live Gateway: `show` returns Gateway metadata, rendered Gateway page content, and approved data source IDs. Inaccessible Gateway references are reported as `unresolved_databases` and are not included in the approved registry.
- Phase 2 is complete: schema and page get enforce Gateway scope and return normalized schema/page packets with traceability. The earlier title-only `page search` command was removed in favor of official `ntn datasources query --filter` for ad hoc data-source searches.
- Phase 3 is complete: page create, page properties update, and block append generate SDK request bodies, validate properties against live schema before writes, fail closed for invalid targets/properties/options, and expose dry-run plans.
- Phase 4 is complete: aggregation starts from Gateway discovery, queries only approved data sources, supports status/date/database filters, filters status values per live schema, and groups results into commitments, completed work, stale work, and planning candidates.
- Phase 5 was intentionally removed after review: morning, evening, and weekly workflow presets did not add enough behavior beyond `aggregate pages`.
- Phase 6 is complete: `skills/notion-knowledge-sop/SKILL.md` teaches the Notion knowledge/artifact SOP, one-locator workflow, and property-bearing creates through `ntn-gateway`.
- Gateway stewardship is complete for the current page: the live Agent Note was updated to point to `ntn-gateway database schema <data-source-id>` instead of the older `notion-cli` wording.
- Follow-up audit: `Writing` access is now resolved. The only remaining discoverability limitation is Notion alias blocks whose targets are not exposed by the API; these require adding normal database links/mentions or explicit IDs on the Gateway page if they should become approved `ntn-gateway` databases.
