import { beforeEach, describe, expect, it, vi } from 'vitest';
import createFetchMock from 'vitest-fetch-mock';

import { AirtableClient } from './dist';

const fetchMocker = createFetchMock(vi);

// Sets `globalThis.fetch` & `globalThis.fetchMock` to our mocked version.
fetchMocker.enableMocks();

const getClient = () =>
  new AirtableClient({
    apiKey: `pat_mock_123456789`,
    baseId: `app_mock_123456789`,
  });

describe(`AirtableClient`, () => {
  beforeEach(() => {
    fetchMocker.resetMocks();
  });

  it(`createRecord`, async () => {
    const client = getClient();

    fetchMocker.mockResponseOnce(JSON.stringify({ response: true }));

    const res = await client.createRecord({
      fields: { foo: `bar` },
      tableIdOrName: `table_mock`,
    });

    expect(res.data).toEqual({ response: true });

    expect(fetchMocker.requests().length).toEqual(1);

    const request = fetchMocker.requests()[0];

    expect(request.method).toEqual(`POST`);

    expect(request.url).toEqual(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock`,
    );

    const requestBody = request.body
      ? // @ts-expect-error
        JSON.parse(Buffer.from(request.body).toString())
      : null;

    expect(requestBody).toEqual({ fields: { foo: `bar` } });
  });
});
