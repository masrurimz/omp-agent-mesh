import { Schema } from "effect";

export class TargetAmbiguous extends Schema.TaggedError<
  TargetAmbiguous,
  { readonly brand: unique symbol }
>()("TargetAmbiguous", {
  candidates: Schema.Array(Schema.String),
  query: Schema.String,
}) {
  override get message(): string {
    return `MESH_TARGET_AMBIGUOUS: "${this.query}" matches ${this.candidates.join(", ")}. Fix: send to one exact handle.`;
  }
}
