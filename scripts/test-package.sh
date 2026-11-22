#!/usr/bin/env bash
#
# Smoke-test the package as consumers receive it.
#
#   scripts/test-package.sh                     Pack this repo (runs the `prepare`
#                                               build), then test the tarball.
#   scripts/test-package.sh --tarball <file>    Test an existing tarball.
#   --skip-typecheck                            Skip compiling the TypeScript
#                                               consumer (needs no dev deps).
#
# The tarball is installed into a fresh consumer project outside the repo.
# Checks: the exact packed file list; `import` & `require` by package name on
# the current Node.js; and (unless skipped) compiling ESM & CommonJS
# TypeScript consumers against the shipped declarations, using this repo's
# TypeScript.

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tarball=""
typecheck=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tarball)
      tarball="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
      shift 2
      ;;
    --skip-typecheck)
      typecheck=0
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

echo "Node.js $(node --version), npm $(npm --version)"

if [[ -z "$tarball" ]]; then
  echo "Packing $repo_dir ..."
  pack_dir="$work_dir/pack"
  mkdir -p "$pack_dir"
  # `npm pack` runs the `prepare` lifecycle, which builds dist/ from source.
  (cd "$repo_dir" && npm pack --pack-destination "$pack_dir" > /dev/null)
  tarball="$(ls "$pack_dir"/*.tgz)"
fi

echo "Tarball: $tarball"

# 1. Exact packed contents.
expected_files="package/LICENSE
package/README.md
package/dist/airtable-error.d.ts
package/dist/airtable-error.js
package/dist/index.d.ts
package/dist/index.js
package/dist/types.d.ts
package/dist/types.js
package/package.json"

actual_files="$(tar -tzf "$tarball" | LC_ALL=C sort)"

if [[ "$actual_files" != "$expected_files" ]]; then
  echo "Unexpected tarball contents:" >&2
  diff <(echo "$expected_files") <(echo "$actual_files") >&2 || true
  exit 1
fi

echo "ok - tarball contains exactly the expected files"

# 2. Fresh consumer project (outside the repo), installing only the tarball.
consumer_dir="$work_dir/consumer"
mkdir -p "$consumer_dir"
cd "$consumer_dir"

cat > package.json <<'JSON'
{ "name": "airtable-consumer-smoke-test", "private": true, "version": "0.0.0" }
JSON

npm install --no-audit --no-fund --ignore-scripts --silent "$tarball"

# Shared runtime checks (no network: requests go to an injected fetch).
cat > checks.js <<'JS'
module.exports = async function runChecks({ AirtableClient, AirtableError }, label) {
  const assert = require('node:assert/strict');

  const replies = [
    [200, { deleted: true, id: 'recSmokeTest00001' }],
    [200, { tables: [] }],
    [404, { error: 'NOT_FOUND' }],
    [200, { createdTime: '2026-11-21T00:00:00.000Z', fields: {}, id: 'recSmokeTest00001' }],
  ];
  const requests = [];

  const fetch = async (url, init) => {
    requests.push(`${init.method} ${url}`);
    const [status, body] = replies.shift();

    return new Response(JSON.stringify(body), { status });
  };

  const client = new AirtableClient({
    apiKey: 'patSmokeTest00000',
    baseId: 'appSmokeTest00000',
    fetch,
  });

  assert.deepEqual(
    await client.deleteRecord({ recordId: 'recSmokeTest00001', tableIdOrName: 'My Table' }),
    { deleted: true, id: 'recSmokeTest00001' },
  );
  assert.deepEqual(await client.listTables(), []);
  await assert.rejects(
    client.deleteRecord({ recordId: 'recSmokeTest00001', tableIdOrName: 'My Table' }),
    (err) => err instanceof AirtableError && err instanceof Error && err.status === 404,
  );
  assert.equal((await client.getRecord({ recordId: 'recSmokeTest00001', tableIdOrName: 'T' })).ok, true);

  assert.deepEqual(requests, [
    'DELETE https://api.airtable.com/v0/appSmokeTest00000/My%20Table/recSmokeTest00001',
    'GET https://api.airtable.com/v0/meta/bases/appSmokeTest00000/tables',
    'DELETE https://api.airtable.com/v0/appSmokeTest00000/My%20Table/recSmokeTest00001',
    'GET https://api.airtable.com/v0/appSmokeTest00000/T/recSmokeTest00001',
  ]);

  console.log(`ok - ${label}`);
};
JS

cat > esm.mjs <<'JS'
import { createRequire } from 'node:module';

import * as pkg from '@ensembleblock/airtable';

const runChecks = createRequire(import.meta.url)('./checks.js');

await runChecks(pkg, `import '@ensembleblock/airtable' (ESM)`);
JS

cat > cjs.cjs <<'JS'
const pkg = require('@ensembleblock/airtable');
const runChecks = require('./checks.js');

runChecks(pkg, `require('@ensembleblock/airtable') (CommonJS)`).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
JS

node esm.mjs
node cjs.cjs

# 3. Compile TypeScript consumers against the shipped declarations.
if [[ "$typecheck" -eq 0 ]]; then
  echo "skip - TypeScript consumer compilation (--skip-typecheck)"
  exit 0
fi

tsc="$repo_dir/node_modules/.bin/tsc"

if [[ ! -x "$tsc" ]]; then
  echo "TypeScript not found at $tsc (run npm ci, or pass --skip-typecheck)" >&2
  exit 1
fi

cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "exactOptionalPropertyTypes": true,
    "lib": ["ES2022", "DOM"],
    "module": "nodenext",
    "noEmit": true,
    "skipLibCheck": false,
    "strict": true,
    "target": "ES2022",
    "types": []
  },
  "files": ["consumer.mts", "consumer.cts"]
}
JSON

consumer_ts='
import {
  AirtableClient,
  AirtableError,
  type AirtableField,
  type AirtableResponse,
  type AirtableTable,
  type DeletedRecord,
} from "@ensembleblock/airtable";

const client = new AirtableClient({
  apiKey: "patSmokeTest00000",
  baseId: "appSmokeTest00000",
  fetch: globalThis.fetch,
});

export async function demo(): Promise<void> {
  const res: AirtableResponse = await client.getRecord({
    recordId: "recSmokeTest00001",
    tableIdOrName: "T",
  });

  // @ts-expect-error -- `data` is `unknown` until `ok` has been checked.
  console.log(res.data.id);

  if (res.ok) {
    const id: `rec${string}` = res.data.id;
    console.log(id, res.status, res.statusText);
  } else {
    const body: unknown = res.data;
    console.log(body, res.status, res.statusText);
  }

  const deleted: DeletedRecord = await client.deleteRecord({
    recordId: "recSmokeTest00001",
    tableIdOrName: "T",
  });
  const confirmed: true = deleted.deleted;

  const tables: AirtableTable[] = await client.listTables();
  const fields: AirtableField[] = tables[0]?.fields ?? [];
  const tableId: `tbl${string}` | undefined = tables[0]?.id;
  console.log(confirmed, fields[0]?.type, fields[0]?.options, tableId);

  try {
    await client.findMany({ tableIdOrName: "T" });
  } catch (err) {
    if (err instanceof AirtableError) {
      const status: number = err.status;
      const type: string | null = err.type;
      console.log(status, type, err.body, err.message);
    }
  }
}
'

echo "$consumer_ts" > consumer.mts
echo "$consumer_ts" > consumer.cts

"$tsc" -p tsconfig.json
echo "ok - TypeScript consumers (ESM .mts & CommonJS .cts) compile against the shipped declarations"
