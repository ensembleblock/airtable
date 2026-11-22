/* eslint no-underscore-dangle: ["error", { "allow": ["_airtableId"] }] */

/**
 * Pagination, the `maxRecords` bound, record identity (`_airtableId`),
 * and the scope of upsert updates.
 */

import { describe, expect, it } from 'vitest';

import { createClient, json, makeRecord } from './helpers.js';

const tableIdOrName = `People`;
const listUrl = `https://api.airtable.com/v0/app_mock_123456789/People/listRecords`;

const rec = (n: number, fields: Record<string, unknown> = { n }) => ({
  fields,
  id: `recRecord0000000${String(n)}`,
});

describe(`findMany pagination`, () => {
  it(`follows offsets across pages and returns every record in order`, async () => {
    const { client, requests } = createClient(
      json({ offset: `itr1/recRecord00000001`, records: [rec(1), rec(2)] }),
      json({ offset: `itr2/recRecord00000003`, records: [rec(3)] }),
      json({ records: [rec(4)] }),
    );

    const records = await client.findMany({ tableIdOrName });

    expect(records).toStrictEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
    expect(requests.map(({ body }) => body)).toStrictEqual([
      {},
      { offset: `itr1/recRecord00000001` },
      { offset: `itr2/recRecord00000003` },
    ]);
    expect(requests.every(({ url }) => url === listUrl)).toBe(true);
  });

  it(`rejects a pagination cycle before requesting an offset twice`, async () => {
    const { client, requests } = createClient(
      ...[`first`, `second`, `first`].map((offset) =>
        json({ offset, records: [] }),
      ),
    );

    await expect(client.findMany({ tableIdOrName })).rejects.toMatchObject({
      body: { offset: `first`, records: [] },
      name: `AirtableError`,
      status: 200,
    });
    expect(requests).toHaveLength(3);
  });

  it(`sends the same options with every page`, async () => {
    const { client, requests } = createClient(
      json({ offset: `itr1`, records: [rec(1)] }),
      json({ records: [rec(2)] }),
    );

    await client.findMany({
      fields: [`n`],
      filterByFormula: `{n}>0`,
      tableIdOrName,
    });

    expect(requests.map(({ body }) => body)).toStrictEqual([
      { fields: [`n`], filterByFormula: `{n}>0` },
      { fields: [`n`], filterByFormula: `{n}>0`, offset: `itr1` },
    ]);
  });

  it(`treats maxRecords as a total across pages`, async () => {
    const { client, requests } = createClient(
      json({ offset: `itr1`, records: [rec(1), rec(2)] }),
      json({ offset: `itr2`, records: [rec(3), rec(4)] }),
    );

    const records = await client.findMany({ maxRecords: 3, tableIdOrName });

    expect(records).toStrictEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);

    // Stops paginating once the bound is reached (no request for `itr2`).
    expect(requests.map(({ body }) => body)).toStrictEqual([
      { maxRecords: 3 },
      { maxRecords: 3, offset: `itr1` },
    ]);
  });

  it(`never returns more than maxRecords, even if a page has more`, async () => {
    const { client } = createClient(
      json({ offset: `itr1`, records: [rec(1), rec(2), rec(3)] }),
    );

    await expect(
      client.findMany({ maxRecords: 2, tableIdOrName }),
    ).resolves.toStrictEqual([{ n: 1 }, { n: 2 }]);
  });

  it(`rejects a malformed second page instead of returning a partial list`, async () => {
    const { client } = createClient(
      json({ offset: `itr1`, records: [rec(1)] }),
      json({ offset: `itr2` }),
    );

    await expect(client.findMany({ tableIdOrName })).rejects.toThrow(
      `Airtable findMany received a malformed response`,
    );
  });
});

describe(`_airtableId precedence`, () => {
  const decoy = `recDecoy000000000`;
  const real = `recReal0000000000`;
  const page = () =>
    json({
      records: [{ fields: { _airtableId: decoy, Name: `Jane` }, id: real }],
    });

  it(`findMany: the real record ID wins over a field named _airtableId`, async () => {
    const { client } = createClient(page());

    await expect(
      client.findMany({ includeAirtableId: true, tableIdOrName }),
    ).resolves.toStrictEqual([{ _airtableId: real, Name: `Jane` }]);
  });

  it(`findFirst: the real record ID wins over a field named _airtableId`, async () => {
    const { client } = createClient(page());

    await expect(
      client.findFirst({
        includeAirtableId: true,
        tableIdOrName,
        where: { Name: `Jane` },
      }),
    ).resolves.toStrictEqual({ _airtableId: real, Name: `Jane` });
  });

  it(`findMany without includeAirtableId returns the fields unchanged`, async () => {
    const { client } = createClient(page());

    await expect(client.findMany({ tableIdOrName })).resolves.toStrictEqual([
      { _airtableId: decoy, Name: `Jane` },
    ]);
  });

  it(`upsertRecord: updates the real record even if a field is named _airtableId`, async () => {
    const { client, requests } = createClient(
      json({
        records: [{ fields: { _airtableId: decoy, Name: `Old` }, id: real }],
      }),
      json(makeRecord({ Name: `New` }, real)),
    );

    const result = await client.upsertRecord({
      $set: { _airtableId: decoy, Name: `New` },
      tableIdOrName,
      where: { Email: `jane@example.com` },
    });

    expect(result).toStrictEqual({
      _airtableId: real,
      upsertResult: `RECORD_UPDATED`,
    });
    expect(requests[1]?.method).toBe(`PATCH`);
    expect(requests[1]?.url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/People/${real}`,
    );
    // `_airtableId` (a real field here) was unchanged, so it isn't sent.
    expect(requests[1]?.body).toStrictEqual({ fields: { Name: `New` } });
  });
});

describe(`upsertRecord update scope`, () => {
  const where = { Email: `jane@example.com` };
  const existing = () =>
    json({
      records: [{ fields: { Age: 30, Name: `Jane` }, id: `recJane0000000000` }],
    });

  it(`PATCHes only the fields whose values changed`, async () => {
    const { client, requests } = createClient(
      existing(),
      json(makeRecord({ Age: 31, Name: `Jane` }, `recJane0000000000`)),
    );

    await expect(
      client.upsertRecord({
        // `Name` is unchanged; `Nickname` is empty in both places.
        $set: { Age: 31, Name: `Jane`, Nickname: `` },
        tableIdOrName,
        where,
      }),
    ).resolves.toStrictEqual({
      _airtableId: `recJane0000000000`,
      upsertResult: `RECORD_UPDATED`,
    });

    expect(requests[0]?.body).toStrictEqual({
      fields: [`Age`, `Name`, `Nickname`],
      filterByFormula: `{Email}="jane@example.com"`,
      maxRecords: 1,
    });
    expect(requests[1]?.body).toStrictEqual({ fields: { Age: 31 } });
  });

  it(`compares compound values and sends only JSON-visible changes`, async () => {
    const date = new Date(`2026-11-21T00:00:00.000Z`);
    const { client, requests } = createClient(
      json({
        records: [
          rec(1, {
            Contact: Object.fromEntries([
              [`b`, `2`],
              [`a`, `1`],
            ]),
            Name: `keep`,
            Tags: [`A`, `B`],
            When: date.toISOString(),
          }),
        ],
      }),
      json(makeRecord()),
    );

    await client.upsertRecord({
      $set: {
        [`__proto__`]: `custom field`,
        Changed: [`C`],
        Contact: { a: `1`, b: `2` },
        // eslint-disable-next-line no-undefined -- callers may explicitly omit a value
        Name: undefined,
        Tags: [`A`, `B`],
        When: date,
      },
      tableIdOrName,
      where,
    });

    expect(requests[1]?.body).toStrictEqual({
      fields: { [`__proto__`]: `custom field`, Changed: [`C`] },
    });
  });

  it(`makes no write when nothing changed`, async () => {
    const { client, requests } = createClient(existing());

    await expect(
      client.upsertRecord({ $set: { Age: 30 }, tableIdOrName, where }),
    ).resolves.toStrictEqual({
      _airtableId: `recJane0000000000`,
      upsertResult: `RECORD_UNCHANGED`,
    });

    expect(requests).toHaveLength(1);
  });

  it(`accepts an empty $set (looks up only the where field)`, async () => {
    const { client, requests } = createClient(existing());

    await expect(
      client.upsertRecord({ $set: {}, tableIdOrName, where }),
    ).resolves.toMatchObject({ upsertResult: `RECORD_UNCHANGED` });

    expect(requests[0]?.body).toMatchObject({ fields: [`Email`] });
  });
});
