/**
 * deleteRecord: DELETE {baseUrl}/{baseId}/{tableIdOrName}/{recordId}
 * @see https://airtable.com/developers/web/api/delete-record
 */

import { describe, expect, it } from 'vitest';

import type { DeletedRecord } from '../src/index.js';
import { AirtableError } from '../src/index.js';
import {
  createClient,
  json,
  recordId,
  tableIdOrName,
  text,
} from './test-helpers.js';

const deleted = { deleted: true, id: recordId };

const catchAirtableError = async (
  promise: Promise<unknown>,
): Promise<AirtableError> => {
  const err: unknown = await promise.then(
    () => null,
    (error: unknown) => error,
  );

  expect(err).toBeInstanceOf(AirtableError);

  return err as AirtableError;
};

describe(`deleteRecord`, () => {
  it(`sends a DELETE to the record URL and returns Airtable's confirmation`, async () => {
    const { client, requests } = createClient(json(deleted));

    const result: DeletedRecord = await client.deleteRecord({
      recordId,
      tableIdOrName,
    });

    expect(result).toStrictEqual({ deleted: true, id: recordId });
    expect(requests).toHaveLength(1);

    const [request] = requests;

    expect(request?.method).toBe(`DELETE`);
    expect(request?.url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/table_mock/rec_mock_123456789`,
    );
    expect(request?.body).toBe(null);
    expect(request?.headers[`authorization`]).toBe(`Bearer pat_mock_123456789`);
  });

  it(`encodes the table name and record ID`, async () => {
    const { client, requests } = createClient(json(deleted));

    await client.deleteRecord({ recordId, tableIdOrName: `Leads / 2026 #1` });

    expect(requests[0]?.url).toBe(
      `https://api.airtable.com/v0/app_mock_123456789/Leads%20%2F%202026%20%231/rec_mock_123456789`,
    );
  });

  it.each([
    [
      401,
      `Unauthorized`,
      {
        error: {
          message: `Authentication required`,
          type: `AUTHENTICATION_REQUIRED`,
        },
      },
      `AUTHENTICATION_REQUIRED`,
    ],
    [
      403,
      `Forbidden`,
      {
        error: {
          message: `Invalid permissions, or the requested model was not found.`,
          type: `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`,
        },
      },
      `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`,
    ],
    [404, `Not Found`, { error: `NOT_FOUND` }, `NOT_FOUND`],
    [
      404,
      `Not Found`,
      {
        error: {
          message: `Could not find record rec_mock_123456789`,
          type: `MODEL_ID_NOT_FOUND`,
        },
      },
      `MODEL_ID_NOT_FOUND`,
    ],
  ])(
    `throws AirtableError for HTTP %i %s`,
    async (status, statusText, body, type) => {
      const { client } = createClient(json(body, { status, statusText }));

      const err: AirtableError = await catchAirtableError(
        client.deleteRecord({ recordId, tableIdOrName }),
      );

      expect(err.status).toBe(status);
      expect(err.statusText).toBe(statusText);
      expect(err.type).toBe(type);
      expect(err.body).toStrictEqual(body);
      expect(err.message).toMatch(
        new RegExp(
          `^Airtable deleteRecord failed with HTTP status ${String(status)} ${statusText} \\(${type}`,
          `u`,
        ),
      );
    },
  );

  it(`lets callers treat a missing record as already deleted`, async () => {
    const { client } = createClient(
      json({ error: `NOT_FOUND` }, { status: 404, statusText: `Not Found` }),
    );

    const deleteIfPresent = async (): Promise<boolean> => {
      try {
        await client.deleteRecord({ recordId, tableIdOrName });

        return true;
      } catch (err) {
        if (err instanceof AirtableError && err.status === 404) {
          return false;
        }

        throw err;
      }
    };

    await expect(deleteIfPresent()).resolves.toBe(false);
  });

  it(`throws for an HTML error page`, async () => {
    const { client } = createClient(
      text(`<html>Bad Gateway</html>`, {
        status: 502,
        statusText: `Bad Gateway`,
      }),
    );

    const err: AirtableError = await catchAirtableError(
      client.deleteRecord({ recordId, tableIdOrName }),
    );

    expect(err.status).toBe(502);
    expect(err.type).toBe(null);
    expect(err.body).toBe(`<html>Bad Gateway</html>`);
  });

  it.each([
    { description: `an empty object`, response: () => json({}) },
    {
      description: `deleted: false`,
      response: () => json({ deleted: false, id: recordId }),
    },
    {
      description: `a different record ID`,
      response: () => json({ deleted: true, id: `recSomethingElse0` }),
    },
    { description: `a non-JSON body`, response: () => text(`ok`) },
    { description: `an empty body`, response: () => text(``) },
  ])(
    `rejects a malformed 2xx response ($description)`,
    async ({ response }) => {
      const { client } = createClient(response());

      const err: AirtableError = await catchAirtableError(
        client.deleteRecord({ recordId, tableIdOrName }),
      );

      expect(err.status).toBe(200);
      expect(err.message).toContain(
        `Airtable deleteRecord received a malformed response`,
      );
    },
  );

  it.each([
    [{ recordId: `not-a-record`, tableIdOrName }, `'recordId'`],
    [{ recordId: `rec123`, tableIdOrName }, `'recordId'`],
    [{ recordId, tableIdOrName: `` }, `'tableIdOrName'`],
  ])(`validates %j before any request`, async (opts, param) => {
    const { client, requests } = createClient();

    await expect(client.deleteRecord(opts)).rejects.toThrow(
      `Airtable deleteRecord expected ${param}`,
    );
    expect(requests).toHaveLength(0);
  });
});
