/**
 * @see https://github.com/ensembleblock/airtable
 */
export class AirtableClient {
    baseId = null;
    baseUrl = `https://api.airtable.com/v0`;
    headers = {};
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
     * Create a record.
     * @see https://airtable.com/developers/web/api/create-records
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
        const res = await fetch(updateRecordUrl, {
            body,
            headers: this.headers,
            method: method.toUpperCase(),
        });
        const data = await res.json();
        return { data, ok: res.ok, status: res.status, statusText: res.statusText };
    }
}
