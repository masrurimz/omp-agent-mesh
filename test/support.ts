import { BunFileSystem } from "@effect/platform-bun";
import { Effect, FileSystem, Layer, Stream } from "effect";

import type { MeshMessage } from "../src/domain/message.ts";
import type { Peer } from "../src/domain/peer.ts";
import { MeshServices } from "../src/services/live.ts";
import { MeshConfig } from "../src/services/mesh-config.ts";
import type { MeshSession, JoinInput } from "../src/services/mesh-session.ts";

export const TestMesh = Layer.unwrap(
  Effect.gen(function* TestMesh() {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "mesh-test-" });

    return MeshServices.pipe(
      Layer.provideMerge(
        MeshConfig.configLayer({ home: dir, meshDir: dir, roots: ["~/work/*"] })
      )
    );
  })
).pipe(Layer.provideMerge(BunFileSystem.layer));

export const withLayer =
  <ROut, E, RIn>(layer: Layer.Layer<ROut, E, RIn>) =>
  <A, E2, R>(body: Effect.Effect<A, E2, R>) =>
    Layer.build(layer).pipe(
      Effect.flatMap((context) => Effect.provideContext(body, context))
    );

export const withMesh = withLayer(TestMesh);

export const peer = (sessionId: string, extra: Partial<Peer> = {}): Peer => ({
  cwd: "/work/repo",
  name: `Peer${sessionId}`,
  pid: process.pid,
  recent: [],
  reservations: [],
  sessionId,
  status: "idle",
  subagents: 0,
  updatedAt: 0,
  ...extra,
});

export const DEAD_PID = 99_999_999;

export const joinInput = (
  sessionId: string,
  extra: Partial<JoinInput> = {}
): JoinInput => ({
  branch: undefined,
  cwd: "/work/repo",
  group: "/work/repo",
  model: undefined,
  readTitle: Effect.undefined,
  sessionId,
  ...extra,
});

export const deliveries = (session: MeshSession["Service"], count: number) =>
  session.deliveries.pipe(
    Stream.take(count),
    Stream.runCollect,
    Effect.timeout("4 seconds"),
    Effect.map((messages) => [...messages])
  );

export const bodiesOf = (messages: readonly MeshMessage[]) =>
  messages.map((m) => m.body);
