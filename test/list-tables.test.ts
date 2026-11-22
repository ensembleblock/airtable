/**
 * listTables: GET {baseUrl}/meta/bases/{baseId}/tables
 * @see https://airtable.com/developers/web/api/get-base-schema
 */

import { describe, expect, it } from 'vitest';

import type { AirtableTable } from '../src/index.js';
import { AirtableClient, AirtableError } from '../src/index.js';
import {
  apiKey,
  baseId,
  createClient,
  createMockFetch,
  json,
  text,
} from './helpers.js';

/** Modeled on the example response in Airtable's "Get base schema" docs. */
const schema = () => ({
  tables: [
    {
      description: `Apartments to track.`,
      fields: [
        {
          description: `Name of the apartment`,
          id: `fld1VnoyuotSTyxW1`,
          name: `Name`,
          type: `singleLineText`,
        },
        {
          id: `fldoaIqdn5szURHpw`,
          name: `Pictures`,
          options: { isReversed: false },
          type: `multipleAttachments`,
        },
        {
          id: `fldumZe00w09RYTW6`,
          name: `District`,
          options: {
            inverseLinkFieldId: `fldWnCJlo2z6ttT8Y`,
            isReversed: false,
            linkedTableId: `tblK6MZHez0ZvBChZ`,
            prefersSingleRecordLink: true,
          },
          type: `multipleRecordLinks`,
        },
      ],
      id: `tbltp8DGLhqbUmjK1`,
      name: `Apartments`,
      primaryFieldId: `fld1VnoyuotSTyxW1`,
      views: [{ id: `viwQpsuEDqHFqegkp`, name: `Grid view`, type: `grid` }],
    },
    {
      fields: [
        { id: `fldEVzvQOoULO38yl`, name: `Name`, type: `singleLineText` },
        {
          id: `fldWnCJlo2z6ttT8Y`,
          name: `Apartments`,
          options: {
            inverseLinkFieldId: `fldumZe00w09RYTW6`,
            isReversed: false,
            linkedTableId: `tbltp8DGLhqbUmjK1`,
            prefersSingleRecordLink: false,
          },
          type: `multipleRecordLinks`,
        },
      ],
      id: `tblK6MZHez0ZvBChZ`,
      name: `Districts`,
      primaryFieldId: `fldEVzvQOoULO38yl`,
      views: [
        { id: `viwi3KXvrKug2mIBS`, name: `District views`, type: `grid` },
      ],
    },
  ],
});

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

describe(`listTables`, () => {
  it(`GETs the base schema and returns the tables with fields & views`, async () => {
    const { client, requests } = createClient(json(schema()));

    const tables: AirtableTable[] = await client.listTables();

    expect(tables).toStrictEqual(schema().tables);
    expect(requests).toHaveLength(1);

    const [request] = requests;

    expect(request?.method).toBe(`GET`);
    expect(request?.url).toBe(
      `https://api.airtable.com/v0/meta/bases/app_mock_123456789/tables`,
    );
    expect(request?.body).toBe(null);
    expect(request?.headers[`authorization`]).toBe(`Bearer pat_mock_123456789`);
  });

  it(`gives typed access to tables, fields, and views`, async () => {
    const { client } = createClient(json(schema()));

    const tables: AirtableTable[] = await client.listTables();

    const apartments: AirtableTable | undefined = tables.find(
      (table) => table.name === `Apartments`,
    );

    expect(apartments?.fields.map((field) => field.name)).toStrictEqual([
      `Name`,
      `Pictures`,
      `District`,
    ]);
    expect(apartments?.views[0]?.type).toBe(`grid`);
    expect(apartments?.fields[2]?.options?.[`linkedTableId`]).toBe(
      `tblK6MZHez0ZvBChZ`,
    );
  });

  it(`preserves unknown properties and unknown field/view types`, async () => {
    const future = {
      tables: [
        {
          fields: [
            {
              id: `fldFuture00000001`,
              name: `Magic`,
              newProperty: 1,
              options: { anything: [`goes`] },
              type: `someFutureFieldType`,
            },
          ],
          id: `tblFuture00000001`,
          name: `Future`,
          newTableProperty: { nested: true },
          primaryFieldId: `fldFuture00000001`,
          views: [
            { id: `viwFuture00000001`, name: `Map`, type: `someFutureView` },
          ],
        },
      ],
    };
    const { client } = createClient(json(future));

    await expect(client.listTables()).resolves.toStrictEqual(future.tables);
  });

  it(`returns an empty array for a base without tables`, async () => {
    const { client } = createClient(json({ tables: [] }));

    await expect(client.listTables()).resolves.toStrictEqual([]);
  });

  it(`builds the metadata URL from a custom baseUrl, including a proxy path`, async () => {
    const { fetch, requests } = createMockFetch(json(schema()));
    const client = new AirtableClient({
      apiKey,
      baseId,
      baseUrl: `https://proxy.example.com/airtable/v0`,
      fetch,
    });

    await client.listTables();

    expect(requests[0]?.url).toBe(
      `https://proxy.example.com/airtable/v0/meta/bases/app_mock_123456789/tables`,
    );
  });

  it(`throws AirtableError when the token lacks the scope or base access (403)`, async () => {
    const body = {
      error: {
        message: `Invalid permissions, or the requested model was not found. Check that both your user and your token have the required permissions, and that the model names and/or ids are correct.`,
        type: `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`,
      },
    };
    const { client } = createClient(
      json(body, { status: 403, statusText: `Forbidden` }),
    );

    const err = await catchAirtableError(client.listTables());

    expect(err.status).toBe(403);
    expect(err.type).toBe(`INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`);
    expect(err.body).toStrictEqual(body);
    expect(err.message).toMatch(
      /^Airtable listTables failed with HTTP status 403 Forbidden \(INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND: Invalid permissions/u,
    );
  });

  it.each([
    [
      401,
      {
        error: {
          message: `Authentication required`,
          type: `AUTHENTICATION_REQUIRED`,
        },
      },
      `AUTHENTICATION_REQUIRED`,
    ],
    [404, { error: `NOT_FOUND` }, `NOT_FOUND`],
  ])(`throws AirtableError for HTTP %i`, async (status, body, type) => {
    const { client } = createClient(json(body, { status }));

    const err: AirtableError = await catchAirtableError(client.listTables());

    expect(err.status).toBe(status);
    expect(err.type).toBe(type);
  });

  it.each([
    { description: `an empty object`, response: () => json({}) },
    {
      description: `a non-string table description`,
      response: () =>
        json({ tables: [{ ...schema().tables[0], description: 42 }] }),
    },
    {
      description: `a non-string field description`,
      response: () =>
        json({
          tables: [
            {
              ...schema().tables[0],
              fields: [
                { description: false, id: `fldX`, name: `X`, type: `number` },
              ],
            },
          ],
        }),
    },
    { description: `a bare array`, response: () => json(schema().tables) },
    { description: `tables: null`, response: () => json({ tables: null }) },
    {
      description: `a table without fields`,
      response: () =>
        json({
          tables: [
            {
              id: `tblX0000000000001`,
              name: `X`,
              primaryFieldId: `fldX0000000000001`,
              views: [],
            },
          ],
        }),
    },
    {
      description: `a field without a type`,
      response: () =>
        json({
          tables: [
            {
              fields: [{ id: `fldX0000000000001`, name: `X` }],
              id: `tblX0000000000001`,
              name: `X`,
              primaryFieldId: `fldX0000000000001`,
              views: [],
            },
          ],
        }),
    },
    {
      description: `a view with a malformed ID`,
      response: () =>
        json({
          tables: [
            {
              fields: [],
              id: `tblX0000000000001`,
              name: `X`,
              primaryFieldId: `fldX0000000000001`,
              views: [{ id: `nope`, name: `Grid`, type: `grid` }],
            },
          ],
        }),
    },
    { description: `a non-JSON body`, response: () => text(`<html>ok</html>`) },
  ])(
    `rejects a malformed 2xx response ($description)`,
    async ({ response }) => {
      const { client } = createClient(response());

      const err: AirtableError = await catchAirtableError(client.listTables());

      expect(err.status).toBe(200);
      expect(err.message).toContain(
        `Airtable listTables received a malformed response`,
      );
    },
  );
});
