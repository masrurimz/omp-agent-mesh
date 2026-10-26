import { Context, Effect, Layer, Option, Ref } from "effect";
import type { ClaimConflict, MeshIoError } from "../domain/errors.ts";

export interface MainHandle {
  readonly sessionId: string;
  readonly guardEdit: (
    path: string,
    by?: string,
  ) => Effect.Effect<void, ClaimConflict | MeshIoError>;
  readonly subagentStarted: (key: string, label: string) => Effect.Effect<void, MeshIoError>;
  readonly subagentEnded: (key: string) => Effect.Effect<void, MeshIoError>;
}

// Subagent sessions run in the same omp process as the main session that spawned
// them, and omp rebinds the extension factory per session, so only process-level
// state links them. The main session registers here; subagents look it up.
export class MainRegistry extends Context.Service<MainRegistry>()(
  "omp-agent-mesh/services/MainRegistry",
  {
    make: Effect.gen(function* () {
      const main = yield* Ref.make(Option.none<MainHandle>());
      return {
        register: (handle: MainHandle) => Ref.set(main, Option.some(handle)),
        unregister: (sessionId: string) =>
          Ref.update(main, (current) => Option.filter(current, (h) => h.sessionId !== sessionId)),
        current: Ref.get(main),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
