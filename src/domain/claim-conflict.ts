import { Schema } from "effect";

import { folderName } from "./paths.ts";
import { hasText } from "./text.ts";

export class ClaimConflict extends Schema.TaggedError<
  ClaimConflict,
  { readonly brand: unique symbol }
>()("ClaimConflict", {
  holder: Schema.String,
  holderCwd: Schema.String,
  path: Schema.String,
  reason: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return [
      `MESH_CLAIM_CONFLICT: ${this.path}`,
      `Reserved by: ${this.holder} (in ${folderName(this.holderCwd)})`,
      ...(hasText(this.reason) ? [`Reason: "${this.reason}"`] : []),
      "",
      `Fix: coordinate with the mesh tool by sending to "${this.holder}", or edit a different file.`,
    ].join("\n");
  }
}
