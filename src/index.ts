#!/usr/bin/env node

import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {AirtableService} from './airtableService.js';
import {AirtableMCPServer} from './mcpServer.js';
import {logger} from './logger.js';
import http from 'http';

const main = async () => {
	// Prefer env vars first so Cloud Run secrets work, fall back to CLI arg for local/dev
	const envApiKey = process.env.AIRTABLE_API_KEY ?? process.env.AIRTABLE_PAT;
	const cliApiKey = process.argv.slice(2)[0];
	const apiKey = envApiKey ?? cliApiKey;

	if (cliApiKey) {
		// Deprecation warning
		logger.warn('Passing in an API key as a command-line argument is deprecated and may be removed in a future version. Instead, set the `AIRTABLE_API_KEY` environment variable. See https://github.com/domdomegg/airtable-mcp-server/blob/master/README.md#usage for an example with Claude Desktop.');
	}

	const airtableService = new AirtableService(apiKey);
	logger.info('Starting Airtable MCP Server');
	logger.info('Running preflight checks');
	/*
	 * Tests (and some CI scenarios) may not have a real Airtable token available.
	 * Allow skipping the pre-flight connectivity / scope check by setting
	 * `SKIP_PREFLIGHT=1`.
	 */
	if (process.env.SKIP_PREFLIGHT !== '1') {
		try {
			// Basic scope check: list bases
			const basesResponse = await airtableService.listBases();

			if (basesResponse.bases.length === 0) {
				logger.warn('No accessible bases found for provided Airtable token');
			} else {
				// Attempt schema fetch of first base to ensure schema scope
				const firstBaseId = basesResponse.bases[0]!.id;
				await airtableService.getBaseSchema(firstBaseId);
			}

			logger.info('Preflight checks passed');
		} catch (preflightError) {
			logger.error({err: preflightError}, 'Preflight checks failed');
			throw preflightError;
		}
	}

	const server = new AirtableMCPServer(airtableService);
	const portEnv = process.env.PORT;
	const enableCors = process.env.ENABLE_CORS === 'true';
	const allowedOrigins = process.env.ALLOWED_ORIGINS ?? '*';

	// Decide transport(s)
	if (portEnv) {
		// Cloud-Run / HTTP mode
		const port = Number(portEnv);
		const httpServer = http.createServer(async (req, res) => {
			// CORS handling
			if (enableCors) {
				res.setHeader('Access-Control-Allow-Origin', allowedOrigins);
				res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
				res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
			}

			// Pre-flight
			if (req.method === 'OPTIONS') {
				res.writeHead(204);
				return res.end();
			}

			// Basic health endpoints
			if (req.method === 'GET' && (req.url === '/' || req.url === '/healthz')) {
				res.writeHead(200, {'Content-Type': 'text/plain'});
				return res.end('ok');
			}

			// MCP HTTP transport not yet implemented
			res.writeHead(404, {'Content-Type': 'text/plain'});
			return res.end('Not Found');
		});

		httpServer.listen(port, () => {
			logger.info({port}, 'HTTP server started');
		});

		// Only start stdio transport if explicitly requested
		if (process.env.STDIO_MODE === '1') {
			logger.info('Starting stdio transport (STDIO_MODE=1)');
			const transport = new StdioServerTransport();
			await server.connect(transport);
		} else {
			logger.info('STDIO transport disabled (set STDIO_MODE=1 to enable)');
		}
	} else {
		// Local / CLI usage with stdio
		const transport = new StdioServerTransport();
		logger.info('Starting stdio transport (no PORT set)');
		await server.connect(transport);
	}
};

main().catch((error: unknown) => {
	logger.error({err: error}, 'Fatal error');
	process.exit(1);
});
