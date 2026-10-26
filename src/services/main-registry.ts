import { Context, Effect, Layer, Option, Ref } from "effect";

import type { ClaimConflict } from "../domain/claim-conflict.ts";
import type { MeshIoError } from "../domain/mesh-io-error.ts";

export interface MainHandle {
  readonly sessionId: string;
  readonly guardEdit: (
    path: string,
    by?: string
  ) => Effect.Effect<void, ClaimConflict | MeshIoError>;
  readonly subagentStarted: (
    key: string,
    label: string
  ) => Effect.Effect<void, MeshIoError>;
  readonly subagentEnded: (key: string) => Effect.Effect<void, MeshIoError>;
}

export class MainRegistry extends Context.Service<MainRegistry>()(
  "omp-agent-mesh/services/MainRegistry",
  {
    make: Effect.gen(function* make() {
      const main = yield* Ref.make(Option.none<MainHandle>());

      return {
        current: Ref.get(main),
        register: (handle: MainHandle) => Ref.set(main, Option.some(handle)),
        unregister: (sessionId: string) =>
          Ref.update(main, (current) =>
            current.pipe(Option.filter((h) => h.sessionId !== sessionId))
          ),
      };
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
