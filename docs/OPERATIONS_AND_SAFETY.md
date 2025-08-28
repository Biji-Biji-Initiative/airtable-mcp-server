# Operations and Safety Notes

## "DELETE validation" vs destructive deletes

- The OpenAI connector performs an HTTP `DELETE /mcp` request during validation. This is a metadata/teardown probe and does NOT delete Airtable data. Our server returns `204 No Content` as required. No state is removed other than any ephemeral connection context already held in memory.

- Destructive Airtable operations are different and are executed through explicit tools, for example `delete_records`. These require a JSON-RPC `tools/call` with arguments such as `baseId`, `tableId`, and an array of `recordIds`.

## Destructive operations

- `delete_records` will permanently remove specified records from a table.
- Recommend safeguards in calling flows:
  - Present a summary of records to delete
  - Require explicit confirmation in UI before sending the tool call
  - Log all destructive calls and responses

## Least-privilege and environment

- Use an API key with the minimum scopes needed.
- In production, restrict CORS to known origins (avoid `*`).
- Prefer read-only workflows where possible; gate write/delete access behind feature flags.

## Session security

- Sessions are ephemeral and expire after inactivity.
- Session ids are opaque tokens issued on `initialize`; do not reuse across users.

## Streaming

- When streaming via SSE, responses are one-way server events; do not include secrets in streamed payloads.



