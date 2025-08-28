# Airtable MCP Server - OpenAI Compatibility Guide

## Overview

This guide explains how to deploy and configure your Airtable MCP server to be compatible with OpenAI's MCP connector requirements. Based on the lessons learned from the ClickUp MCP deployment, this implementation addresses all the critical issues that prevent OpenAI from successfully connecting to MCP servers.

## What Was Fixed

### ✅ Critical Issues Resolved

1. **HTTP Transport Implementation** - Added proper MCP HTTP endpoint at `/mcp`
2. **Session Management** - Implemented proper session ID generation and validation
3. **Required Tools** - Already had `search` and `fetch` tools implemented
4. **CORS Configuration** - Enabled proper cross-origin support
5. **Initialize Request Handling** - Direct method checking instead of unreliable SDK functions
6. **Error Handling** - Proper JSON-RPC error responses

### 🔧 Technical Implementation

- **MCP Endpoint**: `/mcp`
- **Supported Methods (required by OpenAI validation)**:
  - `POST` JSON-RPC (initialize, tools/list, tools/call, resources/*, notifications/*)
  - `GET` server metadata (used by validator)
  - `DELETE` teardown (used by validator)
- **Streaming**: Server-Sent Events (SSE) when `Accept: text/event-stream`
- **Session Management**: In-memory session storage with automatic cleanup
- **Tool Support**: Full Airtable functionality + required OpenAI tools (`search`, `fetch` first)
- **CORS**: Wildcard origin support for development/testing

## OpenAI Validation Requirements (What ChatGPT actually calls)

During connector creation ChatGPT’s validator performs these checks. Your server now implements all of them:

- Initialize flow
  - `POST /mcp` with `{ method: "initialize" }`
  - Response includes `protocolVersion`, `capabilities`, and `serverInfo`
  - Returns header `mcp-session-id`
- Notification
  - `POST /mcp` with `{ method: "notifications/initialized" }`
  - Must return `204 No Content` (no JSON body, no id required)
- Capabilities discovery
  - `POST /mcp` with `{ method: "tools/list" }` using the session id
- Metadata probes
  - `GET /mcp` should return `200` with JSON metadata
  - `DELETE /mcp` should return `204 No Content`
- Content negotiation
  - Accept header must be flexible: allow `application/json`, `*/*`, and `text/event-stream`
  - When `Accept: text/event-stream` is present, stream SSE lines like `data: {json}\n\n`

## Prerequisites

- Google Cloud CLI configured and authenticated
- Node.js 18+ with TypeScript support
- Access to Google Cloud Run and Secret Manager
- Airtable API key with appropriate permissions

## Quick Deployment

### 1. Build and Deploy

```bash
# Make scripts executable
chmod +x deploy-local.sh
chmod +x test-mcp-server.sh

# Deploy to Google Cloud Run
./deploy-local.sh
```

### 2. Test the Deployment

```bash
# Test all MCP endpoints
./test-mcp-server.sh
```

### 3. Get Your MCP Endpoint

The deployment script will output your MCP endpoint URL. It will look like:
```
https://airtable-mcp-[hash]-[region].run.app/mcp
```

## OpenAI MCP Connector Setup

### 1. In OpenAI Platform

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Navigate to **Connectors** → **Create Connector**
3. Select **MCP (Model Context Protocol)**
4. Enter your MCP server URL: `https://your-service-url.run.app/mcp`
5. Click **Create Connector**

### 2. Test the Connection

The connector should now successfully validate and connect to your Airtable MCP server.

## Architecture Details

### MCP Server Structure

```
src/
├── index.ts              # HTTP server + MCP transport
├── mcpServer.ts          # MCP server implementation
├── airtableService.ts    # Airtable API integration
└── types.ts              # Type definitions
```

### HTTP Transport Layer

- **Endpoint**: `/mcp`
- **Methods**: `POST` (JSON-RPC), `GET` (metadata), `DELETE` (teardown)
- **Content-Type**: `application/json` (or `text/event-stream` for SSE)
- **Session Header**: `mcp-session-id`

### Session Management

- **Generation**: Automatic on initialize request
- **Storage**: In-memory Map with automatic cleanup
- **Lifetime**: 24 hours from last use
- **Cleanup**: Hourly background process

## Environment Variables

```bash
# Required for OpenAI compatibility
ENABLE_CORS=true
ALLOWED_ORIGINS=*
LOG_LEVEL=debug

# Airtable configuration
AIRTABLE_API_KEY=your_api_key_here

# Cloud Run configuration
PORT=8080
```

## Testing Your MCP Server

### Manual Testing

```bash
# 1. Initialize request
curl -X POST "https://your-service-url.run.app/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}}, "id": 1}'

# 2. Get tools list (use session ID from step 1)
curl -X POST "https://your-service-url.run.app/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "mcp-session-id: YOUR_SESSION_ID" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 2}'

# 3. Notification (validator sends this)
curl -X POST "https://your-service-url.run.app/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "mcp-session-id: YOUR_SESSION_ID" \
  -d '{"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}' -i

# 4. Metadata probes (validator)
curl -X GET "https://your-service-url.run.app/mcp" -i
curl -X DELETE "https://your-service-url.run.app/mcp" -i

# 5. SSE initialize (optional, proves streaming works)
curl -X POST "https://your-service-url.run.app/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}}, "id": 1}' -i
```

### Automated Testing

Use the provided test script:

```bash
./test-mcp-server.sh
```

This will test:
- ✅ Health check endpoint
- ✅ CORS preflight requests
- ✅ MCP initialize request
- ✅ Session ID generation
- ✅ Tools list endpoint
- ✅ Tool execution

## Troubleshooting

### Common Issues

#### 1. "This MCP server doesn't implement our specification"

**Cause**: Missing required tools or incorrect tool schemas
**Solution**: Verify `search` and `fetch` tools are present in tools list

#### 2. "Bad Request: No valid session ID provided"

**Cause**: Session handling issues
**Solution**: Check that initialize requests are generating session IDs properly

#### 3. CORS Errors

**Cause**: Cross-origin request blocking
**Solution**: Verify `ENABLE_CORS=true` and `ALLOWED_ORIGINS=*`

#### 4. Build Failures

**Cause**: Missing dependencies
**Solution**: Ensure `@types/node` is installed

### Debug Logs

Enable debug logging:

```bash
LOG_LEVEL=debug
```

Check Cloud Run logs:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=airtable-mcp" \
  --limit=20 --project YOUR_PROJECT --format="value(timestamp,textPayload)" --freshness=10m
```

## Security Considerations

### Development vs Production

- **Development**: `ALLOWED_ORIGINS=*` for testing
- **Production**: Restrict origins to specific domains
- **API Keys**: Use Google Secret Manager (already configured)

### Session Security

- Sessions are stored in memory (not persistent)
- Automatic cleanup prevents memory leaks
- No sensitive data in session storage

## Performance Optimization

### Cloud Run Configuration

- **Memory**: 512Mi (adequate for MCP operations)
- **CPU**: 1000m (1 vCPU)
- **Max Instances**: 100 (auto-scaling)
- **Timeout**: 300 seconds (5 minutes)

### Caching

- Airtable schema caching (already implemented)
- Session cleanup every hour
- No persistent storage overhead

## Monitoring

### Health Checks

- **Endpoint**: `/healthz`
- **Response**: Simple "ok" string
- **Use Case**: Load balancer health checks

### Metrics to Watch

- Response times for MCP requests
- Session count and cleanup frequency
- Airtable API call success rates
- Memory usage patterns

## Future Enhancements

### Planned Improvements

1. **Persistent Sessions**: Redis or database storage
2. **Rate Limiting**: Per-session API call limits
3. **Metrics**: Prometheus integration
4. **Webhooks**: Real-time Airtable updates
5. **Authentication**: OAuth2 flow for Airtable

### OpenAI-Specific Features

1. **Streaming Responses**: Server-sent events support
2. **Tool Validation**: Enhanced schema validation
3. **Error Recovery**: Automatic retry mechanisms
4. **Performance**: Response caching and optimization

## Support

### Getting Help

1. **Check Logs**: Use the test script and Cloud Run logs
2. **Verify Configuration**: Ensure all environment variables are set
3. **Test Endpoints**: Use the provided test script
4. **Check Airtable**: Verify API key permissions

### Common Commands

```bash
# Check service status
gcloud run services describe airtable-mcp --region=asia-southeast1

# View recent logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=airtable-mcp" --limit=10

# Test MCP endpoint
./test-mcp-server.sh

# Redeploy after changes
./deploy-local.sh
```

## Conclusion

Your Airtable MCP server is now fully compatible with OpenAI's MCP connector requirements. The implementation follows all the best practices learned from the ClickUp deployment and addresses the specific validation requirements that OpenAI has.

Key success factors:
- ✅ Proper HTTP transport implementation
- ✅ Required tools (`search` and `fetch`)
- ✅ Session management
- ✅ CORS configuration
- ✅ Error handling
- ✅ Comprehensive testing

The server should now work seamlessly with OpenAI's MCP connector, providing full access to your Airtable databases through natural language interactions.
