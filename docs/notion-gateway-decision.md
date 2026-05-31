# Notion Gateway CLI Decision

Date: 2026-05-17

## Decision

Build a Gateway-scoped personal Notion operations CLI named `ntn-gateway`, not `notion-cli`.

`ntn-gateway` will be a deterministic, agent-friendly tool for operating on the Notion workspace through the Gateway page. The Gateway page remains the single entry point and allowed surface area for human/AI collaboration.

## Why Not `notion-cli`

Notion now has an official CLI named `ntn`. Future agents may have skills or tool knowledge for `ntn`, so naming our project `notion-cli` would make it sound like the generic or official Notion CLI.

Our tool is narrower and more opinionated:

- It is specific to Fred's Gateway page.
- It only operates on databases exposed through the Gateway.
- It provides normalized, token-efficient data for agents.
- It supports personal admin workflows through direct aggregation and scoped page operations.

## Relationship To `ntn`

Use official `ntn` as the backbone where possible for authentication and raw Notion API operations.

`ntn-gateway` should sit above `ntn`:

- `ntn`: official Notion CLI, raw API/data source/page/file operations.
- `ntn-gateway`: Gateway-aware registry, normalized retrieval, safe mutation helpers, and aggregation.

This keeps our implementation aligned with Notion's current platform while preserving our personal workspace semantics.

### Page Creation Through `ntn`

`ntn pages create` is Markdown-oriented. It can create a page under a `page:`, `database:`, or `data-source:` parent, but it does not provide first-class flags for setting database properties.

Observed behavior with `ntn v0.14.0` against the Technical Reading data source:

- A first Markdown heading becomes the database page title.
- Non-title properties are left at database defaults.
- YAML/frontmatter-looking Markdown is treated as page body content, not mapped into database properties.
- To set properties during creation, use `ntn api v1/pages` with a full Pages API request body.

Example property-bearing create through `ntn api`:

```bash
ntn api v1/pages -d '{
  "parent": {
    "type": "data_source_id",
    "data_source_id": "<data-source-id>"
  },
  "properties": {
    "Name": {
      "title": [
        {
          "type": "text",
          "text": {
            "content": "New page title"
          }
        }
      ]
    },
    "Status": {
      "status": {
        "name": "In progress"
      }
    },
    "Start Date": {
      "date": {
        "start": "2026-05-18"
      }
    }
  },
  "markdown": "Page body content."
}'
```

`ntn api` also supports inline assignment paths such as `properties[Status][status][name]=In progress`, but those paths are shell-fragile and must be quoted in `zsh`. `ntn-gateway` should generate JSON request bodies for reliability.

## Locator Standard

Use Notion canonical IDs as the only reusable locator in CLI input/output.

The command noun determines the entity type:

```bash
ntn-gateway database schema <data-source-id>
ntn-gateway page get <page-id>
ntn-gateway page properties update <page-id>
ntn-gateway aggregate pages --status "In progress"
```

Gateway commands resolve human-readable names and links into canonical IDs:

```bash
ntn-gateway show
```

The `show.content` response renders the Gateway page with exposed database names/headings annotated inline with resolved canonical data source IDs. Agents should pass those IDs forward. The CLI may keep database IDs, source types, and URLs internally for resolution and scope checks, but normal registry output should stay centered on the canonical data source ID.

## Initial Command Shape

```bash
ntn-gateway show

ntn-gateway database schema <data-source-id>
ntn-gateway database create --title "..." --dry-run

ntn-gateway page get <page-id>
ntn-gateway page create --database <data-source-id> --title "..." [--properties @props.json] [--content <markdown>|stdin|--stdin]
ntn-gateway page properties update <page-id> --properties @props.json --dry-run
ntn-gateway block append <page-id> (--content <markdown>|stdin|--stdin)

ntn-gateway aggregate pages --status "Not started,In progress"
ntn-gateway aggregate pages --status Done --since 2026-05-11 --until 2026-05-17
```

## Intended Command Workflows

Agents should use `ntn-gateway` as a staged workflow, not as a bag of unrelated commands.

### Onboarding

Start every new Notion workspace session with:

```bash
ntn-gateway show
```

`show` should return the Gateway page in an agent-ready format:

- rendered Gateway page content
- inline canonical data source IDs next to each exposed database name or heading

The Gateway is the only registry. If a database is not exposed by `show`, agents should treat it as out of scope unless the user explicitly says otherwise.

### Add Page To Database

Typical sequence:

```bash
ntn-gateway show
ntn-gateway database schema <data-source-id>
ntn datasources query <data-source-id> --filter '{"property":"Name","title":{"contains":"..."}}'
ntn-gateway page create --database <data-source-id> --title "..." [--properties @props.json] [--content <markdown>|stdin|--stdin]
```

Purpose:

- `show`: identify the eligible database from Gateway context.
- `database schema`: inspect exact writable properties and allowed option values just in time.
- `ntn datasources query`: read the rows of a single database and avoid likely duplicates with the official, schema-aware query surface. Requires a logged-in `ntn` (`ntn login` sets the default workspace, or set `NOTION_WORKSPACE_ID`); otherwise it fails with `No workspace selected`. We deliberately do not duplicate this as a `ntn-gateway database rows` command.
- `page create`: create the database page with validated properties and optional body content.

### Update Existing Page

Typical sequence:

```bash
ntn-gateway show
ntn-gateway database schema <data-source-id>
ntn-gateway page get <page-id>
ntn-gateway page properties update <page-id> --properties @props.json
```

Purpose:

- `show`: confirm the page belongs to a Gateway-approved database.
- `database schema`: check the schema of the database where the page belongs.
- `page get`: inspect current properties/body before changing anything.
- `page properties update`: apply the narrow property-only update.
- `block append`: append body content when the requested change belongs in the page body.

Use `--dry-run` when the update is broad, ambiguous, or schema-affecting.

### Search And Inspect

Typical sequence:

```bash
ntn-gateway show
ntn datasources query <data-source-id> --filter '{"property":"Name","title":{"contains":"..."}}'
ntn-gateway page get <page-id>
```

Use this for targeted lookups where a full cross-database aggregate would be too noisy. `ntn-gateway` intentionally delegates ad hoc search syntax to official `ntn` rather than maintaining a narrower parallel query language.

### Cross-Database Retrieval

Typical sequence:

```bash
ntn-gateway show
ntn-gateway aggregate pages --status "Not started,In progress"
```

Use `aggregate pages` when the user asks a cross-cutting question across Gateway databases, such as current commitments, completed pages this week, stale in-progress pages, or candidates for planning.

### Briefings And Lookbacks

For recurring assistant routines, agents should use `aggregate pages` directly:

```bash
ntn-gateway aggregate pages --status "Not started,In progress,Doing,Blocked" --until 2026-05-25
ntn-gateway aggregate pages --status "Done,Complete,Completed" --since 2026-05-18 --until 2026-05-24
```

Workflow presets such as morning brief, evening brief, and weekly lookback were intentionally removed because they were thin wrappers around aggregate filters. Reintroduce a semantic workflow command only when a concrete routine needs additional behavior that cannot be expressed clearly with `aggregate pages` and targeted page inspection.

## Companion Skill

The CLI should be paired with a Notion knowledge/artifact SOP skill for agents.

The skill should teach agents to:

- Start from `ntn-gateway show`.
- Treat the Gateway as the only registry of operable databases.
- Use IDs returned by `ntn-gateway show` as the canonical locators for later commands.
- Inspect schema just in time before writes.
- Use official `ntn datasources query --filter` before creating likely duplicates.
- Use `aggregate pages` for briefings, planning, completed-work review, and stale-work checks.
- Use `--dry-run` before schema or database-level changes.
- Use official `ntn` only for lower-level operations not covered by `ntn-gateway`.

## Open Questions

- Exact JSON output schema for `aggregate pages`.
- What concrete behavior would justify reintroducing workflow commands.
- How calendar handoff should be represented.
- How much schema creation should be supported directly versus proposal-only.
