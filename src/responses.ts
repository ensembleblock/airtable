/**
 * Validating & interpreting Airtable responses: shape checks for records,
 * list pages & schemas, body parsing, and `AirtableError` construction.
 */

import { AirtableError } from './airtable-error.js';
import { isNonEmptyStr, isPlainObj, isValidRecordId } from './guards.js';
import type {
  AirtableField,
  AirtableRecord,
  AirtableResponse,
  AirtableTable,
  AirtableView,
} from './types.js';

/** A fetch `Response`, reduced to its status & its (tolerantly) parsed body. */
export type RawResponse = {
  body: unknown;
  ok: boolean;
  status: number;
  statusText: string;
};

/** The parts of a record that `listRecords` responses are required to include. */
export type ListedRecord = Pick<AirtableRecord, `fields` | `id`>;

/** A complete record, as returned by the get/create/update endpoints. */
export function isAirtableRecord(value: unknown): value is AirtableRecord {
  return isListedRecord(value) && typeof value[`createdTime`] === `string`;
}

/** A field's required schema properties (`options` is left open-ended). */
export function isAirtableField(value: unknown): value is AirtableField {
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
export function isAirtableTable(value: unknown): value is AirtableTable {
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
export function isAirtableView(value: unknown): value is AirtableView {
  return (
    isPlainObj(value) &&
    isPrefixedId(value[`id`], `viw`) &&
    typeof value[`name`] === `string` &&
    typeof value[`type`] === `string`
  );
}

/** A string ID with the expected Airtable prefix (e.g. 'tbl'). */
export function isPrefixedId(value: unknown, prefix: string): boolean {
  return (
    typeof value === `string` &&
    value.length > prefix.length &&
    value.startsWith(prefix)
  );
}

/** The record fields this client relies on: a valid `id` & a `fields` object. */
export function isListedRecord(
  value: unknown,
): value is ListedRecord & Record<string, unknown> {
  return (
    isPlainObj(value) &&
    isValidRecordId(value[`id`]) &&
    isPlainObj(value[`fields`])
  );
}

/**
 * Validate a `listRecords` page. Returns `null` when the body isn't
 * `{ records: ListedRecord[], offset?: string }`.
 */
export function parseListRecordsPage(
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
export function parseResponseText(text: string): unknown {
  if (text.trim() === ``) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Read Airtable's error `type` & `message` from an error body.
 * Handles both `{ error: { type, message } }` & `{ error: "NOT_FOUND" }`.
 */
export function extractAirtableError(body: unknown): {
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

/** An `AirtableError` for a 2xx response whose body isn't the expected shape. */
export function malformedResponseError(
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

/** An `AirtableError` for a non-2xx response. */
export function toAirtableError(
  operation: string,
  res: RawResponse,
): AirtableError {
  const { message, type } = extractAirtableError(res.body);

  const details: string = [type, message].filter(Boolean).join(`: `);

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
export function toRecordResponse(
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

/** Convert an `AirtableResponse` envelope back to a `RawResponse`. */
export function envelopeToRaw({
  data,
  ok,
  status,
  statusText,
}: AirtableResponse): RawResponse {
  return { body: data, ok, status, statusText };
}
