import { expect, test } from "bun:test";
import { Effect, Exit, Option, Scope } from "effect";
import { MainRegistry } from "../src/main-registry.ts";
import { MeshStore } from "../src/mesh-store.ts";
import type { MeshMessage } from "../src/message.ts";
import { joinMesh } from "../src/session.ts";
import { eventually, joinInput, runMesh } from "./support.ts";

const open = <A, E, R>(scope: Scope.Scope, effect: Effect.Effect<A, E, R | Scope.Scope>) =>
  effect.pipe(Scope.provide(scope));

test("closing the session scope removes presence, records leave, and unregisters the main session", () =>
  runMesh(() =>
    Effect.gen(function* () {
      const store = yield* MeshStore;
      const registry = yield* MainRegistry;
      const scope = yield* Scope.make();
      const session = yield* open(scope, joinMesh(joinInput("s1")));

      expect((yield* store.listPresence).map((p) => p.sessionId)).toEqual(["s1"]);
      expect(Option.map(yield* registry.current, (s) => s.name)).toEqual(Option.some(session.name));

      yield* Scope.close(scope, Exit.void);

      expect(yield* store.listPresence).toEqual([]);
      expect(yield* registry.current).toEqual(Option.none());
      const feed = (yield* store.readFeed(10)).join("\n");
      expect(feed).toContain('"type":"join"');
      expect(feed).toContain('"type":"leave"');
    }),
  ));

test("a direct message sent by title card reaches the peer's session", () =>
  runMesh(() =>
    Effect.gen(function* () {
      const received: Array<MeshMessage> = [];
      const scope = yield* Scope.make();
      const planner = yield* open(
        scope,
        joinMesh(
          joinInput("planner", { readTitle: Effect.succeed("PLAN: auth rewrite") }, received),
        ),
      );
      const sender = yield* open(scope, joinMesh(joinInput("sender")));

      const outcome = yield* sender.send("plan", "ping");
      expect(outcome).toMatchObject({ kind: "sent", target: { name: planner.name } });

      const arrived = yield* eventually(Effect.sync(() => received[0]));
      expect(arrived).toMatchObject({ from: sender.name, body: "ping", broadcast: false });
      yield* Scope.close(scope, Exit.void);
    }),
  ));

test("broadcast stays in the repo group unless scope is all", () =>
  runMesh(() =>
    Effect.gen(function* () {
      const sameRepo: Array<MeshMessage> = [];
      const otherRepo: Array<MeshMessage> = [];
      const scope = yield* Scope.make();
      const sender = yield* open(scope, joinMesh(joinInput("sender")));
      yield* open(scope, joinMesh(joinInput("mate", {}, sameRepo)));
      yield* open(
        scope,
        joinMesh(joinInput("far", { group: "/work/other", cwd: "/work/other" }, otherRepo)),
      );

      expect((yield* sender.broadcast("group hello", "group")).recipients).toBe(1);
      expect(yield* eventually(Effect.sync(() => sameRepo[0]))).toMatchObject({
        body: "group hello",
      });
      yield* Effect.sleep(150);
      expect(otherRepo).toEqual([]);

      expect((yield* sender.broadcast("everyone", "all")).recipients).toBe(2);
      expect(yield* eventually(Effect.sync(() => otherRepo[0]))).toMatchObject({
        body: "everyone",
      });
      yield* Scope.close(scope, Exit.void);
    }),
  ));

test("a subagent edit on a path another agent claimed is blocked and attributed", () =>
  runMesh(() =>
    Effect.gen(function* () {
      const store = yield* MeshStore;
      const scope = yield* Scope.make();
      const owner = yield* open(scope, joinMesh(joinInput("owner")));
      const parent = yield* open(scope, joinMesh(joinInput("parent")));
      yield* owner.claim(["/work/repo/auth.ts"], "rewrite");

      const blocked = yield* parent.guardEdit("/work/repo/auth.ts", "scout");
      expect(Option.map(blocked, (c) => c.peer.name)).toEqual(Option.some(owner.name));

      const feed = (yield* store.readFeed(20)).join("\n");
      expect(feed).toContain(`"type":"blocked","agent":"${parent.name}/scout"`);
      expect((yield* parent.view).recent).toEqual([]);
      yield* Scope.close(scope, Exit.void);
    }),
  ));

test("subagent activity shows on the parent's presence for other peers", () =>
  runMesh(() =>
    Effect.gen(function* () {
      const store = yield* MeshStore;
      const scope = yield* Scope.make();
      const observer = yield* open(scope, joinMesh(joinInput("observer")));
      const parent = yield* open(scope, joinMesh(joinInput("parent")));

      yield* parent.subagentStarted("sub-1", "scout");
      yield* parent.subagentStarted("sub-2", "fixer");
      yield* parent.subagentStarted("sub-2", "fixer");
      const free = yield* parent.guardEdit("/work/repo/src/auth.ts", "fixer");
      expect(Option.isNone(free)).toBe(true);

      const seen = (yield* observer.peers).find((p) => p.sessionId === "parent");
      expect(seen?.subagents).toBe(2);
      expect(seen?.recent[0]).toMatchObject({ path: "/work/repo/src/auth.ts", by: "fixer" });
      expect((yield* store.readFeed(20)).join("\n")).toContain(
        `"type":"edit","agent":"${parent.name}/fixer"`,
      );

      yield* parent.subagentEnded("sub-1");
      yield* parent.subagentEnded("sub-1");
      const after = (yield* observer.peers).find((p) => p.sessionId === "parent");
      expect(after?.subagents).toBe(1);
      yield* Scope.close(scope, Exit.void);
    }),
  ));

test("a session's own claims never block its own subagents", () =>
  runMesh(() =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const parent = yield* open(scope, joinMesh(joinInput("parent")));
      yield* parent.claim(["/work/repo/auth.ts"], undefined);
      const result = yield* parent.guardEdit("/work/repo/auth.ts", "scout");
      expect(Option.isNone(result)).toBe(true);
      yield* Scope.close(scope, Exit.void);
    }),
  ));
