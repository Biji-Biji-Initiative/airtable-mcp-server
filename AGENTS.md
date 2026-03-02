# AGENTS.md

## Repository Overview
Fork of [airtable-mcp-server](https://github.com/domdomegg/airtable-mcp-server) - MCP (Model Context Protocol) server for Airtable integration with AI agents.

## Upstream Sync
- Upstream: https://github.com/domdomegg/airtable-mcp-server
- Sync frequency: As needed
- Last sync: 2026-02-27

## Core Commands
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Start: `npm start`

## Configuration
- Airtable API key: `AIRTABLE_API_KEY` (use Personal Access Token)
- Base IDs: Configure in `config/bases.json`
- MCP protocol version: Check `package.json`

## Project Structure
- `src/` — Server implementation
- `config/` — Base and table configurations
- `tools/` — MCP tool definitions

## Validation Requirements
Before marking work as complete:
- Run: `npm run lint`
- Run: `npm test`
- Verify MCP protocol compliance
- Test with actual Airtable base

## Boundaries
- ✅ Always: Validate MCP protocol compliance, rate limit API calls, handle errors gracefully
- ⚠️ Ask First: New Airtable base additions, schema changes, new tool definitions
- 🚫 Never: Expose API keys in code or logs, skip input validation, commit real data

## Security Notes
- Store API keys in environment variables only
- Use Personal Access Tokens with minimal permissions
- Validate all inputs before sending to Airtable API
- Log operations for audit trail (without sensitive data)

---
Last updated: 2026-03-02
