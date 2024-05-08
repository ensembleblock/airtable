import { beforeEach, describe, expect, it, vi } from 'vitest';
import createFetchMock from 'vitest-fetch-mock';

import { AirtableClient } from './dist';

const fetchMock = createFetchMock(vi);

// Set `globalThis.fetch` to our mocked version.
fetchMock.enableMocks();

const getClient = () =>
  new AirtableClient({
    apiKey: `pat_mock_123456789`,
    baseId: `app_mock_123456789`,
  });

const parseBody = (body) =>
  body ? JSON.parse(Buffer.from(body).toString()) : null;

describe(`AirtableClient`, () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it(`createRecord`, async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ createRecordResponse: true }));

    const client = getClient();
    const res = await client.createRecord({
      fields: { foo: `bar` },
      tableIdOrName: `table_mock`,
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
});
