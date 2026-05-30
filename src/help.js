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
  ntn-gateway aggregate pages [--status "..."] [--since YYYY-MM-DD] [--until YYYY-MM-DD]

Environment:
  NTN_GATEWAY_PAGE_ID   Gateway page ID.
  NOTION_API_KEY        Notion integration token.

Output:
  JSON is the default. Success payloads use {"ok":true,"data":...}.
  Errors use {"ok":false,"error":{"code":"...","message":"..."}}.

Content:
  --content accepts inline Markdown or @file.md. Piped stdin is read automatically; --stdin explicitly reads stdin.
`;

module.exports = { HELP };
