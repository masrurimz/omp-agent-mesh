import { Context, Effect, Layer, Option, Ref } from "effect";
import type { MeshSession } from "./session.ts";

// Subagent sessions run in the same omp process as the main session that spawned
// them, and omp rebinds the extension factory per session, so only process-level
// state links them. The main session registers here; subagents look it up.
export class MainRegistry extends Context.Service<
  MainRegistry,
  {
    readonly register: (session: MeshSession) => Effect.Effect<void>;
    readonly unregister: (sessionId: string) => Effect.Effect<void>;
    readonly current: Effect.Effect<Option.Option<MeshSession>>;
  }
>()("omp-agent-mesh/MainRegistry") {
  static readonly layer = Layer.effect(
    MainRegistry,
    Effect.gen(function* () {
      const main = yield* Ref.make(Option.none<MeshSession>());
      return MainRegistry.of({
        register: (session) => Ref.set(main, Option.some(session)),
        unregister: (sessionId) =>
          Ref.update(main, (current) => Option.filter(current, (s) => s.sessionId !== sessionId)),
        current: Ref.get(main),
      });
    }),
  );
}
