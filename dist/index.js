/* eslint no-underscore-dangle: ["error", { "allow": ["_airtableId"] }] */
export const UpsertResults = {
    RECORD_CREATED: `RECORD_CREATED`,
    RECORD_UNCHANGED: `RECORD_UNCHANGED`,
    RECORD_UPDATED: `RECORD_UPDATED`,
};
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
        if (!this.lastRequestAt) {
            // This is the first request.  No throttling is needed.
            return;
        }
        const millisSinceLastReq = Date.now() - this.lastRequestAt;
        if (millisSinceLastReq > this.minMillisBetweenRequests) {
            // Enough time has elapsed since the last request.  No throttling is needed.
            return;
        }
        const throttleMillis = this.minMillisBetweenRequests - millisSinceLastReq;
        await sleep(throttleMillis);
    }
    setLastRequestAt() {
        this.lastRequestAt = Date.now();
    }
    /**
     * Create a record.
     * @see https://airtable.com/developers/web/api/create-records
     *
     * @param {Object} param0 - Configuration for the record creation.
     * @param {Object} param0.fields - Fields to include in the new record (key-value pairs).
     * @param {string} param0.tableIdOrName - Table ID or name where the record will be created.
     *
     * @returns {Promise<Object>} A promise that resolves with the result of the API call.
     */
    async createRecord({ fields, tableIdOrName, }) {
        if (!isPlainObj(fields)) {
            throw new TypeError(`Airtable createRecord expected 'fields' to be a plain object`);
        }
        if (!isNonEmptyStr(tableIdOrName)) {
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
     * Returns the first record that matches the given filter object.
     * (A plain object with exactly one key-value pair.)
     * Returns `null` if no record is found.
     */
    async findFirst({ fields, includeAirtableId, tableIdOrName, where, }) {
        if (fields) {
            const fieldsArrIsValid = Array.isArray(fields) &&
                fields.length > 0 &&
                fields.every((field) => !!field && typeof field === `string`);
            if (!fieldsArrIsValid) {
                throw new TypeError(`Airtable findFirst expected 'fields' to be a lengthy array of strings`);
            }
        }
        // Else, `fields` wasn't provided.  We'll retrieve all fields.
        if (!isPlainObj(where)) {
            throw new TypeError(`Airtable findFirst expected 'where' to be a plain object`);
        }
        if (Object.keys(where).length !== 1) {
            throw new TypeError(`Airtable findFirst expected 'where' to have exactly one key-value pair`);
        }
        if (!isNonEmptyStr(tableIdOrName)) {
            throw new TypeError(`Airtable findFirst expected 'tableIdOrName' to be a non-empty string`);
        }
        const [fieldName, value] = Object.entries(where)[0];
        const opts = {
            filterByFormula: `{${fieldName}}='${value}'`,
            maxRecords: 1,
            tableIdOrName,
        };
        if (fields) {
            opts.fields = fields;
        }
        if (includeAirtableId) {
            opts.includeAirtableId = true;
        }
        const records = await this.findMany(opts);
        if (!Array.isArray(records) || records.length !== 1) {
            return null;
        }
        return isPlainObj(records[0]) ? records[0] : null;
    }
    /**
     * Retrieve many (or all) records from a table.
     * This method makes paginated requests as necessary.
     * Returns an array of records.
     * @see https://airtable.com/developers/web/api/list-records
     */
    async findMany({ fields, filterByFormula, includeAirtableId, maxRecords, modifiedSinceHours, tableIdOrName, }) {
        if (fields) {
            const fieldsArrIsValid = Array.isArray(fields) &&
                fields.length > 0 &&
                fields.every((field) => !!field && typeof field === `string`);
            if (!fieldsArrIsValid) {
                throw new TypeError(`Airtable findMany expected 'fields' to be a lengthy array of strings`);
            }
        }
        // Else, `fields` wasn't provided.  We'll retrieve all fields.
        if (filterByFormula && !isNonEmptyStr(filterByFormula)) {
            throw new TypeError(`Airtable findMany expected 'filterByFormula' to be a non-string when given`);
        }
        // Else, `filterByFormula` wasn't provided.
        if ((maxRecords && (!Number.isInteger(maxRecords) || maxRecords < 1)) ||
            maxRecords === 0) {
            throw new TypeError(`Airtable findMany expected 'maxRecords' to be a positive integer`);
        }
        // Else, `maxRecords` wasn't provided.  We'll retrieve all records.
        if ((modifiedSinceHours &&
            (!Number.isInteger(modifiedSinceHours) || modifiedSinceHours < 1)) ||
            modifiedSinceHours === 0) {
            throw new TypeError(`Airtable findMany expected 'modifiedSinceHours' to be a positive integer`);
        }
        // Else, `modifiedSinceHours` wasn't provided or is `null`.  We'll retrieve all records.
        if (filterByFormula && modifiedSinceHours) {
            throw new TypeError(`Airtable findMany cannot use both 'filterByFormula' and 'modifiedSinceHours'`);
        }
        if (!isNonEmptyStr(tableIdOrName)) {
            throw new TypeError(`Airtable findMany expected 'tableIdOrName' to be a non-empty string`);
        }
        const basePayload = {};
        if (fields) {
            basePayload.fields = fields;
        }
        if (filterByFormula) {
            basePayload.filterByFormula = filterByFormula;
        }
        else if (modifiedSinceHours) {
            basePayload.filterByFormula = `{lastModifiedTime}>=DATETIME_FORMAT(DATEADD(NOW(),-${modifiedSinceHours},'hours'))`;
        }
        if (maxRecords) {
            basePayload.maxRecords = maxRecords;
        }
        const listRecordsUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}/listRecords`;
        const aggregateResponses = [];
        let numRequestsMade = 0;
        let offset = null;
        while (numRequestsMade === 0 || offset) {
            if (numRequestsMade > 500) {
                /**
                 * This safety net prevents an infinite loop of requests that might
                 * happen if `offset` is (somehow) never set back to null in the
                 * body of the `while` loop.
                 *
                 * 50,000 records per base (divided amongst all tables in that base)
                 * is the maximum number of records on all non-enterprise plans.
                 */
                throw new Error(`Airtable findMany should not make more than 500 paginated requests`);
            }
            const payload = { ...basePayload };
            if (offset && typeof offset === `string`) {
                payload.offset = offset;
            }
            const body = JSON.stringify(payload);
            await this.throttleIfNeeded();
            this.setLastRequestAt();
            const res = await fetch(listRecordsUrl, {
                body,
                headers: this.headers,
                // We use a POST instead of a GET request with query parameters.
                // It's more ergonomic than encoding query parameters,
                // especially when using `filterByFormula`.
                method: `POST`,
            });
            numRequestsMade += 1;
            if (!res.ok) {
                throw new Error(`Airtable findMany failed with HTTP status ${res.status} ${res.statusText}`);
            }
            const data = await res.json();
            if (Array.isArray(data.records) && data.records.length > 0) {
                aggregateResponses.push(data.records);
            }
            if (data.offset && typeof data.offset === `string`) {
                ({ offset } = data);
            }
            else {
                // No more records to fetch.
                offset = null;
            }
        }
        /**
         * Basic mapping function to extract fields from a record.
         * Drops the outer `id` & `createdTime` fields.
         */
        const basicMapFn = (record) => record.fields;
        /**
         * Complex mapping function to include the Airtable ID as `_airtableId`
         * along with the record's fields.
         */
        const complexMapFn = (record) => ({
            _airtableId: record.id,
            ...record.fields,
        });
        const records = aggregateResponses
            // Flatten the array of arrays into a single array of records.
            .flat()
            // Determine which mapping function to use based on `includeAirtableId`.
            .map(includeAirtableId ? complexMapFn : basicMapFn);
        return records;
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
        if (!isValidRecordId(recordId)) {
            throw new TypeError(`Airtable getRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`);
        }
        if (!isNonEmptyStr(tableIdOrName)) {
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
     * @param {Object} param0.fields - New values for the record fields (key-value pairs).
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
        if (!isPlainObj(fields)) {
            throw new TypeError(`Airtable updateRecord expected 'fields' to be a plain object`);
        }
        if (typeof method !== `string` ||
            ![`PATCH`, `PUT`].includes(method.toUpperCase())) {
            throw new TypeError(`Airtable updateRecord expected 'method' to be 'PATCH' or 'PUT'`);
        }
        if (!isValidRecordId(recordId)) {
            throw new TypeError(`Airtable updateRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`);
        }
        if (!isNonEmptyStr(tableIdOrName)) {
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
    /**
     * If a record is found that matches the `where` object, the record will be updated.
     * Otherwise, a new record will be created.
     */
    async upsertRecord({ $set, tableIdOrName, where, }) {
        if (!isPlainObj($set)) {
            throw new TypeError(`Airtable upsertRecord expected '$set' to be a plain object`);
        }
        if (!isPlainObj(where)) {
            throw new TypeError(`Airtable upsertRecord expected 'where' to be a plain object`);
        }
        if (Object.keys(where).length !== 1) {
            throw new TypeError(`Airtable upsertRecord expected 'where' to have exactly one key-value pair`);
        }
        const fieldsToRetrieve = Object.keys($set);
        const whereKey = Object.keys(where)[0];
        if (fieldsToRetrieve.includes(whereKey)) {
            throw new TypeError(`Airtable upsertRecord '$set' should not include the 'where' key '${whereKey}'`);
        }
        const findFirstOpts = {
            fields: fieldsToRetrieve,
            includeAirtableId: true,
            tableIdOrName,
            where,
        };
        const foundRecord = await this.findFirst(findFirstOpts);
        if (!isPlainObj(foundRecord)) {
            const createRecordOpts = {
                fields: {
                    ...$set,
                    ...where,
                },
                tableIdOrName,
            };
            const createRecordRes = await this.createRecord(createRecordOpts);
            const createdRecord = createRecordRes.data;
            const _airtableId = createdRecord.id;
            if (!isValidRecordId(_airtableId)) {
                throw new TypeError(`Airtable upsertRecord failed to retrieve a valid '_airtableId' from the created record`);
            }
            return {
                _airtableId,
                upsertResult: UpsertResults.RECORD_CREATED,
            };
        }
        const { _airtableId, ...existingFields } = foundRecord;
        if (!isValidRecordId(_airtableId)) {
            throw new Error(`Airtable upsertRecord failed to retrieve a valid '_airtableId' from the found record`);
        }
        const fieldsToUpdate = {};
        for (const [key, valueToSet] of Object.entries($set)) {
            if (existingFields[key] === valueToSet) {
                // The field is already up-to-date.
                // eslint-disable-next-line no-continue
                continue;
            }
            if (typeof existingFields[key] === `undefined`) {
                // The Airtable API does not return any "empty" fields
                // (e.g. "", [], or false) in the record.
                const updateToMakeIsEmpty = valueToSet === `` ||
                    valueToSet === false ||
                    valueToSet === null ||
                    valueToSet === undefined ||
                    (Array.isArray(valueToSet) && valueToSet.length === 0);
                if (updateToMakeIsEmpty) {
                    // The field is empty on in the existing Airtable record
                    // and the new value is also empty.
                    // eslint-disable-next-line no-continue
                    continue;
                }
            }
            fieldsToUpdate[key] = valueToSet;
        }
        if (Object.keys(fieldsToUpdate).length === 0) {
            // No fields need to be updated.
            return {
                _airtableId,
                upsertResult: UpsertResults.RECORD_UNCHANGED,
            };
        }
        const updateRecordOpts = {
            fields: $set,
            recordId: _airtableId,
            tableIdOrName,
        };
        const updateRecordRes = await this.updateRecord(updateRecordOpts);
        const updatedRecord = updateRecordRes.data;
        if (!isValidRecordId(updatedRecord.id)) {
            throw new Error(`Airtable upsertRecord failed to retrieve a valid '_airtableId' from the updated record`);
        }
        return {
            _airtableId: updatedRecord.id,
            upsertResult: UpsertResults.RECORD_UPDATED,
        };
    }
}
function isNonEmptyStr(str) {
    return typeof str === `string` && str.length > 0;
}
function isPlainObj(obj) {
    return typeof obj === `object` && obj !== null && !Array.isArray(obj);
}
function isValidRecordId(recordId) {
    return (typeof recordId === `string` &&
        recordId.length > 10 &&
        recordId.startsWith(`rec`));
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
