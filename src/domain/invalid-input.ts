import { Schema } from "effect";

export class InvalidInput extends Schema.TaggedError<
  InvalidInput,
  { readonly brand: unique symbol }
>()("InvalidInput", { detail: Schema.String }) {
  override get message(): string {
    return `MESH_INVALID_INPUT: ${this.detail}. Fix: call the mesh tool with a valid action and the fields that action needs; the tool description lists them.`;
  }
}
