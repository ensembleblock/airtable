/**
 * Argument validation: invalid options throw a `TypeError` with a specific
 * message, before any request is made.
 */

import { describe, expect, it } from 'vitest';

import type { AirtableClient, AirtableClientOpts } from '../src/index.js';
import { AirtableClient as Client } from '../src/index.js';
import {
  apiKey,
  baseId,
  createClient,
  createMockFetch,
  json,
  makeRecord,
  recordId,
  tableIdOrName,
} from './test-helpers.js';

/** Bypass the static types to exercise runtime validation. */
const loose = (value: unknown): never => value as never;

describe(`constructor validation`, () => {
  const apiKeyMessage = `AirtableClient expected 'apiKey' to be string of at least 10 characters`;
  const baseIdMessage = `AirtableClient expected 'baseId' to be string of at least 10 characters starting with 'app'`;
  const baseUrlMessage = `AirtableClient expected 'baseUrl' to be a string without a trailing slash`;

  it.each<[string, Partial<AirtableClientOpts>, string]>([
    [`a null apiKey`, { apiKey: loose(null) }, apiKeyMessage],
    [`a non-string apiKey`, { apiKey: loose(1_234_567_890) }, apiKeyMessage],
    [`a 9-character apiKey`, { apiKey: `pat123456` }, apiKeyMessage],
    [`a null baseId`, { baseId: loose(null) }, baseIdMessage],
    [`a 9-character baseId`, { baseId: `app123456` }, baseIdMessage],
    [`a baseId without 'app'`, { baseId: `tbl1234567890` }, baseIdMessage],
    [
      `a baseUrl with a trailing slash`,
      { baseUrl: `https://proxy.example/v0/` },
      baseUrlMessage,
    ],
    [`a non-string baseUrl`, { baseUrl: loose(42) }, baseUrlMessage],
  ])(`rejects %s`, (label, overrides, message) => {
    const construct = () => new Client({ apiKey, baseId, ...overrides });

    expect(construct, label).toThrow(TypeError);
    expect(construct, label).toThrow(message);
  });

  it(`accepts 10-character apiKey & baseId values`, () => {
    expect(
      () => new Client({ apiKey: `pat1234567`, baseId: `app1234567` }),
    ).not.toThrow();
  });

  it(`treats an empty baseUrl as "use the default"`, async () => {
    const { fetch, requests } = createMockFetch(json(makeRecord()));
    const client = new Client({ apiKey, baseId, baseUrl: ``, fetch });

    await client.getRecord({ recordId, tableIdOrName });

    expect(requests[0]?.url).toBe(
      `https://api.airtable.com/v0/${baseId}/${tableIdOrName}/${recordId}`,
    );
  });
});

type Case = [
  label: string,
  call: (client: AirtableClient) => Promise<unknown>,
  message: string,
];

const createRecordCases: Case[] = [
  [
    `createRecord with array fields`,
    (c) => c.createRecord({ fields: loose([]), tableIdOrName }),
    `Airtable createRecord expected 'fields' to be a plain object`,
  ],
  [
    `createRecord with null fields`,
    (c) => c.createRecord({ fields: loose(null), tableIdOrName }),
    `Airtable createRecord expected 'fields' to be a plain object`,
  ],
  [
    `createRecord with an empty table name`,
    (c) => c.createRecord({ fields: {}, tableIdOrName: `` }),
    `Airtable createRecord expected 'tableIdOrName' to be a non-empty string`,
  ],
];

const getAndDeleteCases: Case[] = [
  [
    `getRecord with an empty table name`,
    (c) => c.getRecord({ recordId, tableIdOrName: `` }),
    `Airtable getRecord expected 'tableIdOrName' to be a non-empty string`,
  ],
  [
    `getRecord with a non-'rec' recordId`,
    (c) => c.getRecord({ recordId: `tbl1234567890`, tableIdOrName }),
    `Airtable getRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`,
  ],
  [
    `deleteRecord with a non-string recordId`,
    (c) => c.deleteRecord({ recordId: loose(42), tableIdOrName }),
    `Airtable deleteRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`,
  ],
  [
    `deleteRecord with an empty table name`,
    (c) => c.deleteRecord({ recordId, tableIdOrName: `` }),
    `Airtable deleteRecord expected 'tableIdOrName' to be a non-empty string`,
  ],
];

const updateRecordCases: Case[] = [
  [
    `updateRecord with array fields`,
    (c) => c.updateRecord({ fields: loose([]), recordId, tableIdOrName }),
    `Airtable updateRecord expected 'fields' to be a plain object`,
  ],
  [
    `updateRecord with method POST`,
    (c) =>
      c.updateRecord({
        fields: {},
        method: loose(`POST`),
        recordId,
        tableIdOrName,
      }),
    `Airtable updateRecord expected 'method' to be 'PATCH' or 'PUT'`,
  ],
  [
    `updateRecord with a non-string method`,
    (c) =>
      c.updateRecord({ fields: {}, method: loose(1), recordId, tableIdOrName }),
    `Airtable updateRecord expected 'method' to be 'PATCH' or 'PUT'`,
  ],
  [
    `updateRecord with a short recordId`,
    (c) => c.updateRecord({ fields: {}, recordId: `rec123`, tableIdOrName }),
    `Airtable updateRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`,
  ],
  [
    `updateRecord with an empty table name`,
    (c) => c.updateRecord({ fields: {}, recordId, tableIdOrName: `` }),
    `Airtable updateRecord expected 'tableIdOrName' to be a non-empty string`,
  ],
];

const findFirstCases: Case[] = [
  [
    `findFirst with array where`,
    (c) => c.findFirst({ tableIdOrName, where: loose([[`a`, `b`]]) }),
    `Airtable findFirst expected 'where' to be a plain object`,
  ],
  [
    `findFirst with an empty where`,
    (c) => c.findFirst({ tableIdOrName, where: {} }),
    `Airtable findFirst expected 'where' to have exactly one key-value pair`,
  ],
  [
    `findFirst with two where keys`,
    (c) => c.findFirst({ tableIdOrName, where: { a: `1`, b: `2` } }),
    `Airtable findFirst expected 'where' to have exactly one key-value pair`,
  ],
  [
    `findFirst with an empty where value`,
    (c) => c.findFirst({ tableIdOrName, where: { Name: `` } }),
    `Airtable findFirst expected 'where' to have a truthy key and value`,
  ],
  [
    `findFirst with an empty where key`,
    (c) => c.findFirst({ tableIdOrName, where: { '': `x` } }),
    `Airtable findFirst expected 'where' to have a truthy key and value`,
  ],
  [
    `findFirst with an empty table name`,
    (c) => c.findFirst({ tableIdOrName: ``, where: { Name: `x` } }),
    `Airtable findFirst expected 'tableIdOrName' to be a non-empty string`,
  ],
  [
    `findFirst with empty fields`,
    (c) => c.findFirst({ fields: [], tableIdOrName, where: { Name: `x` } }),
    `Airtable findFirst expected 'fields' to be a lengthy array of strings`,
  ],
];

const findManyCases: Case[] = [
  [
    `findMany with a string fields`,
    (c) => c.findMany({ fields: loose(`Name`), tableIdOrName }),
    `Airtable findMany expected 'fields' to be a lengthy array of strings`,
  ],
  [
    `findMany with an empty fields array`,
    (c) => c.findMany({ fields: [], tableIdOrName }),
    `Airtable findMany expected 'fields' to be a lengthy array of strings`,
  ],
  [
    `findMany with an empty field name`,
    (c) => c.findMany({ fields: [`Name`, ``], tableIdOrName }),
    `Airtable findMany expected 'fields' to be a lengthy array of strings`,
  ],
  [
    `findMany with a non-string filterByFormula`,
    (c) => c.findMany({ filterByFormula: loose(1), tableIdOrName }),
    `Airtable findMany expected 'filterByFormula' to be a non-empty string when given`,
  ],
  [
    `findMany with maxRecords 0`,
    (c) => c.findMany({ maxRecords: 0, tableIdOrName }),
    `Airtable findMany expected 'maxRecords' to be a positive integer`,
  ],
  [
    `findMany with fractional maxRecords`,
    (c) => c.findMany({ maxRecords: 1.5, tableIdOrName }),
    `Airtable findMany expected 'maxRecords' to be a positive integer`,
  ],
  [
    `findMany with string maxRecords`,
    (c) => c.findMany({ maxRecords: loose(`5`), tableIdOrName }),
    `Airtable findMany expected 'maxRecords' to be a positive integer`,
  ],
  [
    `findMany with negative modifiedSinceHours`,
    (c) => c.findMany({ modifiedSinceHours: -1, tableIdOrName }),
    `Airtable findMany expected 'modifiedSinceHours' to be a positive integer`,
  ],
  [
    `findMany with both filterByFormula & modifiedSinceHours`,
    (c) =>
      c.findMany({
        filterByFormula: `{Done}`,
        modifiedSinceHours: 1,
        tableIdOrName,
      }),
    `Airtable findMany cannot use both 'filterByFormula' and 'modifiedSinceHours'`,
  ],
  [
    `findMany with an empty table name`,
    (c) => c.findMany({ tableIdOrName: `` }),
    `Airtable findMany expected 'tableIdOrName' to be a non-empty string`,
  ],
];

const upsertRecordCases: Case[] = [
  [
    `upsertRecord with array $set`,
    (c) =>
      c.upsertRecord({ $set: loose([]), tableIdOrName, where: { a: `1` } }),
    `Airtable upsertRecord expected '$set' to be a plain object`,
  ],
  [
    `upsertRecord with null where`,
    (c) => c.upsertRecord({ $set: {}, tableIdOrName, where: loose(null) }),
    `Airtable upsertRecord expected 'where' to be a plain object`,
  ],
  [
    `upsertRecord with an empty where`,
    (c) => c.upsertRecord({ $set: {}, tableIdOrName, where: {} }),
    `Airtable upsertRecord expected 'where' to have exactly one key-value pair`,
  ],
  [
    `upsertRecord with two where keys`,
    (c) =>
      c.upsertRecord({ $set: {}, tableIdOrName, where: { a: `1`, b: `2` } }),
    `Airtable upsertRecord expected 'where' to have exactly one key-value pair`,
  ],
  [
    `upsertRecord with a zero where value`,
    (c) => c.upsertRecord({ $set: {}, tableIdOrName, where: { Count: 0 } }),
    `Airtable upsertRecord expected 'where' to have a truthy key and value`,
  ],
  [
    `upsertRecord with $set including the where key`,
    (c) =>
      c.upsertRecord({
        $set: { Email: `a@example.com`, Name: `A` },
        tableIdOrName,
        where: { Email: `a@example.com` },
      }),
    `Airtable upsertRecord '$set' should not include the 'where' key 'Email'`,
  ],
  [
    `upsertRecord with an empty table name`,
    (c) => c.upsertRecord({ $set: {}, tableIdOrName: ``, where: { a: `1` } }),
    `Airtable upsertRecord expected 'tableIdOrName' to be a non-empty string`,
  ],
];

describe.each([
  [`createRecord`, createRecordCases],
  [`getRecord & deleteRecord`, getAndDeleteCases],
  [`updateRecord`, updateRecordCases],
  [`findFirst`, findFirstCases],
  [`findMany`, findManyCases],
  [`upsertRecord`, upsertRecordCases],
])(`%s argument validation`, (group, cases) => {
  it.each(cases)(
    `rejects %s before any request`,
    async (label, call, message) => {
      const { client, requests } = createClient();

      const promise = call(client);

      await expect(promise).rejects.toThrow(TypeError);
      await expect(promise).rejects.toThrow(message);
      expect(requests, `${group}: ${label}`).toHaveLength(0);
    },
  );
});

describe(`accepted edge-case options`, () => {
  it(`accepts a lowercase update method & sends it uppercased`, async () => {
    const { client, requests } = createClient(json(makeRecord()));

    await client.updateRecord({
      fields: {},
      method: loose(`put`),
      recordId,
      tableIdOrName,
    });

    expect(requests[0]?.method).toBe(`PUT`);
  });

  it(`treats null maxRecords & modifiedSinceHours as "not given"`, async () => {
    const { client, requests } = createClient(json({ records: [] }));

    await client.findMany({
      maxRecords: null,
      modifiedSinceHours: null,
      tableIdOrName,
    });

    expect(requests[0]?.body).toStrictEqual({});
  });

  it(`builds a lastModifiedTime formula from modifiedSinceHours`, async () => {
    const { client, requests } = createClient(json({ records: [] }));

    await client.findMany({ modifiedSinceHours: 6, tableIdOrName });

    expect(requests[0]?.body).toStrictEqual({
      filterByFormula: `{lastModifiedTime}>=DATETIME_FORMAT(DATEADD(NOW(),-6,'hours'))`,
    });
  });
});
