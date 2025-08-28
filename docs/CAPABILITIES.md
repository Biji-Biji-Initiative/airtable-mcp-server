# Airtable MCP Capabilities

This server implements Model Context Protocol (MCP) over HTTP with Airtable tooling. Below is a concise reference of capabilities, tool schemas, and example calls.

## Protocol
- Endpoint: `/mcp`
- Methods:
  - POST JSON-RPC 2.0
  - GET metadata (validator)
  - DELETE teardown (validator)
- Streaming: Server-Sent Events when `Accept: text/event-stream`
- Session header: `mcp-session-id` (issued on initialize)

## Core Tools (appear first)

### 1) search
- Description: Search baseline tool required by ChatGPT connector.
- Input schema:
```json
{
  "type": "object",
  "properties": {
    "query": {"type": "string"},
    "baseId": {"type": "string"},
    "tableId": {"type": "string"},
    "view": {"type": "string"}
  },
  "required": ["query"]
}
```
- Example:
```bash
curl -X POST "$URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search","arguments":{"query":"onboarding"}},"id":1}'
```

### 2) fetch
- Description: Fetch baseline tool required by ChatGPT connector.
- Input schema:
```json
{
  "type": "object",
  "properties": {
    "id": {"type": "string"},
    "type": {"type": "string", "enum": ["record","table","view"], "default": "record"},
    "baseId": {"type": "string"},
    "tableId": {"type": "string"}
  },
  "required": ["id"]
}
```
- Example:
```bash
curl -X POST "$URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"fetch","arguments":{"id":"rec123","type":"record","baseId":"appXXXX","tableId":"tblYYYY"}},"id":2}'
```

## Airtable Data Tools (selection)
These are available in `tools/list` alongside `search` and `fetch`.

- `list_bases` – List accessible bases.
- `list_tables` – List tables in a base; supports `detailLevel` (`tableIdentifiersOnly`, `identifiersOnly`, `full`).
- `describe_table` – Get detailed table metadata; supports `detailLevel`.
- `list_views` – List views for a table.
- `get_view_metadata` – Detailed configuration for a view.
- `list_records` – List records from a table; supports `view`, `maxRecords`, `filterByFormula`, `sort`.
- `search_records` – Text search within a table; supports `fieldIds`, `maxRecords`.
- `get_record` – Retrieve a record by id.
- `create_record` – Create one record.
- `update_records` – Update up to 10 records.
- `delete_records` – Delete records by ids.
- Table management: `create_table`, `update_table`, `create_field`, `update_field`.
- View management: `create_view`, `delete_view`.

Each tool uses a strict JSON schema (see `tools/list` response for exact shapes).

## Examples

### Initialize and list tools
```bash
URL="https://airtable-mcp-<hash>.<region>.run.app"
INIT=$(curl -s -D /tmp/h.txt -X POST "$URL/mcp" -H "Content-Type: application/json" -H "Accept: application/json" -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}}},"id":1}')
SESSION=$(grep -i 'mcp-session-id:' /tmp/h.txt | awk '{print $2}' | tr -d '\r')

curl -s -X POST "$URL/mcp" -H "Content-Type: application/json" -H "Accept: application/json" -H "mcp-session-id: $SESSION" -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}' | jq '.result.tools | map(.name)'
```

### Delete records (destructive)
```bash
curl -X POST "$URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"delete_records","arguments":{"baseId":"app...","tableId":"tbl...","recordIds":["rec1","rec2"]}},"id":3}'
```

## Notes
- For large schemas, prefer `tableIdentifiersOnly`/`identifiersOnly` to conserve tokens.
- When `Accept: text/event-stream` is present, responses are streamed as SSE.
- Always include the `mcp-session-id` issued by `initialize` for non-initialize calls.



