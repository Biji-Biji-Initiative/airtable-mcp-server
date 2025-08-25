import {z} from 'zod';
import {
	type IAirtableService,
	type ListBasesResponse,
	type BaseSchemaResponse,
	type ListRecordsOptions,
	type Field,
	type Table,
	type AirtableRecord,
	ListBasesResponseSchema,
	BaseSchemaResponseSchema,
	TableSchema,
	FieldSchema,
	type FieldSet,
} from './types.js';
import {enhanceAirtableError} from './enhanceAirtableError.js';

export class AirtableService implements IAirtableService {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly fetch: typeof fetch;
	private readonly schemaCache = new Map<string, {data: BaseSchemaResponse; expiresAt: number}>();
	private basesCache: {data: ListBasesResponse; expiresAt: number} | null = null;
	private readonly schemaTtlMs = Number(process.env.SCHEMA_CACHE_TTL_MS || 5 * 60 * 1000);

	constructor(
		apiKey: string = process.env.AIRTABLE_API_KEY || '',
		baseUrl = 'https://api.airtable.com',
		fetchFn: typeof fetch = fetch,
	) {
		this.apiKey = apiKey.trim();
		if (!this.apiKey) {
			throw new Error('airtable-mcp-server: No API key provided. Set it in the `AIRTABLE_API_KEY` environment variable');
		}

		this.baseUrl = baseUrl;
		this.fetch = fetchFn;
	}

	async listBases(): Promise<ListBasesResponse> {
		// Return cached data if valid
		if (this.basesCache && this.basesCache.expiresAt > Date.now()) {
			return this.basesCache.data;
		}

		// Fetch and cache
		const data = await this.fetchFromAPI('/v0/meta/bases', ListBasesResponseSchema);
		this.basesCache = {
			data,
			expiresAt: Date.now() + this.schemaTtlMs,
		};
		return data;
	}

	async getBaseSchema(baseId: string): Promise<BaseSchemaResponse> {
		// Return cached data if valid
		const cached = this.schemaCache.get(baseId);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.data;
		}

		// Fetch and cache
		const data = await this.fetchFromAPI(`/v0/meta/bases/${baseId}/tables`, BaseSchemaResponseSchema);
		this.schemaCache.set(baseId, {
			data,
			expiresAt: Date.now() + this.schemaTtlMs,
		});
		return data;
	}

	async listRecords(baseId: string, tableId: string, options: ListRecordsOptions = {}): Promise<AirtableRecord[]> {
		let allRecords: AirtableRecord[] = [];
		let offset: string | undefined;

		do {
			const queryParams = new URLSearchParams();
			if (options.maxRecords) {
				queryParams.append('maxRecords', options.maxRecords.toString());
			}

			if (options.filterByFormula) {
				queryParams.append('filterByFormula', options.filterByFormula);
			}

			if (options.view) {
				queryParams.append('view', options.view);
			}

			if (offset) {
				queryParams.append('offset', offset);
			}

			// Add sort parameters if provided
			if (options.sort && options.sort.length > 0) {
				options.sort.forEach((sortOption, index) => {
					queryParams.append(`sort[${index}][field]`, sortOption.field);
					if (sortOption.direction) {
						queryParams.append(`sort[${index}][direction]`, sortOption.direction);
					}
				});
			}

			// eslint-disable-next-line no-await-in-loop
			const response = await this.fetchFromAPI(
				`/v0/${baseId}/${tableId}?${queryParams.toString()}`,
				z.object({
					records: z.array(z.object({id: z.string(), fields: z.record(z.any())})),
					offset: z.string().optional(),
				}),
			);

			allRecords = allRecords.concat(response.records);
			offset = response.offset;
		} while (offset);

		return allRecords;
	}

	async getRecord(baseId: string, tableId: string, recordId: string): Promise<AirtableRecord> {
		return this.fetchFromAPI(
			`/v0/${baseId}/${tableId}/${recordId}`,
			z.object({id: z.string(), fields: z.record(z.any())}),
		);
	}

	async createRecord(baseId: string, tableId: string, fields: FieldSet): Promise<AirtableRecord> {
		return this.fetchFromAPI(
			`/v0/${baseId}/${tableId}`,
			z.object({id: z.string(), fields: z.record(z.any())}),
			{
				method: 'POST',
				body: JSON.stringify({fields}),
			},
		);
	}

	async updateRecords(
		baseId: string,
		tableId: string,
		records: {id: string; fields: FieldSet}[],
	): Promise<AirtableRecord[]> {
		const response = await this.fetchFromAPI(
			`/v0/${baseId}/${tableId}`,
			z.object({records: z.array(z.object({id: z.string(), fields: z.record(z.any())}))}),
			{
				method: 'PATCH',
				body: JSON.stringify({records}),
			},
		);
		return response.records;
	}

	async deleteRecords(baseId: string, tableId: string, recordIds: string[]): Promise<{id: string}[]> {
		const queryString = recordIds.map((id) => `records[]=${id}`).join('&');
		const response = await this.fetchFromAPI(
			`/v0/${baseId}/${tableId}?${queryString}`,
			z.object({records: z.array(z.object({id: z.string(), deleted: z.boolean()}))}),
			{
				method: 'DELETE',
			},
		);
		return response.records.map(({id}) => ({id}));
	}

	async createTable(baseId: string, name: string, fields: Field[], description?: string): Promise<Table> {
		const result = await this.fetchFromAPI(
			`/v0/meta/bases/${baseId}/tables`,
			TableSchema,
			{
				method: 'POST',
				body: JSON.stringify({name, description, fields}),
			},
		);
		this.invalidateBaseSchema(baseId);
		return result;
	}

	async updateTable(
		baseId: string,
		tableId: string,
		updates: {name?: string; description?: string},
	): Promise<Table> {
		const result = await this.fetchFromAPI(
			`/v0/meta/bases/${baseId}/tables/${tableId}`,
			TableSchema,
			{
				method: 'PATCH',
				body: JSON.stringify(updates),
			},
		);
		this.invalidateBaseSchema(baseId);
		return result;
	}

	async createField(baseId: string, tableId: string, field: Omit<Field, 'id'>): Promise<Field> {
		const result = await this.fetchFromAPI(
			`/v0/meta/bases/${baseId}/tables/${tableId}/fields`,
			FieldSchema,
			{
				method: 'POST',
				body: JSON.stringify(field),
			},
		);
		this.invalidateBaseSchema(baseId);
		return result;
	}

	async updateField(
		baseId: string,
		tableId: string,
		fieldId: string,
		updates: {name?: string; description?: string},
	): Promise<Field> {
		const result = await this.fetchFromAPI(
			`/v0/meta/bases/${baseId}/tables/${tableId}/fields/${fieldId}`,
			FieldSchema,
			{
				method: 'PATCH',
				body: JSON.stringify(updates),
			},
		);
		this.invalidateBaseSchema(baseId);
		return result;
	}

	async searchRecords(
		baseId: string,
		tableId: string,
		searchTerm: string,
		fieldIds?: string[],
		maxRecords?: number,
		view?: string,
	): Promise<AirtableRecord[]> {
		// Validate and get search fields
		const searchFields = await this.validateAndGetSearchFields(baseId, tableId, fieldIds);

		// Escape the search term to prevent formula injection
		const escapedTerm = searchTerm.replace(/["\\]/g, '\\$&');

		// Build OR(FIND("term", field1), FIND("term", field2), ...)
		const filterByFormula = `OR(${
			searchFields
				.map((fieldId) => `FIND("${escapedTerm}", {${fieldId}})`)
				.join(',')
		})`;

		return this.listRecords(baseId, tableId, {maxRecords, filterByFormula, view});
	}

	// ------------------------------------------------------------------
	// View manipulation API implementations
	// ------------------------------------------------------------------
	async listViews(
		baseId: string,
		tableId: string,
	): Promise<{id: string; name: string; type: string}[]> {
		const table = await this.getTableSchema(baseId, tableId);
		return table.views.map((v) => ({id: v.id, name: v.name, type: v.type}));
	}

	async getViewMetadata(baseId: string, tableId: string, viewId: string): Promise<any> {
		return this.fetchFromAPI(
			`/v0/meta/bases/${baseId}/tables/${tableId}/views/${viewId}`,
			z.any(),
		);
	}

	async createView(
		baseId: string,
		tableId: string,
		input: {
			name: string;
			type: 'grid' | 'kanban';
			filterByFormula?: string;
			sorts?: {fieldId: string; direction: 'asc' | 'desc'}[];
			rowGroupingFieldId?: string;
			fieldOrderIds?: string[];
		},
	): Promise<any> {
		const body: any = {
			type: input.type,
			name: input.name,
			configuration: {},
		};

		if (input.filterByFormula) {
			body.configuration.filters = {formula: input.filterByFormula};
		}

		if (input.sorts && input.sorts.length > 0) {
			body.configuration.sorts = input.sorts.map((s) => ({
				fieldId: s.fieldId,
				direction: s.direction,
			}));
		}

		if (input.fieldOrderIds && input.fieldOrderIds.length > 0) {
			body.configuration.fieldOrder = {
				fieldIds: input.fieldOrderIds,
				lockedFields: [],
			};
		}

		if (input.type === 'kanban') {
			if (!input.rowGroupingFieldId) {
				throw new Error('Kanban view requires rowGroupingFieldId');
			}

			body.configuration.rowGrouping = {fieldId: input.rowGroupingFieldId};
		}

		const result = await this.fetchFromAPI(
			`/v0/meta/bases/${baseId}/tables/${tableId}/views`,
			z.any(),
			{
				method: 'POST',
				body: JSON.stringify(body),
			},
		);

		// Invalidate schema cache after creating a view
		this.invalidateBaseSchema(baseId);
		return result;
	}

	async deleteView(
		baseId: string,
		tableId: string,
		viewId: string,
	): Promise<{id: string} | void> {
		const response = await this.fetchFromAPI(
			`/v0/meta/bases/${baseId}/tables/${tableId}/views/${viewId}`,
			z.any(),
			{method: 'DELETE'},
		);

		// Invalidate schema cache after deleting a view
		this.invalidateBaseSchema(baseId);

		if (response && typeof response === 'object' && 'id' in response) {
			return {id: (response as {id: string}).id};
		}

		return {id: viewId};
	}

	// ------------------------------------------------------------------
	// Private helpers
	// ------------------------------------------------------------------

	private invalidateBaseSchema(baseId: string) {
		this.schemaCache.delete(baseId);
	}

	private async validateAndGetSearchFields(
		baseId: string,
		tableId: string,
		requestedFieldIds?: string[],
	): Promise<string[]> {
		const schema = await this.getBaseSchema(baseId);
		const table = schema.tables.find((t) => t.id === tableId);
		if (!table) {
			throw new Error(`Table ${tableId} not found in base ${baseId}`);
		}

		const searchableFieldTypes = [
			'singleLineText',
			'multilineText',
			'richText',
			'email',
			'url',
			'phoneNumber',
		];

		const searchableFields = table.fields
			.filter((field: any) => searchableFieldTypes.includes((field).type as string))
			.map((field: any) => (field).id as string);

		if (searchableFields.length === 0) {
			throw new Error('No text fields available to search');
		}

		if (requestedFieldIds && requestedFieldIds.length > 0) {
			const invalidFields = requestedFieldIds.filter((fieldId) => !searchableFields.includes(fieldId));
			if (invalidFields.length > 0) {
				throw new Error(`Invalid fields requested: ${invalidFields.join(', ')}`);
			}

			return requestedFieldIds;
		}

		return searchableFields;
	}

	private async getTableSchema(baseId: string, tableId: string) {
		const schema = await this.getBaseSchema(baseId);
		const table = schema.tables.find((t) => t.id === tableId);
		if (!table) {
			throw new Error(`Table ${tableId} not found in base ${baseId}`);
		}

		return table;
	}

	private async resolveFieldId(baseId: string, tableId: string, nameOrId: string): Promise<string> {
		if (nameOrId.startsWith('fld')) {
			return nameOrId;
		}

		const table = await this.getTableSchema(baseId, tableId);
		const field = table.fields.find((f) => f.id === nameOrId || f.name === nameOrId);
		if (!field) {
			throw new Error(`Field not found on table ${tableId}: ${nameOrId}`);
		}

		return field.id;
	}

	// ------------------------------------------------------------------
	// Networking helpers
	// ------------------------------------------------------------------

	/**
	 * Sleep helper used for exponential-back-off.
	 */
	private async sleep(ms: number): Promise<void> {
		return new Promise<void>((resolve) => {
			setTimeout(resolve, ms);
		});
	}

	private async fetchFromAPI<T>(
		endpoint: string,
		schema: z.ZodSchema<T>,
		options: RequestInit = {},
	): Promise<T> {
		const maxRetries = 3;

		const doRequest = async (attempt: number): Promise<T> => {
			const response = await this.fetch(`${this.baseUrl}${endpoint}`, {
				...options,
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					Accept: 'application/json',
					'Content-Type': 'application/json',
					...options.headers,
				},
			});

			const responseText = await response.text();

			if (!response.ok) {
				const error = new Error(`Airtable API Error: ${response.statusText}. Response: ${responseText}`);
				(error as any).status = response.status;
				(error as any).airtableResponse = responseText;
				enhanceAirtableError(error, responseText, this.apiKey);

				try {
					const parsed = JSON.parse(responseText);
					if (parsed?.error?.type) {
						(error as any).airtableErrorType = parsed.error.type;
					}
				} catch {
					// ignore
				}

				// Retry on 429 or 5xx
				if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
					const baseDelay = (2 ** attempt) * 1000;
					const jitter = Math.random() * 1000;
					await this.sleep(baseDelay + jitter);
					return doRequest(attempt + 1);
				}

				throw error;
			}

			try {
				const data = JSON.parse(responseText);
				return schema.parse(data);
			} catch (parseError) {
				throw new Error(`Failed to parse API response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
			}
		};

		return doRequest(1);
	}
}
