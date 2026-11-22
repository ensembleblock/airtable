/* eslint no-underscore-dangle: ["error", { "allow": ["_airtableId"] }] */

/**
 * Error contracts:
 * - createRecord/getRecord/updateRecord resolve with an `ok`-discriminated
 *   envelope for non-2xx responses, but reject a malformed 2xx body.
 * - findMany/findFirst/upsertRecord throw `AirtableError` for non-2xx
 *   responses & malformed bodies.
 * - Network failures are never wrapped.
 */

import { describe, expect, it } from 'vitest';

import type { AirtableResponse } from '../src/index.js';
import { AirtableError } from '../src/index.js';
import {
  createClient,
  json,
  makeRecord,
  recordId,
  tableIdOrName,
  text,
} from './helpers.js';

/** Await a promise that should reject with an `AirtableError`. */
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

const forbidden = {
  error: {
    message: `Invalid permissions, or the requested model was not found.`,
    type: `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`,
  },
};

describe(`AirtableResponse envelope (createRecord, getRecord, updateRecord)`, () => {
  const envelopeCalls = {
    createRecord: (client: ReturnType<typeof createClient>[`client`]) =>
      client.createRecord({ fields: { foo: `bar` }, tableIdOrName }),
    getRecord: (client: ReturnType<typeof createClient>[`client`]) =>
      client.getRecord({ recordId, tableIdOrName }),
    updateRecord: (client: ReturnType<typeof createClient>[`client`]) =>
      client.updateRecord({ fields: { foo: `bar` }, recordId, tableIdOrName }),
  };

  for (const [name, call] of Object.entries(envelopeCalls)) {
    describe(name, () => {
      it(`resolves ok: true with the record on success`, async () => {
        const { client } = createClient(json(makeRecord({ foo: `bar` })));

        await expect(call(client)).resolves.toStrictEqual({
          data: makeRecord({ foo: `bar` }),
          ok: true,
          status: 200,
          statusText: ``,
        });
      });

      it(`resolves ok: false with the error body for a non-2xx JSON response`, async () => {
        const { client } = createClient(
          json(forbidden, { status: 403, statusText: `Forbidden` }),
        );

        await expect(call(client)).resolves.toStrictEqual({
          data: forbidden,
          ok: false,
          status: 403,
          statusText: `Forbidden`,
        });
      });

      it(`keeps a 429 in the failure envelope`, async () => {
        const rateLimited = {
          error: {
            message: `Rate limit exceeded. Please try again later`,
            type: `RATE_LIMIT_REACHED`,
          },
        };
        const { client } = createClient(
          json(rateLimited, { status: 429, statusText: `Too Many Requests` }),
        );

        await expect(call(client)).resolves.toStrictEqual({
          data: rateLimited,
          ok: false,
          status: 429,
          statusText: `Too Many Requests`,
        });
      });

      it(`resolves ok: false with raw text for a non-JSON (HTML) error`, async () => {
        const { client } = createClient(
          text(`<html>Bad Gateway</html>`, {
            status: 502,
            statusText: `Bad Gateway`,
          }),
        );

        await expect(call(client)).resolves.toStrictEqual({
          data: `<html>Bad Gateway</html>`,
          ok: false,
          status: 502,
          statusText: `Bad Gateway`,
        });
      });

      it(`resolves ok: false with null data for an empty error body`, async () => {
        const { client } = createClient(
          text(``, { status: 503, statusText: `Service Unavailable` }),
        );

        await expect(call(client)).resolves.toStrictEqual({
          data: null,
          ok: false,
          status: 503,
          statusText: `Service Unavailable`,
        });
      });

      it(`rejects a malformed 2xx body instead of exposing it as a record`, async () => {
        for (const body of [{}, { id: recordId }, `<html>ok</html>`, ``]) {
          const { client } = createClient(
            typeof body === `string` ? text(body) : json(body),
          );

          const err = await catchAirtableError(call(client));

          expect(err.status).toBe(200);
          expect(err.message).toContain(
            `Airtable ${name} received a malformed response`,
          );
        }
      });
    });
  }

  it(`narrows 'data' by checking 'ok' (compile-time contract)`, async () => {
    const { client } = createClient(json(makeRecord({ foo: `bar` })));
    const res: AirtableResponse = await client.getRecord({
      recordId,
      tableIdOrName,
    });

    // @ts-expect-error -- `data` is `unknown` until `ok` has been checked.
    expect(res.data.id).toBe(recordId);

    if (res.ok) {
      // `data` is an `AirtableRecord` here.
      expect(res.data.id).toBe(recordId);
    }
  });
});

describe(`AirtableError (findMany & findFirst)`, () => {
  it(`preserves status, Airtable's type & message, and the body`, async () => {
    const { client } = createClient(
      json(forbidden, { status: 403, statusText: `Forbidden` }),
    );

    const err = await catchAirtableError(client.findMany({ tableIdOrName }));

    expect(err.name).toBe(`AirtableError`);
    expect(err.status).toBe(403);
    expect(err.statusText).toBe(`Forbidden`);
    expect(err.type).toBe(`INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`);
    expect(err.body).toStrictEqual(forbidden);
    expect(err.message).toBe(
      `Airtable findMany failed with HTTP status 403 Forbidden (INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND: Invalid permissions, or the requested model was not found.)`,
    );
  });

  it(`handles Airtable's string error shape`, async () => {
    const { client } = createClient(
      json({ error: `NOT_FOUND` }, { status: 404, statusText: `Not Found` }),
    );

    const err = await catchAirtableError(client.findMany({ tableIdOrName }));

    expect(err.type).toBe(`NOT_FOUND`);
    expect(err.message).toBe(
      `Airtable findMany failed with HTTP status 404 Not Found (NOT_FOUND)`,
    );
  });

  it(`handles HTML & empty error bodies`, async () => {
    const { client } = createClient(
      text(`<html>Bad Gateway</html>`, {
        status: 502,
        statusText: `Bad Gateway`,
      }),
      text(``, { status: 503 }),
    );

    const htmlErr = await catchAirtableError(
      client.findMany({ tableIdOrName }),
    );

    expect(htmlErr.status).toBe(502);
    expect(htmlErr.type).toBe(null);
    expect(htmlErr.body).toBe(`<html>Bad Gateway</html>`);
    expect(htmlErr.message).toBe(
      `Airtable findMany failed with HTTP status 502 Bad Gateway`,
    );

    const emptyErr = await catchAirtableError(
      client.findMany({ tableIdOrName }),
    );

    expect(emptyErr.status).toBe(503);
    expect(emptyErr.body).toBe(null);
    expect(emptyErr.message).toBe(
      `Airtable findMany failed with HTTP status 503`,
    );
  });

  it(`throws for a 429 (no automatic retry)`, async () => {
    const { client, requests } = createClient(
      json(
        {
          error: {
            message: `Rate limit exceeded.`,
            type: `RATE_LIMIT_REACHED`,
          },
        },
        { status: 429, statusText: `Too Many Requests` },
      ),
    );

    const err = await catchAirtableError(
      client.findFirst({ tableIdOrName, where: { Name: `x` } }),
    );

    expect(err.status).toBe(429);
    expect(err.type).toBe(`RATE_LIMIT_REACHED`);
    expect(requests).toHaveLength(1);
  });

  it(`rejects malformed list pages`, async () => {
    const malformedPages = [
      {},
      { records: `nope` },
      { records: [{ fields: {}, id: `not-a-record-id` }] },
      { records: [{ id: recordId }] },
      { offset: 42, records: [] },
      `<html>ok</html>`,
    ];

    for (const page of malformedPages) {
      const { client } = createClient(
        typeof page === `string` ? text(page) : json(page),
      );

      const err = await catchAirtableError(client.findMany({ tableIdOrName }));

      expect(err.status).toBe(200);
      expect(err.message).toContain(
        `Airtable findMany received a malformed response`,
      );
    }
  });
});

describe(`network failures`, () => {
  it(`are not wrapped`, async () => {
    const networkError = new TypeError(`fetch failed`);
    const { client } = createClient(() => Promise.reject(networkError));

    await expect(client.getRecord({ recordId, tableIdOrName })).rejects.toBe(
      networkError,
    );
  });

  it(`are not wrapped by throwing methods either`, async () => {
    const networkError = new TypeError(`fetch failed`);
    const { client } = createClient(() => Promise.reject(networkError));

    await expect(client.findMany({ tableIdOrName })).rejects.toBe(networkError);
  });
});

describe(`upsertRecord: failed reads never cause a write`, () => {
  const where = { Email: `jane@example.com` };
  const $set = { Name: `Jane` };

  it(`rejects a malformed lookup page with zero mutation requests`, async () => {
    const { client, requests } = createClient(json({}));

    const err = await catchAirtableError(
      client.upsertRecord({ $set, tableIdOrName, where }),
    );

    expect(err.message).toContain(`malformed response`);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toMatch(/\/listRecords$/u);
  });

  it(`rejects a failed lookup with zero mutation requests`, async () => {
    const { client, requests } = createClient(
      json(forbidden, { status: 403, statusText: `Forbidden` }),
    );

    const err = await catchAirtableError(
      client.upsertRecord({ $set, tableIdOrName, where }),
    );

    expect(err.status).toBe(403);
    expect(requests).toHaveLength(1);
  });

  it(`creates a record after a valid, empty lookup`, async () => {
    const created = makeRecord({ ...$set, ...where }, `recCreated0000001`);
    const { client, requests } = createClient(
      json({ records: [] }),
      json(created),
    );

    await expect(
      client.upsertRecord({ $set, tableIdOrName, where }),
    ).resolves.toStrictEqual({
      _airtableId: `recCreated0000001`,
      upsertResult: `RECORD_CREATED`,
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]?.method).toBe(`POST`);
    expect(requests[1]?.body).toStrictEqual({
      fields: { Email: `jane@example.com`, Name: `Jane` },
    });
  });

  it(`preserves Airtable's error when the create is rejected`, async () => {
    const invalid = {
      error: {
        message: `Field "Name" cannot accept the provided value`,
        type: `INVALID_VALUE_FOR_COLUMN`,
      },
    };
    const { client } = createClient(
      json({ records: [] }),
      json(invalid, { status: 422, statusText: `Unprocessable Entity` }),
    );

    const err = await catchAirtableError(
      client.upsertRecord({ $set, tableIdOrName, where }),
    );

    expect(err.status).toBe(422);
    expect(err.type).toBe(`INVALID_VALUE_FOR_COLUMN`);
    expect(err.body).toStrictEqual(invalid);
    expect(err.message).toBe(
      `Airtable upsertRecord (create) failed with HTTP status 422 Unprocessable Entity (INVALID_VALUE_FOR_COLUMN: Field "Name" cannot accept the provided value)`,
    );
  });

  it(`preserves Airtable's error when the PATCH is rejected`, async () => {
    const invalid = {
      error: {
        message: `Unknown field name: "Name"`,
        type: `UNKNOWN_FIELD_NAME`,
      },
    };
    const { client, requests } = createClient(
      json({ records: [{ fields: { Name: `Old` }, id: recordId }] }),
      json(invalid, { status: 422, statusText: `Unprocessable Entity` }),
    );

    const err = await catchAirtableError(
      client.upsertRecord({ $set, tableIdOrName, where }),
    );

    expect(requests[1]?.method).toBe(`PATCH`);
    expect(err.status).toBe(422);
    expect(err.type).toBe(`UNKNOWN_FIELD_NAME`);
    expect(err.message).toBe(
      `Airtable upsertRecord (update) failed with HTTP status 422 Unprocessable Entity (UNKNOWN_FIELD_NAME: Unknown field name: "Name")`,
    );
  });
});
