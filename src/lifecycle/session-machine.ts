import { createEffectLogic, setupEffect, taggedState, type TaggedState } from "@xstate/effect";
import { Effect, Schema } from "effect";
import { types, type SnapshotFrom } from "xstate";
import type { MeshIoError } from "../domain/errors.ts";
import { Feed } from "../services/feed.ts";
import { Presence } from "../services/presence.ts";
import { SessionState } from "../services/session-state.ts";

const Identity = Schema.Struct({ name: Schema.String, sessionId: Schema.String });

const PublishInput = Schema.Struct({
  status: Schema.Literals(["idle", "working"]),
  clearUnread: Schema.Boolean,
});

interface SessionContext {
  readonly name: string;
  readonly sessionId: string;
  readonly failure: MeshIoError | undefined;
}

const announce = createEffectLogic({
  schemas: { input: Identity },
  effect: ({ input }) =>
    Effect.gen(function* () {
      const state = yield* SessionState;
      const feed = yield* Feed;
      yield* state.publishStatus("idle", false);
      yield* feed.append({ type: "join", agent: input.name });
    }),
});

const publishStatus = createEffectLogic({
  schemas: { input: PublishInput },
  effect: ({ input }) =>
    SessionState.use((state) => state.publishStatus(input.status, input.clearUnread)),
});

const depart = createEffectLogic({
  schemas: { input: Identity },
  effect: ({ input }) =>
    Effect.gen(function* () {
      const feed = yield* Feed;
      const presence = yield* Presence;
      yield* feed.append({ type: "leave", agent: input.name });
      yield* presence.remove(input.sessionId);
    }).pipe(Effect.catch((error) => Effect.logWarning(`leave cleanup failed: ${error.message}`))),
});

export const sessionMachine = setupEffect({
  actors: { announce, publishStatus, depart },
  schemas: {
    context: types<SessionContext>(),
    input: Identity,
    events: {
      AGENT_START: Schema.Struct({}),
      AGENT_END: Schema.Struct({}),
      LEAVE: Schema.Struct({}),
    },
  },
}).createMachine({
  context: ({ input }) => ({ name: input.name, sessionId: input.sessionId, failure: undefined }),
  initial: "joining",
  states: {
    joining: {
      invoke: {
        src: "announce",
        input: ({ context }) => ({ name: context.name, sessionId: context.sessionId }),
        onDone: { target: "idle.synced" },
        onError: ({ event }) => ({ target: "idle.unsynced", context: { failure: event.error } }),
      },
      on: { LEAVE: { target: "departing" } },
    },
    idle: {
      initial: "synced",
      states: {
        publishing: {
          invoke: {
            src: "publishStatus",
            input: () => ({ status: "idle" as const, clearUnread: false }),
            onDone: { target: "synced", context: { failure: undefined } },
            onError: ({ event }) => ({ target: "unsynced", context: { failure: event.error } }),
          },
        },
        synced: {},
        unsynced: {},
      },
      on: {
        AGENT_START: { target: "working.publishing" },
        LEAVE: { target: "departing" },
      },
    },
    working: {
      initial: "publishing",
      states: {
        publishing: {
          invoke: {
            src: "publishStatus",
            input: () => ({ status: "working" as const, clearUnread: true }),
            onDone: { target: "synced", context: { failure: undefined } },
            onError: ({ event }) => ({ target: "unsynced", context: { failure: event.error } }),
          },
        },
        synced: {},
        unsynced: {},
      },
      on: {
        AGENT_END: { target: "idle.publishing" },
        LEAVE: { target: "departing" },
      },
    },
    departing: {
      invoke: {
        src: "depart",
        input: ({ context }) => ({ name: context.name, sessionId: context.sessionId }),
        onDone: { target: "left" },
      },
    },
    left: { type: "final" },
  },
});

export type SessionSnapshot = SnapshotFrom<typeof sessionMachine>;
export type SessionPhase = TaggedState<typeof sessionMachine>["_tag"];

export const phaseOf = (snapshot: SessionSnapshot): SessionPhase => taggedState(snapshot)._tag;

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
