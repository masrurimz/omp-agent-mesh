import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";

import { BURST, REFILL_MS, Throttle } from "../src/services/throttle.ts";

const Sends = Schema.Int.check(Schema.isBetween({ maximum: 25, minimum: 1 }));

const IdleRefills = Schema.Int.check(
  Schema.isBetween({ maximum: BURST, minimum: 0 })
);

describe("throttle", () => {
  it.effect.prop(
    "n back-to-back sends all land: the burst is free, then each waits one more refill",
    { sends: Sends },
    ({ sends }) =>
      Effect.gen(function* burstSends() {
        const throttle = yield* Throttle.make;

        const pending = yield* Effect.forEach(
          Array.from({ length: sends }),
          () => Effect.forkChild(throttle.acquire)
        );

        yield* Effect.yieldNow;
        yield* TestClock.adjust(sends * REFILL_MS);

        const waits = yield* Fiber.joinAll(pending);

        const expected = Array.from({ length: sends }, (_, i) =>
          i < BURST ? 0 : (i - BURST + 1) * REFILL_MS
        );

        assert.deepStrictEqual(
          [...waits].toSorted((a, b) => a - b),
          expected
        );
      })
  );

  it.effect.prop(
    "idle time refills one token per interval, up to the burst",
    { refills: IdleRefills },
    ({ refills }) =>
      Effect.gen(function* idleRefill() {
        const throttle = yield* Throttle.make;

        for (let i = 0; i < BURST; i += 1) {
          yield* throttle.acquire;
        }

        yield* TestClock.adjust(refills * REFILL_MS);

        for (let i = 0; i < refills; i += 1) {
          assert.strictEqual(yield* throttle.acquire, 0);
        }

        const next = yield* Effect.forkChild(throttle.acquire);
        yield* Effect.yieldNow;
        assert.isUndefined(next.pollUnsafe());
        yield* TestClock.adjust(REFILL_MS);
        assert.strictEqual(yield* Fiber.join(next), REFILL_MS);
      })
  );
});
