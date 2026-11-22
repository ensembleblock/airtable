/* eslint no-underscore-dangle: ["error", { "allow": ["_airtableId"] }] */

/**
 * Unit tests for the network-free record helpers in `src/records.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { FieldsObj } from '../src/index.js';
import {
  buildEqualsFormula,
  fieldNeedsUpdate,
  validateListOptions,
  withAirtableId,
} from '../src/records.js';

describe(`fieldNeedsUpdate`, () => {
  const existing: FieldsObj = {
    Count: 0,
    Done: true,
    Due: `2026-11-21T00:00:00.000Z`,
    Name: `Ada`,
    Tags: [`a`, `b`],
    User: { email: `ada@example.com`, id: `usr1` },
  };

  it.each<[string, string, FieldsObj[string], boolean]>([
    [`an identical string`, `Name`, `Ada`, false],
    [`a different string`, `Name`, `Grace`, true],
    [`an identical zero`, `Count`, 0, false],
    [`a changed number`, `Count`, 1, true],
    [`an identical boolean`, `Done`, true, false],
    // eslint-disable-next-line no-undefined -- `$set` values may be undefined
    [`an undefined value (skipped)`, `Name`, undefined, false],
    [`an equal array`, `Tags`, [`a`, `b`], false],
    [`a reordered array`, `Tags`, [`b`, `a`], true],
    [`a shorter array`, `Tags`, [`a`], true],
    [
      `an equal object`,
      `User`,
      { email: `ada@example.com`, id: `usr1` },
      false,
    ],
    [
      `an object with a changed value`,
      `User`,
      { email: `x`, id: `usr1` },
      true,
    ],
    [
      `an object with an extra key`,
      `User`,
      { a: `1`, email: ``, id: `` },
      true,
    ],
    [`an object with a different key`, `User`, { email: `x`, name: `y` }, true],
    [`an object with a key removed`, `User`, { id: `usr1` }, true],
    [`an equal Date`, `Due`, new Date(`2026-11-21T00:00:00.000Z`), false],
    [`a different Date`, `Due`, new Date(`2026-11-22T00:00:00.000Z`), true],
    [`a string replaced by an array`, `Name`, [`Ada`], true],
    [`a value cleared to null`, `Name`, null, true],
  ])(`%s -> %s`, (label, key, value, expected) => {
    expect(fieldNeedsUpdate(existing, key, value), label).toBe(expected);
  });

  describe(`for a field Airtable omitted (an empty cell)`, () => {
    it.each<[FieldsObj[string], boolean]>([
      [null, false],
      [false, false],
      [``, false],
      [[], false],
      [0, true],
      [`x`, true],
      [true, true],
      [[`x`], true],
      [{}, true],
      [new Date(0), true],
    ])(`%j -> %s`, (value, expected) => {
      expect(fieldNeedsUpdate({}, `Missing`, value)).toBe(expected);
    });
  });

  it(`ignores inherited properties when checking for an omitted field`, () => {
    // `toString` exists on the prototype, but not as an own field.
    expect(fieldNeedsUpdate({}, `toString`, ``)).toBe(false);
    expect(fieldNeedsUpdate({}, `toString`, `x`)).toBe(true);
  });
});

describe(`buildEqualsFormula`, () => {
  it.each<[string, boolean | number | string, string]>([
    [`Name`, `Ada`, `{Name}="Ada"`],
    [`Name`, `say "hi"`, `{Name}="say \\"hi\\""`],
    [`Path`, `C:\\temp`, `{Path}="C:\\\\temp"`],
    [`Count`, 42, `{Count}="42"`],
    [`Done`, true, `{Done}="true"`],
    [`Full Name (legal)`, `x`, `{Full Name (legal)}="x"`],
  ])(`{%s} = %j -> %s`, (field, value, expected) => {
    expect(buildEqualsFormula(`op`, field, value)).toBe(expected);
  });

  it.each([`a{b`, `a}b`, `{a}`])(`rejects the field name %j`, (field) => {
    expect(() => buildEqualsFormula(`myOp`, field, `x`)).toThrow(
      new TypeError(
        `Airtable myOp cannot reference the field '${field}' in a formula ('{' & '}' are not supported in field names).`,
      ),
    );
  });
});

describe(`validateListOptions`, () => {
  it(`accepts minimal & fully specified options`, () => {
    expect(() => {
      validateListOptions(`op`, { tableIdOrName: `T` });
    }).not.toThrow();

    expect(() => {
      validateListOptions(`op`, {
        fields: [`Name`],
        filterByFormula: `{Done}`,
        maxRecords: 10,
        tableIdOrName: `T`,
      });
    }).not.toThrow();
  });

  it(`names the calling operation in its errors`, () => {
    expect(() => {
      validateListOptions(`customOp`, { tableIdOrName: `` });
    }).toThrow(
      `Airtable customOp expected 'tableIdOrName' to be a non-empty string`,
    );
  });
});

describe(`withAirtableId`, () => {
  it(`adds the record ID as _airtableId`, () => {
    expect(
      withAirtableId({ fields: { Name: `Ada` }, id: `rec1234567` }),
    ).toStrictEqual({ _airtableId: `rec1234567`, Name: `Ada` });
  });

  it(`lets the real ID win over a field named _airtableId`, () => {
    expect(
      withAirtableId({
        fields: { _airtableId: `spoofed` },
        id: `rec1234567`,
      })._airtableId,
    ).toBe(`rec1234567`);
  });

  it(`does not mutate the record's fields`, () => {
    const fields = { Name: `Ada` };
    withAirtableId({ fields, id: `rec1234567` });

    expect(fields).toStrictEqual({ Name: `Ada` });
  });
});
