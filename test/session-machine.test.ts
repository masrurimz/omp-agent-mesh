import { assert, describe, it } from "@effect/vitest";
import { createEffectActor, send, waitFor } from "@xstate/effect";
import { Effect, Schema } from "effect";
import {
  JOINED_PHASES,
  phaseOf,
  type SessionPhase,
  sessionMachine,
} from "../src/lifecycle/session-machine.ts";
import { Feed } from "../src/services/feed.ts";
import { Presence } from "../src/services/presence.ts";
import { SessionState } from "../src/services/session-state.ts";
import { peer, withMesh } from "./support.ts";

const TIMEOUT = "3 seconds";
const PROPERTY = { arbitrary: { runs: 25 } };

const TurnCommands = Schema.Array(Schema.Literals(["AGENT_START", "AGENT_END"]));
const AnyCommands = Schema.Array(Schema.Literals(["AGENT_START", "AGENT_END", "LEAVE"]));

const boot = Effect.gen(function* () {
  const presence = yield* Presence;
  yield* presence.ensureDir;
  const store = yield* SessionState.make({
    peer: peer("s1", { name: "Ada" }),
    subs: new Map(),
    unread: 0,
    peerCount: 0,
  });
  const actor = yield* createEffectActor(sessionMachine, {
    input: { name: "Ada", sessionId: "s1" },
  }).pipe(Effect.provideService(SessionState, store));
  const phases: SessionPhase[] = [phaseOf(actor.getSnapshot())];
  const subscription = actor.subscribe((snapshot) => {
    phases.push(phaseOf(snapshot));
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => subscription.unsubscribe()));
  return { actor, phases };
});

const trace = (phases: ReadonlyArray<SessionPhase>) =>
  phases
    .map((phase) => phase.split(".")[0])
    .filter((phase, index, all) => phase !== all[index - 1]);

const countOf = (lines: ReadonlyArray<string>, type: "join" | "leave") =>
  lines.filter((line) => line.includes(`"type":"${type}"`)).length;

describe("session machine", () => {
  it.live.prop(
    "nothing works before joined, and left is final, whatever the event order",
    { commands: AnyCommands },
    ({ commands }) =>
      withMesh(
        Effect.gen(function* () {
          const { actor, phases } = yield* boot;
          for (const command of commands) yield* send(actor, { type: command });
          yield* send(actor, { type: "LEAVE" });
          yield* waitFor(actor, (snapshot) => phaseOf(snapshot) === "left", {
            timeout: TIMEOUT,
          });

          const seen = trace(phases);
          const firstWorking = seen.indexOf("working");
          if (firstWorking >= 0) {
            const firstIdle = seen.indexOf("idle");
            assert.isTrue(firstIdle >= 0 && firstIdle < firstWorking);
          }
          assert.strictEqual(phases.indexOf("left"), phases.length - 1);
          assert.deepStrictEqual(seen.slice(-2), ["departing", "left"]);
        }),
      ),
    PROPERTY,
  );

  it.live.prop(
    "the persisted status follows every effective event, ignored events change nothing, and cleanup runs once",
    { commands: TurnCommands },
    ({ commands }) =>
      withMesh(
        Effect.gen(function* () {
          const presence = yield* Presence;
          const feed = yield* Feed;
          const { actor, phases } = yield* boot;
          yield* waitFor(actor, (snapshot) => JOINED_PHASES.has(phaseOf(snapshot)), {
            timeout: TIMEOUT,
          });

          let model: "idle" | "working" = "idle";
          const expected = ["joining", "idle"];
          for (const command of commands) {
            const after = command === "AGENT_START" ? "working" : "idle";
            const effective =
              (command === "AGENT_START" && model === "idle") ||
              (command === "AGENT_END" && model === "working");
            yield* send(actor, { type: command });
            if (effective) {
              expected.push(after);
              model = after;
              yield* waitFor(actor, (snapshot) => phaseOf(snapshot) === `${after}.synced`, {
                timeout: TIMEOUT,
              });
            }
            assert.strictEqual((yield* presence.list)[0]?.status, model);
          }

          yield* send(actor, { type: "LEAVE" });
          yield* waitFor(actor, (snapshot) => phaseOf(snapshot) === "left", {
            timeout: TIMEOUT,
          });
          expected.push("departing", "left");

          assert.deepStrictEqual(trace(phases), expected);
          assert.deepStrictEqual(yield* presence.list, []);
          const lines = yield* feed.read(100);
          assert.strictEqual(countOf(lines, "join"), 1);
          assert.strictEqual(countOf(lines, "leave"), 1);
        }),
      ),
    PROPERTY,
  );
});
