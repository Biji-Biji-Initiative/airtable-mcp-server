#!/bin/bash

# Local deployment script for Airtable MCP Server to Google Cloud Run
set -e

echo "🚀 Deploying Airtable MCP Server to Google Cloud Run..."
echo "Project: mereka-mcp-servers"
echo "Region: asia-southeast1"
echo "Service: airtable-mcp"

# Check if gcloud is configured
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Error: gcloud is not authenticated. Please run gcloud auth login first."
    exit 1
fi

# Build and deploy
echo "🔨 Building Docker image..."
docker build -t "gcr.io/mereka-mcp-servers/airtable-mcp-server:latest" .

echo "📤 Pushing image to Google Container Registry..."
docker push "gcr.io/mereka-mcp-servers/airtable-mcp-server:latest"

echo "🚀 Deploying to Cloud Run..."
gcloud run deploy airtable-mcp \
    --project mereka-mcp-servers \
    --region asia-southeast1 \
    --image "gcr.io/mereka-mcp-servers/airtable-mcp-server:latest" \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars "AIRTABLE_API_KEY=patT7fn4UEL5G4I6j.31e64c59f5ccbfcb300b18bd43e3895f5d6629e90bbcb43c6a43f9589b0b1666,LOG_LEVEL=info,SCHEMA_CACHE_TTL_MS=300000" \
    --memory 512Mi \
    --cpu 1000m \
    --max-instances 100 \
    --timeout 300 \
    --port 8080 \
    --quiet
