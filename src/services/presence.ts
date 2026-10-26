import { join } from "node:path";
import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { Peer } from "../domain/peer.ts";
import { isAlive } from "../domain/peers.ts";
import { meshIo } from "./io.ts";
import { MeshConfig } from "./mesh-config.ts";

const decodePeer = Schema.decodeUnknownEffect(Schema.fromJsonString(Peer));
const encodePeer = Schema.encodeEffect(Schema.fromJsonString(Peer));

export class Presence extends Context.Service<Presence>()("omp-agent-mesh/services/Presence", {
  make: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { meshDir } = yield* MeshConfig;
    const agentsDir = join(meshDir, "agents");
    const presencePath = (sessionId: string) => join(agentsDir, `${sessionId}.json`);

    const ensureDir = fs
      .makeDirectory(agentsDir, { recursive: true })
      .pipe(meshIo("ensureDir", agentsDir));

    const write = Effect.fnUntraced(
      function* (peer: Peer) {
        const path = presencePath(peer.sessionId);
        const tmp = `${path}.tmp-${process.pid}`;
        yield* fs.writeFileString(tmp, yield* encodePeer(peer));
        yield* fs.rename(tmp, path);
      },
      (effect, peer) => meshIo("writePresence", presencePath(peer.sessionId))(effect),
    );

    const remove = (sessionId: string) =>
      fs
        .remove(presencePath(sessionId), { force: true })
        .pipe(meshIo("removePresence", presencePath(sessionId)));

    const readPeer = Effect.fnUntraced(function* (name: string) {
      const text = yield* fs.readFileString(join(agentsDir, name)).pipe(Effect.option);
      if (Option.isNone(text)) return Option.none<Peer>();
      return yield* decodePeer(text.value).pipe(
        Effect.tapError(() => Effect.logWarning(`skipping unreadable presence file ${name}`)),
        Effect.option,
      );
    });

    const list = Effect.gen(function* () {
      if (!(yield* fs.exists(agentsDir))) return [];
      const names = yield* fs.readDirectory(agentsDir);
      const found = yield* Effect.forEach(
        names.filter((name) => name.endsWith(".json")),
        readPeer,
        { concurrency: 8 },
      );
      return found.flatMap((peer) => (Option.isSome(peer) ? [peer.value] : []));
    }).pipe(meshIo("listPresence", agentsDir));

    const livePeers = (selfSessionId: string) =>
      list.pipe(
        Effect.map((peers) => peers.filter((p) => p.sessionId !== selfSessionId && isAlive(p.pid))),
      );

    const reapDead = Effect.gen(function* () {
      const peers = yield* list;
      yield* Effect.forEach(
        peers.filter((p) => !isAlive(p.pid)),
        (p) => remove(p.sessionId),
        { discard: true },
      );
    });

    return { ensureDir, write, remove, list, livePeers, reapDead };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
