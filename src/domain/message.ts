import { Schema } from "effect";

export const MeshMessageSchema = Schema.Struct({
  at: Schema.Finite,
  body: Schema.String,
  broadcast: Schema.Boolean,
  from: Schema.String,
  to: Schema.String,
});

export const FeedEventSchema = Schema.Struct({
  agent: Schema.String,
  preview: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  ts: Schema.String,
  type: Schema.String,
});

export type MeshMessage = typeof MeshMessageSchema.Type;

export type FeedEvent = typeof FeedEventSchema.Type;

export type NewFeedEvent = Omit<FeedEvent, "ts">;
