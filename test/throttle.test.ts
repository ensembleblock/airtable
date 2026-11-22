/**
 * Request throttling: Airtable allows 5 requests per second per base,
 * so a client spaces the *start* of its requests at least 200 ms apart.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AirtableClient } from '../src/index.js';
import {
  apiKey,
  baseId,
  json,
  makeRecord,
  recordId,
  tableIdOrName,
} from './helpers.js';

/** A fetch stub that records when each request started (fake-clock millis). */
const createTimedFetch = (
  respond: () => Promise<Response> | Response = () => json(makeRecord()),
) => {
  const startTimes: number[] = [];

  const fetch = (() => {
    startTimes.push(Date.now());

    return Promise.resolve(respond());
  }) as typeof globalThis.fetch;

  return { client: new AirtableClient({ apiKey, baseId, fetch }), startTimes };
};

const gaps = (times: number[]): number[] =>
  times.slice(1).map((time, i) => time - (times[i] ?? 0));

describe(`request throttling`, () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(`spaces simultaneous calls 200 ms apart, in call order`, async () => {
    const { client, startTimes } = createTimedFetch();

    const calls = Array.from({ length: 5 }, () =>
      client.getRecord({ recordId, tableIdOrName }),
    );

    await vi.runAllTimersAsync();
    await Promise.all(calls);

    expect(startTimes).toStrictEqual([0, 200, 400, 600, 800]);
  });

  it(`does not delay a request when the previous one started long enough ago`, async () => {
    const { client, startTimes } = createTimedFetch();

    await client.getRecord({ recordId, tableIdOrName });
    await vi.advanceTimersByTimeAsync(1_000);
    await client.getRecord({ recordId, tableIdOrName });

    expect(startTimes).toStrictEqual([0, 1_000]);
  });

  it(`keeps requests spaced after a delayed event loop`, async () => {
    const { client, startTimes } = createTimedFetch();

    const calls = Array.from({ length: 3 }, () =>
      client.getRecord({ recordId, tableIdOrName }),
    );

    // Let the first request start; the second is now sleeping until t=200.
    await vi.advanceTimersByTimeAsync(0);
    expect(startTimes).toStrictEqual([0]);

    // Simulate the event loop being blocked for 1 second: the wall clock
    // moves on, but no timers get a chance to fire.
    vi.setSystemTime(1_000);

    await vi.runAllTimersAsync();
    await Promise.all(calls);

    expect(startTimes).toHaveLength(3);

    // The overdue timer fires late, but the third request is still spaced
    // 200 ms after the second one actually started (no burst).
    for (const gap of gaps(startTimes)) {
      expect(gap).toBeGreaterThanOrEqual(200);
    }
  });

  it(`keeps the 200 ms gap when the system clock jumps forward`, async () => {
    const { client, startTimes } = createTimedFetch();
    await client.getRecord({ recordId, tableIdOrName });
    vi.setSystemTime(10_000);
    const second = client.getRecord({ recordId, tableIdOrName });

    await vi.advanceTimersByTimeAsync(199);
    expect(startTimes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(startTimes).toStrictEqual([0, 10_200]);
  });

  it(`does not wait for slow responses before starting the next request`, async () => {
    const firstResponseControl: { release?: () => void } = {};

    const firstResponse = new Promise<Response>((resolve) => {
      firstResponseControl.release = () => {
        resolve(json(makeRecord()));
      };
    });

    let requestCount = 0;
    const { client, startTimes } = createTimedFetch(() => {
      requestCount += 1;

      return requestCount === 1 ? firstResponse : json(makeRecord());
    });

    const first = client.getRecord({ recordId, tableIdOrName });
    const second = client.getRecord({ recordId, tableIdOrName });

    await vi.advanceTimersByTimeAsync(200);

    // The second request started while the first response is still pending.
    expect(startTimes).toStrictEqual([0, 200]);
    await expect(second).resolves.toMatchObject({ ok: true });

    firstResponseControl.release?.();
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it(`throttles each client independently`, async () => {
    const a = createTimedFetch();
    const b = createTimedFetch();

    await Promise.all([
      a.client.getRecord({ recordId, tableIdOrName }),
      b.client.getRecord({ recordId, tableIdOrName }),
    ]);

    expect(a.startTimes).toStrictEqual([0]);
    expect(b.startTimes).toStrictEqual([0]);
  });
});
