import { Context, Effect, Layer, Option } from "effect";

import { findConflict } from "../domain/peers.ts";
import { Presence } from "./presence.ts";

export class Claims extends Context.Service<Claims>()(
  "omp-agent-mesh/services/Claims",
  {
    make: Effect.gen(function* make() {
      const presence = yield* Presence;

      const guard = Effect.fn("Claims.guard")(function* guard(
        selfSessionId: string,
        path: string
      ) {
        const peers = yield* presence.livePeers(selfSessionId);

        yield* Option.match(findConflict(peers, selfSessionId, path), {
          onNone: () => Effect.void,
          onSome: Effect.fail,
        });
      });

      return { guard };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
