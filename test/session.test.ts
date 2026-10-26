import { assert, describe, it } from "@effect/vitest";
import { join } from "node:path";
import { Effect, Exit, FileSystem, Option, Scope } from "effect";
import { Feed } from "../src/services/feed.ts";
import { MainRegistry } from "../src/services/main-registry.ts";
import { MeshConfig } from "../src/services/mesh-config.ts";
import { MeshSession } from "../src/services/mesh-session.ts";
import { Presence } from "../src/services/presence.ts";
import { bodiesOf, deliveries, joinInput, withMesh } from "./support.ts";

const open = (scope: Scope.Scope, sessionId: string) =>
  MeshSession.make(joinInput(sessionId)).pipe(Scope.provide(scope));

describe("session lifecycle", () => {
  it.live("closing the scope removes presence, records the leave, and unregisters the main", () =>
    withMesh(
      Effect.gen(function* () {
        const presence = yield* Presence;
        const feed = yield* Feed;
        const registry = yield* MainRegistry;
        const scope = yield* Scope.make();
        const session = yield* open(scope, "s1");

        assert.deepStrictEqual(
          (yield* presence.list).map((p) => p.sessionId),
          ["s1"],
        );
        assert.strictEqual(yield* session.phase, "idle.synced");
        assert.isTrue(Option.isSome(yield* registry.current));

        yield* Scope.close(scope, Exit.void);

        assert.deepStrictEqual(yield* presence.list, []);
        assert.isTrue(Option.isNone(yield* registry.current));
        const lines = yield* feed.read(10);
        assert.isTrue(lines.some((l) => l.includes('"type":"leave"') && l.includes(session.name)));
      }),
    ),
  );

  it.live("agent start and end move the phase and mirror it in presence", () =>
    withMesh(
      Effect.gen(function* () {
        const presence = yield* Presence;
        const scope = yield* Scope.make();
        const session = yield* open(scope, "s1");

        yield* session.agentStarted;
        assert.strictEqual(yield* session.phase, "working.synced");
        assert.strictEqual((yield* presence.list)[0]?.status, "working");
        yield* session.agentEnded;
        assert.strictEqual((yield* presence.list)[0]?.status, "idle");

        yield* Scope.close(scope, Exit.void);
      }),
    ),
  );

  it.live(
    "a failing presence write fails the turn with MeshIoError and the next turn recovers",
    () =>
      withMesh(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const { meshDir } = yield* MeshConfig;
          const agentsDir = join(meshDir, "agents");
          const scope = yield* Scope.make();
          const session = yield* open(scope, "s1");

          yield* fs.remove(agentsDir, { recursive: true });
          const error = yield* Effect.flip(session.agentStarted);
          assert.strictEqual(error._tag, "MeshIoError");
          assert.strictEqual(yield* session.phase, "working.unsynced");

          yield* fs.makeDirectory(agentsDir, { recursive: true });
          yield* session.agentEnded;
          assert.strictEqual(yield* session.phase, "idle.synced");

          yield* Scope.close(scope, Exit.void);
        }),
      ),
  );
});

describe("messaging", () => {
  it.live("a direct message wakes the receiver, and the sender's own broadcast is not echoed", () =>
    withMesh(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const a = yield* open(scope, "a");
        const b = yield* open(scope, "b");

        const sent = yield* a.send(b.name, "hello B");
        assert.strictEqual(sent.target.name, b.name);
        assert.strictEqual(sent.waitedMs, 0);
        assert.deepStrictEqual(bodiesOf(yield* deliveries(b, 1)), ["hello B"]);

        const out = yield* a.broadcast("all hands", "group");
        assert.strictEqual(out.recipients, 1);
        assert.deepStrictEqual(bodiesOf(yield* deliveries(b, 2)), ["hello B", "all hands"]);

        yield* Scope.close(scope, Exit.void);
      }),
    ),
  );

  it.live("sending fails with typed errors for unknown targets and empty bodies", () =>
    withMesh(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const a = yield* open(scope, "a");

        const missing = yield* Effect.flip(a.send("nobody", "hi"));
        assert.strictEqual(missing._tag, "TargetNotFound");
        assert.include(missing.message, "MESH_TARGET_NOT_FOUND");
        const empty = yield* Effect.flip(a.send("nobody", "   "));
        assert.strictEqual(empty._tag, "EmptyBody");

        yield* Scope.close(scope, Exit.void);
      }),
    ),
  );
});

describe("claims and subagents", () => {
  it.live(
    "a claim blocks another session's edit, attributed to the subagent, but never the owner",
    () =>
      withMesh(
        Effect.gen(function* () {
          const scope = yield* Scope.make();
          const owner = yield* open(scope, "owner");
          const other = yield* open(scope, "other");

          yield* owner.claim(["/work/repo/auth.ts"], "refactoring");
          yield* owner.guardEdit("/work/repo/auth.ts", "scout");

          const blocked = yield* Effect.flip(other.guardEdit("/work/repo/auth.ts", "fixer"));
          assert.strictEqual(blocked._tag, "ClaimConflict");
          assert.include(blocked.message, owner.name);
          assert.include(blocked.message, "refactoring");

          const feed = yield* other.feed(10);
          assert.isTrue(
            feed.some((l) => l.includes('"type":"blocked"') && l.includes(`${other.name}/fixer`)),
          );

          yield* owner.release(undefined);
          yield* other.guardEdit("/work/repo/auth.ts");

          yield* Scope.close(scope, Exit.void);
        }),
      ),
  );

  it.live("subagent activity shows on the parent's presence and clears when it ends", () =>
    withMesh(
      Effect.gen(function* () {
        const presence = yield* Presence;
        const scope = yield* Scope.make();
        const parent = yield* open(scope, "parent");

        yield* parent.subagentStarted("sub-1", "scout");
        yield* parent.guardEdit("/work/repo/x.ts", "scout");
        const during = (yield* presence.list)[0];
        assert.strictEqual(during?.subagents, 1);
        assert.strictEqual(during?.recent[0]?.by, "scout");

        yield* parent.subagentEnded("sub-1");
        assert.strictEqual((yield* presence.list)[0]?.subagents, 0);

        yield* Scope.close(scope, Exit.void);
      }),
    ),
  );
});
