import { assert, describe, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { events, joining, type Lifecycle, transition } from "../src/lifecycle/lifecycle.ts";

const Commands = Schema.Array(
  Schema.Literals(["joined", "agentStarted", "agentEnded", "departed"]),
);

describe("lifecycle", () => {
  it.prop(
    "over any command sequence: nothing works before joining, Left is absorbing, rejections name the state",
    { commands: Commands },
    ({ commands }) => {
      let state: Lifecycle = joining;
      let joined = false;
      let left = false;
      for (const command of commands) {
        const event = events[command];
        const result = transition(state, event);
        if (left) {
          assert.isTrue(Result.isFailure(result));
        }
        if (Result.isFailure(result)) {
          assert.strictEqual(result.failure.from, state._tag);
          assert.strictEqual(result.failure.event, event._tag);
          continue;
        }
        state = result.success;
        joined ||= command === "joined";
        left ||= state._tag === "Left";
        if (state._tag === "Working" || state._tag === "Idle") assert.isTrue(joined);
        if (left) assert.strictEqual(state._tag, "Left");
      }
    },
  );

  it("a working session returns to idle when the agent ends", () => {
    const steps = [events.joined, events.agentStarted, events.agentEnded].reduce<
      Result.Result<Lifecycle, unknown>
    >(
      (acc, event) => Result.flatMap(acc, (state) => transition(state, event)),
      Result.succeed(joining),
    );
    assert.isTrue(Result.isSuccess(steps));
    if (Result.isSuccess(steps)) assert.strictEqual(steps.success._tag, "Idle");
  });
});
