export type AirtableClientOpts = {
    /** A string of at least 10 characters. */
    apiKey: string;
    /** A string of at least 10 characters beginning with "app". */
    baseId: string;
    /**
     * Optionally set the base URL (without a trailing slash).
     * Defaults to "https://api.airtable.com/v0".
     */
    baseUrl?: string;
};
export type AirtableResponse = {
    data: unknown;
    ok: boolean;
    status: number;
    statusText: string;
};
export type FieldsObj = Record<string, boolean | Date | null | number | string | undefined>;
export type CreateRecordOpts = {
    fields: FieldsObj;
    tableIdOrName: string;
};
export type GetRecordOpts = {
    /** A string of at least 10 characters beginning with "rec". */
    recordId: string;
    tableIdOrName: string;
};
export type UpdateRecordOpts = {
    fields: FieldsObj;
    /**
     * A PATCH request (the default) will only update the fields you specify,
     * leaving the rest as they were.
     *
     * A PUT request will perform a destructive update and clear all unspecified cell values.
     */
    method?: `PATCH` | `PUT`;
    /** A string of at least 10 characters beginning with "rec". */
    recordId: string;
    tableIdOrName: string;
};
/**
 * @see https://github.com/ensembleblock/airtable
 */
export declare class AirtableClient {
    private baseId;
    private baseUrl;
    private headers;
    /** Timestamp of the last request (epoch millis). */
    private lastRequestAt;
    /** The Airtable API is limited to 5 requests per second per base. */
    private minMillisBetweenRequests;
    /**
     * Constructs an instance of the AirtableClient.
     *
     * @param {Object} param0 - Configuration object.
     * @param {string} param0.apiKey - Airtable API key for authentication.
     * @param {string} param0.baseId - The unique identifier for the base (begins with 'app').
     * @param {string} [param0.baseUrl] - An optional API base URL (without a trailing slash).
     * Defaults to the standard Airtable API URL.
     */
    constructor({ apiKey, baseId, baseUrl }: AirtableClientOpts);
    /**
     * Call before making an Airtable API request.
     * This method ensures that we don't make more than 5 requests per second.
     * @see https://airtable.com/developers/web/api/rate-limits
     */
    private throttleIfNeeded;
    private setLastRequestAt;
    /**
     * Create a record.
     * @see https://airtable.com/developers/web/api/create-records
     *
     * @param {Object} param0 - Configuration for the record creation.
     * @param {Object} param0.fields - Fields to include in the new record (key/value pairs).
     * @param {string} param0.tableIdOrName - Table ID or name where the record will be created.
     *
     * @returns {Promise<Object>} A promise that resolves with the result of the API call.
     */
    createRecord({ fields, tableIdOrName, }: CreateRecordOpts): Promise<AirtableResponse>;
    /**
     * Retrieve a single record using an Airtable `recordId`.
     * Any "empty" fields (e.g. "", [], or false) in the record will not be returned.
     * @see https://airtable.com/developers/web/api/get-record
     *
     * @param {Object} param0 - Configuration for retrieving the record.
     * @param {string} param0.recordId - The unique identifier of the record to retrieve
     * (begins with 'rec').
     * @param {string} param0.tableIdOrName - Table ID or name from which to retrieve the record.
     *
     * @returns {Promise<Object>} A promise that resolves with the result of the GET request.
     */
    getRecord({ recordId, tableIdOrName, }: GetRecordOpts): Promise<AirtableResponse>;
    /**
     * Updates a single record.
     * @see https://airtable.com/developers/web/api/update-record
     *
     * @param {Object} param0 - Configuration for updating the record.
     * @param {Object} param0.fields - New values for the record fields (key/value pairs).
     * @param {string} [param0.method='PATCH'] - The HTTP method to use for the update
     * ('PATCH' or 'PUT'). Defaults to 'PATCH'. 'PATCH' will only update the fields you specify,
     * leaving the rest as they were. 'PUT' will perform a destructive update
     * and clear all unspecified cell values.
     * @param {string} param0.recordId - The unique identifier of the record to update
     * (begins with 'rec').
     * @param {string} param0.tableIdOrName - Table ID or name in which the record resides.
     *
     * @returns {Promise<Object>} A promise that resolves with the result of the update operation.
     */
    updateRecord({ fields, method, recordId, tableIdOrName, }: UpdateRecordOpts): Promise<AirtableResponse>;
}
