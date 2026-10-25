import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { Peer } from "./peer.ts";
import { agentsDir, isAlive, meshDir } from "./store.ts";

export class RegistryReadError extends Schema.TaggedError<RegistryReadError>()(
  "RegistryReadError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class Registry extends Context.Service<
  Registry,
  {
    readonly activePeers: (
      selfSessionId: string,
    ) => Effect.Effect<ReadonlyArray<Peer>, RegistryReadError>;
  }
>()("omp-agent-mesh/Registry") {
  static readonly layer = Layer.effect(
    Registry,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = agentsDir(meshDir());
      const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Peer));

      const readPeer = Effect.fnUntraced(function* (name: string) {
        const text = yield* fs.readFileString(`${dir}/${name}`);
        return yield* decode(text);
      });

      const activePeers = Effect.fn("Registry.activePeers")(function* (selfSessionId: string) {
        const names = yield* fs
          .readDirectory(dir)
          .pipe(Effect.catch((cause) => Effect.fail(new RegistryReadError({ path: dir, cause }))));
        const peers: Array<Peer> = [];
        for (const name of names) {
          if (!name.endsWith(".json")) continue;
          const peer = yield* readPeer(name).pipe(
            Effect.tapError(() =>
              Effect.logWarning(`mesh: skipping unreadable presence file ${name}`),
            ),
            Effect.option,
          );
          if (
            Option.isSome(peer) &&
            peer.value.sessionId !== selfSessionId &&
            isAlive(peer.value.pid)
          ) {
            peers.push(peer.value);
          }
        }
        return peers;
      });

      return Registry.of({ activePeers });
    }),
  );
}
