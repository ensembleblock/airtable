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
  id: string;
};

export type AirtableResponse = {
  data: AirtableRecord;
  ok: boolean;
  status: number;
  statusText: string;
};

export type CreateRecordOpts = {
  fields: FieldsObj;
  tableIdOrName: string;
};

export type FindFirstOpts = {
  /**
   * If you don't need every field, you can use this parameter
   * to reduce the amount of data transferred.
   */
  fields?: string[];

  /**
   * A plain object with exactly one key-value pair.
   */
  filterObj: Record<string, string | number | boolean>;

  /**
   * When true, we'll attach the Airtable record ID to the record as `_airtableId`.
   * Otherwise, the record will only include its fields.
   */
  includeAirtableId?: boolean;

  tableIdOrName: string;
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
export class AirtableClient {
  private baseId: string | null = null;

  private baseUrl: string = `https://api.airtable.com/v0`;

  private headers: Record<string, string> = {};

  /** Timestamp of the last request (epoch millis). */
  private lastRequestAt: number | null = null;

  /** The Airtable API is limited to 5 requests per second per base. */
  private minMillisBetweenRequests: number = 200;

  /**
   * Constructs an instance of the AirtableClient.
   *
   * @param {Object} param0 - Configuration object.
   * @param {string} param0.apiKey - Airtable API key for authentication.
   * @param {string} param0.baseId - The unique identifier for the base (begins with 'app').
   * @param {string} [param0.baseUrl] - An optional API base URL (without a trailing slash).
   * Defaults to the standard Airtable API URL.
   */
  constructor({ apiKey, baseId, baseUrl }: AirtableClientOpts) {
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
  }

  /**
   * Call before making an Airtable API request.
   * This method ensures that we don't make more than 5 requests per second.
   * @see https://airtable.com/developers/web/api/rate-limits
   */
  private async throttleIfNeeded(): Promise<void> {
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

  private setLastRequestAt(): void {
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

    const createRecordUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}`;
    const body = JSON.stringify({ fields });

    await this.throttleIfNeeded();
    this.setLastRequestAt();

    const res: Response = await fetch(createRecordUrl, {
      body,
      headers: this.headers,
      method: `POST`,
    });

    const data: AirtableRecord = await res.json();

    return { data, ok: res.ok, status: res.status, statusText: res.statusText };
  }

  /**
   * Returns the first record that matches the given filter object.
   * (A plain object with exactly one key-value pair.)
   * Returns `null` if no record is found.
   */
  public async findFirst({
    fields,
    filterObj,
    includeAirtableId,
    tableIdOrName,
  }: FindFirstOpts): Promise<
    FieldsObj | (FieldsObj & { _airtableId: string }) | null
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

    // Validate `filterObj`.
    if (!isPlainObj(filterObj)) {
      throw new TypeError(
        `Airtable findFirst expected 'filterObj' to be a plain object`,
      );
    }

    if (Object.keys(filterObj).length !== 1) {
      throw new TypeError(
        `Airtable findFirst expected 'filterObj' to have exactly one key-value pair`,
      );
    }

    if (!isNonEmptyStr(tableIdOrName)) {
      throw new TypeError(
        `Airtable findFirst expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const [fieldName, value] = Object.entries(filterObj)[0]!;

    const opts: FindManyOpts = {
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
  public async findMany({
    fields,
    filterByFormula,
    includeAirtableId,
    maxRecords,
    modifiedSinceHours,
    tableIdOrName,
  }: FindManyOpts): Promise<
    (FieldsObj | (FieldsObj & { _airtableId: string }))[]
  > {
    if (fields) {
      const fieldsArrIsValid =
        Array.isArray(fields) &&
        fields.length > 0 &&
        fields.every((field) => !!field && typeof field === `string`);

      if (!fieldsArrIsValid) {
        throw new TypeError(
          `Airtable findMany expected 'fields' to be a lengthy array of strings`,
        );
      }
    }
    // Else, `fields` wasn't provided.  We'll retrieve all fields.

    if (filterByFormula && !isNonEmptyStr(filterByFormula)) {
      throw new TypeError(
        `Airtable findMany expected 'filterByFormula' to be a non-string when given`,
      );
    }
    // Else, `filterByFormula` wasn't provided.

    if (
      (maxRecords && (!Number.isInteger(maxRecords) || maxRecords < 1)) ||
      maxRecords === 0
    ) {
      throw new TypeError(
        `Airtable findMany expected 'maxRecords' to be a positive integer`,
      );
    }
    // Else, `maxRecords` wasn't provided.  We'll retrieve all records.

    if (
      (modifiedSinceHours &&
        (!Number.isInteger(modifiedSinceHours) || modifiedSinceHours < 1)) ||
      modifiedSinceHours === 0
    ) {
      throw new TypeError(
        `Airtable findMany expected 'modifiedSinceHours' to be a positive integer`,
      );
    }
    // Else, `modifiedSinceHours` wasn't provided or is `null`.  We'll retrieve all records.

    if (filterByFormula && modifiedSinceHours) {
      throw new Error(
        `Airtable findMany cannot use both 'filterByFormula' and 'modifiedSinceHours'`,
      );
    }

    if (!isNonEmptyStr(tableIdOrName)) {
      throw new TypeError(
        `Airtable findMany expected 'tableIdOrName' to be a non-empty string`,
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
      basePayload.filterByFormula = `{lastModifiedTime}>=DATETIME_FORMAT(DATEADD(NOW(),-${modifiedSinceHours},'hours'))`;
    }

    if (maxRecords) {
      basePayload.maxRecords = maxRecords;
    }

    const listRecordsUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}/listRecords`;
    const aggregateResponses: AirtableRecord[][] = [];

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
          `Airtable findMany should not make more than 500 paginated requests`,
        );
      }

      const payload: Payload = { ...basePayload };

      if (offset && typeof offset === `string`) {
        payload.offset = offset;
      }

      const body = JSON.stringify(payload);

      await this.throttleIfNeeded();
      this.setLastRequestAt();

      const res: Response = await fetch(listRecordsUrl, {
        body,
        headers: this.headers,

        // We use a POST instead of a GET request with query parameters.
        // It's more ergonomic than encoding query parameters,
        // especially when using `filterByFormula`.
        method: `POST`,
      });

      numRequestsMade += 1;

      if (!res.ok) {
        throw new Error(
          `Airtable findMany failed with HTTP status ${res.status} ${res.statusText}`,
        );
      }

      const data: {
        offset?: string;
        records: AirtableRecord[];
      } = await res.json();

      if (Array.isArray(data.records) && data.records.length > 0) {
        aggregateResponses.push(data.records);
      }

      if (data.offset && typeof data.offset === `string`) {
        ({ offset } = data);
      } else {
        // No more records to fetch.
        offset = null;
      }
    }

    /**
     * Basic mapping function to extract fields from a record.
     * Drops the outer `id` & `createdTime` fields.
     */
    const basicMapFn = (record: AirtableRecord): FieldsObj => record.fields;

    /**
     * Complex mapping function to include the Airtable ID as `_airtableId`
     * along with the record's fields.
     */
    const complexMapFn = (
      record: AirtableRecord,
    ): FieldsObj & { _airtableId: string } => ({
      _airtableId: record.id,
      ...record.fields,
    });

    const records: (FieldsObj | (FieldsObj & { _airtableId: string }))[] =
      aggregateResponses
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
  public async getRecord({
    recordId,
    tableIdOrName,
  }: GetRecordOpts): Promise<AirtableResponse> {
    if (
      typeof recordId !== `string` ||
      recordId.length < 10 ||
      !recordId.startsWith(`rec`)
    ) {
      throw new TypeError(
        `Airtable getRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`,
      );
    }

    if (!isNonEmptyStr(tableIdOrName)) {
      throw new TypeError(
        `Airtable getRecord expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const getRecordUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}/${recordId}`;

    await this.throttleIfNeeded();
    this.setLastRequestAt();

    const res: Response = await fetch(getRecordUrl, {
      headers: this.headers,
      method: `GET`,
    });

    const data: AirtableRecord = await res.json();

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

    if (
      typeof recordId !== `string` ||
      recordId.length < 10 ||
      !recordId.startsWith(`rec`)
    ) {
      throw new TypeError(
        `Airtable updateRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`,
      );
    }

    if (!isNonEmptyStr(tableIdOrName)) {
      throw new TypeError(
        `Airtable updateRecord expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const updateRecordUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}/${recordId}`;
    const body = JSON.stringify({ fields });

    await this.throttleIfNeeded();
    this.setLastRequestAt();

    const res: Response = await fetch(updateRecordUrl, {
      body,
      headers: this.headers,
      method: method.toUpperCase(),
    });

    const data: AirtableRecord = await res.json();

    return { data, ok: res.ok, status: res.status, statusText: res.statusText };
  }
}

function isNonEmptyStr(str: string): str is string {
  return typeof str === `string` && str.length > 0;
}

function isPlainObj(obj: unknown): obj is object {
  return typeof obj === `object` && obj !== null && !Array.isArray(obj);
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
