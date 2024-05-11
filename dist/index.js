/**
 * @see https://github.com/ensembleblock/airtable
 */
export class AirtableClient {
    baseId = null;
    baseUrl = `https://api.airtable.com/v0`;
    headers = {};
    /** Timestamp of the last request (epoch millis). */
    lastRequestAt = null;
    /** The Airtable API is limited to 5 requests per second per base. */
    minMillisBetweenRequests = 200;
    /**
     * Constructs an instance of the AirtableClient.
     *
     * @param {Object} param0 - Configuration object.
     * @param {string} param0.apiKey - Airtable API key for authentication.
     * @param {string} param0.baseId - The unique identifier for the base (begins with 'app').
     * @param {string} [param0.baseUrl] - An optional API base URL (without a trailing slash).
     * Defaults to the standard Airtable API URL.
     */
    constructor({ apiKey, baseId, baseUrl }) {
        if (typeof apiKey !== `string` || apiKey.length < 10) {
            throw new TypeError(`AirtableClient expected 'apiKey' to be string of at least 10 characters`);
        }
        if (typeof baseId !== `string` ||
            baseId.length < 10 ||
            !baseId.startsWith(`app`)) {
            throw new TypeError(`AirtableClient expected 'baseId' to be string of at least 10 characters starting with 'app'`);
        }
        this.headers = {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': `application/json`,
        };
        this.baseId = baseId;
        if (baseUrl) {
            if (typeof baseUrl !== `string` || baseUrl.endsWith(`/`)) {
                throw new TypeError(`AirtableClient expected 'baseUrl' to be a string without a trailing slash`);
            }
            this.baseUrl = baseUrl;
        }
    }
    /**
     * Call before making an Airtable API request.
     * This method ensures that we don't make more than 5 requests per second.
     * @see https://airtable.com/developers/web/api/rate-limits
     */
    async throttleIfNeeded() {
        const millisSinceLastReq = this.lastRequestAt
            ? Date.now() - this.lastRequestAt
            : null;
        if (millisSinceLastReq &&
            millisSinceLastReq < this.minMillisBetweenRequests) {
            const throttleMillis = this.minMillisBetweenRequests - millisSinceLastReq;
            await sleep(throttleMillis);
        }
    }
    setLastRequestAt() {
        this.lastRequestAt = Date.now();
    }
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
    async createRecord({ fields, tableIdOrName, }) {
        if (!fields || typeof fields !== `object` || Array.isArray(fields)) {
            throw new TypeError(`Airtable createRecord expected 'fields' to be a plain object`);
        }
        if (!tableIdOrName || typeof tableIdOrName !== `string`) {
            throw new TypeError(`Airtable createRecord expected 'tableIdOrName' to be a non-empty string`);
        }
        const createRecordUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}`;
        const body = JSON.stringify({ fields });
        await this.throttleIfNeeded();
        this.setLastRequestAt();
        const res = await fetch(createRecordUrl, {
            body,
            headers: this.headers,
            method: `POST`,
        });
        const data = await res.json();
        return { data, ok: res.ok, status: res.status, statusText: res.statusText };
    }
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
    async getRecord({ recordId, tableIdOrName, }) {
        if (typeof recordId !== `string` ||
            recordId.length < 10 ||
            !recordId.startsWith(`rec`)) {
            throw new TypeError(`Airtable getRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`);
        }
        if (!tableIdOrName || typeof tableIdOrName !== `string`) {
            throw new TypeError(`Airtable getRecord expected 'tableIdOrName' to be a non-empty string`);
        }
        const getRecordUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}/${recordId}`;
        await this.throttleIfNeeded();
        this.setLastRequestAt();
        const res = await fetch(getRecordUrl, {
            headers: this.headers,
            method: `GET`,
        });
        const data = await res.json();
        return { data, ok: res.ok, status: res.status, statusText: res.statusText };
    }
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
    async updateRecord({ fields, method = `PATCH`, recordId, tableIdOrName, }) {
        if (!fields || typeof fields !== `object` || Array.isArray(fields)) {
            throw new TypeError(`Airtable updateRecord expected 'fields' to be a plain object`);
        }
        if (typeof method !== `string` ||
            ![`PATCH`, `PUT`].includes(method.toUpperCase())) {
            throw new TypeError(`Airtable updateRecord expected 'method' to be 'PATCH' or 'PUT'`);
        }
        if (typeof recordId !== `string` ||
            recordId.length < 10 ||
            !recordId.startsWith(`rec`)) {
            throw new TypeError(`Airtable updateRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`);
        }
        if (!tableIdOrName || typeof tableIdOrName !== `string`) {
            throw new TypeError(`Airtable updateRecord expected 'tableIdOrName' to be a non-empty string`);
        }
        const updateRecordUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}/${recordId}`;
        const body = JSON.stringify({ fields });
        await this.throttleIfNeeded();
        this.setLastRequestAt();
        const res = await fetch(updateRecordUrl, {
            body,
            headers: this.headers,
            method: method.toUpperCase(),
        });
        const data = await res.json();
        return { data, ok: res.ok, status: res.status, statusText: res.statusText };
    }
}
/**
 * Sleep for the specified number of milliseconds.
 * We use this to throttle our API requests.
 */
function sleep(millis) {
    return new Promise((resolve) => {
        setTimeout(resolve, millis);
    });
}
