import { Schema } from "effect";
import { folderName } from "./paths.ts";

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export class NotJoined extends Schema.TaggedError<NotJoined, { readonly brand: unique symbol }>()(
  "NotJoined",
  {},
) {
  override get message(): string {
    return "MESH_NOT_JOINED: this session is not on the mesh (its cwd is outside the configured roots, or it is a subagent). Fix: start omp under a root listed in ~/.omp/agent/mesh.json.";
  }
}

export class TargetNotFound extends Schema.TaggedError<
  TargetNotFound,
  { readonly brand: unique symbol }
>()("TargetNotFound", { query: Schema.String }) {
  override get message(): string {
    return `MESH_TARGET_NOT_FOUND: no live agent matches "${this.query}". Fix: run the mesh tool with action peers to list handles and titles, then send to one of them.`;
  }
}

export class TargetAmbiguous extends Schema.TaggedError<
  TargetAmbiguous,
  { readonly brand: unique symbol }
>()("TargetAmbiguous", {
  query: Schema.String,
  candidates: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `MESH_TARGET_AMBIGUOUS: "${this.query}" matches ${this.candidates.join(", ")}. Fix: send to one exact handle.`;
  }
}

export class ClaimConflict extends Schema.TaggedError<
  ClaimConflict,
  { readonly brand: unique symbol }
>()("ClaimConflict", {
  path: Schema.String,
  holder: Schema.String,
  holderCwd: Schema.String,
  reason: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return [
      `MESH_CLAIM_CONFLICT: ${this.path}`,
      `Reserved by: ${this.holder} (in ${folderName(this.holderCwd)})`,
      ...(this.reason ? [`Reason: "${this.reason}"`] : []),
      "",
      `Fix: coordinate with the mesh tool by sending to "${this.holder}", or edit a different file.`,
    ].join("\n");
  }
}

export class EmptyBody extends Schema.TaggedError<EmptyBody, { readonly brand: unique symbol }>()(
  "EmptyBody",
  { action: Schema.Literals(["send", "broadcast"]) },
) {
  override get message(): string {
    return `MESH_EMPTY_BODY: mesh ${this.action} needs a non-empty body. Fix: pass the message text as body.`;
  }
}

export class InvalidInput extends Schema.TaggedError<
  InvalidInput,
  { readonly brand: unique symbol }
>()("InvalidInput", { detail: Schema.String }) {
  override get message(): string {
    return `MESH_INVALID_INPUT: ${this.detail}. Fix: call the mesh tool with a valid action and the fields that action needs; the tool description lists them.`;
  }
}

export class MeshIoError extends Schema.TaggedError<
  MeshIoError,
  { readonly brand: unique symbol }
>()("MeshIoError", { op: Schema.String, path: Schema.String, cause: Schema.Defect() }) {
  override get message(): string {
    return `MESH_IO_ERROR: ${this.op} failed on ${this.path}: ${describeCause(this.cause)}. Fix: check that the mesh directory is writable and the disk is not full, then retry.`;
  }
}
