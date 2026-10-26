import { Schema } from "effect";

export class MeshIoError extends Schema.TaggedError<MeshIoError>()("MeshIoError", {
  op: Schema.String,
  path: Schema.String,
  cause: Schema.Defect(),
}) {}
