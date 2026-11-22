/* eslint no-underscore-dangle: ["error", { "allow": ["_airtableId"] }] */

/**
 * Record-level logic that doesn't touch the network: list-option validation,
 * `{field}="value"` formulas, upsert field diffing, & `_airtableId` shaping.
 */

import { isNonEmptyStr, isPlainObj } from './guards.js';
import type { ListedRecord } from './responses.js';
import type { FieldsObj, FindManyOpts } from './types.js';

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
export function buildEqualsFormula(
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

/** Compare the supported field values as they are sent over JSON. */
export function fieldNeedsUpdate(
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

export function validateListOptions(
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

/**
 * A record's fields plus its ID as `_airtableId`.
 * The real record ID takes precedence over a field named `_airtableId`.
 */
export function withAirtableId(
  record: ListedRecord,
): FieldsObj & { _airtableId: `rec${string}` } {
  return { ...record.fields, _airtableId: record.id };
}
