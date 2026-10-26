import { Effect, Schema } from "effect";

export const Reservation = Schema.Struct({
  pattern: Schema.String,
  reason: Schema.optional(Schema.String),
  since: Schema.Number,
});

export const RecentEdit = Schema.Struct({
  path: Schema.String,
  by: Schema.String,
  at: Schema.Number,
});

export const Peer = Schema.Struct({
  name: Schema.String,
  pid: Schema.Number,
  sessionId: Schema.String,
  cwd: Schema.String,
  group: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  status: Schema.Literals(["working", "idle"]),
  note: Schema.optional(Schema.String),
  reservations: Schema.Array(Reservation),
  subagents: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  recent: Schema.Array(RecentEdit).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  updatedAt: Schema.Number,
});

export type Peer = typeof Peer.Type;
export type Reservation = typeof Reservation.Type;
export type RecentEdit = typeof RecentEdit.Type;
