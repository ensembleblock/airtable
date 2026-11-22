/**
 * Unit tests for response parsing & validation in `src/responses.ts`,
 * and the shared guards in `src/guards.ts`.
 */

import { describe, expect, it } from 'vitest';

import { isNonEmptyStr, isPlainObj, isValidRecordId } from '../src/guards.js';
import { AirtableError } from '../src/index.js';
import type { RawResponse } from '../src/responses.js';
import {
  envelopeToRaw,
  extractAirtableError,
  isAirtableField,
  isAirtableRecord,
  isAirtableTable,
  isAirtableView,
  isListedRecord,
  isPrefixedId,
  malformedResponseError,
  parseListRecordsPage,
  parseResponseText,
  toAirtableError,
  toRecordResponse,
} from '../src/responses.js';

const raw = (overrides: Partial<RawResponse> = {}): RawResponse => ({
  body: null,
  ok: true,
  status: 200,
  statusText: `OK`,
  ...overrides,
});

const record = {
  createdTime: `2026-11-21T00:00:00.000Z`,
  fields: { Name: `Ada` },
  id: `rec1234567`,
};

const field = { id: `fld1`, name: `Name`, type: `singleLineText` };
const view = { id: `viw1`, name: `Grid`, type: `grid` };
const table = {
  fields: [field],
  id: `tbl1`,
  name: `People`,
  primaryFieldId: `fld1`,
  views: [view],
};

describe(`guards`, () => {
  it.each([
    [`x`, true],
    [``, false],
    [null, false],
    [1, false],
  ])(`isNonEmptyStr(%j) -> %s`, (value, expected) => {
    expect(isNonEmptyStr(value)).toBe(expected);
  });

  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    [`{}`, false],
  ])(`isPlainObj(%j) -> %s`, (value, expected) => {
    expect(isPlainObj(value)).toBe(expected);
  });

  it.each([
    [`rec1234567`, true],
    [`rec123456`, false],
    [`tbl1234567`, false],
    [`REC1234567`, false],
    [1_234_567_890, false],
  ])(`isValidRecordId(%j) -> %s`, (value, expected) => {
    expect(isValidRecordId(value)).toBe(expected);
  });

  it.each([
    [`tbl1`, `tbl`, true],
    [`tbl`, `tbl`, false],
    [`fld1`, `tbl`, false],
    [null, `tbl`, false],
  ])(`isPrefixedId(%j, %j) -> %s`, (value, prefix, expected) => {
    expect(isPrefixedId(value, prefix)).toBe(expected);
  });
});

describe(`parseResponseText`, () => {
  it.each([
    [``, null],
    [`  \n `, null],
    [`{"a":1}`, { a: 1 }],
    [`[1,2]`, [1, 2]],
    [`"str"`, `str`],
    [`<html>Bad Gateway</html>`, `<html>Bad Gateway</html>`],
    [`{"truncated":`, `{"truncated":`],
  ])(`%j -> %j`, (text, expected) => {
    expect(parseResponseText(text)).toStrictEqual(expected);
  });
});

describe(`record shape checks`, () => {
  it(`accepts a complete record`, () => {
    expect(isAirtableRecord(record)).toBe(true);
    expect(isListedRecord(record)).toBe(true);
  });

  it(`accepts a listed record without createdTime`, () => {
    const { createdTime: unusedCreatedTime, ...listed } = record;

    expect(isListedRecord(listed)).toBe(true);
    expect(isAirtableRecord(listed)).toBe(false);
  });

  it.each([
    [`a non-object`, `rec1234567`],
    [`an invalid id`, { ...record, id: `bad` }],
    [`array fields`, { ...record, fields: [] }],
    [`missing fields`, { createdTime: record.createdTime, id: record.id }],
  ])(`rejects %s`, (label, value) => {
    expect(isListedRecord(value), label).toBe(false);
    expect(isAirtableRecord(value)).toBe(false);
  });
});

describe(`schema shape checks`, () => {
  it(`accepts a table with fields & views`, () => {
    expect(isAirtableTable(table)).toBe(true);
  });

  it(`accepts optional descriptions & options`, () => {
    expect(
      isAirtableTable({
        ...table,
        description: `All the people`,
        fields: [{ ...field, description: `Their name`, options: {} }],
      }),
    ).toBe(true);
  });

  it.each([
    [`a non-object`, null],
    [`an array`, [table]],
    [`a bad id`, { ...table, id: `fld1` }],
    [`a bad primaryFieldId`, { ...table, primaryFieldId: `tbl1` }],
    [`a non-string description`, { ...table, description: 1 }],
    [`a missing name`, { ...table, name: null }],
    [`non-array fields`, { ...table, fields: {} }],
    [`non-array views`, { ...table, views: null }],
    [`an invalid field`, { ...table, fields: [{ ...field, type: 1 }] }],
    [`an invalid view`, { ...table, views: [{ ...view, id: `fld1` }] }],
  ])(`rejects a table with %s`, (label, value) => {
    expect(isAirtableTable(value), label).toBe(false);
  });

  it.each([
    [`a bad id`, { ...field, id: `viw1` }],
    [`non-object options`, { ...field, options: [] }],
    [`a non-string description`, { ...field, description: null }],
  ])(`rejects a field with %s`, (label, value) => {
    expect(isAirtableField(value), label).toBe(false);
  });

  it.each([
    [`a missing type`, { id: `viw1`, name: `Grid` }],
    [`a non-object`, `viw1`],
  ])(`rejects a view with %s`, (label, value) => {
    expect(isAirtableView(value), label).toBe(false);
  });
});

describe(`parseListRecordsPage`, () => {
  const listed = { fields: {}, id: `rec1234567` };

  it.each([
    [`a page without offset`, { records: [listed] }, null],
    [`a page with offset`, { offset: `itr1/rec1`, records: [] }, `itr1/rec1`],
  ])(`accepts %s`, (label, body, offset) => {
    expect(parseListRecordsPage(body), label).toStrictEqual({
      offset,
      records: body.records,
    });
  });

  it.each([
    [`a non-object`, `nope`],
    [`missing records`, {}],
    [`non-array records`, { records: {} }],
    [`an invalid record`, { records: [{ fields: {}, id: `bad` }] }],
    [`an empty offset`, { offset: ``, records: [] }],
    [`a numeric offset`, { offset: 1, records: [] }],
  ])(`rejects %s`, (label, body) => {
    expect(parseListRecordsPage(body), label).toBeNull();
  });
});

describe(`extractAirtableError`, () => {
  it.each([
    [
      `an object error`,
      { error: { message: `Bad`, type: `INVALID_REQUEST` } },
      { message: `Bad`, type: `INVALID_REQUEST` },
    ],
    [
      `a string error`,
      { error: `NOT_FOUND` },
      { message: null, type: `NOT_FOUND` },
    ],
    [
      `non-string members`,
      { error: { message: 1, type: [] } },
      { message: null, type: null },
    ],
    [`no error key`, { other: 1 }, { message: null, type: null }],
    [`a text body`, `oops`, { message: null, type: null }],
    [`a null body`, null, { message: null, type: null }],
  ])(`reads %s`, (label, body, expected) => {
    expect(extractAirtableError(body), label).toStrictEqual(expected);
  });
});

describe(`toAirtableError`, () => {
  it(`includes the status, status text, type & message`, () => {
    const body = { error: { message: `Unknown field`, type: `UNKNOWN_FIELD` } };
    const err = toAirtableError(
      `findMany`,
      raw({ body, ok: false, status: 422, statusText: `Unprocessable` }),
    );

    expect(err).toBeInstanceOf(AirtableError);
    expect(err.message).toBe(
      `Airtable findMany failed with HTTP status 422 Unprocessable (UNKNOWN_FIELD: Unknown field)`,
    );
    expect(err).toMatchObject({
      body,
      status: 422,
      statusText: `Unprocessable`,
      type: `UNKNOWN_FIELD`,
    });
  });

  it(`omits empty status text & details without dangling spaces`, () => {
    const err = toAirtableError(
      `getRecord`,
      raw({ body: null, ok: false, status: 500, statusText: `` }),
    );

    expect(err.message).toBe(`Airtable getRecord failed with HTTP status 500`);
    expect(err.type).toBeNull();
  });
});

describe(`malformedResponseError`, () => {
  it(`describes the expected shape & keeps the response details`, () => {
    const err = malformedResponseError(
      `listTables`,
      raw({ body: `<html>` }),
      `{ tables: [...] }`,
    );

    expect(err).toBeInstanceOf(AirtableError);
    expect(err.message).toBe(
      `Airtable listTables received a malformed response (expected { tables: [...] })`,
    );
    expect(err).toMatchObject({
      body: `<html>`,
      status: 200,
      statusText: `OK`,
      type: null,
    });
  });
});

describe(`toRecordResponse & envelopeToRaw`, () => {
  it(`wraps a valid record as ok`, () => {
    expect(toRecordResponse(`getRecord`, raw({ body: record }))).toStrictEqual({
      data: record,
      ok: true,
      status: 200,
      statusText: `OK`,
    });
  });

  it(`resolves a non-2xx response as not ok, with its body`, () => {
    const body = { error: `NOT_FOUND` };

    expect(
      toRecordResponse(
        `getRecord`,
        raw({ body, ok: false, status: 404, statusText: `Not Found` }),
      ),
    ).toStrictEqual({
      data: body,
      ok: false,
      status: 404,
      statusText: `Not Found`,
    });
  });

  it(`throws for a 2xx response that isn't a record`, () => {
    expect(() => toRecordResponse(`createRecord`, raw({ body: {} }))).toThrow(
      `Airtable createRecord received a malformed response (expected an Airtable record with 'id', 'createdTime', & 'fields')`,
    );
  });

  it(`round-trips an envelope back to a raw response`, () => {
    const res = raw({ body: { error: `X` }, ok: false, status: 403 });

    expect(envelopeToRaw(toRecordResponse(`op`, res))).toStrictEqual(res);
  });
});
