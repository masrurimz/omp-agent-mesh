import { Context, Effect, FileSystem, Layer, Option, Predicate, Schema } from "effect";
import { Peer } from "./peer.ts";

export class RegistryReadError extends Schema.TaggedError<RegistryReadError>()(
  "RegistryReadError",
  {
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Predicate.isObject(error) && "code" in error && error.code === "EPERM";
  }
};

export class Registry extends Context.Service<
  Registry,
  {
    readonly activePeers: (
      selfPid: number,
    ) => Effect.Effect<ReadonlyArray<Peer>, RegistryReadError>;
  }
>()("omp-agent-mesh/Registry") {
  static readonly layer = Layer.effect(
    Registry,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const base = process.env.PI_MESSENGER_DIR ?? `${process.env.HOME}/.pi/agent/messenger`;
      const dir = `${base}/registry`;
      const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Peer));

      const readPeer = Effect.fnUntraced(function* (name: string) {
        const text = yield* fs.readFileString(`${dir}/${name}`);
        return yield* decode(text);
      });

      const activePeers = Effect.fn("Registry.activePeers")(function* (selfPid: number) {
        const names = yield* fs
          .readDirectory(dir)
          .pipe(Effect.catch((cause) => Effect.fail(new RegistryReadError({ path: dir, cause }))));
        const peers: Array<Peer> = [];
        for (const name of names) {
          if (!name.endsWith(".json")) continue;
          const peer = yield* readPeer(name).pipe(
            Effect.tapError(() =>
              Effect.logWarning(`mesh: skipping unreadable registry file ${name}`),
            ),
            Effect.option,
          );
          if (Option.isSome(peer) && peer.value.pid !== selfPid && isAlive(peer.value.pid)) {
            peers.push(peer.value);
          }
        }
        return peers;
      });

      return Registry.of({ activePeers });
    }),
  );
}
