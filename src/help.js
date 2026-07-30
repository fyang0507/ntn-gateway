const HELP = `ntn-gateway

Gateway-scoped Notion operations for agent collaboration.

Usage:
  ntn-gateway show [--format json|human]
  ntn-gateway database schema <data-source-id>
  ntn-gateway database create --title "..." --dry-run
  ntn-gateway page get <page-id> [--content full|none|preview] [--max-content-chars N] [--head-lines N] [--tail-lines N] [--section <text>] [--find <text>]
  ntn-gateway page create --database <data-source-id> --title "..." [--properties @props.json] [--content <markdown>|stdin|--stdin] [--dry-run] [--allow-new-options]
  ntn-gateway page properties update <page-id> --properties @props.json [--dry-run] [--allow-new-options]
  ntn-gateway block append <page-id> (--content <markdown>|stdin|--stdin) [--dry-run]
  ntn-gateway page body replace <page-id> (--content <markdown>|stdin|--stdin) [--dry-run] [--confirm]
  ntn-gateway aggregate pages [--databases <id|title,...>] [--status "..."] [--all] [--date-filter '<json>'] [--limit N]

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
  dropped. Narrow with --status/--date-filter or raise the cap with --limit N.
  The Connections database (people/relationship tracker, not a ticketed project) is excluded
  from the default sweep and listed under a top-level "skipped"; name it explicitly in
  --databases to include it.

Date filtering:
  --date-filter takes a JSON object (inline or @file.json) keyed by date field; each field
  carries optional "after"/"before" YYYY-MM-DD bounds. All bounds are AND-combined with each
  other and the status filter. "after" -> on_or_after, "before" -> on_or_before.
    {"start":{"after":"2026-01-01","before":"2026-06-30"},"end":{"before":"2026-12-31"},
     "created":{"after":"2026-05-01"},"edited":{"after":"2026-05-01","before":"2026-05-31"}}
  Fields: start -> "Start Date" property, end -> "End Date" property, created -> created_time
  (built-in), edited -> last_edited_time (built-in). created/edited work on every database;
  start/end require those properties to exist. There is no pre-query schema guard: if a named
  database lacks "Start Date"/"End Date", Notion's validation error is surfaced on that
  database's entry as an "error" field and the rest of the sweep still returns.

Reading page bodies:
  page get returns the full Markdown body in "content" by default. To verify an append or read one
  section without pulling the whole body into context, pass exactly ONE shaping option (two or more
  fail with argument_conflict):
    --content full|none|preview   full (default, whole body); none omits "content" entirely and
                                  returns content_omitted:true + a content_hint; preview returns the
                                  first ~400 chars (cut on a line boundary where practical).
    --max-content-chars N         first N chars of the body.
    --head-lines N / --tail-lines N   first / last N lines. N must be a positive integer.
    --section <text>              the section from the first heading whose text contains <text>
                                  (case-insensitive) through the line before the next heading of the
                                  same-or-higher level; content_section_found:false if none matches.
    --find <text>                 every line containing <text> (case-insensitive) with up to 2 lines of
                                  context each side; adds content_find_matches:N.
  Whenever content is actually truncated (a shaped slice shorter than the full body), the result
  carries content_truncated:true, content_lines_total and content_chars_total (of the FULL body), and
  a content_note naming the flags to read more or the whole body. --content none and a non-matching
  --section instead report content_omitted:true / content_section_found:false with those totals.

Content:
  --content accepts inline Markdown or @file.md. Piped stdin is read automatically; --stdin explicitly reads stdin.
  A bare existing file path passed as --content <path> (no leading @) fails with content_looks_like_path
  so the file is not written verbatim as literal Markdown; use --content @<path> to read the file.
  block append and page body replace auto-batch appends over 100 blocks (NOTION_CHILD_LIMIT) into
  sequential appends; results carry batch_count and appended_count. Dry-run is terse by default
  (block append: block_count; page body replace: new_block_count/removed_block_count; both:
  notion_child_limit, would_require_batches); pass --verbose to also echo the full children request body.
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

Properties (--properties):
  --properties takes a JSON object (inline or @file.json) keyed by the live property NAME; each
  value is a simplified scalar the CLI expands into the correct Notion property object (an already-
  shaped Notion property object is also accepted and passed through). Unknown names fail with
  property_unknown, non-writable names with property_read_only. Value shape by property type:
    title, rich_text          string, e.g. "Forward Deployed Engineer"
    select, status            option-name string, e.g. "Applied" (must be a live option)
    multi_select              array of option-name strings, e.g. ["ai-infra","backend"]
    date                      "YYYY-MM-DD" (or full ISO) string, or {"start":"..","end":".."} for a range
    number                    number, e.g. 120000
    checkbox                  true or false
    url, email, phone_number  string, e.g. "https://job-boards.example.com/x"
    relation, people          array of IDs, e.g. ["<page-id>"] (relation) / ["<user-id>"] (people)
  The title property is normally set with --title, which fills whatever the title property is named
  (e.g. a "Company" title column), so it need not be repeated in --properties. Pass null to clear a
  select/status/url/email/phone_number/number value. See Options below for select/status option
  rules and Links below for relation linking.

Options (select / multi_select):
  Writing an unrecognized select or multi_select value fails closed with "property_new_option",
  whose details carry "new" (your unrecognized values) and "existing" (the live options) so you
  can reuse an existing option instead of inventing a near-duplicate. If none fits, re-run the same
  write with --allow-new-options to let Notion create the new option(s) by name. --dry-run previews
  which options would be created under "new_options". status options are UI-managed: an unrecognized
  status value always fails with "property_option_invalid" and --allow-new-options does not apply.

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
