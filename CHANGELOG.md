# Changelog

## 0.1.0 (2026-11-22)

### Breaking changes

- **Node.js 22.12.0 or later is required** (`engines: ">=22.12.0"`). Node 18 and 20 are end-of-life. 22.12.0 is the first 22.x release where `require()` can load ES modules without a flag.
- **TypeScript: `AirtableResponse` is now a discriminated union.** It was always possible at runtime for `createRecord`, `getRecord`, and `updateRecord` to resolve with an error body, but the type claimed `data` was always a record. Now `data` is an `AirtableRecord` only when `ok` is `true`, and `unknown` otherwise. Code that reads `res.data.id` without checking `res.ok` no longer compiles:

  ```ts
  const res = await client.getRecord({ tableIdOrName, recordId });

  // Before (compiled, but `data` could be an error body at runtime):
  console.log(res.data.id);

  // After:
  if (res.ok) {
    console.log(res.data.id);
  } else {
    console.error(res.status, res.data); // Airtable's error body
  }
  ```

- **Table names and record IDs are percent-encoded by the client.** Names containing `/`, `#`, `?`, or `%` used to produce broken URLs. If you pre-encoded names, pass the raw name instead. Names with only spaces behave as before.
- **`findFirst` & `upsertRecord` build `where` formulas safely.** Values are written as double-quoted Airtable string literals with `"` and `\` escaped. Values containing quotes previously broke the formula or could inject formula code. Field names containing `{` or `}` are rejected with a `TypeError`.

### Added

- `deleteRecord({ tableIdOrName, recordId })` deletes a single record. It resolves to `{ deleted: true, id }` and throws `AirtableError` for non-2xx responses, including `404`. Requires `data.records:write`.
- `listTables()` lists the base's tables with their fields and views (Airtable's "Get base schema"). It resolves to `AirtableTable[]` and requires `schema.bases:read`.
- `AirtableError`, which carries `status`, `statusText`, Airtable's error `type`, and the response `body`.
- New types: `AirtableTable`, `AirtableField`, `AirtableFieldType`, `AirtableView`, `AirtableViewType`, `DeleteRecordOpts`, and `DeletedRecord`.
- The optional `fetch` constructor option injects a custom `fetch` implementation.
- CommonJS support: `require('@ensembleblock/airtable')` now resolves (via Node's `require(esm)`). Previously it failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

### Fixed

- **Throttling now works for concurrent calls.** Simultaneous requests previously all started at once. Request starts from one client are now spaced at least 200 ms apart, even after a delayed event loop, without waiting on earlier responses.
- **A failed or malformed lookup can no longer cause `upsertRecord` to create a duplicate.** Every `listRecords` page is validated, and a malformed page rejects instead of being read as "no records".
- `upsertRecord` reports Airtable's actual error when its create or update is rejected. Previously it threw a cryptic "failed to retrieve a valid '\_airtableId'" error.
- `upsertRecord` always updates the matched record's real ID, even if the table has a field named `_airtableId`. With `includeAirtableId`, the real ID also takes precedence in `findMany` and `findFirst` results.
- `upsertRecord` sends only the fields that changed. It previously sent all of `$set`.
- `upsertRecord` accepts an empty `$set`.
- `maxRecords` is enforced as a total across pages.
- Non-JSON or empty response bodies (e.g. an HTML `502`) no longer throw a bare `SyntaxError`. Envelope methods resolve with `ok: false`; throwing methods throw `AirtableError`.
- A malformed 2xx response is never returned as a successful record, deletion, or table list.
- Record IDs of exactly 10 characters are accepted, matching the validation message.

### Changed

- `findMany`, `findFirst`, and `upsertRecord` throw `AirtableError` (a subclass of `Error`) instead of a plain `Error` for HTTP failures. The error messages now include Airtable's error type and message when available. Errors raised while `findFirst` or `upsertRecord` look up a record name that method rather than `findMany`.
- Network failures are passed through unchanged (not wrapped).

### Maintenance

- Dev tooling: TypeScript 6.0, Vitest 5, ESLint 9 flat config with `@percuss.io/eslint-config-ericcarraway` v9, and Prettier 3.10.
- Releases are published from GitHub Actions with npm trusted publishing (OIDC), so no npm token is stored anywhere, and every release carries a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements). `np` is no longer used. See [RELEASING.md](./RELEASING.md).
- CI tests on Node 22.x, 24.x, and 26.x. It also packs the package and smoke-tests the tarball on Node 22.12.0, 22.x, 24.x, and 26.x, and compiles ESM and CommonJS TypeScript consumers against the shipped declarations.
- `dist/` is no longer committed; it's built by the `prepare` lifecycle.
- The test suite was rewritten and split by concern. It now has 100% statement, branch, function, and line coverage, enforced by `npm run test:coverage` in `npm run check` and in CI.
- The source was split into modules (`types`, `responses`, `records`, `guards`, `throttle`, `airtable-error`). The public API is unchanged.
