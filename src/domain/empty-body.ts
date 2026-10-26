import { Schema } from "effect";

export class EmptyBody extends Schema.TaggedError<
  EmptyBody,
  { readonly brand: unique symbol }
>()("EmptyBody", { action: Schema.Literals(["send", "broadcast"]) }) {
  override get message(): string {
    return `MESH_EMPTY_BODY: mesh ${this.action} needs a non-empty body. Fix: pass the message text as body.`;
  }
}
