import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
	type CallToolResult,
	type ListToolsResult,
	type ReadResourceResult,
	type ListResourcesResult,
} from '@modelcontextprotocol/sdk/types.js';
import {type z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {type Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
	ListRecordsArgsSchema,
	ListTablesArgsSchema,
	DescribeTableArgsSchema,
	GetRecordArgsSchema,
	CreateRecordArgsSchema,
	UpdateRecordsArgsSchema,
	DeleteRecordsArgsSchema,
	CreateTableArgsSchema,
	UpdateTableArgsSchema,
	CreateFieldArgsSchema,
	UpdateFieldArgsSchema,
	SearchRecordsArgsSchema,
	ListViewsArgsSchema,
	GetViewMetadataArgsSchema,
	CreateViewArgsSchema,
	DeleteViewArgsSchema,
	type IAirtableService,
	type IAirtableMCPServer,
} from './types.js';
import {logger} from './logger.js';

const getInputSchema = (schema: z.ZodType<object>): ListToolsResult['tools'][0]['inputSchema'] => {
	const jsonSchema = zodToJsonSchema(schema);
	if (!('type' in jsonSchema) || jsonSchema.type !== 'object') {
		throw new Error(`Invalid input schema to convert in airtable-mcp-server: expected an object but got ${'type' in jsonSchema ? String(jsonSchema.type) : 'no type'}`);
	}

	return {...jsonSchema, type: 'object'};
};

const formatToolResponse = (data: unknown, isError = false): CallToolResult => {
	return {
		content: [{
			type: 'text',
			mimeType: 'application/json',
			text: JSON.stringify(data),
		}],
		isError,
	};
};

export class AirtableMCPServer implements IAirtableMCPServer {
	private readonly server: Server;

	constructor(private readonly airtableService: IAirtableService) {
		this.server = new Server(
			{
				name: 'airtable-mcp-server',
				version: '0.1.0',
			},
			{
				capabilities: {
					resources: {},
					tools: {},
				},
			},
		);
		this.initializeHandlers();
	}

	async connect(transport: Transport): Promise<void> {
		logger.info('Connecting MCP server to transport');
		await this.server.connect(transport);
		logger.info('MCP server connected successfully');
	}

	async close(): Promise<void> {
		logger.info('Closing MCP server connection');
		await this.server.close();
	}

	// Public methods for HTTP transport
	async handleListTools(): Promise<ListToolsResult> {
		return this.handleListToolsInternal();
	}

	async handleCallTool(params: {name: string; arguments?: unknown}): Promise<CallToolResult> {
		// Wrap bare params in the structure expected by internal handler
		return this.handleCallToolInternal({
			method: 'tools/call',
			params: params as unknown as z.infer<typeof CallToolRequestSchema>['params'],
		} as z.infer<typeof CallToolRequestSchema>);
	}

	async handleListResources(): Promise<ListResourcesResult> {
		return this.handleListResourcesInternal();
	}

	async handleReadResource(params: {uri: string}): Promise<ReadResourceResult> {
		// Wrap bare params in the structure expected by internal handler
		return this.handleReadResourceInternal({
			method: 'resources/read',
			params: params as unknown as z.infer<typeof ReadResourceRequestSchema>['params'],
		} as z.infer<typeof ReadResourceRequestSchema>);
	}

	private initializeHandlers(): void {
		this.server.setRequestHandler(ListResourcesRequestSchema, this.handleListResourcesInternal.bind(this));
		this.server.setRequestHandler(ReadResourceRequestSchema, this.handleReadResourceInternal.bind(this));
		this.server.setRequestHandler(ListToolsRequestSchema, this.handleListToolsInternal.bind(this));
		this.server.setRequestHandler(CallToolRequestSchema, this.handleCallToolInternal.bind(this));
		logger.debug('MCP server handlers initialized');
	}

	private resolveAndValidateGroupByField(table: any, args: any): string | undefined {
		if (!args.groupBy?.field) {
			return undefined;
		}

		const lookup = (pred: (f: any) => boolean) => table.fields.find(pred);
		const field = args.groupBy.field.startsWith('fld')
			? lookup((f: any) => f.id === args.groupBy.field)
			: lookup((f: any) => f.name === args.groupBy.field);
		if (!field) {
			throw new Error(`Field ${args.groupBy.field} not found in table ${args.tableId}`);
		}

		if (args.type === 'kanban' && field.type !== 'singleSelect' && field.type !== 'singleCollaborator') {
			throw new Error('Kanban group-by must be singleSelect or singleCollaborator');
		}

		return field.id;
	}

	private async handleListResourcesInternal(): Promise<ListResourcesResult> {
		logger.debug('Handling list_resources request');
		const {bases} = await this.airtableService.listBases();
		const resources = await Promise.all(bases.map(async (base) => {
			const schema = await this.airtableService.getBaseSchema(base.id);
			return schema.tables.map((table) => ({
				uri: `airtable://${base.id}/${table.id}/schema`,
				mimeType: 'application/json',
				name: `${base.name}: ${table.name} schema`,
			}));
		}));

		return {
			resources: resources.flat(),
		};
	}

	private async handleReadResourceInternal(request: z.infer<typeof ReadResourceRequestSchema>): Promise<ReadResourceResult> {
		const {uri} = request.params;
		logger.debug({uri}, 'Handling read_resource request');
		const match = /^airtable:\/\/([^/]+)\/([^/]+)\/schema$/.exec(uri);

		if (!match?.[1] || !match[2]) {
			throw new Error('Invalid resource URI');
		}

		const [, baseId, tableId] = match;
		const schema = await this.airtableService.getBaseSchema(baseId);
		const table = schema.tables.find((t) => t.id === tableId);

		if (!table) {
			throw new Error(`Table ${tableId} not found in base ${baseId}`);
		}

		return {
			contents: [
				{
					uri: request.params.uri,
					mimeType: 'application/json',
					text: JSON.stringify({
						baseId,
						tableId: table.id,
						name: table.name,
						description: table.description,
						primaryFieldId: table.primaryFieldId,
						fields: table.fields,
						views: table.views,
					}),
				},
			],
		};
	}

	private async handleListToolsInternal(): Promise<ListToolsResult> {
		logger.debug('Handling list_tools request');
		return {
			tools: [
				{
					name: 'search',
					description: 'Search baseline tool required by ChatGPT connector.',
					inputSchema: {
						type: 'object',
						properties: {
							query: {type: 'string'},
							baseId: {type: 'string'},
							tableId: {type: 'string'},
							view: {type: 'string'},
						},
						required: ['query'],
					},
				},
				{
					name: 'fetch',
					description: 'Fetch baseline tool required by ChatGPT connector.',
					inputSchema: {
						type: 'object',
						properties: {
							id: {type: 'string'},
							type: {type: 'string', enum: ['record', 'table', 'view'], default: 'record'},
							baseId: {type: 'string'},
							tableId: {type: 'string'},
						},
						required: ['id'],
					},
				},
				{
					name: 'list_records',
					description: 'List records from a table',
					inputSchema: getInputSchema(ListRecordsArgsSchema),
				},
				{
					name: 'search_records',
					description: 'Search for records containing specific text',
					inputSchema: getInputSchema(SearchRecordsArgsSchema),
				},
				{
					name: 'list_bases',
					description: 'List all accessible Airtable bases',
					inputSchema: {
						type: 'object',
						properties: {},
						required: [],
					},
				},
				{
					name: 'list_tables',
					description: 'List all tables in a specific base',
					inputSchema: getInputSchema(ListTablesArgsSchema),
				},
				{
					name: 'describe_table',
					description: 'Get detailed information about a specific table',
					inputSchema: getInputSchema(DescribeTableArgsSchema),
				},
				{
					name: 'get_record',
					description: 'Get a specific record by ID',
					inputSchema: getInputSchema(GetRecordArgsSchema),
				},
				{
					name: 'create_record',
					description: 'Create a new record in a table',
					inputSchema: getInputSchema(CreateRecordArgsSchema),
				},
				{
					name: 'update_records',
					description: 'Update up to 10 records in a table',
					inputSchema: getInputSchema(UpdateRecordsArgsSchema),
				},
				{
					name: 'delete_records',
					description: 'Delete records from a table',
					inputSchema: getInputSchema(DeleteRecordsArgsSchema),
				},
				{
					name: 'create_table',
					description: 'Create a new table in a base',
					inputSchema: getInputSchema(CreateTableArgsSchema),
				},
				{
					name: 'update_table',
					description: 'Update a table\'s name or description',
					inputSchema: getInputSchema(UpdateTableArgsSchema),
				},
				{
					name: 'create_field',
					description: 'Create a new field in a table',
					inputSchema: getInputSchema(CreateFieldArgsSchema),
				},
				{
					name: 'update_field',
					description: 'Update a field\'s name or description',
					inputSchema: getInputSchema(UpdateFieldArgsSchema),
				},
				{
					name: 'list_views',
					description: 'List all views for a given table',
					inputSchema: getInputSchema(ListViewsArgsSchema),
				},
				{
					name: 'get_view_metadata',
					description: 'Get detailed configuration for a specific view',
					inputSchema: getInputSchema(GetViewMetadataArgsSchema),
				},
				{
					name: 'create_view',
					description: 'Create a new view (grid or kanban) with optional filters, sorts, grouping, and field visibility',
					inputSchema: getInputSchema(CreateViewArgsSchema),
				},
				{
					name: 'delete_view',
					description: 'Delete an existing view by name or ID',
					inputSchema: getInputSchema(DeleteViewArgsSchema),
				},
			],
		};
	}

	private async handleCallToolInternal(request: z.infer<typeof CallToolRequestSchema>): Promise<CallToolResult> {
		logger.info({tool: request.params.name}, 'Handling tool call');
		try {
			switch (request.params.name) {
				case 'search': {
					const {query, baseId, tableId, view} = request.params.arguments as {
						query: string;
						baseId?: string;
						tableId?: string;
						view?: string;
					};

					if (baseId && tableId) {
						logger.debug({baseId, tableId, query}, 'Executing search_records');
						const records = await this.airtableService.searchRecords(
							baseId,
							tableId,
							query,
							undefined,
							undefined,
							view,
						);
						return formatToolResponse(records);
					}

					return formatToolResponse({note: 'search placeholder', query});
				}

				case 'fetch': {
					const {id, type = 'record', baseId, tableId} = request.params.arguments as {
						id: string;
						type?: 'record' | 'table' | 'view';
						baseId?: string;
						tableId?: string;
					};

					logger.debug(
						{
							id,
							type,
							baseId,
							tableId,
						},
						'Executing fetch',
					);
					if (type === 'record' && baseId && tableId) {
						const record = await this.airtableService.getRecord(baseId, tableId, id);
						return formatToolResponse(record);
					}

					if (type === 'table' && baseId) {
						const schema = await this.airtableService.getBaseSchema(baseId);
						const table = schema.tables.find((t) => t.id === id);
						if (table) {
							return formatToolResponse(table);
						}
					}

					if (type === 'view' && baseId && tableId) {
						const viewMetadata = await this.airtableService.getViewMetadata(baseId, tableId, id);
						return formatToolResponse(viewMetadata);
					}

					return formatToolResponse({note: 'fetch placeholder', id, type});
				}

				case 'list_records': {
					const args = ListRecordsArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId}, 'Executing list_records');
					const records = await this.airtableService.listRecords(
						args.baseId,
						args.tableId,
						{
							view: args.view,
							maxRecords: args.maxRecords,
							filterByFormula: args.filterByFormula,
							sort: args.sort,
						},
					);
					return formatToolResponse(records);
				}

				case 'search_records': {
					const args = SearchRecordsArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId, term: args.searchTerm}, 'Executing search_records');
					const records = await this.airtableService.searchRecords(
						args.baseId,
						args.tableId,
						args.searchTerm,
						args.fieldIds,
						args.maxRecords,
						args.view,
					);
					return formatToolResponse(records);
				}

				case 'list_bases': {
					logger.debug('Executing list_bases');
					const {bases} = await this.airtableService.listBases();
					return formatToolResponse(bases.map((base) => ({
						id: base.id,
						name: base.name,
						permissionLevel: base.permissionLevel,
					})));
				}

				case 'list_tables': {
					const args = ListTablesArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId}, 'Executing list_tables');
					const schema = await this.airtableService.getBaseSchema(args.baseId);
					return formatToolResponse(schema.tables.map((table) => {
						switch (args.detailLevel) {
							case 'tableIdentifiersOnly':
								return {
									id: table.id,
									name: table.name,
								};
							case 'identifiersOnly':
								return {
									id: table.id,
									name: table.name,
									fields: table.fields.map((field) => ({
										id: field.id,
										name: field.name,
									})),
									views: table.views.map((view) => ({
										id: view.id,
										name: view.name,
									})),
								};
							case 'full':
							// eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check, no-fallthrough
							default:
								return {
									id: table.id,
									name: table.name,
									description: table.description,
									fields: table.fields,
									views: table.views,
								};
						}
					}));
				}

				case 'describe_table': {
					const args = DescribeTableArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId}, 'Executing describe_table');
					const schema = await this.airtableService.getBaseSchema(args.baseId);
					const table = schema.tables.find((t) => t.id === args.tableId);

					if (!table) {
						return formatToolResponse(`Table ${args.tableId} not found in base ${args.baseId}`, true);
					}

					switch (args.detailLevel) {
						case 'tableIdentifiersOnly':
							return formatToolResponse({
								id: table.id,
								name: table.name,
							});
						case 'identifiersOnly':
							return formatToolResponse({
								id: table.id,
								name: table.name,
								fields: table.fields.map((field) => ({
									id: field.id,
									name: field.name,
								})),
								views: table.views.map((view) => ({
									id: view.id,
									name: view.name,
								})),
							});
						case 'full':
						// eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check, no-fallthrough
						default:
							return formatToolResponse({
								id: table.id,
								name: table.name,
								description: table.description,
								fields: table.fields,
								views: table.views,
							});
					}
				}

				case 'get_record': {
					const args = GetRecordArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId, recordId: args.recordId}, 'Executing get_record');
					const record = await this.airtableService.getRecord(args.baseId, args.tableId, args.recordId);
					return formatToolResponse({
						id: record.id,
						fields: record.fields,
					});
				}

				case 'create_record': {
					const args = CreateRecordArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId}, 'Executing create_record');
					const record = await this.airtableService.createRecord(args.baseId, args.tableId, args.fields);
					return formatToolResponse({
						id: record.id,
						fields: record.fields,
					});
				}

				case 'update_records': {
					const args = UpdateRecordsArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId, count: args.records.length}, 'Executing update_records');
					const records = await this.airtableService.updateRecords(args.baseId, args.tableId, args.records);
					return formatToolResponse(records.map((record) => ({
						id: record.id,
						fields: record.fields,
					})));
				}

				case 'delete_records': {
					const args = DeleteRecordsArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId, count: args.recordIds.length}, 'Executing delete_records');
					const records = await this.airtableService.deleteRecords(args.baseId, args.tableId, args.recordIds);
					return formatToolResponse(records.map((record) => ({
						id: record.id,
					})));
				}

				case 'create_table': {
					const args = CreateTableArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableName: args.name}, 'Executing create_table');
					const table = await this.airtableService.createTable(
						args.baseId,
						args.name,
						args.fields,
						args.description,
					);
					return formatToolResponse(table);
				}

				case 'update_table': {
					const args = UpdateTableArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId}, 'Executing update_table');
					const table = await this.airtableService.updateTable(
						args.baseId,
						args.tableId,
						{name: args.name, description: args.description},
					);
					return formatToolResponse(table);
				}

				case 'create_field': {
					const args = CreateFieldArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId, fieldType: args.nested.field.type}, 'Executing create_field');
					const field = await this.airtableService.createField(
						args.baseId,
						args.tableId,
						args.nested.field,
					);
					return formatToolResponse(field);
				}

				case 'update_field': {
					const args = UpdateFieldArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId, fieldId: args.fieldId}, 'Executing update_field');
					const field = await this.airtableService.updateField(
						args.baseId,
						args.tableId,
						args.fieldId,
						{
							name: args.name,
							description: args.description,
						},
					);
					return formatToolResponse(field);
				}

				case 'list_views': {
					const args = ListViewsArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId}, 'Executing list_views');
					const views = await this.airtableService.listViews(args.baseId, args.tableId);
					return formatToolResponse(views);
				}

				case 'get_view_metadata': {
					const args = GetViewMetadataArgsSchema.parse(request.params.arguments);
					logger.debug(
						{
							baseId: args.baseId,
							tableId: args.tableId,
							view: args.view,
						},
						'Executing get_view_metadata',
					);

					// Resolve view ID if a name was provided
					let viewId = args.view;
					if (!viewId.startsWith('viw')) {
						const schema = await this.airtableService.getBaseSchema(args.baseId);
						const table = schema.tables.find((t) => t.id === args.tableId);
						if (!table) {
							return formatToolResponse(`Table ${args.tableId} not found in base ${args.baseId}`, true);
						}

						const matches = table.views.filter((v) => v.name === args.view);
						logger.debug({viewName: args.view, matchCount: matches.length}, 'View name resolution');

						if (matches.length === 0) {
							return formatToolResponse(`View ${args.view} not found in table ${args.tableId}`, true);
						}

						if (matches.length > 1) {
							logger.warn(
								{
									viewName: args.view,
									tableId: args.tableId,
								},
								'Ambiguous view name detected',
							);
							return formatToolResponse({
								code: 'ambiguous_view_name',
								message: `Multiple views named ${args.view} in table ${args.tableId}`,
								remediation: 'Use the view ID (viw...) instead of name.',
							}, true);
						}

						viewId = matches[0]!.id;
						logger.debug(
							{
								viewName: args.view,
								viewId,
							},
							'View name resolved to ID',
						);
					}

					const metadata = await this.airtableService.getViewMetadata(args.baseId, args.tableId, viewId);
					return formatToolResponse(metadata);
				}

				case 'create_view': {
					const args = CreateViewArgsSchema.parse(request.params.arguments);
					logger.debug(
						{
							baseId: args.baseId,
							tableId: args.tableId,
							viewName: args.name,
							viewType: args.type,
						},
						'Executing create_view',
					);

					// Map field names to IDs if needed
					const schema = await this.airtableService.getBaseSchema(args.baseId);
					const table = schema.tables.find((t) => t.id === args.tableId);
					if (!table) {
						return formatToolResponse(`Table ${args.tableId} not found in base ${args.baseId}`, true);
					}

					// Map sorts field names to IDs
					const sorts = args.sorts?.map((sort) => {
						if (sort.field.startsWith('fld')) {
							return {fieldId: sort.field, direction: sort.direction};
						}

						const field = table.fields.find((f) => f.name === sort.field);
						if (!field) {
							throw new Error(`Field ${sort.field} not found in table ${args.tableId}`);
						}

						return {fieldId: field.id, direction: sort.direction};
					});

					// Use the helper method to resolve and validate groupBy field
					const rowGroupingFieldId = this.resolveAndValidateGroupByField(table, args);

					// Map fields array to field IDs
					const fieldOrderIds = args.fields?.map((fieldName) => {
						if (fieldName.startsWith('fld')) {
							return fieldName;
						}

						const field = table.fields.find((f) => f.name === fieldName);
						if (!field) {
							throw new Error(`Field ${fieldName} not found in table ${args.tableId}`);
						}

						return field.id;
					});

					// Construct input, adding optional properties only when defined
					const createInput: {
						name: string;
						type: 'grid' | 'kanban';
						filterByFormula?: string;
						sorts?: {fieldId: string; direction: 'asc' | 'desc'}[];
						rowGroupingFieldId?: string;
						fieldOrderIds?: string[];
					} = {
						name: args.name,
						type: args.type,
					};

					if (args.filterByFormula) {
						createInput.filterByFormula = args.filterByFormula;
					}

					if (sorts?.length) {
						createInput.sorts = sorts as {fieldId: string; direction: 'asc' | 'desc'}[];
					}

					if (rowGroupingFieldId) {
						createInput.rowGroupingFieldId = rowGroupingFieldId;
					}

					if (fieldOrderIds?.length) {
						createInput.fieldOrderIds = fieldOrderIds as string[];
					}

					const view = await this.airtableService.createView(args.baseId, args.tableId, createInput);
					logger.info({baseId: args.baseId, tableId: args.tableId, viewId: view.id}, 'View created successfully');
					return formatToolResponse(view);
				}

				case 'delete_view': {
					const args = DeleteViewArgsSchema.parse(request.params.arguments);
					logger.debug({baseId: args.baseId, tableId: args.tableId, view: args.view}, 'Executing delete_view');

					// Resolve view ID if a name was provided
					let viewId = args.view;
					if (!viewId.startsWith('viw')) {
						const schema = await this.airtableService.getBaseSchema(args.baseId);
						const table = schema.tables.find((t) => t.id === args.tableId);
						if (!table) {
							return formatToolResponse(`Table ${args.tableId} not found in base ${args.baseId}`, true);
						}

						const matches = table.views.filter((v) => v.name === args.view);
						logger.debug({viewName: args.view, matchCount: matches.length}, 'View name resolution for deletion');

						if (matches.length === 0) {
							return formatToolResponse(`View ${args.view} not found in table ${args.tableId}`, true);
						}

						if (matches.length > 1) {
							logger.warn({viewName: args.view, tableId: args.tableId}, 'Ambiguous view name detected for deletion');
							return formatToolResponse({
								code: 'ambiguous_view_name',
								message: `Multiple views named ${args.view} in table ${args.tableId}`,
								remediation: 'Use the view ID (viw...) instead of name.',
							}, true);
						}

						viewId = matches[0]!.id;
						logger.debug({viewName: args.view, viewId}, 'View name resolved to ID for deletion');
					}

					const result = await this.airtableService.deleteView(args.baseId, args.tableId, viewId);
					logger.info({baseId: args.baseId, tableId: args.tableId, viewId}, 'View deleted successfully');
					return formatToolResponse(result || {deleted: true, id: viewId});
				}

				default: {
					logger.warn({tool: request.params.name}, 'Unknown tool requested');
					throw new Error(`Unknown tool: ${request.params.name}`);
				}
			}
		} catch (error) {
			// Enhanced error handling with structured error objects
			logger.error({err: error, tool: request.params.name}, 'Error in tool execution');

			if (error instanceof Error) {
				// Check for structured error properties
				const {status} = (error as any);
				const {airtableErrorType} = (error as any);

				// Map error codes based on status or error type
				let code = 'internal_error';
				if (status === 401 || airtableErrorType === 'AUTHENTICATION_REQUIRED') {
					code = 'unauthorized';
				} else if (status === 403 || airtableErrorType === 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND') {
					code = 'forbidden_or_not_found';
				} else if (status === 422) {
					code = 'validation_error';
				}

				// Return structured error if we have metadata
				if (status || airtableErrorType || (error as any).hint || (error as any).remediation) {
					return formatToolResponse({
						code,
						message: error.message,
						hint: (error as any).hint,
						remediation: (error as any).remediation,
					}, true);
				}
			}

			// Fallback to previous string format
			return formatToolResponse(
				`Error in tool ${request.params.name}: ${error instanceof Error ? error.message : String(error)}`,
				true,
			);
		}
	}
}
