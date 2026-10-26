import { Schema } from "effect";

export const MeshMessage = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  body: Schema.String,
  broadcast: Schema.Boolean,
  at: Schema.Number,
});

export const FeedEvent = Schema.Struct({
  ts: Schema.String,
  type: Schema.String,
  agent: Schema.String,
  target: Schema.optional(Schema.String),
  preview: Schema.optional(Schema.String),
});

export type MeshMessage = typeof MeshMessage.Type;
export type FeedEvent = typeof FeedEvent.Type;
export type NewFeedEvent = Omit<FeedEvent, "ts">;
