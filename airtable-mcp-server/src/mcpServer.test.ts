import {
	describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type {
	JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {IAirtableService} from './types.js';
import {AirtableMCPServer} from './mcpServer.js';

describe('AirtableMCPServer', () => {
	let server: AirtableMCPServer;
	let mockAirtableService: IAirtableService;
	let serverTransport: InMemoryTransport;
	let clientTransport: InMemoryTransport;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Create mock AirtableService
		mockAirtableService = {
			listBases: vi.fn().mockResolvedValue({
				bases: [
					{id: 'base1', name: 'Test Base', permissionLevel: 'create'},
				],
			}),
			getBaseSchema: vi.fn().mockResolvedValue({
				tables: [
					{
						id: 'tbl1',
						name: 'Test Table',
						description: 'Test Description',
						fields: [],
						views: [],
						primaryFieldId: 'fld1',
					},
				],
			}),
			listRecords: vi.fn().mockResolvedValue([
				{id: 'rec1', fields: {name: 'Test Record'}},
			]),
			getRecord: vi.fn().mockResolvedValue({
				id: 'rec1',
				fields: {name: 'Test Record'},
			}),
			createRecord: vi.fn().mockResolvedValue({
				id: 'rec1',
				fields: {name: 'New Record'},
			}),
			updateRecords: vi.fn().mockResolvedValue([
				{id: 'rec1', fields: {name: 'Updated Record'}},
			]),
			deleteRecords: vi.fn().mockResolvedValue([
				{id: 'rec1', deleted: true},
			]),
			createTable: vi.fn().mockResolvedValue({
				id: 'tbl1',
				name: 'New Table',
				fields: [],
			}),
			updateTable: vi.fn().mockResolvedValue({
				id: 'tbl1',
				name: 'Updated Table',
				fields: [],
			}),
			createField: vi.fn().mockResolvedValue({
				id: 'fld1',
				name: 'New Field',
				type: 'singleLineText',
			}),
			updateField: vi.fn().mockResolvedValue({
				id: 'fld1',
				name: 'Updated Field',
				type: 'singleLineText',
			}),
			searchRecords: vi.fn().mockResolvedValue([
				{id: 'rec1', fields: {name: 'Test Result'}},
			]),
		};

		// Create server instance with test transport
		server = new AirtableMCPServer(mockAirtableService);
		[serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
	});

	const sendRequest = async (message: JSONRPCRequest): Promise<JSONRPCResponse> => {
		return new Promise((resolve, reject) => {
			// Set up response handler
			clientTransport.onmessage = (response: JSONRPCMessage) => {
				resolve(response as JSONRPCResponse);
			};

			clientTransport.onerror = (err: Error) => {
				reject(err);
			};

			clientTransport.send(message).catch((err: unknown) => {
				reject(err instanceof Error ? err : new Error(String(err)));
			});
		});
	};

	describe('server functionality', () => {
		test('handles list_resources request', async () => {
			const response = await sendRequest({
				jsonrpc: '2.0',
				id: '1',
				method: 'resources/list',
				params: {},
			});

			expect(response.result).toEqual({
				resources: [{
					uri: 'airtable://base1/tbl1/schema',
					mimeType: 'application/json',
					name: 'Test Base: Test Table schema',
				}],
			});
		});

		test('handles read_resource request', async () => {
			const response = await sendRequest({
				jsonrpc: '2.0',
				id: '1',
				method: 'resources/read',
				params: {
					uri: 'airtable://base1/tbl1/schema',
				},
			});

			expect(response.result).toEqual({
				contents: [{
					uri: 'airtable://base1/tbl1/schema',
					mimeType: 'application/json',
					text: JSON.stringify({
						baseId: 'base1',
						tableId: 'tbl1',
						name: 'Test Table',
						description: 'Test Description',
						primaryFieldId: 'fld1',
						fields: [],
						views: [],
					}),
				}],
			});
		});

		test('handles list_tools request', async () => {
			const response = await sendRequest({
				jsonrpc: '2.0',
				id: '1',
				method: 'tools/list',
				params: {},
			});

			const tools = response.result.tools as Tool[];

			// At least the core + view + compat tools should be present
			expect(tools.length).toBeGreaterThanOrEqual(16);

			// ChatGPT-compat tools must be first and in order
			expect(tools[0]?.name).toBe('search');
			expect(tools[1]?.name).toBe('fetch');

			// Verify required tool names are all included
			const names = tools.map((t) => t.name);
			for (const n of [
				'list_records',
				'search_records',
				'list_bases',
				'list_tables',
				'describe_table',
				'get_record',
				'create_record',
				'update_records',
				'delete_records',
				'create_table',
				'update_table',
				'create_field',
				'update_field',
				'list_views',
				'get_view_metadata',
				'create_view',
				'delete_view',
			]) {
				expect(names).toContain(n);
			}

			// Basic shape sanity check on a sample non-compat tool (3rd index)
			expect(tools[2]).toMatchObject({
				name: expect.any(String),
				description: expect.any(String),
				inputSchema: expect.objectContaining({type: 'object'}),
			});
		});

		test('handles list_records tool call', async () => {
			const response = await sendRequest({
				jsonrpc: '2.0',
				id: '1',
				method: 'tools/call',
				params: {
					name: 'list_records',
					arguments: {
						baseId: 'base1',
						tableId: 'tbl1',
						maxRecords: 100,
					},
				},
			});

			expect(response.result).toEqual({
				content: [{
					type: 'text',
					mimeType: 'application/json',
					text: JSON.stringify([
						{id: 'rec1', fields: {name: 'Test Record'}},
					]),
				}],
				isError: false,
			});
		});

		test('get_view_metadata disambiguates view name and errors on ambiguity', async () => {
			// Mock schema where two views share the same name -> should trigger ambiguity error
			(mockAirtableService.getBaseSchema as any).mockResolvedValueOnce({
				tables: [{
					id: 'tbl1',
					name: 'Test Table',
					description: 'Test Description',
					fields: [],
					views: [
						{id: 'viw1', name: 'My View', type: 'grid'},
						{id: 'viw2', name: 'My View', type: 'grid'},
					],
					primaryFieldId: 'fld1',
				}],
			});

			const response = await sendRequest({
				jsonrpc: '2.0',
				id: '1',
				method: 'tools/call',
				params: {
					name: 'get_view_metadata',
					arguments: {
						baseId: 'base1',
						tableId: 'tbl1',
						view: 'My View',
					},
				},
			});

			expect(response.result).toMatchObject({isError: true});
			const payload = JSON.parse((response.result as any).content[0].text);
			expect(payload.code).toBe('ambiguous_view_name');
		});

		test('create_view validates Kanban group-by field type', async () => {
			// Schema with a group-by field that is NOT singleSelect or singleCollaborator
			(mockAirtableService.getBaseSchema as any).mockResolvedValueOnce({
				tables: [{
					id: 'tbl1',
					name: 'Test Table',
					description: 'Test Description',
					fields: [
						{id: 'fld_status', name: 'Status', type: 'singleLineText'},
					],
					views: [],
					primaryFieldId: 'fld1',
				}],
			});

			const response = await sendRequest({
				jsonrpc: '2.0',
				id: '1',
				method: 'tools/call',
				params: {
					name: 'create_view',
					arguments: {
						baseId: 'base1',
						tableId: 'tbl1',
						name: 'Kanban A',
						type: 'kanban',
						groupBy: {field: 'Status'},
					},
				},
			});

			expect(response.result).toMatchObject({isError: true});
			const text = (response.result as any).content[0].text as string;
			expect(text).toMatch(/Kanban group-by must be singleSelect or singleCollaborator/);
		});
	});

	afterEach(async () => {
		await server.close();
	});
});
