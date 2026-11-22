/**
 * Public types (and the `UpsertResults` constant) for the Airtable client.
 * Everything exported here is re-exported from the package entry point.
 */

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

/**
 * A field in a table's schema.
 * @see https://airtable.com/developers/web/api/field-model
 */
export type AirtableField = {
  description?: string;

  /** Airtable field ID (begins with 'fld'). */
  id: `fld${string}`;

  name: string;

  /**
   * Type-specific options (e.g. choices for `singleSelect`, or
   * `linkedTableId` for `multipleRecordLinks`). Left open-ended;
   * see Airtable's field model reference for each type's options.
   */
  options?: Record<string, unknown>;

  type: AirtableFieldType;
};

/**
 * Airtable field types. Listed for autocompletion; any other string is
 * accepted, so new field types don't break consumers.
 * @see https://airtable.com/developers/web/api/field-model
 */
export type AirtableFieldType =
  | `aiText`
  | `autoNumber`
  | `barcode`
  | `button`
  | `checkbox`
  | `count`
  | `createdBy`
  | `createdTime`
  | `currency`
  | `date`
  | `dateTime`
  | `duration`
  | `email`
  | `externalSyncSource`
  | `formula`
  | `lastModifiedBy`
  | `lastModifiedTime`
  | `multilineText`
  | `multipleAttachments`
  | `multipleCollaborators`
  | `multipleLookupValues`
  | `multipleRecordLinks`
  | `multipleSelects`
  | `number`
  | `percent`
  | `phoneNumber`
  | `rating`
  | `richText`
  | `rollup`
  | `singleCollaborator`
  | `singleLineText`
  | `singleSelect`
  | `url`
  | (string & {});

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

/**
 * A table in a base's schema, as returned by `listTables()`.
 * @see https://airtable.com/developers/web/api/get-base-schema
 */
export type AirtableTable = {
  description?: string;

  fields: AirtableField[];

  /** Airtable table ID (begins with 'tbl'). */
  id: `tbl${string}`;

  name: string;

  /** The ID of the table's primary field (begins with 'fld'). */
  primaryFieldId: `fld${string}`;

  views: AirtableView[];
};

/** A view in a table's schema. */
export type AirtableView = {
  /** Airtable view ID (begins with 'viw'). */
  id: `viw${string}`;

  name: string;

  type: AirtableViewType;
};

/**
 * Airtable view types. Listed for autocompletion; any other string is
 * accepted, so new view types don't break consumers.
 */
export type AirtableViewType =
  | `block`
  | `calendar`
  | `form`
  | `gallery`
  | `grid`
  | `kanban`
  | `timeline`
  | (string & {});

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
