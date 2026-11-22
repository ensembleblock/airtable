/**
 * Test helpers: a recording `fetch` stub that is injected through the
 * `AirtableClient` constructor's `fetch` option (no global mocking).
 */

import { AirtableClient } from '../src/index.js';

export const apiKey = `pat_mock_123456789`;
export const baseId = `app_mock_123456789`;
export const recordId = `rec_mock_123456789`;
export const tableIdOrName = `table_mock`;

export type RecordedRequest = {
  /** The parsed JSON request body, or `null` when no body was sent. */
  body: unknown;
  headers: Record<string, string>;
  method: string;
  url: string;
};

/** A canned response, or a function producing one per request. */
export type MockReply =
  Response | ((request: RecordedRequest) => Promise<Response> | Response);

/** Build a JSON `Response`. */
export const json = (
  data: unknown,
  {
    status = 200,
    statusText = ``,
  }: { status?: number; statusText?: string } = {},
): Response =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': `application/json` },
    status,
    statusText,
  });

/**
 * Create a `fetch` stub that replies with the given responses in order
 * and records each request. Throws if more requests are made than replies given.
 */
export const createMockFetch = (...replies: MockReply[]) => {
  const requests: RecordedRequest[] = [];
  const queue = [...replies];

  const mockFetch = async (
    input: Parameters<typeof fetch>[0],
    init: RequestInit = {},
  ): Promise<Response> => {
    const rawBody = init.body;

    const request: RecordedRequest = {
      body:
        typeof rawBody === `string` ? (JSON.parse(rawBody) as unknown) : null,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      method: init.method ?? `GET`,
      url: input instanceof Request ? input.url : String(input),
    };

    requests.push(request);

    const reply = queue.shift();

    if (!reply) {
      throw new Error(
        `mock fetch: unexpected request #${String(requests.length)} ${request.method} ${request.url}`,
      );
    }

    return typeof reply === `function` ? reply(request) : reply;
  };

  return { fetch: mockFetch, requests };
};

/** Create a client wired to a mock fetch with the given replies. */
export const createClient = (
  ...replies: MockReply[]
): { client: AirtableClient; requests: RecordedRequest[] } => {
  const { fetch, requests } = createMockFetch(...replies);
  const client = new AirtableClient({ apiKey, baseId, fetch });

  return { client, requests };
};
