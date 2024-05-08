export type AirtableClientOpts = {
  /** A string of at least 10 characters. */
  apiKey: string;

  /** A string of at least 10 characters beginning with "app". */
  baseId: string;

  /**
   * Optionally set the base URL (without a trailing slash).
   * Defaults to "https://api.airtable.com/v0".
   */
  baseUrl?: string;
};

export type AirtableResponse = {
  data: unknown;
  ok: boolean;
  status: number;
  statusText: string;
};

export type FieldsObj = Record<
  string,
  boolean | Date | null | number | string | undefined
>;

export type CreateRecordOpts = {
  fields: FieldsObj;
  tableIdOrName: string;
};

export type GetRecordOpts = {
  /** A string of at least 10 characters beginning with "rec". */
  recordId: string;

  tableIdOrName: string;
};

export type UpdateRecordOpts = {
  fields: FieldsObj;

  /**
   * A PATCH request (the default) will only update the fields you specify,
   * leaving the rest as they were.
   *
   * A PUT request will perform a destructive update and clear all unspecified cell values.
   */
  method?: `PATCH` | `PUT`;

  /** A string of at least 10 characters beginning with "rec". */
  recordId: string;

  tableIdOrName: string;
};

/**
 * @see https://github.com/ensembleblock/airtable
 */
export class AirtableClient {
  private baseId: string | null = null;

  private baseUrl: string = `https://api.airtable.com/v0`;

  private headers: Record<string, string> = {};

  constructor({ apiKey, baseId, baseUrl }: AirtableClientOpts) {
    if (typeof apiKey !== `string` || apiKey.length < 10) {
      throw new TypeError(
        `AirtableClient expected 'apiKey' to be string of at least 10 characters`,
      );
    }

    if (
      typeof baseId !== `string` ||
      baseId.length < 10 ||
      !baseId.startsWith(`app`)
    ) {
      throw new TypeError(
        `AirtableClient expected 'baseId' to be string of at least 10 characters starting with 'app'`,
      );
    }

    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': `application/json`,
    };

    this.baseId = baseId;

    if (baseUrl) {
      if (typeof baseUrl !== `string` || baseUrl.endsWith(`/`)) {
        throw new TypeError(
          `AirtableClient expected 'baseUrl' to be a string without a trailing slash`,
        );
      }

      this.baseUrl = baseUrl;
    }
  }

  /**
   * Create a record.
   * @see https://airtable.com/developers/web/api/create-records
   */
  public async createRecord({
    fields,
    tableIdOrName,
  }: CreateRecordOpts): Promise<AirtableResponse> {
    if (!fields || typeof fields !== `object` || Array.isArray(fields)) {
      throw new TypeError(
        `Airtable createRecord expected 'fields' to be a plain object`,
      );
    }

    if (!tableIdOrName || typeof tableIdOrName !== `string`) {
      throw new TypeError(
        `Airtable createRecord expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const createRecordUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}`;
    const body = JSON.stringify({ fields });

    const res: Response = await fetch(createRecordUrl, {
      body,
      headers: this.headers,
      method: `POST`,
    });

    const data: unknown = await res.json();

    return { data, ok: res.ok, status: res.status, statusText: res.statusText };
  }

  /**
   * Retrieve a single record using an Airtable `recordId`.
   * Any "empty" fields (e.g. "", [], or false) in the record will not be returned.
   * @see https://airtable.com/developers/web/api/get-record
   */
  public async getRecord({
    recordId,
    tableIdOrName,
  }: GetRecordOpts): Promise<AirtableResponse> {
    if (
      typeof recordId !== `string` ||
      recordId.length < 10 ||
      !recordId.startsWith(`rec`)
    ) {
      throw new TypeError(
        `Airtable getRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`,
      );
    }

    if (!tableIdOrName || typeof tableIdOrName !== `string`) {
      throw new TypeError(
        `Airtable getRecord expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const getRecordUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}/${recordId}`;

    const res = await fetch(getRecordUrl, {
      headers: this.headers,
      method: `GET`,
    });

    const data: unknown = await res.json();

    return { data, ok: res.ok, status: res.status, statusText: res.statusText };
  }

  /**
   * Updates a single record.
   * @see https://airtable.com/developers/web/api/update-record
   */
  public async updateRecord({
    fields,
    method = `PATCH`,
    recordId,
    tableIdOrName,
  }: UpdateRecordOpts): Promise<AirtableResponse> {
    if (!fields || typeof fields !== `object` || Array.isArray(fields)) {
      throw new TypeError(
        `Airtable updateRecord expected 'fields' to be a plain object`,
      );
    }

    if (
      typeof method !== `string` ||
      ![`PATCH`, `PUT`].includes(method.toUpperCase())
    ) {
      throw new TypeError(
        `Airtable updateRecord expected 'method' to be 'PATCH' or 'PUT'`,
      );
    }

    if (
      typeof recordId !== `string` ||
      recordId.length < 10 ||
      !recordId.startsWith(`rec`)
    ) {
      throw new TypeError(
        `Airtable updateRecord expected 'recordId' to be string of at least 10 characters starting with 'rec'`,
      );
    }

    if (!tableIdOrName || typeof tableIdOrName !== `string`) {
      throw new TypeError(
        `Airtable updateRecord expected 'tableIdOrName' to be a non-empty string`,
      );
    }

    const updateRecordUrl = `${this.baseUrl}/${this.baseId}/${tableIdOrName}/${recordId}`;
    const body = JSON.stringify({ fields });

    const res = await fetch(updateRecordUrl, {
      body,
      headers: this.headers,
      method: method.toUpperCase(),
    });

    const data: unknown = await res.json();

    return { data, ok: res.ok, status: res.status, statusText: res.statusText };
  }
}
