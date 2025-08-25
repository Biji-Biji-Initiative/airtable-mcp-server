#!/usr/bin/env node

import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {AirtableService} from './airtableService.js';
import {AirtableMCPServer} from './mcpServer.js';
import {logger} from './logger.js';

const main = async () => {
	const apiKey = process.argv.slice(2)[0];
	if (apiKey) {
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
	const transport = new StdioServerTransport();
	await server.connect(transport);
};

main().catch((error: unknown) => {
	logger.error({err: error}, 'Fatal error');
	process.exit(1);
});
