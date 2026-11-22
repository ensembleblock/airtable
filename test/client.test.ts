import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FindFirstOpts, FindManyOpts } from '../src/index.js';
import { AirtableClient } from '../src/index.js';
import {
  apiKey,
  baseId,
  createClient,
  json,
  makeRecord,
  recordId,
  tableIdOrName,
} from './helpers.js';

const expectedHeaders = {
  authorization: `Bearer pat_mock_123456789`,
  'content-type': `application/json`,
};

describe(`AirtableClient`, () => {
  it(`createRecord`, async () => {
    const { client, requests } = createClient(json(makeRecord({ foo: `bar` })));

    const res = await client.createRecord({
      fields: { foo: `bar` },
      tableIdOrName,
    });

    expect(res.data).toStrictEqual(makeRecord({ foo: `bar` }));
    expect(requests).toHaveLength(1);

    const [request] = requests;

    expect(request?.body).toStrictEqual({ fields: { foo: `bar` } });
    expect(request?.headers).toStrictEqual(expectedHeaders);
    expect(request?.method).toBe(`POST`);
    expect(request?.url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock`,
    );
  });

  it(`findFirst`, async () => {
    const { client, requests } = createClient(
      json({
        records: [{ fields: { foo: `bar` }, id: `rec_mock_123456789` }],
      }),
    );

    const opts: FindFirstOpts = {
      fields: [`foo`],
      includeAirtableId: true,
      tableIdOrName,
      where: { foo: `bar` },
    };

    const record = await client.findFirst(opts);

    expect(record).toStrictEqual({
      _airtableId: `rec_mock_123456789`,
      foo: `bar`,
    });
    expect(requests).toHaveLength(1);

    const [request] = requests;

    expect(request?.body).toStrictEqual({
      fields: [`foo`],
      filterByFormula: `{foo}='bar'`,
      maxRecords: 1,
    });
    expect(request?.headers).toStrictEqual(expectedHeaders);
    expect(request?.method).toBe(`POST`);
    expect(request?.url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/listRecords`,
    );
  });

  it(`findMany with no optional options`, async () => {
    const { client, requests } = createClient(
      json({
        records: [{ fields: { foo: `bar` }, id: `rec_mock_123456789` }],
      }),
    );

    const opts: FindManyOpts = { tableIdOrName };
    const records = await client.findMany(opts);

    expect(records).toStrictEqual([{ foo: `bar` }]);
    expect(requests).toHaveLength(1);

    const [request] = requests;

    // Since we didn't pass any optional options,
    // the POST body should have been an empty object.
    expect(request?.body).toStrictEqual({});
    expect(request?.headers).toStrictEqual(expectedHeaders);
    expect(request?.method).toBe(`POST`);
    expect(request?.url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/listRecords`,
    );
  });

  it(`findMany with options including 'modifiedSinceHours'`, async () => {
    const { client, requests } = createClient(
      json({
        records: [
          { fields: { field_1: 23, field_2: `foo` }, id: `rec_mock123` },
          { fields: { field_1: 42, field_2: `bar` }, id: `rec_mock456` },
        ],
      }),
    );

    const opts: FindManyOpts = {
      fields: [`field_1`, `field_2`],
      includeAirtableId: true,
      maxRecords: 2,
      modifiedSinceHours: 24,
      tableIdOrName,
    };

    const records = await client.findMany(opts);

    expect(records).toStrictEqual([
      { _airtableId: `rec_mock123`, field_1: 23, field_2: `foo` },
      { _airtableId: `rec_mock456`, field_1: 42, field_2: `bar` },
    ]);
    expect(requests).toHaveLength(1);

    const [request] = requests;

    // Our expected POST body for this `listRecords` request.
    expect(request?.body).toStrictEqual({
      fields: [`field_1`, `field_2`],
      filterByFormula: `{lastModifiedTime}>=DATETIME_FORMAT(DATEADD(NOW(),-24,'hours'))`,
      maxRecords: 2,
    });
    expect(request?.headers).toStrictEqual(expectedHeaders);
    expect(request?.method).toBe(`POST`);
    expect(request?.url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/listRecords`,
    );
  });

  it(`getRecord`, async () => {
    const { client, requests } = createClient(json(makeRecord({ foo: `bar` })));

    const res = await client.getRecord({ recordId, tableIdOrName });

    expect(res.data).toStrictEqual(makeRecord({ foo: `bar` }));
    expect(requests).toHaveLength(1);

    const [request] = requests;

    expect(request?.body).toBe(null);
    expect(request?.headers).toStrictEqual(expectedHeaders);
    expect(request?.method).toBe(`GET`);
    expect(request?.url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/rec_mock_123456789`,
    );
  });

  it(`updateRecord`, async () => {
    const { client, requests } = createClient(json(makeRecord({ foo: `bar` })));

    const res = await client.updateRecord({
      fields: { foo: `bar` },
      recordId,
      tableIdOrName,
    });

    expect(res.data).toStrictEqual(makeRecord({ foo: `bar` }));
    expect(requests).toHaveLength(1);

    const [request] = requests;

    expect(request?.body).toStrictEqual({ fields: { foo: `bar` } });
    expect(request?.headers).toStrictEqual(expectedHeaders);
    expect(request?.method).toBe(`PATCH`);
    expect(request?.url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/rec_mock_123456789`,
    );
  });
});

describe(`AirtableClient 'fetch' option`, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(`uses the injected fetch instead of the global fetch`, async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal(`fetch`, globalFetch);

    const { client, requests } = createClient(json(makeRecord({ foo: `bar` })));
    const res = await client.getRecord({ recordId, tableIdOrName });

    expect(res.data).toStrictEqual(makeRecord({ foo: `bar` }));
    expect(requests).toHaveLength(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it(`falls back to the global fetch, resolved at request time`, async () => {
    // The client is constructed before the global is stubbed.
    const client = new AirtableClient({ apiKey, baseId });

    const globalFetch = vi.fn(() =>
      Promise.resolve(json(makeRecord({ foo: `bar` }))),
    );
    vi.stubGlobal(`fetch`, globalFetch);

    const res = await client.getRecord({ recordId, tableIdOrName });

    expect(res.data).toStrictEqual(makeRecord({ foo: `bar` }));
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  it(`rejects a non-function 'fetch' option`, () => {
    expect(
      () =>
        new AirtableClient({
          apiKey,
          baseId,
          fetch: `nope` as unknown as typeof fetch,
        }),
    ).toThrow(`AirtableClient expected 'fetch' to be a function when given`);
  });
});
