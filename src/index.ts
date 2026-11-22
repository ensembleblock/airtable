/* eslint no-underscore-dangle: ["error", { "allow": ["_airtableId"] }] */

import { AirtableError } from './airtable-error.js';
import type {
  AirtableClientOpts,
  AirtableField,
  AirtableRecord,
  AirtableResponse,
  AirtableTable,
  AirtableView,
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

/** A fetch `Response`, reduced to its status & its (tolerantly) parsed body. */
type RawResponse = {
  body: unknown;
  ok: boolean;
  status: number;
  statusText: string;
};

/** The parts of a record that `listRecords` responses are required to include. */
type ListedRecord = Pick<AirtableRecord, `fields` | `id`>;

/**
 * @see https://github.com/ensembleblock/airtable
 */
export class AirtableClient {
  private baseId: string;

  private baseUrl = `https://api.airtable.com/v0`;

  /** A caller-provided `fetch`, or `null` to use the global `fetch`. */
  private fetchImpl: typeof fetch | null = null;

  private headers: Record<string, string> = {};

  /** When this client's most recent request actually started (monotonic milliseconds). */
  private lastRequestStartedAt = Number.NEGATIVE_INFINITY;

  /** The Airtable API is limited to 5 requests per second per base. */
  private minMillisBetweenRequests = 200;

  /**
   * Settles once the most recently queued request has started.
   * Each request waits on its predecessor's *start*, never its response,
   * so slow responses don't hold up later requests.
   */
  private requestStartGate: Promise<void> = Promise.resolve();

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

    if (Object.keys(where).length !== 1) {
      throw new TypeError(
        `Airtable findFirst expected 'where' to have exactly one key-value pair`,
      );
    }

    const [whereKey, whereValue] = Object.entries(where)[0] ?? [];

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

    const res = await this.startRequest(url, init);
    const text = await res.text();

    return {
      body: parseResponseText(text),
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
    };
  }

  /**
   * Start a request when this client has a free slot.
   *
   * The Airtable API allows 5 requests per second per base, so request
   * *starts* are spaced at least `minMillisBetweenRequests` apart. Callers are
   * queued in call order. The gap is measured from the previous request's
   * actual start, after any sleep, so timers that fire late together (e.g.
   * after the event loop was blocked) still can't start requests in a burst.
   *
   * Throttling is per client instance: separate clients, processes, or other
   * users of the same base or token are not coordinated.
   * @see https://airtable.com/developers/web/api/rate-limits
   */
  private async startRequest(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const started = this.requestStartGate.then(async () => {
      const nextStart =
        this.lastRequestStartedAt + this.minMillisBetweenRequests;
      while (performance.now() < nextStart) {
        await sleep(Math.ceil(nextStart - performance.now()));
      }

      const fetchFn = this.fetchImpl ?? globalThis.fetch;
      this.lastRequestStartedAt = performance.now();
      // Wrap the promise so the next turn waits only for fetch to be invoked.
      return { response: fetchFn(url, init) };
    });

    // Even a synchronously throwing custom fetch must release the next caller.
    this.requestStartGate = started.then(
      () => {
        /* The request started. */
      },
      () => {
        /* A synchronous fetch error belongs to its caller. */
      },
    );

    return (await started).response;
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

    const res = await this.request({
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

    if (Object.keys(where).length !== 1) {
      throw new TypeError(
        `Airtable upsertRecord expected 'where' to have exactly one key-value pair`,
      );
    }

    const [whereKey, whereValue] = Object.entries(where)[0] ?? [];

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
    const foundRecord = await this.findFirstRecord(`upsertRecord`, {
      fields: fieldsToRetrieve.length > 0 ? fieldsToRetrieve : [whereKey],
      tableIdOrName,
      whereKey,
      whereValue,
    });

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

/** Compare the supported field values as they are sent over JSON. */
function fieldNeedsUpdate(
  fields: FieldsObj,
  key: string,
  value: FieldsObj[string],
): boolean {
  const existing = fields[key];
  if (typeof value === `undefined` || existing === value) {
    return false;
  }

  const next = value instanceof Date ? value.toJSON() : value;

  if (!Object.hasOwn(fields, key)) {
    // Airtable omits empty cells. Zero is a meaningful numeric value.
    return !(
      next === null ||
      next === false ||
      next === `` ||
      (Array.isArray(next) && next.length === 0)
    );
  }

  if (Array.isArray(next) && Array.isArray(existing)) {
    return (
      next.length !== existing.length ||
      next.some((entry, i) => entry !== existing[i])
    );
  }

  if (isPlainObj(next) && isPlainObj(existing)) {
    return (
      Object.keys(next).length !== Object.keys(existing).length ||
      Object.entries(next).some(
        ([property, entry]) =>
          !Object.hasOwn(existing, property) || existing[property] !== entry,
      )
    );
  }

  return existing !== next;
}

function validateListOptions(
  operation: string,
  {
    fields,
    filterByFormula,
    maxRecords,
    modifiedSinceHours,
    tableIdOrName,
  }: FindManyOpts,
): void {
  if (
    fields &&
    !(Array.isArray(fields) && fields.length > 0 && fields.every(isNonEmptyStr))
  ) {
    throw new TypeError(
      `Airtable ${operation} expected 'fields' to be a lengthy array of strings`,
    );
  }

  if (filterByFormula && !isNonEmptyStr(filterByFormula)) {
    throw new TypeError(
      `Airtable ${operation} expected 'filterByFormula' to be a non-empty string when given`,
    );
  }

  for (const [name, value] of Object.entries({
    maxRecords,
    modifiedSinceHours,
  })) {
    if (
      typeof value !== `undefined` &&
      value !== null &&
      (!Number.isInteger(value) || value < 1)
    ) {
      throw new TypeError(
        `Airtable ${operation} expected '${name}' to be a positive integer`,
      );
    }
  }

  if (filterByFormula && modifiedSinceHours) {
    throw new TypeError(
      `Airtable ${operation} cannot use both 'filterByFormula' and 'modifiedSinceHours'`,
    );
  }

  if (!isNonEmptyStr(tableIdOrName)) {
    throw new TypeError(
      `Airtable ${operation} expected 'tableIdOrName' to be a non-empty string`,
    );
  }
}

function isNonEmptyStr(str: unknown): str is string {
  return typeof str === `string` && str.length > 0;
}

function isPlainObj(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === `object` && obj !== null && !Array.isArray(obj);
}

/**
 * Build an Airtable formula matching records whose `field` equals `value`:
 * `{field}="value"`.
 *
 * - The value is written as a double-quoted string literal (the form
 *   Airtable documents), with `"` escaped as `\"` & `\` escaped as `\\`.
 *   Numbers & booleans are compared as strings, as before.
 * - The field is referenced in braces. Airtable documents no escape for
 *   `{` or `}` inside a field name, so such names are rejected rather than
 *   producing a formula that could match the wrong records.
 * @see https://support.airtable.com/docs/formula-field-reference
 */
function buildEqualsFormula(
  operation: string,
  field: string,
  value: boolean | number | string,
): string {
  if (/[{}]/u.test(field)) {
    throw new TypeError(
      `Airtable ${operation} cannot reference the field '${field}' in a formula ('{' & '}' are not supported in field names).`,
    );
  }

  const escapedValue = String(value).replace(/["\\]/gu, (char) => `\\${char}`);

  return `{${field}}="${escapedValue}"`;
}

/** A complete record, as returned by the get/create/update endpoints. */
function isAirtableRecord(value: unknown): value is AirtableRecord {
  return isListedRecord(value) && typeof value[`createdTime`] === `string`;
}

/** A field's required schema properties (`options` is left open-ended). */
function isAirtableField(value: unknown): value is AirtableField {
  return (
    isPlainObj(value) &&
    (typeof value[`description`] === `undefined` ||
      typeof value[`description`] === `string`) &&
    isPrefixedId(value[`id`], `fld`) &&
    typeof value[`name`] === `string` &&
    typeof value[`type`] === `string` &&
    (typeof value[`options`] === `undefined` || isPlainObj(value[`options`]))
  );
}

/** A table's required schema properties, including its fields & views. */
function isAirtableTable(value: unknown): value is AirtableTable {
  if (!isPlainObj(value)) {
    return false;
  }

  const { fields, views } = value;

  return (
    (typeof value[`description`] === `undefined` ||
      typeof value[`description`] === `string`) &&
    isPrefixedId(value[`id`], `tbl`) &&
    typeof value[`name`] === `string` &&
    isPrefixedId(value[`primaryFieldId`], `fld`) &&
    Array.isArray(fields) &&
    fields.every(isAirtableField) &&
    Array.isArray(views) &&
    views.every(isAirtableView)
  );
}

/** A view's required schema properties. */
function isAirtableView(value: unknown): value is AirtableView {
  return (
    isPlainObj(value) &&
    isPrefixedId(value[`id`], `viw`) &&
    typeof value[`name`] === `string` &&
    typeof value[`type`] === `string`
  );
}

/** A string ID with the expected Airtable prefix (e.g. 'tbl'). */
function isPrefixedId(value: unknown, prefix: string): boolean {
  return (
    typeof value === `string` &&
    value.length > prefix.length &&
    value.startsWith(prefix)
  );
}

/** The record fields this client relies on: a valid `id` & a `fields` object. */
function isListedRecord(
  value: unknown,
): value is ListedRecord & Record<string, unknown> {
  return (
    isPlainObj(value) &&
    isValidRecordId(value[`id`]) &&
    isPlainObj(value[`fields`])
  );
}

/**
 * Read Airtable's error `type` & `message` from an error body.
 * Handles both `{ error: { type, message } }` & `{ error: "NOT_FOUND" }`.
 */
function extractAirtableError(body: unknown): {
  message: string | null;
  type: string | null;
} {
  const error = isPlainObj(body) ? body[`error`] : null;

  if (typeof error === `string`) {
    return { message: null, type: error };
  }

  if (isPlainObj(error)) {
    return {
      message: typeof error[`message`] === `string` ? error[`message`] : null,
      type: typeof error[`type`] === `string` ? error[`type`] : null,
    };
  }

  return { message: null, type: null };
}

/**
 * A record's fields plus its ID as `_airtableId`.
 * The real record ID takes precedence over a field named `_airtableId`.
 */
function withAirtableId(
  record: ListedRecord,
): FieldsObj & { _airtableId: `rec${string}` } {
  return { ...record.fields, _airtableId: record.id };
}

/** Convert an `AirtableResponse` envelope back to a `RawResponse`. */
function envelopeToRaw({
  data,
  ok,
  status,
  statusText,
}: AirtableResponse): RawResponse {
  return { body: data, ok, status, statusText };
}

/** An `AirtableError` for a 2xx response whose body isn't the expected shape. */
function malformedResponseError(
  operation: string,
  res: RawResponse,
  expected: string,
): AirtableError {
  return new AirtableError(
    `Airtable ${operation} received a malformed response (expected ${expected})`,
    {
      body: res.body,
      status: res.status,
      statusText: res.statusText,
      type: null,
    },
  );
}

/**
 * Validate a `listRecords` page. Returns `null` when the body isn't
 * `{ records: ListedRecord[], offset?: string }`.
 */
function parseListRecordsPage(
  body: unknown,
): { offset: string | null; records: ListedRecord[] } | null {
  if (!isPlainObj(body)) {
    return null;
  }

  const { offset, records } = body;

  if (!Array.isArray(records) || !records.every(isListedRecord)) {
    return null;
  }

  if (typeof offset === `undefined`) {
    return { offset: null, records };
  }

  return isNonEmptyStr(offset) ? { offset, records } : null;
}

/** Parse a response body as JSON; fall back to raw text, or `null` if empty. */
function parseResponseText(text: string): unknown {
  if (text.trim() === ``) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** An `AirtableError` for a non-2xx response. */
function toAirtableError(operation: string, res: RawResponse): AirtableError {
  const { message, type } = extractAirtableError(res.body);

  const details = [type, message].filter(Boolean).join(`: `);

  const errMsg =
    `Airtable ${operation} failed with HTTP status ${String(res.status)} ${res.statusText}`.trimEnd() +
    (details ? ` (${details})` : ``);

  return new AirtableError(errMsg, {
    body: res.body,
    status: res.status,
    statusText: res.statusText,
    type,
  });
}

/**
 * Build the `AirtableResponse` envelope for createRecord/getRecord/updateRecord.
 * Non-2xx responses resolve with `ok: false`; a 2xx response must contain
 * a valid record, or this throws rather than exposing it as a success.
 */
function toRecordResponse(
  operation: string,
  res: RawResponse,
): AirtableResponse {
  const { body, status, statusText } = res;

  if (!res.ok) {
    return { data: body, ok: false, status, statusText };
  }

  if (!isAirtableRecord(body)) {
    throw malformedResponseError(
      operation,
      res,
      `an Airtable record with 'id', 'createdTime', & 'fields'`,
    );
  }

  return { data: body, ok: true, status, statusText };
}

function isValidRecordId(recordId: unknown): recordId is `rec${string}` {
  return (
    typeof recordId === `string` &&
    recordId.length >= 10 &&
    recordId.startsWith(`rec`)
  );
}

/**
 * Sleep for the specified number of milliseconds.
 * We use this to throttle our API requests.
 */
function sleep(millis: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, millis);
  });
}
