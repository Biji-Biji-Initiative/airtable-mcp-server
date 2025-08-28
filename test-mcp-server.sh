#!/bin/bash

# Test script for Airtable MCP Server OpenAI compatibility
# This script tests the critical endpoints that OpenAI requires

# Load environment variables
source deploy-config.env

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$GCP_REGION --project=$GCP_PROJECT_ID --format='value(status.url)')

if [ -z "$SERVICE_URL" ]; then
    echo "❌ Error: Could not get service URL. Is the service deployed?"
    exit 1
fi

echo "🧪 Testing Airtable MCP Server at: $SERVICE_URL"
echo ""

# Test 1: Health check
echo "1️⃣ Testing health check endpoint..."
HEALTH_RESPONSE=$(curl -s "$SERVICE_URL/healthz")
if [ "$HEALTH_RESPONSE" = "ok" ]; then
    echo "✅ Health check passed: $HEALTH_RESPONSE"
else
    echo "❌ Health check failed: $HEALTH_RESPONSE"
fi
echo ""

# Test 2: CORS preflight
echo "2️⃣ Testing CORS preflight..."
CORS_RESPONSE=$(curl -s -X OPTIONS "$SERVICE_URL/mcp" \
    -H "Origin: https://chatgpt.com" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type" \
    -w "%{http_code}")
if [[ "$CORS_RESPONSE" == *"204"* ]]; then
    echo "✅ CORS preflight passed"
else
    echo "❌ CORS preflight failed: $CORS_RESPONSE"
fi
echo ""

# Test 3: Initialize request (required by OpenAI)
echo "3️⃣ Testing MCP initialize request..."
INIT_RESPONSE=$(curl -s -X POST "$SERVICE_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d '{"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}}, "id": 1}' \
    -w "\n%{http_code}")

# Extract HTTP status code
HTTP_CODE=$(echo "$INIT_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$INIT_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Initialize request passed"
    echo "Response: $RESPONSE_BODY"
    
    # Extract session ID from response headers
    SESSION_ID=$(curl -s -X POST "$SERVICE_URL/mcp" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -d '{"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}}, "id": 1}' \
        -D /tmp/headers.txt \
        -o /dev/null && grep -i 'mcp-session-id:' /tmp/headers.txt | cut -d' ' -f2 | tr -d '\r')
    
    if [ -n "$SESSION_ID" ]; then
        echo "✅ Session ID generated: $SESSION_ID"
    else
        echo "❌ No session ID in response headers"
    fi
else
    echo "❌ Initialize request failed with status: $HTTP_CODE"
    echo "Response: $RESPONSE_BODY"
fi
echo ""

# Test 4: Tools list (if we have a session ID)
if [ -n "$SESSION_ID" ]; then
    echo "4️⃣ Testing tools list request..."
    TOOLS_RESPONSE=$(curl -s -X POST "$SERVICE_URL/mcp" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -H "mcp-session-id: $SESSION_ID" \
        -d '{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 2}' \
        -w "\n%{http_code}")
    
    TOOLS_HTTP_CODE=$(echo "$TOOLS_RESPONSE" | tail -n1)
    TOOLS_BODY=$(echo "$TOOLS_RESPONSE" | head -n -1)
    
    if [ "$TOOLS_HTTP_CODE" = "200" ]; then
        echo "✅ Tools list request passed"
        
        # Check if required tools are present
        if echo "$TOOLS_BODY" | grep -q '"name": "search"'; then
            echo "✅ Search tool found"
        else
            echo "❌ Search tool missing"
        fi
        
        if echo "$TOOLS_BODY" | grep -q '"name": "fetch"'; then
            echo "✅ Fetch tool found"
        else
            echo "❌ Fetch tool missing"
        fi
    else
        echo "❌ Tools list request failed with status: $TOOLS_HTTP_CODE"
        echo "Response: $TOOLS_BODY"
    fi
else
    echo "4️⃣ Skipping tools list test (no session ID)"
fi
echo ""

# Test 5: Test search tool (if we have a session ID)
if [ -n "$SESSION_ID" ]; then
    echo "5️⃣ Testing search tool..."
    SEARCH_RESPONSE=$(curl -s -X POST "$SERVICE_URL/mcp" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json" \
        -H "mcp-session-id: $SESSION_ID" \
        -d '{"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "search", "arguments": {"query": "test"}}, "id": 3}' \
        -w "\n%{http_code}")
    
    SEARCH_HTTP_CODE=$(echo "$SEARCH_RESPONSE" | tail -n1)
    SEARCH_BODY=$(echo "$SEARCH_RESPONSE" | head -n -1)
    
    if [ "$SEARCH_HTTP_CODE" = "200" ]; then
        echo "✅ Search tool execution passed"
    else
        echo "❌ Search tool execution failed with status: $SEARCH_HTTP_CODE"
        echo "Response: $SEARCH_BODY"
    fi
else
    echo "5️⃣ Skipping search tool test (no session ID)"
fi
echo ""

# Summary
echo "🎯 Test Summary:"
echo "Service URL: $SERVICE_URL"
echo "MCP Endpoint: $SERVICE_URL/mcp"
echo ""
echo "For OpenAI MCP connector setup:"
echo "1. Use the full URL: $SERVICE_URL/mcp"
echo "2. Ensure the service is accessible from the internet"
echo "3. Verify all tests above pass"
echo ""
echo "If any tests failed, check the Cloud Run logs:"
echo "gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME' --limit=20 --project $GCP_PROJECT_ID --format='value(timestamp,textPayload)' --freshness=10m"



