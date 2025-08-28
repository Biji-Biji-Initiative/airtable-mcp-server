#!/bin/bash

# Load environment variables
source deploy-config.env

# Build the project
echo "Building Airtable MCP Server..."
cd airtable-mcp-server
npm run build

# Check if build was successful
if [ $? -ne 0 ]; then
    echo "Build failed. Exiting."
    exit 1
fi

echo "Build successful!"

# Deploy to Google Cloud Run
echo "Deploying to Google Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --source . \
    --region $GCP_REGION \
    --project $GCP_PROJECT_ID \
    --allow-unauthenticated \
    --port $CONTAINER_PORT \
    --memory $MEMORY_LIMIT \
    --cpu $CPU_LIMIT \
    --max-instances $MAX_INSTANCES \
    --timeout $TIMEOUT_SECONDS \
    --set-env-vars ENABLE_CORS=true,ALLOWED_ORIGINS='*',LOG_LEVEL=debug,ENABLE_SSE=false,DOCUMENT_SUPPORT=true \
    --set-secrets AIRTABLE_API_KEY=AIRTABLE_API_KEY:latest

echo "Deployment completed!"
echo "Your MCP server endpoint: https://$SERVICE_NAME-$(gcloud run services describe $SERVICE_NAME --region=$GCP_REGION --project=$GCP_PROJECT_ID --format='value(status.url)' | sed 's|https://||' | sed 's|/.*||')"
echo ""
echo "For OpenAI MCP connector, use the endpoint: https://$SERVICE_NAME-$(gcloud run services describe $SERVICE_NAME --region=$GCP_REGION --project=$GCP_PROJECT_ID --format='value(status.url)' | sed 's|https://||' | sed 's|/.*||')/mcp"
