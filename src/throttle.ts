import { Clock, Effect, Ref } from "effect";

interface Bucket {
  readonly tokens: number;
  readonly last: number;
}

export interface Throttle {
  readonly acquire: Effect.Effect<number>;
}

// Token bucket that delays instead of rejecting: the caller that overdraws sleeps
// until its reserved token has refilled and learns how long it waited (ms).
export const makeThrottle = (capacity: number, refillMs: number): Effect.Effect<Throttle> =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis;
    const bucket = yield* Ref.make<Bucket>({ tokens: capacity, last: start });

    const reserve = (now: number) =>
      Ref.modify(bucket, (b): readonly [number, Bucket] => {
        const elapsed = Math.max(0, now - b.last);
        const tokens = Math.min(capacity, b.tokens + elapsed / refillMs) - 1;
        const wait = tokens >= 0 ? 0 : Math.ceil(-tokens * refillMs);
        return [wait, { tokens, last: Math.max(now, b.last) }];
      });

    const acquire = Effect.gen(function* () {
      const wait = yield* reserve(yield* Clock.currentTimeMillis);
      if (wait > 0) yield* Effect.sleep(wait);
      return wait;
    });

    return { acquire };
  });
