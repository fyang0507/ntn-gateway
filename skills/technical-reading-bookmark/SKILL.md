---
name: technical-reading-bookmark
description: Bookmark technical articles, blogs, announcements, X posts, GitHub pages, papers, courses, and videos into Fred's Notion Technical Reading database. Use when the user asks to save, bookmark, add, queue, or remember a technical reading/watch item for later reading.
---

# Technical Reading Bookmark

Use this as the fast path for routine Technical Reading saves. Use `notion-gateway` for unusual Notion work, schema changes, or broader workspace questions.

## Required Environment

`ntn-gateway` must be runnable before bookmarking. Even when working from another directory, run `ntn-gateway show` first; the CLI loads env from the caller workspace or its package root. If `show` fails with `config_missing`, fix the install/env before retrying.

## Workflow

1. Identify the source URL.
2. Verify Notion access and identify the current Technical Reading data source:

```bash
ntn-gateway show
```

Use the `Technical Reading` canonical data source ID shown in the rendered content. The current expected ID is `3619782c-4f4a-804a-9670-000be28dec1a`, but treat `ntn-gateway show` as source of truth.

3. Extract title and estimate expected time:

```bash
node skills/technical-reading-bookmark/scripts/extract-reading-metadata.js "$URL"
```

When running from the agent skill symlink, the helper is usually at:

```bash
node .agents/skills/technical-reading-bookmark/scripts/extract-reading-metadata.js "$URL"
```

4. Create the Technical Reading page:

```bash
ntn-gateway page create \
  --database "$TECHNICAL_READING_DATA_SOURCE_ID" \
  --title "$TITLE" \
  --properties '{"Status":"Not started","Expected Reading Time":"15 min"}' \
  --content "$URL"
```

Use the helper's integer `estimated_minutes` for `Expected Reading Time`.
Use the helper's `title` for `--title` unless Fred supplies a better title.

## Defaults

- Put only the URL in the page body. The CLI turns URL-only body content into a Notion bookmark block.
- Leave `Agent Notes` empty by default.
- Add `Agent Notes` only for durable future-agent behavior, such as "skip this for today suggestions because Fred saved it for later this month."
- Do not add summaries, takeaways, commentary, or extra context unless Fred explicitly asks.
- Leave `Start Date` and `End Date` empty unless Fred provides scheduling intent.
- Use `Status: "Not started"` unless Fred says it is already in progress or done.

## Checks

- If `ntn-gateway show` fails with `config_missing`, the workspace/install env is not prepared. Fix or source `NOTION_API_KEY` and `NTN_GATEWAY_PAGE_ID` before retrying.
- If page creation rejects the data source ID after `show` succeeds, rerun `ntn-gateway show` and use the current Technical Reading data source ID.
- If Fred asks "what can I read today?", filter Not started/In progress Technical Reading rows and respect any `Agent Notes` scheduling reminders.
