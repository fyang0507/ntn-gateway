# ntn-gateway

[![Runtime](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)](package.json) [![Agent-native](https://img.shields.io/badge/design-agent--native-8A2BE2)](skills/notion-gateway/SKILL.md) [![Works with](https://img.shields.io/badge/works%20with-Codex%20%C2%B7%20Claude%20Code-black)](skills/notion-gateway/SKILL.md) [![Works with](https://img.shields.io/badge/works%20with-Notion-000000?logo=notion&logoColor=white)](https://www.notion.so/) [![Publication](https://img.shields.io/badge/npm-not%20published-555555)](#publication--license)


> **Durable shared state for human-and-agent work.**

`ntn-gateway` is an agent-native Notion gateway for durable shared state and human/agent workflow coordination. It gives agents one narrow, legible path into a shared Notion workspace—so the work survives a session, and the humans who return to it can still understand what happened.

This is deliberately **not** a general-purpose Notion wrapper. Direct API access makes it easy for an agent to rediscover structure, reach into the wrong database, or rewrite context a person meant to keep. `ntn-gateway` starts from one human-readable Gateway page and treats it as the only registry of databases it may operate on.

## The idea in one minute

An agent should not need to remember a workspace map from a previous conversation, and a person should not have to reverse-engineer an agent's private scratchpad. The Gateway page is the shared handoff: it names the approved workspaces, carries durable operating notes, and supplies canonical IDs for the next command.

```text
┌──────────────────┐       ntn-gateway show        ┌─────────────────────┐
│  Agent workflow  │ ─────────────────────────────► │  Gateway page       │
│  a fresh session │                                 │  human-readable map │
└────────┬─────────┘                                 └─────────┬───────────┘
         │                                                       │ approved sources
         │ schema-aware, scoped operations                       │ only
         ▼                                                       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ ntn-gateway                                                               │
│ canonical IDs · live schema validation · compact JSON · auditable writes  │
└──────────────────────────────────────┬───────────────────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │ Notion workspace │
                              └─────────────────┘
```

The boundary is intentional:

- **Gateway-first scope.** The CLI only discovers and operates on databases exposed by the Gateway page; it fails closed outside that approved surface.
- **Human legibility.** The default output is compact JSON for agents, with `--format human` when a person is reading along. Canonical IDs and normalized data make a later session traceable rather than magical.
- **Narrow writes.** Create pages, update validated properties, and append Markdown content. Full body replacement is an explicit, warned, `--confirm`-gated escape hatch—not the normal editing path.
- **Live schema checks.** Property-bearing writes validate the current database schema immediately before they are planned or sent. Unknown properties and unrecognized select options do not silently invent a parallel taxonomy.
- **Context discipline.** Cross-database rollups are bounded and favor recently edited work, so an agent gets a useful working set instead of an unbounded API dump.

## Command surface

Start every ordinary workflow by discovering the Gateway. The companion skill explains the operating posture; `--help` and the command responses carry the detailed, current flags.

| Need | Command | What it protects |
| --- | --- | --- |
| Find the approved workspace map | `ntn-gateway show` | No guessed database IDs or broad discovery |
| Inspect a live schema | `ntn-gateway database schema <data-source-id>` | Writes use the database as it exists now |
| Read a page | `ntn-gateway page get <page-id>` | Typed properties and Markdown body, with focused read modes |
| Create a shared record | `ntn-gateway page create --database <data-source-id> --title "…"` | Target and properties are validated before creation |
| Change structured state | `ntn-gateway page properties update <page-id> --properties @props.json` | Human-authored body text stays intact |
| Add evidence or a handoff | `ntn-gateway block append <page-id> --content "…"` | New context is appended, not overwritten |
| Review work across approved databases | `ntn-gateway aggregate pages` | Results are scoped, status-aware, and capped |

For the durable agent workflow, see [`skills/notion-gateway/SKILL.md`](skills/notion-gateway/SKILL.md). Product decisions and implementation history live in [`docs/notion-gateway-decision.md`](docs/notion-gateway-decision.md), [`docs/phased-implementation-plan.md`](docs/phased-implementation-plan.md), and [`docs/implementation-progress.md`](docs/implementation-progress.md).

## Quick start

Prerequisites: Node.js 20 or newer, a Notion integration with access to the intended Gateway page, and credentials supplied through your environment (or a local, uncommitted `.env`).

```bash
git clone https://github.com/fyang0507/ntn-gateway.git
cd ntn-gateway
npm ci

# Supply your own local values; never commit them.
export NTN_GATEWAY_PAGE_ID="<gateway-page-id>"
export NOTION_API_KEY="<notion-integration-token>"

# From this checkout:
node bin/ntn-gateway.js --help
```

Once the command is on your `PATH`, use the shorter `ntn-gateway` form below. In a repository checkout, replace it with `node bin/ntn-gateway.js` if you have not installed the binary locally.

### A safe first workflow

```bash
# 1. Let the Gateway page tell you what is in scope.
ntn-gateway show --format human

# 2. Inspect the selected database just before writing.
ntn-gateway database schema <data-source-id>

# 3. Preview a new shared record. The supplied property names and values
#    are checked against the live schema; no write happens with --dry-run.
ntn-gateway page create \
  --database <data-source-id> \
  --title "Prepare a concise handoff" \
  --properties '{"Status":"Not started"}' \
  --stdin \
  --dry-run <<'MARKDOWN'
## Context

A short, human-readable summary belongs here.
MARKDOWN

# 4. When the plan is right, remove --dry-run. Later evidence is appended.
ntn-gateway block append <page-id> \
  --stdin \
  --dry-run <<'MARKDOWN'
## Update

The first pass is ready for review.
MARKDOWN
```

By default, successful commands emit compact JSON (`{"ok":true,"data":...}`), and failures have a stable JSON error shape. Use `--format human` for indented output or `--verbose` when an agent needs the full API echo for a write or aggregate.

## Development and verification

Tests are mocked: running them must never touch a live Notion workspace.

```bash
npm test       # behavior and safety boundaries
npm run check  # syntax-check the CLI, source, scripts, and tests
```

The repository contains a local companion-skill sync script for a configured agent data repository. That workstation convenience is intentionally separate from the verification commands above; it is not a package-release step.

## Publication & license

This repository is public so its gateway design can be inspected and discussed. It is **not an npm package**: `package.json` sets `"private": true` to prevent accidental publication.

It is also deliberately **unlicensed** (`"license": "UNLICENSED"`), and no `LICENSE` file grants reuse rights. Public visibility permits reading the source; it does not grant permission to copy, modify, distribute, or use it beyond what applicable law allows. If you would like to use this work, please open an issue to discuss permission.
