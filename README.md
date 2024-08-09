# @ensembleblock/airtable

**Lightweight Airtable API client powered by fetch.**

## Overview

`@ensembleblock/airtable` is a minimalistic and efficient client library designed to interact with Airtable's API using modern JavaScript standards. It leverages the `fetch` API for making HTTP requests, ensuring zero runtime dependencies and offering a clean, ergonomic API with ORM-style methods for common operations like `findFirst`, `upsertRecord`, and more.

## Features

- **Zero runtime dependencies**: Pure JavaScript implementation.
- **Modern API**: Built on the `fetch` API.
- **Input validation**: Provides clear and meaningful error messages for invalid inputs.
- **Ergonomic methods**: Includes ORM-style methods such as `findFirst` and `upsertRecord` for intuitive data manipulation.
- **Customizable**: Options like `modifiedSinceHours` allow for fine-grained control over data retrieval.

## Installation

Install the package via npm:

```bash
npm install @ensembleblock/airtable
```

## Usage

### Initialization

Create an instance of `AirtableClient` with your Airtable API key and base ID:

```javascript
import { AirtableClient } from '@ensembleblock/airtable';

const client = new AirtableClient({
  apiKey: 'your_airtable_api_key',
  baseId: 'your_airtable_base_id',
});
```

### Basic Operations

#### Create a Record

```javascript
const response = await client.createRecord({
  tableIdOrName: 'Table Name',
  fields: {
    Name: 'John Doe',
    Age: 30,
  },
});
console.log(response.data);
```

#### Find the First Matching Record

```javascript
const record = await client.findFirst({
  tableIdOrName: 'Table Name',
  where: { Name: 'John Doe' },
  fields: ['Name', 'Age'],
});
console.log(record);
```

#### Upsert a Record

```javascript
const result = await client.upsertRecord({
  tableIdOrName: 'Table Name',
  where: { Email: 'johndoe@example.com' },
  $set: { Age: 31 },
});
console.log(result);
```

### API Reference

#### `AirtableClient`

##### `constructor(options: AirtableClientOpts)`

Creates a new instance of the `AirtableClient`.

- `options.apiKey` (string): Your Airtable API key (required).
- `options.baseId` (string): The ID of your Airtable base (required).
- `options.baseUrl` (string): The base URL for Airtable API (optional, defaults to `https://api.airtable.com/v0`).

##### `createRecord(options: CreateRecordOpts): Promise<AirtableResponse>`

Creates a new record in the specified table.

##### `findFirst(options: FindFirstOpts): Promise<FieldsObj | (FieldsObj & { _airtableId: string }) | null>`

Finds the first record that matches the given filter criteria.

##### `upsertRecord(options: UpsertRecordOpts): Promise<{ _airtableId: string; upsertResult: UpsertResult }>`

Upserts a record: updates it if it exists, or creates it if it doesn't.

### Types

- `AirtableClientOpts`
- `FieldsObj`
- `AirtableRecord`
- `AirtableResponse`
- `CreateRecordOpts`
- `FindFirstOpts`
- `FindManyOpts`
- `GetRecordOpts`
- `UpdateRecordOpts`
- `UpsertRecordOpts`
- `UpsertResult`

### Contributing

Contributions are welcome! Please feel free to open issues or submit pull requests on the [GitHub repository](https://github.com/ensembleblock/airtable).

### License

This project is licensed under the MIT License.
