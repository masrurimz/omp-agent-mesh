import { Schema } from "effect";

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export class MeshIoError extends Schema.TaggedError<
  MeshIoError,
  { readonly brand: unique symbol }
>()("MeshIoError", {
  cause: Schema.Defect(),
  op: Schema.String,
  path: Schema.String,
}) {
  override get message(): string {
    return `MESH_IO_ERROR: ${this.op} failed on ${this.path}: ${describeCause(this.cause)}. Fix: check that the mesh directory is writable and the disk is not full, then retry.`;
  }
}
