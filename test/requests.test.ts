/**
 * Request construction: URL encoding, custom `baseUrl` prefixes,
 * and formula building for structured `where` values.
 */

import { describe, expect, it } from 'vitest';

import { AirtableClient } from '../src/index.js';
import {
  apiKey,
  baseId,
  createClient,
  createMockFetch,
  json,
  makeRecord,
  recordId,
} from './helpers.js';

const awkwardTable = `Q1/Q2 #notes? 50%`;
const encodedAwkwardTable = `Q1%2FQ2%20%23notes%3F%2050%25`;
const base = `https://api.airtable.com/v0/app_mock_123456789`;

describe(`URL construction`, () => {
  it(`encodes raw table names exactly once in every record URL`, async () => {
    const { client, requests } = createClient(
      json(makeRecord()),
      json(makeRecord()),
      json(makeRecord()),
      json({ records: [] }),
    );

    await client.createRecord({ fields: {}, tableIdOrName: awkwardTable });
    await client.getRecord({ recordId, tableIdOrName: awkwardTable });
    await client.updateRecord({
      fields: {},
      recordId,
      tableIdOrName: awkwardTable,
    });
    await client.findMany({ tableIdOrName: awkwardTable });

    expect(requests.map(({ url }) => url)).toStrictEqual([
      `${base}/${encodedAwkwardTable}`,
      `${base}/${encodedAwkwardTable}/rec_mock_123456789`,
      `${base}/${encodedAwkwardTable}/rec_mock_123456789`,
      `${base}/${encodedAwkwardTable}/listRecords`,
    ]);
  });

  it(`treats an already percent-encoded name as a raw name`, async () => {
    const { client, requests } = createClient(json(makeRecord()));

    await client.getRecord({ recordId, tableIdOrName: `My%20Table` });

    expect(requests[0]?.url).toBe(`${base}/My%2520Table/rec_mock_123456789`);
  });

  it.each([`.`, `..`])(
    `rejects the dot segment %s before sending a request`,
    async (tableIdOrName) => {
      const { client, requests } = createClient();

      await expect(
        client.deleteRecord({ recordId, tableIdOrName }),
      ).rejects.toThrow(`Use the table ID`);
      expect(requests).toHaveLength(0);
    },
  );

  it(`keeps a plain table name or table ID unchanged`, async () => {
    const { client, requests } = createClient(json(makeRecord()));

    await client.getRecord({ recordId, tableIdOrName: `tblAbc123` });

    expect(requests[0]?.url).toBe(`${base}/tblAbc123/rec_mock_123456789`);
  });

  it(`preserves a custom baseUrl prefix, including a proxy path`, async () => {
    const { fetch, requests } = createMockFetch(
      json(makeRecord()),
      json({ records: [] }),
    );
    const client = new AirtableClient({
      apiKey,
      baseId,
      baseUrl: `https://proxy.example.com/airtable/v0`,
      fetch,
    });

    await client.getRecord({ recordId, tableIdOrName: `Table Name` });
    await client.findMany({ tableIdOrName: `Table Name` });

    expect(requests.map(({ url }) => url)).toStrictEqual([
      `https://proxy.example.com/airtable/v0/app_mock_123456789/Table%20Name/rec_mock_123456789`,
      `https://proxy.example.com/airtable/v0/app_mock_123456789/Table%20Name/listRecords`,
    ]);
  });
});

describe(`formulas built from 'where'`, () => {
  const formulaFor = async (
    where: Record<string, boolean | number | string>,
  ): Promise<unknown> => {
    const { client, requests } = createClient(json({ records: [] }));

    await client.findFirst({ tableIdOrName: `People`, where });

    const body = requests[0]?.body as { filterByFormula?: unknown };

    return body.filterByFormula;
  };

  it.each([
    [{ Name: `O'Brien` }, `{Name}="O'Brien"`],
    [{ Name: `say "hi"` }, `{Name}="say \\"hi\\""`],
    [{ Path: `C:\\temp\\` }, `{Path}="C:\\\\temp\\\\"`],
    [{ Name: `a"} OR TRUE() OR {x}="` }, `{Name}="a\\"} OR TRUE() OR {x}=\\""`],
    [{ 'Full Name (legal) / #1': `x` }, `{Full Name (legal) / #1}="x"`],
    [{ "Owner's E-mail": `a@b.co` }, `{Owner's E-mail}="a@b.co"`],
    [{ fldAbc123: `x` }, `{fldAbc123}="x"`],
    [{ Age: 30 }, `{Age}="30"`],
    [{ Done: true }, `{Done}="true"`],
  ])(`%j -> %s`, async (where, expected) => {
    await expect(formulaFor(where)).resolves.toBe(expected);
  });

  it.each([`Weird {name}`, `closing}`, `{opening`])(
    `rejects the unrepresentable field name %j before any request`,
    async (field) => {
      const { client, requests } = createClient();

      await expect(
        client.findFirst({ tableIdOrName: `People`, where: { [field]: `x` } }),
      ).rejects.toThrow(
        `Airtable findFirst cannot reference the field '${field}' in a formula`,
      );

      await expect(
        client.upsertRecord({
          $set: { Name: `x` },
          tableIdOrName: `People`,
          where: { [field]: `x` },
        }),
      ).rejects.toThrow(TypeError);

      expect(requests).toHaveLength(0);
    },
  );

  it(`preserves a caller-supplied filterByFormula verbatim`, async () => {
    const filterByFormula = `AND({Status}='Active', {Name}="O'Brien")`;
    const { client, requests } = createClient(json({ records: [] }));

    await client.findMany({ filterByFormula, tableIdOrName: `People` });

    expect(requests[0]?.body).toStrictEqual({ filterByFormula });
  });
});
