/**
 * Request throttling: Airtable allows 5 requests per second per base,
 * so a client spaces the *start* of its requests at least 200 ms apart.
 *
 * `RequestThrottle` is tested directly, then through `AirtableClient`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AirtableClient } from '../src/index.js';
import { RequestThrottle } from '../src/throttle.js';
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

describe(`RequestThrottle`, () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Run `count` tasks at once; record each start time & settle them all. */
  const runAll = async (throttle: RequestThrottle, count: number) => {
    const starts: number[] = [];
    const results = [...Array(count).keys()].map((i) =>
      throttle.run(() => {
        starts.push(performance.now());

        return Promise.resolve(i);
      }),
    );

    await vi.runAllTimersAsync();

    return { results: await Promise.all(results), starts };
  };

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    `rejects a minimum gap of %s`,
    (gap) => {
      expect(() => new RequestThrottle(gap)).toThrow(
        new TypeError(
          `RequestThrottle expected 'minMillisBetweenStarts' to be a non-negative finite number`,
        ),
      );
    },
  );

  it(`resolves each caller with its own task's result, in call order`, async () => {
    const { results, starts } = await runAll(new RequestThrottle(50), 4);

    expect(results).toStrictEqual([0, 1, 2, 3]);
    expect(starts).toStrictEqual([0, 50, 100, 150]);
  });

  it(`does not delay tasks when the gap is zero`, async () => {
    const { starts } = await runAll(new RequestThrottle(0), 3);

    expect(starts).toStrictEqual([0, 0, 0]);
  });

  it(`starts the first task immediately`, async () => {
    const throttle = new RequestThrottle(1_000);
    const start = vi.fn(() => Promise.resolve(`done`));

    const result = throttle.run(start);
    await vi.advanceTimersByTimeAsync(0);

    expect(start).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toBe(`done`);
  });

  it(`rejects only the caller whose task throws synchronously`, async () => {
    const throttle = new RequestThrottle(100);
    const boom = new Error(`sync boom`);
    const starts: number[] = [];

    const first = throttle.run(() => {
      starts.push(performance.now());
      throw boom;
    });
    const second = throttle.run(() => {
      starts.push(performance.now());

      return Promise.resolve(`second`);
    });

    // Attach handlers before timers run, so no rejection goes unhandled.
    const settled = Promise.allSettled([first, second]);
    await vi.runAllTimersAsync();

    expect(await settled).toStrictEqual([
      { reason: boom, status: `rejected` },
      { status: `fulfilled`, value: `second` },
    ]);

    // The failed task still counts as a start, so the gap is kept.
    expect(starts).toStrictEqual([0, 100]);
  });

  it(`propagates an async rejection without blocking later tasks`, async () => {
    const throttle = new RequestThrottle(100);
    const boom = new Error(`async boom`);

    const first = throttle.run(() => Promise.reject(boom));
    const second = throttle.run(() => Promise.resolve(`second`));

    const settled = Promise.allSettled([first, second]);
    await vi.runAllTimersAsync();

    expect(await settled).toStrictEqual([
      { reason: boom, status: `rejected` },
      { status: `fulfilled`, value: `second` },
    ]);
  });

  it(`sleeps again if a timer fires before the gap has elapsed`, async () => {
    // Timers may fire slightly early relative to the monotonic clock.
    // Simulate that by making the clock lag 5 ms behind the timers.
    const fakeNow = performance.now.bind(performance);
    let lag = 0;
    vi.spyOn(performance, `now`).mockImplementation(() => fakeNow() - lag);

    const throttle = new RequestThrottle(200);
    const starts: number[] = [];
    const task = () => {
      starts.push(performance.now());

      return Promise.resolve();
    };

    const runs = [throttle.run(task), throttle.run(task)];

    // The second task is now sleeping for 200 ms; its timer fires "early".
    await vi.advanceTimersByTimeAsync(199);
    lag = 5;

    await vi.runAllTimersAsync();
    await Promise.all(runs);

    expect(starts).toStrictEqual([0, 200]);
  });

  it(`does not call a task before its turn`, async () => {
    const throttle = new RequestThrottle(200);
    const second = vi.fn(() => Promise.resolve(2));

    const first = throttle.run(() => Promise.resolve(1));
    const result = throttle.run(second);

    await vi.advanceTimersByTimeAsync(199);
    expect(second).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(second).toHaveBeenCalledTimes(1);
    await expect(Promise.all([first, result])).resolves.toStrictEqual([1, 2]);
  });
});
