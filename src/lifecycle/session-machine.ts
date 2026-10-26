import { createEffectLogic, setupEffect, taggedState } from "@xstate/effect";
import type { TaggedState } from "@xstate/effect";
import { Effect, Schema } from "effect";
import { types } from "xstate";
import type { SnapshotFrom } from "xstate";

import type { MeshIoError } from "../domain/mesh-io-error.ts";
import { Feed } from "../services/feed.ts";
import { Presence } from "../services/presence.ts";
import { SessionState } from "../services/session-state.ts";

const Identity = Schema.Struct({
  name: Schema.String,
  sessionId: Schema.String,
});

const PublishInput = Schema.Struct({
  clearUnread: Schema.Boolean,
  status: Schema.Literals(["idle", "working"]),
});

interface SessionContext {
  readonly name: string;
  readonly sessionId: string;
  readonly failure: MeshIoError | undefined;
}

const announce = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* effect() {
      const state = yield* SessionState;
      const feed = yield* Feed;
      yield* state.publishStatus("idle", false);
      yield* feed.append({ agent: input.name, type: "join" });
    }),
  schemas: { input: Identity },
});

const publishStatus = createEffectLogic({
  effect: ({ input }) =>
    SessionState.use((state) =>
      state.publishStatus(input.status, input.clearUnread)
    ),
  schemas: { input: PublishInput },
});

const depart = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* effect() {
      const feed = yield* Feed;
      const presence = yield* Presence;
      yield* feed.append({ agent: input.name, type: "leave" });
      yield* presence.remove(input.sessionId);
    }).pipe(
      Effect.catchTag("MeshIoError", (failure) =>
        Effect.logWarning(`leave cleanup failed: ${failure.message}`)
      )
    ),
  schemas: { input: Identity },
});

export const sessionMachine = setupEffect({
  actors: { announce, depart, publishStatus },
  schemas: {
    context: types<SessionContext>(),
    events: {
      AGENT_END: Schema.Struct({}),
      AGENT_START: Schema.Struct({}),
      LEAVE: Schema.Struct({}),
    },
    input: Identity,
  },
}).createMachine({
  context: ({ input }) => ({
    failure: undefined,
    name: input.name,
    sessionId: input.sessionId,
  }),
  initial: "joining",
  states: {
    departing: {
      invoke: {
        input: ({ context }) => ({
          name: context.name,
          sessionId: context.sessionId,
        }),
        onDone: { target: "left" },
        src: "depart",
      },
    },
    idle: {
      initial: "synced",
      on: {
        AGENT_START: { target: "working.publishing" },
        LEAVE: { target: "departing" },
      },
      states: {
        publishing: {
          invoke: {
            input: () => ({ clearUnread: false, status: "idle" as const }),
            onDone: { context: { failure: undefined }, target: "synced" },
            onError: ({ event }) => ({
              context: { failure: event.error },
              target: "unsynced",
            }),
            src: "publishStatus",
          },
        },
        synced: {},
        unsynced: {},
      },
    },
    joining: {
      invoke: {
        input: ({ context }) => ({
          name: context.name,
          sessionId: context.sessionId,
        }),
        onDone: { target: "idle.synced" },
        onError: ({ event }) => ({
          context: { failure: event.error },
          target: "idle.unsynced",
        }),
        src: "announce",
      },
      on: { LEAVE: { target: "departing" } },
    },
    left: { type: "final" },
    working: {
      initial: "publishing",
      on: {
        AGENT_END: { target: "idle.publishing" },
        LEAVE: { target: "departing" },
      },
      states: {
        publishing: {
          invoke: {
            input: () => ({ clearUnread: true, status: "working" as const }),
            onDone: { context: { failure: undefined }, target: "synced" },
            onError: ({ event }) => ({
              context: { failure: event.error },
              target: "unsynced",
            }),
            src: "publishStatus",
          },
        },
        synced: {},
        unsynced: {},
      },
    },
  },
});

export type SessionSnapshot = SnapshotFrom<typeof sessionMachine>;

export type SessionPhase = TaggedState<typeof sessionMachine>["_tag"];

export const phaseOf = (snapshot: SessionSnapshot): SessionPhase =>
  taggedState(snapshot)._tag;

export const JOINED_PHASES: ReadonlySet<SessionPhase> = new Set<SessionPhase>([
  "idle.synced",
  "idle.unsynced",
]);

export const STARTED_PHASES: ReadonlySet<SessionPhase> = new Set<SessionPhase>([
  "working.synced",
  "working.unsynced",
  "left",
]);

export const ENDED_PHASES: ReadonlySet<SessionPhase> = new Set<SessionPhase>([
  "idle.synced",
  "idle.unsynced",
  "left",
]);
