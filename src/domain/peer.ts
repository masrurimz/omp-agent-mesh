import { Effect, Schema } from "effect";

export const ReservationSchema = Schema.Struct({
  pattern: Schema.String,
  reason: Schema.optional(Schema.String),
  since: Schema.Finite,
});

export const RecentEditSchema = Schema.Struct({
  at: Schema.Finite,
  by: Schema.String,
  path: Schema.String,
});

export const PeerSchema = Schema.Struct({
  branch: Schema.optional(Schema.String),
  cwd: Schema.String,
  group: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  name: Schema.String,
  note: Schema.optional(Schema.String),
  pid: Schema.Int,
  recent: Schema.Array(RecentEditSchema).pipe(
    Schema.withDecodingDefault(Effect.succeed([]))
  ),
  reservations: Schema.Array(ReservationSchema),
  sessionId: Schema.String,
  status: Schema.Literals(["working", "idle"]),
  subagents: Schema.Finite.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  title: Schema.optional(Schema.String),
  updatedAt: Schema.Finite,
});

export type Peer = typeof PeerSchema.Type;

export type Reservation = typeof ReservationSchema.Type;

export type RecentEdit = typeof RecentEditSchema.Type;
