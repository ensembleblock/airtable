/* eslint no-underscore-dangle: ["error", { "allow": ["_airtableId"] }] */

import { AirtableError } from './airtable-error.js';

export { AirtableError } from './airtable-error.js';

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

  /**
   * Optionally provide a `fetch` implementation (for example, to add
   * instrumentation or to stub requests in tests).
   * Defaults to the global `fetch`, resolved at request time.
   */
  fetch?: typeof fetch;
};

export type FieldsObj = Record<
  string,
  | boolean
  | Date
  | null
  | number
  | Record<string, string>
  | string
  | string[]
  | undefined
>;

export type AirtableRecord = {
  /** A date timestamp in the ISO format. */
  createdTime: string;

  fields: FieldsObj;

  /** Airtable record ID (begins with 'rec'). */
  id: `rec${string}`;
};

/**
 * The result of `createRecord`, `getRecord`, & `updateRecord`.
 *
 * These methods resolve (rather than throw) for non-2xx HTTP responses.
 * Check `ok` before reading `data`:
 * - `ok: true`  -> `data` is the Airtable record.
 * - `ok: false` -> `data` is the parsed error body (or raw text, or `null`).
 */
export type AirtableResponse =
  | {
      data: AirtableRecord;
      ok: true;
      status: number;
      statusText: string;
    }
  | {
      /**
       * Airtable's error body: usually `{ error: { type, message } }` or
       * `{ error: "NOT_FOUND" }`. Raw text if the body isn't JSON,
       * or `null` if it's empty.
       */
      data: unknown;
      ok: false;
      status: number;
      statusText: string;
    };

export type CreateRecordOpts = {
  fields: FieldsObj;
  tableIdOrName: string;
};

export type DeleteRecordOpts = {
  /** A string of at least 10 characters beginning with "rec". */
  recordId: string;

  tableIdOrName: string;
};

/** Airtable's response to a successful Delete Record request. */
export type DeletedRecord = {
  deleted: true;

  /** The deleted record's ID. */
  id: `rec${string}`;
};

export type FindFirstOpts = {
  /**
   * If you don't need every field, you can use this parameter
   * to reduce the amount of data transferred.
   */
  fields?: string[];

  /**
   * When true, we'll attach the Airtable record ID to the record as `_airtableId`.
   * Otherwise, the record will only include its fields.
   */
  includeAirtableId?: boolean;

  tableIdOrName: string;

  /** A plain object with exactly one key-value pair. */
  where: Record<string, string | number | boolean>;
};

export type FindManyOpts = {
  /**
   * If you don't need every field, you can use this parameter
   * to reduce the amount of data transferred.
   */
  fields?: string[];

  /**
   * @see https://support.airtable.com/docs/formula-field-reference
   */
  filterByFormula?: string;

  /**
   * When true, we'll attach the Airtable record ID to each record as `_airtableId`.
   * Otherwise, each record will only include its fields.
   */
  includeAirtableId?: boolean;

  /**
   * The maximum total number of records to return across all (paginated) requests.
   * Can be used as an optimization in "find one" scenarios.
   *
   * Works like a `limit` clause commonly used in database queries.
   */
  maxRecords?: number | null;

  /**
   * Instructs Airtable to limit the records returned to those that
   * have been modified since the specified number of hours ago.
   * Cannot be used in combination with `filterByFormula`.
   */
  modifiedSinceHours?: number | null;

  tableIdOrName: string;
};

export type GetRecordOpts = {
  /** A string of at least 10 characters beginning with "rec". */
  recordId: string;

  tableIdOrName: string;
};

export type UpdateRecordOpts = {
  /** Updates to make. */
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

export type UpsertRecordOpts = {
  /** Updates to make. */
  $set: FieldsObj;

  tableIdOrName: string;

  /**
   * A plain object with exactly one key-value pair.
   * Both the key and the value should be truthy.
   */
  where: Record<string, string | number | boolean>;
};

export const UpsertResults = {
  RECORD_CREATED: `RECORD_CREATED`,
  RECORD_UNCHANGED: `RECORD_UNCHANGED`,
  RECORD_UPDATED: `RECORD_UPDATED`,
} as const;

export type UpsertResult = keyof typeof UpsertResults;

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

  /** When this client's most recent request actually started (epoch millis). */
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
   * Calls the caller-provided `fetch` if one was given, otherwise the global
   * `fetch` (looked up per request, so later stubs/polyfills are honored).
   * Called as a plain function so implementations that depend on their
   * receiver (e.g. a browser's `window.fetch`) keep working.
   */
  private async fetch(url: string, init: RequestInit): Promise<Response> {
    const fetchFn = this.fetchImpl ?? globalThis.fetch;

    return fetchFn(url, init);
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
    if (fields) {
      const fieldsArrIsValid =
        Array.isArray(fields) &&
        fields.length > 0 &&
        fields.every((field) => !!field && typeof field === `string`);

      if (!fieldsArrIsValid) {
        throw new TypeError(
          `Airtable findFirst expected 'fields' to be a lengthy array of strings`,
        );
      }
    }
    // Else, `fields` wasn't provided.  We'll retrieve all fields.

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
    {
      fields,
      filterByFormula,
      maxRecords,
      modifiedSinceHours,
      tableIdOrName,
    }: FindManyOpts,
  ): Promise<ListedRecord[]> {
    if (fields) {
      const fieldsArrIsValid =
        Array.isArray(fields) &&
        fields.length > 0 &&
        fields.every((field) => !!field && typeof field === `string`);

      if (!fieldsArrIsValid) {
        throw new TypeError(
          `Airtable ${operation} expected 'fields' to be a lengthy array of strings`,
        );
      }
    }
    // Else, `fields` wasn't provided.  We'll retrieve all fields.

    if (filterByFormula && !isNonEmptyStr(filterByFormula)) {
      throw new TypeError(
        `Airtable ${operation} expected 'filterByFormula' to be a non-empty string when given`,
      );
    }
    // Else, `filterByFormula` wasn't provided.

    if (
      (maxRecords && (!Number.isInteger(maxRecords) || maxRecords < 1)) ||
      maxRecords === 0
    ) {
      throw new TypeError(
        `Airtable ${operation} expected 'maxRecords' to be a positive integer`,
      );
    }
    // Else, `maxRecords` wasn't provided.  We'll retrieve all records.

    if (
      (modifiedSinceHours &&
        (!Number.isInteger(modifiedSinceHours) || modifiedSinceHours < 1)) ||
      modifiedSinceHours === 0
    ) {
      throw new TypeError(
        `Airtable ${operation} expected 'modifiedSinceHours' to be a positive integer`,
      );
    }
    // Else, `modifiedSinceHours` wasn't provided or is `null`.  We'll retrieve all records.

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

    let numRequestsMade = 0;
    let offset: string | null = null;

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
        throw new Error(
          `Airtable ${operation} should not make more than 500 paginated requests`,
        );
      }

      const payload: Payload = { ...basePayload };

      if (offset) {
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

      numRequestsMade += 1;

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
    }

    return records;
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
    await this.waitForRequestSlot();

    const init: RequestInit = {
      cache: `no-store`,
      headers: this.headers,
      method,
    };

    if (typeof body !== `undefined`) {
      init.body = JSON.stringify(body);
    }

    const res: Response = await this.fetch(url, init);
    const text = await res.text();

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

    const fieldsToUpdate: FieldsObj = {};

    for (const [key, valueToSet] of Object.entries($set)) {
      if (existingFields[key] === valueToSet) {
        // The field is already up-to-date.
        continue;
      }

      if (typeof existingFields[key] === `undefined`) {
        // The Airtable API does not return any "empty" fields
        // (e.g. "", [], or false) in the record.
        const updateToMakeIsEmpty =
          valueToSet === `` ||
          valueToSet === false ||
          valueToSet === null ||
          typeof valueToSet === `undefined` ||
          (Array.isArray(valueToSet) && valueToSet.length === 0);

        if (updateToMakeIsEmpty) {
          // The field is empty on in the existing Airtable record
          // and the new value is also empty.
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

  /**
   * Resolves when this client may start its next request.
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
  private async waitForRequestSlot(): Promise<void> {
    const waitForSpacing = async (): Promise<void> => {
      const waitMillis =
        this.lastRequestStartedAt + this.minMillisBetweenRequests - Date.now();

      if (waitMillis > 0) {
        await sleep(waitMillis);

        // Re-check: a timer can fire early (by a millisecond) or late.
        await waitForSpacing();
      }
    };

    const turn = this.requestStartGate.then(async () => {
      await waitForSpacing();
      this.lastRequestStartedAt = Date.now();
    });

    this.requestStartGate = turn;

    await turn;
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
      `Airtable ${operation} cannot reference the field '${field}' in a formula ('{' & '}' are not supported in field names). Use the field ID instead.`,
    );
  }

  const escapedValue = String(value).replace(/["\\]/gu, (char) => `\\${char}`);

  return `{${field}}="${escapedValue}"`;
}

/** A complete record, as returned by the get/create/update endpoints. */
function isAirtableRecord(value: unknown): value is AirtableRecord {
  return isListedRecord(value) && typeof value[`createdTime`] === `string`;
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
