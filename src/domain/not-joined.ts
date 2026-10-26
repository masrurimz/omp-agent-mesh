import { Schema } from "effect";

export class NotJoined extends Schema.TaggedError<
  NotJoined,
  { readonly brand: unique symbol }
>()("NotJoined", {}) {
  override readonly message =
    "MESH_NOT_JOINED: this session is not on the mesh (its cwd is outside the configured roots, or it is a subagent). Fix: start omp under a root listed in ~/.omp/agent/mesh.json.";
}
