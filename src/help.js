const HELP = `ntn-gateway

Gateway-scoped Notion operations for agent collaboration.

Usage:
  ntn-gateway show [--format json|human]
  ntn-gateway database schema <data-source-id>
  ntn-gateway database create --title "..." --dry-run
  ntn-gateway page get <page-id>
  ntn-gateway page create --database <data-source-id> --title "..." [--properties @props.json] [--content <markdown>|stdin|--stdin] [--dry-run]
  ntn-gateway page properties update <page-id> --properties @props.json [--dry-run]
  ntn-gateway block append <page-id> (--content <markdown>|stdin|--stdin) [--dry-run]
  ntn-gateway page body replace <page-id> (--content <markdown>|stdin|--stdin) [--dry-run] [--confirm]
  ntn-gateway aggregate pages [--databases <id|title,...>] [--status "..."] [--all] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--limit N]

Global flags:
  --format json|human   Output format (default json). json is compact (single line) to save
                        agent tokens; human is indented for people.
  --verbose, --format full   Include the full Notion API echo on writes and aggregate.

Environment:
  NTN_GATEWAY_PAGE_ID   Gateway page ID.
  NOTION_API_KEY        Notion integration token.

Output:
  JSON is the default and is emitted compactly (single line, no indentation) to save agent
  tokens; pass --format human for indented, human-readable output.
  Success payloads use {"ok":true,"data":...}.
  Errors use {"ok":false,"error":{"code":"...","message":"..."}}.
  page get returns the page's typed properties and full Markdown content (plus id, url,
  parent, last_edited_time, and an archived flag only when the page is archived).
  Writes and aggregate are terse by default to save context: page create returns the
  normalized page + reminder, block append returns {page_id, appended_count, block_ids},
  and aggregate pages groups rows by database, each page being {id, title, last_edited,
  agent_notes} (URL is inferable from the id; last_edited is date-only; status is omitted
  because rows are grouped under it). These terse responses carry a "hint" pointing here.
  Pass --verbose (or --format full) to also get the full API request/response echo and full
  normalized pages.

  aggregate pages returns a "databases" array; each entry has {id, title, result_count,
  truncated} plus a "by_status" map keyed by the live Notion status value (e.g. "In
  progress", "Done") whose values are page summaries. Scope to specific databases with
  --databases <id|title,...>. By default it hides completed work (done/complete/completed
  statuses) and returns a "status_hint"; pass --all for every status, or --status "Done"
  for just completed tasks. It caps results at 10 per database by default (most-recently-
  edited first) to protect the context window and adds a top-level "note" when rows were
  dropped. Narrow with --status/--since/--until or raise the cap with --limit N.

Content:
  --content accepts inline Markdown or @file.md. Piped stdin is read automatically; --stdin explicitly reads stdin.
  Markdown is parsed into native Notion blocks (headings, bulleted/numbered lists, to-dos, quotes,
  fenced code, dividers, nested lists) so the page renders correctly for humans. Source-only URLs
  become bookmark blocks. Raw Notion block JSON (input starting with [ or {) is still passed through.
  page get returns the full body as clean Markdown in the "content" field.
  page body replace rewrites the whole body: it clears the existing top-level blocks and
  recreates them from the supplied Markdown (use it for mid-page edits/reordering that append
  cannot do). Use --dry-run to preview a line diff plus removed/new block counts and any
  warnings; the destructive apply requires --confirm. Inline page and database mentions are
  preserved (they round-trip as [[id]] / [[db:id]]), so the Gateway registry survives a replace.
  It still cannot recreate standalone database, child-page, table, column, or media
  (image/video/file/pdf/embed) blocks, nor other inline mention types (user/date/link_preview);
  dry-run lists each of those as a warning so nothing is dropped silently.

Links:
  Write a real, clickable page link with [[page-id]] in Markdown body content; it becomes a native
  Notion page mention (optional label: [[page-id|Label]], the label is dropped since Notion renders
  the live title). A database mention uses [[db:database-id]] (the Gateway registry form). page get
  serializes page and database mentions back to [[id]] / [[db:id]] so links round-trip.
  To relate pages through a relation property, pass an array of page IDs for that property, e.g.
  --properties '{"Related": ["<page-id>", "<page-id>"]}' (the related data source must be shared with
  the integration). show resolves each child-database and page link to "Name: <id>" / "Name [[id]]"
  on its own line, preserving the name<->ID mapping.
`;

module.exports = { HELP };
