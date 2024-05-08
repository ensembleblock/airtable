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
    constructor({ apiKey, baseId, baseUrl }: AirtableClientOpts);
    /**
     * Create a record.
     * @see https://airtable.com/developers/web/api/create-records
     */
    createRecord({ fields, tableIdOrName, }: CreateRecordOpts): Promise<AirtableResponse>;
    /**
     * Retrieve a single record using an Airtable `recordId`.
     * Any "empty" fields (e.g. "", [], or false) in the record will not be returned.
     * @see https://airtable.com/developers/web/api/get-record
     */
    getRecord({ recordId, tableIdOrName, }: GetRecordOpts): Promise<AirtableResponse>;
    /**
     * Updates a single record.
     * @see https://airtable.com/developers/web/api/update-record
     */
    updateRecord({ fields, method, recordId, tableIdOrName, }: UpdateRecordOpts): Promise<AirtableResponse>;
}
