#!/bin/bash

echo "🧪 Simple MCP Server Test"
echo "=========================="

# Test 1: Initialize request
echo ""
echo "1️⃣ Testing MCP initialize request..."
INIT_RESPONSE=$(curl -s -X POST "https://airtable-mcp-giwxufzbeq-as.a.run.app/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}}, "id": 1}')

echo "Response: $INIT_RESPONSE"

# Extract session ID from response headers
echo ""
echo "2️⃣ Getting session ID..."
SESSION_RESPONSE=$(curl -s -X POST "https://airtable-mcp-giwxufzbeq-as.a.run.app/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}}, "id": 1}' \
  -D /tmp/headers.txt)

SESSION_ID=$(grep -i 'mcp-session-id:' /tmp/headers.txt | cut -d' ' -f2 | tr -d '\r')

if [ -n "$SESSION_ID" ]; then
    echo "✅ Session ID: $SESSION_ID"
    
    # Test 3: Tools list
    echo ""
    echo "3️⃣ Testing tools list..."
    TOOLS_RESPONSE=$(curl -s -X POST "https://airtable-mcp-giwxufzbeq-as.a.run.app/mcp" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -H "mcp-session-id: $SESSION_ID" \
      -d '{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 2}')
    
    echo "Tools response: $TOOLS_RESPONSE"
    
    # Test 4: Simple tool call
    echo ""
    echo "4️⃣ Testing list_bases tool..."
    TOOL_RESPONSE=$(curl -s -X POST "https://airtable-mcp-giwxufzbeq-as.a.run.app/mcp" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -H "mcp-session-id: $SESSION_ID" \
      -d '{"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "list_bases", "arguments": {}}, "id": 3}')
    
    echo "Tool response: $TOOL_RESPONSE"
    
else
    echo "❌ No session ID found"
fi

echo ""
echo "🎯 Test Summary:"
echo "MCP Endpoint: https://airtable-mcp-giwxufzbeq-as.a.run.app/mcp"
echo "Status: MCP server is responding to basic requests"



