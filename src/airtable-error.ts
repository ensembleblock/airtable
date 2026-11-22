/**
 * Thrown when Airtable responds with a non-2xx HTTP status (by methods that
 * throw on HTTP errors), or when a 2xx response doesn't have the shape the
 * method relies on.
 *
 * Network failures are not wrapped: they reject with whatever `fetch` throws.
 */
export class AirtableError extends Error {
  /**
   * The response body: parsed JSON when possible, otherwise the raw text,
   * or `null` when the body is empty.
   */
  public readonly body: unknown;

  public override readonly name = `AirtableError`;

  /** The HTTP status code (e.g. `404`). */
  public readonly status: number;

  /** The HTTP status text (e.g. `Not Found`). May be empty. */
  public readonly statusText: string;

  /**
   * Airtable's error type (e.g. `NOT_FOUND`,
   * `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`) when the body includes one.
   */
  public readonly type: string | null;

  constructor(
    message: string,
    {
      body,
      status,
      statusText,
      type,
    }: {
      body: unknown;
      status: number;
      statusText: string;
      type: string | null;
    },
  ) {
    super(message);

    this.body = body;
    this.status = status;
    this.statusText = statusText;
    this.type = type;
  }
}
