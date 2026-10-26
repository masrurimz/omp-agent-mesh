import { Schema } from "effect";

export class TargetNotFound extends Schema.TaggedError<
  TargetNotFound,
  { readonly brand: unique symbol }
>()("TargetNotFound", { query: Schema.String }) {
  override get message(): string {
    return `MESH_TARGET_NOT_FOUND: no live agent matches "${this.query}". Fix: run the mesh tool with action peers to list handles and titles, then send to one of them.`;
  }
}
