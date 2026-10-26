import { Clock, Context, Effect, Layer, Ref } from "effect";

export const BURST = 5;

export const REFILL_MS = 20_000;

interface Bucket {
  readonly tokens: number;
  readonly last: number;
}

export class Throttle extends Context.Service<Throttle>()(
  "omp-agent-mesh/services/Throttle",
  {
    make: Effect.gen(function* make() {
      const start = yield* Clock.currentTimeMillis;
      const bucket = yield* Ref.make<Bucket>({ last: start, tokens: BURST });

      const reserve = (now: number) =>
        Ref.modify(bucket, (b): readonly [number, Bucket] => {
          const elapsed = Math.max(0, now - b.last);
          const tokens = Math.min(BURST, b.tokens + elapsed / REFILL_MS) - 1;
          const wait = tokens >= 0 ? 0 : Math.ceil(-tokens * REFILL_MS);

          return [wait, { last: Math.max(now, b.last), tokens }];
        });

      const acquire = Effect.gen(function* acquire() {
        const wait = yield* reserve(yield* Clock.currentTimeMillis);

        if (wait > 0) {
          yield* Effect.sleep(wait);
        }

        return wait;
      });

      return { acquire };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
