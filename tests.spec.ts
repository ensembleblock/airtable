import { beforeEach, describe, expect, it, vi } from 'vitest';
import createFetchMock from 'vitest-fetch-mock';

import { AirtableClient } from './dist';

const fetchMock = createFetchMock(vi);

// Set `globalThis.fetch` to our mocked version.
fetchMock.enableMocks();

const apiKey = `pat_mock_123456789`;
const baseId = `app_mock_123456789`;
const recordId = `rec_mock_123456789`;
const tableIdOrName = `table_mock`;

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

    expect(fetchMock.requests().length).toEqual(1);

    const { body, method, url } = fetchMock.requests()[0];

    expect(method).toEqual(`POST`);
    expect(url).toEqual(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock`,
    );
    expect(parseBody(body)).toEqual({ fields: { foo: `bar` } });
    expect(res.data).toEqual({ createRecordResponse: true });
  });

  it(`getRecord`, async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ getRecordResponse: true }));

    const client: AirtableClient = getClient();
    const res = await client.getRecord({ recordId, tableIdOrName });

    expect(fetchMock.requests().length).toEqual(1);

    const { body, method, url } = fetchMock.requests()[0];

    expect(method).toEqual(`GET`);
    expect(url).toEqual(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/rec_mock_123456789`,
    );
    expect(parseBody(body)).toEqual(null);
    expect(res.data).toEqual({ getRecordResponse: true });
  });

  it(`updateRecord`, async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ updateRecordResponse: true }));

    const client: AirtableClient = getClient();
    const res = await client.updateRecord({
      fields: { foo: `bar` },
      recordId,
      tableIdOrName,
    });

    expect(fetchMock.requests().length).toEqual(1);

    const { body, method, url } = fetchMock.requests()[0];

    expect(method).toEqual(`PATCH`);
    expect(url).toEqual(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/rec_mock_123456789`,
    );
    expect(parseBody(body)).toEqual({ fields: { foo: `bar` } });
    expect(res.data).toEqual({ updateRecordResponse: true });
  });
});
