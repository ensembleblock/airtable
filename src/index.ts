import { isNonEmptyStr, isPlainObj, isValidRecordId } from './guards.js';
import {
  buildEqualsFormula,
  fieldNeedsUpdate,
  validateListOptions,
  withAirtableId,
} from './records.js';
import type { ListedRecord, RawResponse } from './responses.js';
import {
  envelopeToRaw,
  isAirtableTable,
  malformedResponseError,
  parseListRecordsPage,
  parseResponseText,
  toAirtableError,
  toRecordResponse,
} from './responses.js';
import { RequestThrottle } from './throttle.js';
import type {
  AirtableClientOpts,
  AirtableResponse,
  AirtableTable,
  CreateRecordOpts,
  DeletedRecord,
  DeleteRecordOpts,
  FieldsObj,
  FindFirstOpts,
  FindManyOpts,
  GetRecordOpts,
  UpdateRecordOpts,
  UpsertRecordOpts,
  UpsertResult,
} from './types.js';
import { UpsertResults } from './types.js';

export { AirtableError } from './airtable-error.js';
export * from './types.js';

type HttpMethod = `DELETE` | `GET` | `PATCH` | `POST` | `PUT`;

/**
 * @see https://github.com/ensembleblock/airtable
 */
export class AirtableClient {
  private baseId: string;

  private baseUrl = `https://api.airtable.com/v0`;

  /** A caller-provided `fetch`, or `null` to use the global `fetch`. */
  private fetchImpl: typeof fetch | null = null;

  private headers: Record<string, string> = {};

  /**
   * The Airtable API allows 5 requests per second per base, so request
   * *starts* are spaced at least 200 ms apart (see `RequestThrottle`).
   *
   * Throttling is per client instance: separate clients, processes, or other
   * users of the same base or token are not coordinated.
   * @see https://airtable.com/developers/web/api/rate-limits
   */
  private throttle = new RequestThrottle(200);

  /**
   * Constructs an instance of the AirtableClient.
   *
   * @param {Object} param0 - Configuration object.
   * @param {string} param0.apiKey - Airtable API key for authentication.
   * @param {string} param0.baseId - The unique identifier for the base (begins with 'app').
   * @param {string} [param0.baseUrl] - An optional API base URL (without a trailing slash).
   * Defaults to the standard Airtable API URL.
   * @param {Function} [param0.fetch] - An optional `fetch` implementation.
   * Defaults to the global `fetch`.
   */
  constructor({
    apiKey,
    baseId,
    baseUrl,
    fetch: fetchImpl,
  }: AirtableClientOpts) {
    if (typeof apiKey !== `string` || apiKey.length < 10) {
      throw new TypeError(
        `AirtableClient expected 'apiKey' to be string of at least 10 characters`,
      );
    }

    if (
      typeof baseId !== `string` ||
      baseId.length < 10 ||
      !baseId.startsWith(`app`)
    ) {
      throw new TypeError(
        `AirtableClient expected 'baseId' to be string of at least 10 characters starting with 'app'`,
      );
    }

    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': `application/json`,
    };

    this.baseId = baseId;

    if (baseUrl) {
      if (typeof baseUrl !== `string` || baseUrl.endsWith(`/`)) {
        throw new TypeError(
          `AirtableClient expected 'baseUrl' to be a string without a trailing slash`,
        );
      }

      this.baseUrl = baseUrl;
    }

    if (typeof fetchImpl !== `undefined`) {
      if (typeof fetchImpl !== `function`) {
        throw new TypeError(
          `AirtableClient expected 'fetch' to be a function when given`,
        );
      }

      this.fetchImpl = fetchImpl;
    }
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
  public async createRecord({
    fields,
    tableIdOrName,
  }: CreateRecordOpts): Promise<AirtableResponse> {
    if (!isPlainObj(fields)) {
      throw new TypeError(
        `Airtable createRecord expected 'fields' to be a plain object`,
      );
    }

    if (!isNonEmptyStr(tableIdOrName)) {
      throw new TypeError(
        `Airtable createRecord expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const res = await this.request({
      body: { fields },
      method: `POST`,
      url: this.tableUrl(tableIdOrName),
    });

    return toRecordResponse(`createRecord`, res);
  }

  /**
   * Delete a single record.
   *
   * Requires a token with the `data.records:write` scope.
   * @see https://airtable.com/developers/web/api/delete-record
   *
   * @returns Airtable's confirmation: `{ deleted: true, id }`.
   * @throws {AirtableError} For any non-2xx response, e.g. `404` when the
   * record doesn't exist (or was already deleted), `403` when the token lacks
   * access, or `401` when it's invalid. Also thrown when a 2xx response
   * isn't a confirmation for the requested record.
   */
  public async deleteRecord({
    recordId,
    tableIdOrName,
  }: DeleteRecordOpts): Promise<DeletedRecord> {
    if (!isValidRecordId(recordId)) {
      throw new TypeError(
        `Airtable deleteRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`,
      );
    }

    if (!isNonEmptyStr(tableIdOrName)) {
      throw new TypeError(
        `Airtable deleteRecord expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const res = await this.request({
      method: `DELETE`,
      url: this.tableUrl(tableIdOrName, recordId),
    });

    if (!res.ok) {
      throw toAirtableError(`deleteRecord`, res);
    }

    const { body } = res;

    if (
      !isPlainObj(body) ||
      body[`deleted`] !== true ||
      body[`id`] !== recordId
    ) {
      throw malformedResponseError(
        `deleteRecord`,
        res,
        `{ deleted: true, id: '${recordId}' }`,
      );
    }

    return { deleted: true, id: recordId };
  }

  /**
   * Returns the first record that matches the given filter object.
   * (A plain object with exactly one key-value pair.)
   * Returns `null` if no record is found.
   *
   * When `includeAirtableId` is true, `_airtableId` is always the record's
   * real ID, even if the table has a field named `_airtableId`.
   */
  public async findFirst({
    fields,
    includeAirtableId,
    tableIdOrName,
    where,
  }: FindFirstOpts): Promise<
    FieldsObj | (FieldsObj & { _airtableId: `rec${string}` }) | null
  > {
    if (!isPlainObj(where)) {
      throw new TypeError(
        `Airtable findFirst expected 'where' to be a plain object`,
      );
    }

    const [entry, secondEntry] = Object.entries(where);
    if (!entry || secondEntry) {
      throw new TypeError(
        `Airtable findFirst expected 'where' to have exactly one key-value pair`,
      );
    }

    const [whereKey, whereValue] = entry;

    if (!whereKey || !whereValue) {
      throw new TypeError(
        `Airtable findFirst expected 'where' to have a truthy key and value`,
      );
    }

    if (!isNonEmptyStr(tableIdOrName)) {
      throw new TypeError(
        `Airtable findFirst expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const record = await this.findFirstRecord(`findFirst`, {
      fields,
      tableIdOrName,
      whereKey,
      whereValue,
    });

    if (!record) {
      return null;
    }

    return includeAirtableId ? withAirtableId(record) : record.fields;
  }

  /**
   * Find the first record whose `whereKey` field equals `whereValue`.
   * Returns the record as Airtable sent it (`id` & `fields`), or `null`.
   */
  private async findFirstRecord(
    operation: string,
    {
      fields,
      tableIdOrName,
      whereKey,
      whereValue,
    }: {
      fields: string[] | undefined;
      tableIdOrName: string;
      whereKey: string;
      whereValue: boolean | number | string;
    },
  ): Promise<ListedRecord | null> {
    const opts: FindManyOpts = {
      filterByFormula: buildEqualsFormula(operation, whereKey, whereValue),
      maxRecords: 1,
      tableIdOrName,
    };

    if (fields) {
      opts.fields = fields;
    }

    const records = await this.listRecords(operation, opts);

    return records[0] ?? null;
  }

  /**
   * Retrieve many (or all) records from a table.
   * This method makes paginated requests as necessary.
   * Returns an array of records.
   *
   * When `includeAirtableId` is true, `_airtableId` is always the record's
   * real ID, even if the table has a field named `_airtableId`.
   * @see https://airtable.com/developers/web/api/list-records
   */
  public async findMany(
    opts: FindManyOpts,
  ): Promise<(FieldsObj | (FieldsObj & { _airtableId: `rec${string}` }))[]> {
    const records = await this.listRecords(`findMany`, opts);

    return opts.includeAirtableId
      ? records.map(withAirtableId)
      : records.map((record) => record.fields);
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
  public async getRecord({
    recordId,
    tableIdOrName,
  }: GetRecordOpts): Promise<AirtableResponse> {
    if (!isValidRecordId(recordId)) {
      throw new TypeError(
        `Airtable getRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`,
      );
    }

    if (!isNonEmptyStr(tableIdOrName)) {
      throw new TypeError(
        `Airtable getRecord expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const res = await this.request({
      method: `GET`,
      url: this.tableUrl(tableIdOrName, recordId),
    });

    return toRecordResponse(`getRecord`, res);
  }

  /**
   * Validate `findMany` options & fetch every matching record,
   * following `offset` across pages, up to `maxRecords` records in total.
   * Every page is validated before it's used.
   */
  private async listRecords(
    operation: string,
    opts: FindManyOpts,
  ): Promise<ListedRecord[]> {
    validateListOptions(operation, opts);
    const {
      fields,
      filterByFormula,
      maxRecords,
      modifiedSinceHours,
      tableIdOrName,
    } = opts;

    type Payload = {
      fields?: string[];
      filterByFormula?: string;
      maxRecords?: number;

      /**
       * The Airtable API may include an `offset` field in the response.
       * To fetch the next page of records, we include the offset
       * from the previous request in the next request.
       */
      offset?: string;
    };

    const basePayload: Payload = {};

    if (fields) {
      basePayload.fields = fields;
    }

    if (filterByFormula) {
      basePayload.filterByFormula = filterByFormula;
    } else if (modifiedSinceHours) {
      basePayload.filterByFormula = `{lastModifiedTime}>=DATETIME_FORMAT(DATEADD(NOW(),-${String(modifiedSinceHours)},'hours'))`;
    }

    if (maxRecords) {
      basePayload.maxRecords = maxRecords;
    }

    const listRecordsUrl = this.tableUrl(tableIdOrName, `listRecords`);
    const records: ListedRecord[] = [];

    const seenOffsets = new Set<string>();
    let offset: string | null = null;

    do {
      const payload: Payload = { ...basePayload };

      if (offset) {
        seenOffsets.add(offset);
        payload.offset = offset;
      }

      const res = await this.request({
        body: payload,

        // We use a POST instead of a GET request with query parameters.
        // It's more ergonomic than encoding query parameters,
        // especially when using `filterByFormula`.
        method: `POST`,
        url: listRecordsUrl,
      });

      if (!res.ok) {
        throw toAirtableError(operation, res);
      }

      // Never interpret a malformed page as "no records":
      // `upsertRecord` would treat that as "not found" & create a duplicate.
      const page = parseListRecordsPage(res.body);

      if (!page) {
        throw malformedResponseError(
          operation,
          res,
          `{ records: [...], offset?: string }`,
        );
      }

      records.push(...page.records);

      // `maxRecords` bounds the total across all pages. Airtable applies it
      // server-side; we also stop paginating & trim defensively.
      if (maxRecords && records.length >= maxRecords) {
        return records.slice(0, maxRecords);
      }

      // `null` when there are no more records to fetch.
      ({ offset } = page);

      if (offset && seenOffsets.has(offset)) {
        throw malformedResponseError(operation, res, `a new pagination offset`);
      }
    } while (offset);

    return records;
  }

  /**
   * List the tables in this client's base, including each table's fields
   * & views. (Airtable calls this endpoint "Get base schema".)
   *
   * Requires a token with the `schema.bases:read` scope that also has
   * access to the base. Uses `{baseUrl}/meta/bases/{baseId}/tables`, so a
   * custom `baseUrl` (e.g. a proxy) must also forward `/meta/` paths.
   * @see https://airtable.com/developers/web/api/get-base-schema
   *
   * @returns Airtable's `tables` array. Objects are returned as received,
   * so properties not described by the types are preserved.
   * @throws {AirtableError} For any non-2xx response, e.g. `403` when the
   * token lacks the `schema.bases:read` scope or access to the base, or
   * `401` when it's invalid. Also thrown when a 2xx response isn't a valid
   * table list.
   */
  public async listTables(): Promise<AirtableTable[]> {
    const res = await this.request({
      method: `GET`,
      url: `${this.baseUrl}/meta/bases/${encodeURIComponent(this.baseId)}/tables`,
    });

    if (!res.ok) {
      throw toAirtableError(`listTables`, res);
    }

    const tables = isPlainObj(res.body) ? res.body[`tables`] : null;

    if (!Array.isArray(tables) || !tables.every(isAirtableTable)) {
      throw malformedResponseError(
        `listTables`,
        res,
        `{ tables: [{ id, name, primaryFieldId, fields, views }] }`,
      );
    }

    return tables;
  }

  /**
   * Make one throttled request & parse its body.
   * Resolves for any HTTP status; callers decide how to treat non-2xx.
   * Network & body-read failures reject with the underlying error.
   */
  private async request({
    body,
    method,
    url,
  }: {
    body?: unknown;
    method: HttpMethod;
    url: string;
  }): Promise<RawResponse> {
    const init: RequestInit = {
      cache: `no-store`,
      headers: this.headers,
      method,
    };

    if (typeof body !== `undefined`) {
      init.body = JSON.stringify(body);
    }

    // Resolve the global `fetch` at request time (not construction time).
    const res: Response = await this.throttle.run(() =>
      (this.fetchImpl ?? globalThis.fetch)(url, init),
    );

    const text: string = await res.text();

    return {
      body: parseResponseText(text),
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
    };
  }

  /**
   * Build `{baseUrl}/{baseId}/{tableIdOrName}[/{segment}]`.
   *
   * `tableIdOrName` & `segment` are raw values (e.g. a table name with spaces
   * or slashes) and are percent-encoded exactly once here. The `baseUrl`
   * prefix, including any proxy path, is used as given.
   */
  private tableUrl(tableIdOrName: string, segment?: string): string {
    if (tableIdOrName === `.` || tableIdOrName === `..`) {
      throw new TypeError(
        `Use the table ID for a table named '${tableIdOrName}' because URLs normalize dot segments`,
      );
    }

    const url = `${this.baseUrl}/${encodeURIComponent(this.baseId)}/${encodeURIComponent(tableIdOrName)}`;

    return typeof segment === `undefined`
      ? url
      : `${url}/${encodeURIComponent(segment)}`;
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
  public async updateRecord({
    fields,
    method = `PATCH`,
    recordId,
    tableIdOrName,
  }: UpdateRecordOpts): Promise<AirtableResponse> {
    if (!isPlainObj(fields)) {
      throw new TypeError(
        `Airtable updateRecord expected 'fields' to be a plain object`,
      );
    }

    if (
      typeof method !== `string` ||
      ![`PATCH`, `PUT`].includes(method.toUpperCase())
    ) {
      throw new TypeError(
        `Airtable updateRecord expected 'method' to be 'PATCH' or 'PUT'`,
      );
    }

    if (!isValidRecordId(recordId)) {
      throw new TypeError(
        `Airtable updateRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`,
      );
    }

    if (!isNonEmptyStr(tableIdOrName)) {
      throw new TypeError(
        `Airtable updateRecord expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const res: RawResponse = await this.request({
      body: { fields },
      method: method.toUpperCase() as `PATCH` | `PUT`,
      url: this.tableUrl(tableIdOrName, recordId),
    });

    return toRecordResponse(`updateRecord`, res);
  }

  /**
   * If a record is found that matches the `where` object, the record will be updated.
   * Otherwise, a new record will be created.
   *
   * Only the fields in `$set` whose values differ from the existing record
   * are sent in the update (PATCH).
   *
   * This is a read-then-write sequence, not an atomic operation: concurrent
   * upserts for the same `where` value (from this or any other client) can
   * both see "not found" & both create a record.
   */
  public async upsertRecord({
    $set,
    tableIdOrName,
    where,
  }: UpsertRecordOpts): Promise<{
    _airtableId: `rec${string}`;
    upsertResult: UpsertResult;
  }> {
    if (!isPlainObj($set)) {
      throw new TypeError(
        `Airtable upsertRecord expected '$set' to be a plain object`,
      );
    }

    if (!isPlainObj(where)) {
      throw new TypeError(
        `Airtable upsertRecord expected 'where' to be a plain object`,
      );
    }

    const [entry, secondEntry] = Object.entries(where);
    if (!entry || secondEntry) {
      throw new TypeError(
        `Airtable upsertRecord expected 'where' to have exactly one key-value pair`,
      );
    }

    const [whereKey, whereValue] = entry;

    if (!whereKey || !whereValue) {
      throw new TypeError(
        `Airtable upsertRecord expected 'where' to have a truthy key and value`,
      );
    }

    const fieldsToRetrieve: string[] = Object.keys($set);

    if (fieldsToRetrieve.includes(whereKey)) {
      throw new TypeError(
        `Airtable upsertRecord '$set' should not include the 'where' key '${whereKey}'`,
      );
    }

    // Read the record as Airtable sent it, so the update below always
    // targets its real ID (never a field that happens to be named
    // `_airtableId`). Retrieve only the fields we might update; when `$set`
    // is empty, retrieve just the `where` field.
    const foundRecord: ListedRecord | null = await this.findFirstRecord(
      `upsertRecord`,
      {
        fields: fieldsToRetrieve.length > 0 ? fieldsToRetrieve : [whereKey],
        tableIdOrName,
        whereKey,
        whereValue,
      },
    );

    if (!foundRecord) {
      const createRecordOpts: CreateRecordOpts = {
        fields: {
          ...$set,
          ...where,
        },
        tableIdOrName,
      };

      const createRecordRes: AirtableResponse =
        await this.createRecord(createRecordOpts);

      // Surface Airtable's own error (e.g. a 422 for an invalid field value)
      // rather than failing later while looking for the new record's ID.
      if (!createRecordRes.ok) {
        throw toAirtableError(
          `upsertRecord (create)`,
          envelopeToRaw(createRecordRes),
        );
      }

      return {
        _airtableId: createRecordRes.data.id,
        upsertResult: UpsertResults.RECORD_CREATED,
      };
    }

    const { fields: existingFields, id: _airtableId } = foundRecord;

    const fieldsToUpdate = Object.fromEntries(
      Object.entries($set).filter(([key, value]) =>
        fieldNeedsUpdate(existingFields, key, value),
      ),
    );

    if (Object.keys(fieldsToUpdate).length === 0) {
      // No fields need to be updated.
      return {
        _airtableId,
        upsertResult: UpsertResults.RECORD_UNCHANGED,
      };
    }

    // PATCH only the fields that actually changed.
    const updateRecordOpts: UpdateRecordOpts = {
      fields: fieldsToUpdate,
      recordId: _airtableId,
      tableIdOrName,
    };

    const updateRecordRes: AirtableResponse =
      await this.updateRecord(updateRecordOpts);

    // Previously, a failed update surfaced only as a cryptic "failed to
    // retrieve a valid '_airtableId'" error. Report Airtable's error instead.
    if (!updateRecordRes.ok) {
      throw toAirtableError(
        `upsertRecord (update)`,
        envelopeToRaw(updateRecordRes),
      );
    }

    return {
      _airtableId,
      upsertResult: UpsertResults.RECORD_UPDATED,
    };
  }
}
