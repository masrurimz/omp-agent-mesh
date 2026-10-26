import { BunFileSystem } from "@effect/platform-bun";
import { Effect, FileSystem, Layer, type Scope } from "effect";
import { MainRegistry } from "../src/main-registry.ts";
import { MeshStore } from "../src/mesh-store.ts";
import type { MeshMessage } from "../src/message.ts";
import type { Peer } from "../src/peer.ts";
import type { JoinInput } from "../src/session.ts";

type MeshServices = MeshStore | MainRegistry | Scope.Scope;

export const runMesh = <A, E>(
  program: (dir: string) => Effect.Effect<A, E, MeshServices>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "mesh-test-" });
      return yield* program(dir).pipe(
        Effect.provide(Layer.mergeAll(MeshStore.layer(dir), MainRegistry.layer)),
      );
    }).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer)),
  );

export const peer = (sessionId: string, extra: Partial<Peer> = {}): Peer => ({
  name: `Peer${sessionId}`,
  pid: process.pid,
  sessionId,
  cwd: "/work/repo",
  status: "idle",
  reservations: [],
  subagents: 0,
  recent: [],
  updatedAt: 0,
  ...extra,
});

export const DEAD_PID = 99_999_999;

export const joinInput = (
  sessionId: string,
  extra: Partial<JoinInput> = {},
  inbox: Array<MeshMessage> = [],
): JoinInput => ({
  sessionId,
  cwd: "/work/repo",
  group: "/work/repo",
  branch: undefined,
  model: undefined,
  readTitle: Effect.succeed(undefined),
  onMessage: (message) => Effect.sync(() => void inbox.push(message)),
  ...extra,
});

export const eventually = <A>(
  probe: Effect.Effect<A | undefined>,
  attempts = 150,
): Effect.Effect<A | undefined> =>
  Effect.gen(function* () {
    for (let i = 0; i < attempts; i++) {
      const value = yield* probe;
      if (value !== undefined) return value;
      yield* Effect.sleep(20);
    }
    return undefined;
  });
