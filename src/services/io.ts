import { Effect } from "effect";

import { MeshIoError } from "../domain/mesh-io-error.ts";

export const meshIo =
  (op: string, path: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, MeshIoError, R> =>
    Effect.mapError(effect, (cause) => new MeshIoError({ cause, op, path }));
