#!/usr/bin/env node

import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {AirtableService} from './airtableService.js';
import {AirtableMCPServer} from './mcpServer.js';
import {logger} from './logger.js';
import http from 'http';

// Session storage for MCP requests
const sessions = new Map<string, {created: Date; lastUsed: Date}>();

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
				res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
				res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
				res.setHeader('Access-Control-Max-Age', '86400');
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

			// MCP endpoint - handle POST, GET, DELETE
			if (req.url === '/mcp') {
				if (req.method === 'POST') {
					await handleMCPRequest(req, res, server);
					return;
				}

				if (req.method === 'GET') {
					// CRITICAL: Handle GET requests from OpenAI validation
					res.setHeader('Content-Type', 'application/json');
					res.writeHead(200);
					res.end(JSON.stringify({
						name: 'airtable-mcp-server',
						version: '1.7.0',
						protocol: 'mcp',
						capabilities: ['tools', 'prompts', 'resources'],
					}));
					return;
				}

				if (req.method === 'DELETE') {
					// CRITICAL: Handle DELETE requests from OpenAI validation
					res.writeHead(204); // No Content
					res.end();
					return;
				}
			}

			// Not Found
			res.writeHead(404, {'Content-Type': 'text/plain'});
			return res.end('Not Found');
		});

		httpServer.listen(port, () => {
			logger.info({port}, 'HTTP server started with MCP endpoint at /mcp');
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

// Handle MCP HTTP requests
async function handleMCPRequest(req: http.IncomingMessage, res: http.ServerResponse, server: AirtableMCPServer) {
	try {
		// CRITICAL: Flexible Accept header handling for ChatGPT compatibility
		const acceptHeader = req.headers.accept || '';
		if (!acceptHeader.includes('application/json')
			&& !acceptHeader.includes('*/*')
			&& !acceptHeader.includes('text/event-stream')) {
			res.writeHead(406, {'Content-Type': 'application/json'});
			res.end(JSON.stringify({
				jsonrpc: '2.0',
				error: {
					code: -32000,
					message: 'Not Acceptable: Client must accept application/json, text/event-stream, or */*',
				},
				id: null,
			}));
			return;
		}

		// Parse request body
		let body = '';
		req.on('data', (chunk: Buffer) => {
			body += chunk.toString();
		});

		req.on('end', async () => {
			try {
				// Parse JSON body
				const request = JSON.parse(body);
				logger.debug({method: request.method, id: request.id, acceptHeader}, 'MCP request received');

				// Get session ID from headers
				const sessionId = req.headers['mcp-session-id'] as string;

				// Handle initialize request (no session required)
				if (request.method === 'initialize') {
					// Generate new session ID
					const newSessionId = generateSessionId();
					sessions.set(newSessionId, {created: new Date(), lastUsed: new Date()});

					// Set session ID in response headers
					res.setHeader('mcp-session-id', newSessionId);

					// Return initialize response
					const response = {
						jsonrpc: '2.0',
						result: {
							protocolVersion: '2024-11-05',
							capabilities: {
								tools: {listChanged: true},
								prompts: {listChanged: true},
								resources: {listChanged: true},
							},
							serverInfo: {
								name: 'airtable-mcp-server',
								version: '1.7.0',
							},
						},
						id: request.id,
					};

					// CRITICAL: Handle SSE vs JSON response based on Accept header
					if (acceptHeader.includes('text/event-stream')) {
						// SSE Response for OpenAI compatibility
						res.setHeader('Content-Type', 'text/event-stream');
						res.setHeader('Cache-Control', 'no-cache');
						res.setHeader('Connection', 'keep-alive');
						res.writeHead(200);
						res.write(`data: ${JSON.stringify(response)}\n\n`);
						res.end();
					} else {
						// Standard JSON response
						res.setHeader('Content-Type', 'application/json');
						res.writeHead(200);
						res.end(JSON.stringify(response));
					}

					return;
				}

				// Validate session for other requests
				if (!sessionId || !sessions.has(sessionId)) {
					res.writeHead(400, {'Content-Type': 'application/json'});
					res.end(JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32000,
							message: 'Bad Request: No valid session ID provided',
						},
						id: request.id,
					}));
					return;
				}

				// Update session last used time
				const session = sessions.get(sessionId)!;
				session.lastUsed = new Date();

				// Handle different MCP methods
				let response;
				switch (request.method) {
					case 'notifications/initialized': {
						// CRITICAL: Handle notifications/initialized - OpenAI sends this after initialize
						logger.debug('Handling notifications/initialized');
						// For notifications, we don't send a response (no id in request)
						res.writeHead(204); // No Content
						res.end();
						return;
					}

					case 'tools/list': {
						const toolsResult = await server.handleListTools();
						response = {
							jsonrpc: '2.0',
							result: toolsResult,
							id: request.id,
						};
						break;
					}

					case 'tools/call': {
						const toolResult = await server.handleCallTool(request.params);
						response = {
							jsonrpc: '2.0',
							result: toolResult,
							id: request.id,
						};
						break;
					}

					case 'resources/list': {
						const resourcesResult = await server.handleListResources();
						response = {
							jsonrpc: '2.0',
							result: resourcesResult,
							id: request.id,
						};
						break;
					}

					case 'resources/read': {
						const resourceResult = await server.handleReadResource(request.params);
						response = {
							jsonrpc: '2.0',
							result: resourceResult,
							id: request.id,
						};
						break;
					}

					case 'prompts/list': {
						response = {
							jsonrpc: '2.0',
							result: {prompts: []},
							id: request.id,
						};
						break;
					}

					case 'prompts/get': {
						// Minimal implementation: no prompts available
						res.writeHead(404, {'Content-Type': 'application/json'});
						res.end(JSON.stringify({
							jsonrpc: '2.0',
							error: {code: -32601, message: `Prompt not found: ${request.params?.name ?? ''}`},
							id: request.id,
						}));
						return;
					}

					default: {
						res.writeHead(400, {'Content-Type': 'application/json'});
						res.end(JSON.stringify({
							jsonrpc: '2.0',
							error: {
								code: -32601,
								message: `Method not found: ${request.method}`,
							},
							id: request.id,
						}));
						return;
					}
				}

				// Return successful response with SSE support
				if (acceptHeader.includes('text/event-stream')) {
					// SSE Response for OpenAI compatibility
					res.setHeader('Content-Type', 'text/event-stream');
					res.setHeader('Cache-Control', 'no-cache');
					res.setHeader('Connection', 'keep-alive');
					res.writeHead(200);
					res.write(`data: ${JSON.stringify(response)}\n\n`);
					res.end();
				} else {
					// Standard JSON response
					res.setHeader('Content-Type', 'application/json');
					res.writeHead(200);
					res.end(JSON.stringify(response));
				}
			} catch (parseError) {
				logger.error({err: parseError}, 'Error parsing MCP request');
				res.writeHead(400, {'Content-Type': 'application/json'});
				res.end(JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32700,
						message: 'Parse error: Invalid JSON',
					},
					id: null,
				}));
			}
		});
	} catch (error) {
		logger.error({err: error}, 'Error handling MCP request');
		res.writeHead(500, {'Content-Type': 'application/json'});
		res.end(JSON.stringify({
			jsonrpc: '2.0',
			error: {
				code: -32603,
				message: 'Internal error',
			},
			id: null,
		}));
	}
}

// Generate unique session ID
function generateSessionId(): string {
	return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// Clean up old sessions periodically
setInterval(() => {
	const now = new Date();
	const maxAge = 24 * 60 * 60 * 1000; // 24 hours

	for (const [sessionId, session] of sessions.entries()) {
		if (now.getTime() - session.lastUsed.getTime() > maxAge) {
			sessions.delete(sessionId);
		}
	}
}, 60 * 60 * 1000); // Clean up every hour

main().catch((error: unknown) => {
	logger.error({err: error}, 'Fatal error');
	process.exit(1);
});
