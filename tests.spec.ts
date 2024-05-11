import { beforeEach, describe, expect, it, vi } from 'vitest';
import createFetchMock from 'vitest-fetch-mock';

import type { FindManyOpts } from './dist';
import { AirtableClient } from './dist';

const fetchMock = createFetchMock(vi);

// Set `globalThis.fetch` to our mocked version.
fetchMock.enableMocks();

const apiKey = `pat_mock_123456789`;
const baseId = `app_mock_123456789`;
const recordId = `rec_mock_123456789`;
const tableIdOrName = `table_mock`;

const expectedHeaders = new Headers({
  Authorization: `Bearer pat_mock_123456789`,
  'Content-Type': `application/json`,
});

const getClient = () => new AirtableClient({ apiKey, baseId });

const parseBody = (body) =>
  body ? JSON.parse(Buffer.from(body).toString()) : null;

describe(`AirtableClient`, () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it(`createRecord`, async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ createRecordResponse: true }));

    const client: AirtableClient = getClient();
    const res = await client.createRecord({
      fields: { foo: `bar` },
      tableIdOrName,
    });

    expect(res.data).toStrictEqual({ createRecordResponse: true });
    expect(fetchMock.requests().length).toBe(1);

    const { body, headers, method, url } = fetchMock.requests()[0];

    expect(parseBody(body)).toStrictEqual({ fields: { foo: `bar` } });
    expect(headers).toStrictEqual(expectedHeaders);
    expect(method).toBe(`POST`);
    expect(url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock`,
    );
  });

  it(`findMany with no optional options`, async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        records: [
          {
            fields: { foo: `bar` },
            id: `rec_mock_123456789`,
          },
        ],
      }),
    );

    const client: AirtableClient = getClient();

    const opts: FindManyOpts = { tableIdOrName };
    const res = await client.findMany(opts);

    expect(res).toStrictEqual([{ foo: `bar` }]);
    expect(fetchMock.requests().length).toBe(1);

    const { body, headers, method, url } = fetchMock.requests()[0];

    // Since we didn't pass any optional options,
    // the POST body should have been an empty object.
    expect(parseBody(body)).toStrictEqual({});

    expect(headers).toStrictEqual(expectedHeaders);
    expect(method).toBe(`POST`);
    expect(url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/listRecords`,
    );
  });

  it(`getRecord`, async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ getRecordResponse: true }));

    const client: AirtableClient = getClient();
    const res = await client.getRecord({ recordId, tableIdOrName });

    expect(res.data).toStrictEqual({ getRecordResponse: true });
    expect(fetchMock.requests().length).toBe(1);

    const { body, headers, method, url } = fetchMock.requests()[0];

    expect(parseBody(body)).toBe(null);
    expect(headers).toStrictEqual(expectedHeaders);
    expect(method).toBe(`GET`);
    expect(url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/rec_mock_123456789`,
    );
  });

  it(`updateRecord`, async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ updateRecordResponse: true }));

    const client: AirtableClient = getClient();
    const res = await client.updateRecord({
      fields: { foo: `bar` },
      recordId,
      tableIdOrName,
    });

    expect(res.data).toStrictEqual({ updateRecordResponse: true });
    expect(fetchMock.requests().length).toBe(1);

    const { body, headers, method, url } = fetchMock.requests()[0];

    expect(parseBody(body)).toStrictEqual({ fields: { foo: `bar` } });
    expect(headers).toStrictEqual(expectedHeaders);
    expect(method).toBe(`PATCH`);
    expect(url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/rec_mock_123456789`,
    );
  });
});
