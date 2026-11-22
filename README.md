# @ensembleblock/airtable

[![npm version](https://img.shields.io/npm/v/@ensembleblock/airtable)](https://www.npmjs.com/package/@ensembleblock/airtable)
[![CI](https://github.com/ensembleblock/airtable/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ensembleblock/airtable/actions/workflows/ci.yml)
[![coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](./vitest.config.js)
[![types: included](https://img.shields.io/badge/types-included-blue)](#types)
[![license: MIT](https://img.shields.io/npm/l/@ensembleblock/airtable)](./LICENSE)

**A small, typed Airtable client built on `fetch`, with zero runtime dependencies.**

- **Zero runtime dependencies.** It uses the platform's `fetch`, or one you provide. Nothing else gets installed.
- **100% test coverage, enforced in CI.** Every line and branch is tested, and the build fails if coverage drops. CI also installs the packed tarball and tests it on Node.js 22.12.0 through 26.
- **Errors you can act on.** `AirtableError` carries the HTTP status, Airtable's error type, and the response body. A malformed response is never reported as a success.
- **Safe by default.** `where` values are escaped, so input like `O'Brien` can't break a formula or inject code into it. Table names and record IDs are URL-encoded for you.
- **Built-in throttling** keeps you within Airtable's limit of 5 requests per second per base.
- **TypeScript-first.** It ships declarations for every method, option, and response.
- **Helpers** such as `findFirst` and `upsertRecord`, plus `findMany` pagination, alongside the basic record operations.

## Requirements

- Node.js **22.12.0 or later**.
- Works with both `import` and `require()`. The package is ESM; CommonJS callers load it through Node's `require(esm)` support. Node 22.12.0 prints an `ExperimentalWarning` when `require()` loads it; later 22.x releases and Node 24+ don't.

## Installation

```bash
npm install @ensembleblock/airtable
```

## Quick start

```ts
import { AirtableClient } from '@ensembleblock/airtable';

const client = new AirtableClient({
  apiKey: process.env.AIRTABLE_TOKEN!, // the constructor throws if it's missing
  baseId: 'appXXXXXXXXXXXXXX',
});

// Read: the first matching record's fields, or `null`.
const contact = await client.findFirst({
  tableIdOrName: 'Contacts',
  where: { Email: 'jane@example.com' },
});

// Write: update the matching record, or create it if none exists.
const { upsertResult } = await client.upsertRecord({
  tableIdOrName: 'Contacts',
  where: { Email: 'jane@example.com' },
  $set: { Name: 'Jane Doe', Status: 'Active' },
});
// 'RECORD_CREATED' | 'RECORD_UPDATED' | 'RECORD_UNCHANGED'
```

## Authentication & scopes

Create a [personal access token](https://airtable.com/create/tokens) that has access to your base and the scopes for the methods you call:

| Method                                      | Required scope(s)                          |
| ------------------------------------------- | ------------------------------------------ |
| `findMany`, `findFirst`, `getRecord`        | `data.records:read`                        |
| `createRecord`, `updateRecord`              | `data.records:write`                       |
| `deleteRecord`                              | `data.records:write`                       |
| `upsertRecord`                              | `data.records:read` & `data.records:write` |
| `listTables` (Airtable's "Get base schema") | `schema.bases:read`                        |

The token also needs access to the base itself. Airtable returns `403` for a missing scope and for missing base access alike.

## API

### `new AirtableClient(options)`

| Option    | Type           | Description                                                                                                                                                  |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiKey`  | `string`       | **Required.** Your Airtable token.                                                                                                                           |
| `baseId`  | `string`       | **Required.** The base ID (begins with `app`).                                                                                                               |
| `baseUrl` | `string`       | Optional API root, without a trailing slash. Defaults to `https://api.airtable.com/v0`. A proxy path is fine (e.g. `https://proxy.example.com/airtable/v0`). |
| `fetch`   | `typeof fetch` | Optional `fetch` implementation (instrumentation, tests). Defaults to the global `fetch`, looked up at request time.                                         |

Table names are passed **raw**: `'Q1 / Q2 Leads'`, not `'Q1%20%2F%20Q2%20Leads'`. The client percent-encodes `tableIdOrName` and `recordId` itself. Use the table ID (`tbl…`) for a table named exactly `.` or `..`, since URL parsers normalize those path segments.

### Records

#### `createRecord({ tableIdOrName, fields }): Promise<AirtableResponse>`

```ts
const res = await client.createRecord({
  tableIdOrName: 'Contacts',
  fields: { Name: 'Jane Doe', Age: 30 },
});

if (res.ok) {
  console.log(res.data.id); // 'rec…'
} else {
  console.error(res.status, res.data); // Airtable's error body
}
```

#### `getRecord({ tableIdOrName, recordId }): Promise<AirtableResponse>`

```ts
const res = await client.getRecord({ tableIdOrName: 'Contacts', recordId });

if (res.ok) {
  console.log(res.data.fields);
}
```

Airtable omits "empty" fields (e.g. `""`, `[]`, `false`) from records.

#### `updateRecord({ tableIdOrName, recordId, fields, method? }): Promise<AirtableResponse>`

`method` defaults to `'PATCH'`, which updates only the given fields. `'PUT'` clears every field you don't specify.

```ts
const res = await client.updateRecord({
  tableIdOrName: 'Contacts',
  recordId,
  fields: { Age: 31 },
});
```

#### `deleteRecord({ tableIdOrName, recordId }): Promise<DeletedRecord>`

Deletes a single record and resolves to Airtable's confirmation, `{ deleted: true, id }`. It **throws** `AirtableError` for any non-2xx response, so you decide how to treat a missing record:

```ts
import { AirtableError } from '@ensembleblock/airtable';

try {
  await client.deleteRecord({ tableIdOrName: 'Contacts', recordId });
} catch (err) {
  if (err instanceof AirtableError && err.status === 404) {
    // The record doesn't exist (or was already deleted).
  } else {
    throw err;
  }
}
```

#### `findMany(options): Promise<FieldsObj[]>`

Retrieves matching records, following Airtable's pagination. Each record is returned as its fields object.

```ts
const contacts = await client.findMany({
  tableIdOrName: 'Contacts',
  fields: ['Name', 'Email'], // optional: limit the fields returned
  filterByFormula: `{Status} = "Active"`, // optional; passed to Airtable verbatim
  maxRecords: 100, // optional: total across all pages (like SQL LIMIT)
  includeAirtableId: true, // optional: add each record's ID as `_airtableId`
});
```

`modifiedSinceHours: number` limits results to records modified within that many hours. It relies on a `lastModifiedTime` field in your table and can't be combined with `filterByFormula`.

With `includeAirtableId`, `_airtableId` is always the record's real ID, even if your table has a field with that name.

#### `findFirst({ tableIdOrName, where, fields?, includeAirtableId? }): Promise<FieldsObj | null>`

Returns the first record whose field equals the given value, or `null`.

```ts
const contact = await client.findFirst({
  tableIdOrName: 'Contacts',
  where: { Email: 'jane@example.com' },
  includeAirtableId: true,
});
```

- `where` must have exactly one key-value pair, and both the key and the value must be truthy.
- The value is compared as a string. The client escapes quotes and backslashes, so values like `O'Brien` or `say "hi"` are safe.
- Use a field name without braces for structured lookups. Airtable requires field names in [filterByFormula](https://support.airtable.com/docs/airtable-web-api-using-filterbyformula-or-sort-parameters).

#### `upsertRecord({ tableIdOrName, where, $set }): Promise<{ _airtableId, upsertResult }>`

Finds the first record matching `where` and updates it with `$set`, or creates a record with `{ ...$set, ...where }` if none matches.

```ts
const { _airtableId, upsertResult } = await client.upsertRecord({
  tableIdOrName: 'Contacts',
  where: { Email: 'jane@example.com' },
  $set: { Name: 'Jane Doe', Age: 31 },
});
// upsertResult: 'RECORD_CREATED' | 'RECORD_UPDATED' | 'RECORD_UNCHANGED'
```

- Only fields whose values actually changed are sent in the update.
- `where` follows the same rules as `findFirst`, and `$set` must not include the `where` key.
- An upsert is a read followed by a write, **not** an atomic operation. Concurrent upserts for the same `where` value can both find nothing and both create a record.
- Throws `AirtableError` if the lookup, create, or update fails. A failed or malformed lookup never leads to a create.

### Schema

#### `listTables(): Promise<AirtableTable[]>`

Lists the tables in the client's base, with each table's fields and views (Airtable's [Get base schema](https://airtable.com/developers/web/api/get-base-schema) endpoint). Requires the `schema.bases:read` scope.

```ts
const tables = await client.listTables();

for (const table of tables) {
  console.log(table.id, table.name);

  for (const field of table.fields) {
    console.log(`  ${field.name}: ${field.type}`, field.options ?? '');
  }
}
```

Each `AirtableTable` has `id`, `name`, `description?`, `primaryFieldId`, `fields` (`id`, `name`, `type`, `description?`, `options?`), and `views` (`id`, `name`, `type`). Field `options` vary by field type and are left open-ended. Unknown properties and new field or view types are passed through unchanged.

This method requests `{baseUrl}/meta/bases/{baseId}/tables`. If you use a custom `baseUrl` (for example, a proxy), it must also forward `/meta/` paths.

## Error handling

The single-record CRUD methods resolve with a result envelope you check, much like `fetch`'s `Response`. The other methods throw:

| Methods                                                               | Non-2xx HTTP response                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `createRecord`, `getRecord`, `updateRecord`                           | **Resolve** with `{ ok: false, status, statusText, data }`. Check `res.ok`. |
| `deleteRecord`, `listTables`, `findMany`, `findFirst`, `upsertRecord` | **Throw** `AirtableError`.                                                  |

`AirtableResponse` is a discriminated union. Narrow it with `ok` before reading `data`:

```ts
const res = await client.getRecord({ tableIdOrName: 'Contacts', recordId });

res.data.id; // ❌ type error: `data` is `unknown` until `ok` is checked

if (res.ok) {
  res.data.id; // ✅ `data` is an `AirtableRecord`
} else {
  res.data; // `unknown`: Airtable's error body (raw text or `null` if it wasn't JSON)
}
```

`AirtableError` extends `Error` and adds:

| Property     | Type             | Description                                                                          |
| ------------ | ---------------- | ------------------------------------------------------------------------------------ |
| `status`     | `number`         | HTTP status code.                                                                    |
| `statusText` | `string`         | HTTP status text (may be empty).                                                     |
| `type`       | `string \| null` | Airtable's error type, e.g. `NOT_FOUND` or `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`. |
| `body`       | `unknown`        | The parsed JSON body, the raw text if it wasn't JSON, or `null` if empty.            |

Airtable's error message, when present, is included in `err.message`.

**Malformed responses.** All methods reject with `AirtableError` when a 2xx response isn't the shape they rely on, such as a record without an `id`. A malformed response is never reported as a success.

**Network failures** (DNS, connection resets, aborted requests) are not wrapped. They reject with whatever `fetch` throws.

## Rate limiting

Airtable allows [5 requests per second per base](https://airtable.com/developers/web/api/rate-limits). Each client spaces the start of its requests at least 200 ms apart, in call order. It doesn't wait for earlier responses, so slow responses don't hold up later requests.

Throttling is **per client instance**. It doesn't coordinate separate clients, processes, or other users of the same base or token.

The client doesn't retry. A `429` response follows each method's normal error contract (an `ok: false` envelope or an `AirtableError` with `status === 429`). Airtable asks clients to wait 30 seconds before retrying after a `429`.

## Types

Exported types: `AirtableClientOpts`, `AirtableRecord`, `AirtableResponse`, `AirtableTable`, `AirtableField`, `AirtableFieldType`, `AirtableView`, `AirtableViewType`, `DeletedRecord`, `FieldsObj`, `CreateRecordOpts`, `DeleteRecordOpts`, `FindFirstOpts`, `FindManyOpts`, `GetRecordOpts`, `UpdateRecordOpts`, `UpsertRecordOpts`, and `UpsertResult`.

Exported values: `AirtableClient`, `AirtableError`, and `UpsertResults`.

## Migrating to 0.1.0

- **Node.js 22.12.0 or later is required.** Node 18 and 20 are end-of-life.
- **TypeScript:** narrow `AirtableResponse` with `if (res.ok)` before reading `res.data.id`. See [Error handling](#error-handling).
- `findMany`, `findFirst`, and `upsertRecord` throw `AirtableError` (a subclass of `Error`) for HTTP failures, and now also reject malformed responses instead of treating them as "no records".
- `createRecord`, `getRecord`, and `updateRecord` still resolve for non-2xx responses, but a non-JSON error body (e.g. an HTML 502 page) now resolves as `ok: false` instead of throwing a `SyntaxError`, and a malformed 2xx body rejects with `AirtableError`.
- `findFirst` and `upsertRecord` escape `where` values and reject field names containing `{` or `}`.
- Table names are percent-encoded for you. If you were pre-encoding names, pass the raw name instead.

See the [CHANGELOG](./CHANGELOG.md) for the full list of changes.

## Contributing

Contributions are welcome! Please open an issue or a pull request on [GitHub](https://github.com/ensembleblock/airtable).

```bash
npm ci
npm run check         # lint, format, typecheck, and test
npm run test:package  # pack the package and smoke-test it as a consumer
```

## License

MIT
