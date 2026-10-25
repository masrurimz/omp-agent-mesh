import { Schema } from "effect";

export const Peer = Schema.Struct({
  name: Schema.String,
  pid: Schema.Number,
  cwd: Schema.String,
  model: Schema.String,
  gitBranch: Schema.optional(Schema.String),
  statusMessage: Schema.optional(Schema.String),
  activity: Schema.optional(
    Schema.Struct({
      lastActivityAt: Schema.String,
      currentActivity: Schema.optional(Schema.String),
      lastToolCall: Schema.optional(Schema.String),
    }),
  ),
});

export type Peer = typeof Peer.Type;
