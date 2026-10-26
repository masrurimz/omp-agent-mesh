import { expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { makeThrottle } from "../src/throttle.ts";

const run = <A>(program: Effect.Effect<A>) =>
  Effect.runPromise(program.pipe(Effect.provide(TestClock.layer())));

test("a burst of five passes instantly, then sends are delayed one refill apart, never rejected", () =>
  run(
    Effect.gen(function* () {
      const throttle = yield* makeThrottle(5, 20_000);
      for (let i = 0; i < 5; i++) expect(yield* throttle.acquire).toBe(0);

      const sixth = yield* Effect.forkChild(throttle.acquire);
      const seventh = yield* Effect.forkChild(throttle.acquire);
      yield* Effect.yieldNow;
      expect(sixth.pollUnsafe()).toBeUndefined();

      yield* TestClock.adjust(20_000);
      expect(yield* Fiber.join(sixth)).toBe(20_000);
      expect(seventh.pollUnsafe()).toBeUndefined();

      yield* TestClock.adjust(20_000);
      expect(yield* Fiber.join(seventh)).toBe(40_000);
    }),
  ));

test("idle time refills the bucket", () =>
  run(
    Effect.gen(function* () {
      const throttle = yield* makeThrottle(5, 20_000);
      for (let i = 0; i < 5; i++) yield* throttle.acquire;
      yield* TestClock.adjust(100_000);
      for (let i = 0; i < 5; i++) expect(yield* throttle.acquire).toBe(0);
    }),
  ));
