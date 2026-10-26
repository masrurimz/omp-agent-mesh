import { Context, Effect, Layer, Option } from "effect";
import { findConflict } from "../domain/peers.ts";
import { Presence } from "./presence.ts";

export class Claims extends Context.Service<Claims>()("omp-agent-mesh/services/Claims", {
  make: Effect.gen(function* () {
    const presence = yield* Presence;

    const guard = Effect.fn("Claims.guard")(function* (selfSessionId: string, path: string) {
      const peers = yield* presence.livePeers(selfSessionId);
      const conflict = findConflict(peers, selfSessionId, path);
      if (Option.isSome(conflict)) return yield* conflict.value;
    });

    return { guard };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
