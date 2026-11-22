/**
 * Spaces the *start* of tasks at least `minMillisBetweenStarts` apart.
 *
 * Callers are queued in call order. Each task waits on its predecessor's
 * *start*, never its completion, so a slow task (e.g. a slow HTTP response)
 * doesn't hold up later ones. The gap is measured from the previous task's
 * actual start, after any sleep, so timers that fire late together (e.g.
 * after the event loop was blocked) still can't start tasks in a burst.
 *
 * Time is measured with the monotonic `performance.now()`, so wall-clock
 * jumps don't shorten or skip a gap.
 */
export class RequestThrottle {
  /** When the most recent task actually started (monotonic milliseconds). */
  private lastStartedAt = Number.NEGATIVE_INFINITY;

  private readonly minMillisBetweenStarts: number;

  /** Settles once the most recently queued task has started. */
  private startGate: Promise<void> = Promise.resolve();

  constructor(minMillisBetweenStarts: number) {
    if (
      !Number.isFinite(minMillisBetweenStarts) ||
      minMillisBetweenStarts < 0
    ) {
      throw new TypeError(
        `RequestThrottle expected 'minMillisBetweenStarts' to be a non-negative finite number`,
      );
    }

    this.minMillisBetweenStarts = minMillisBetweenStarts;
  }

  /**
   * Call `start` once this throttle has a free slot, and settle as the
   * promise it returns settles.
   *
   * If `start` throws synchronously, only this caller's promise rejects;
   * the next queued task still gets its turn.
   */
  public async run<T>(start: () => Promise<T>): Promise<T> {
    const started: Promise<{
      result: Promise<T>;
    }> = this.startGate.then(async () => {
      const nextStart: number =
        this.lastStartedAt + this.minMillisBetweenStarts;

      while (performance.now() < nextStart) {
        await sleep(Math.ceil(nextStart - performance.now()));
      }

      this.lastStartedAt = performance.now();

      // Wrap the result so the next turn waits only for `start` to be invoked.
      return { result: start() };
    });

    // Even a synchronously throwing `start` must release the next caller.
    this.startGate = started.then(
      () => {
        /* The task started. */
      },
      () => {
        /* A synchronous error belongs to its caller. */
      },
    );

    const result: Promise<T> = (await started).result;

    return result;
  }
}

/**
 * Sleep for the specified number of milliseconds.
 * We use this to throttle our API requests.
 */
function sleep(millis: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, millis);
  });
}
