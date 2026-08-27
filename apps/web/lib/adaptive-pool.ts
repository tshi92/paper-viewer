/**
 * A worker pool that adapts its parallelism to the provider it is talking to.
 *
 * The daily digest analyses papers through whatever LLM endpoint the workspace
 * is configured with, and providers differ wildly in what they allow — one
 * org-wide request at a time on one, hundreds on another — and change those
 * numbers without notice. So nothing here is keyed to a model name: the pool
 * starts at the parallelism it is given and treats the provider's own pushback
 * as the only signal, halving down to 1 on every rate-limited answer. Against
 * a single-slot provider that is one wasted volley before it settles into
 * exactly the serial loop this replaced; against a permissive one it never
 * slows down; and when a stingy provider raises its limits, this code speeds
 * up on its own.
 *
 * A rate-limited item goes back in the queue for one more try — on the second
 * rate-limit the handler is told it is the final attempt and decides what
 * giving up means (for an analysis: dequeue, and let the next hourly run
 * retry). The pool never interprets failures beyond that; everything the
 * handler throws is the handler's own business to catch.
 */
export async function runAdaptivePool<T>(params: {
  items: readonly T[];
  /** Starting parallelism; shrinks on pushback, never below 1. */
  concurrency: number;
  /** Checked before each pick; deadline pressure stops new work, not in-flight work. */
  shouldStop: () => boolean;
  handle: (item: T, isFinalAttempt: boolean) => Promise<"done" | "rate-limited">;
}): Promise<{ stopped: boolean; concurrency: number }> {
  const queue = [...params.items];
  const attempts = new Map<T, number>();
  let limit = Math.max(1, params.concurrency);
  let stopped = false;

  async function worker(index: number): Promise<void> {
    // A worker whose index no longer fits under the shrunken limit drains out;
    // its queue entries are picked up by the workers that remain.
    while (index < limit && queue.length > 0) {
      if (params.shouldStop()) {
        stopped = true;
        return;
      }
      const item = queue.shift()!;
      const attempt = (attempts.get(item) ?? 0) + 1;
      attempts.set(item, attempt);

      const outcome = await params.handle(item, attempt >= 2);
      if (outcome === "rate-limited") {
        limit = Math.max(1, Math.floor(limit / 2));
        if (attempt < 2) {
          queue.push(item);
        }
      }
    }
  }

  // Shrinking can strand a requeued item: the worker that put it back may
  // itself be one whose index no longer fits under the new limit, with the
  // low-index workers already drained. Another round picks the leftovers up.
  while (queue.length > 0 && !stopped) {
    await Promise.all(
      Array.from({ length: Math.min(limit, queue.length) }, (_, index) => worker(index))
    );
  }
  return { stopped, concurrency: limit };
}
