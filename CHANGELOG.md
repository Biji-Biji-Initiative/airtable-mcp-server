# Changelog

All notable changes to this project will be documented in this file.

## [1.7.0] - 2025-08-25

### Added
- View manipulation tools: `list_views`, `get_view_metadata`, `create_view`, `delete_view`.
- ChatGPT MCP baseline tools: `search`, `fetch`.
- Structured JSON logging via Pino with redaction and `LOG_LEVEL` support.
- Startup preflight checks with `SKIP_PREFLIGHT` override for tests.
- In-memory caching with configurable TTL (`SCHEMA_CACHE_TTL_MS`) for base schema; invalidation on view create/delete.
- Retry logic with exponential backoff + jitter for 429/5xx.
- Comprehensive tests for view name disambiguation, Kanban validation, caching TTL/invalidation, and retry/backoff behavior.
- E2E smoke script (`scripts/smoke.mjs`) for verifying Airtable access with a PAT.
- GitHub Actions Cloud Run deployment workflow stub (configure secrets in your repo before use).

### Changed
- Refactored `fetchFromAPI` to recursive retry pattern; eliminated await-in-loop lint issues.
- Extracted group-by validation helper in `mcpServer`.
- Improved error mapping and structured error responses across tool handlers.

### Fixed
- Restored `validateAndGetSearchFields` implementation.
- TypeScript exactOptionalPropertyTypes issues in `create_view` input construction.
- ESLint violations across the codebase; now fully lint-clean.
- Stable tests by mocking `Date.now` for TTL and `SKIP_PREFLIGHT` for server init.
