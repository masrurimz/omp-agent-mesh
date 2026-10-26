import { createEffectActor, join, send as sendEvent, waitFor } from "@xstate/effect";
import { Clock, Context, Effect, Layer, PubSub, Stream, SubscriptionRef } from "effect";
import { formatStatus } from "../domain/brief.ts";
import { EmptyBody, InvalidInput } from "../domain/errors.ts";
import type { MeshMessage } from "../domain/message.ts";
import type { Peer, Reservation } from "../domain/peer.ts";
import {
  broadcastTargets,
  type BroadcastScope,
  effectiveGroup,
  generateName,
  resolveTarget,
} from "../domain/peers.ts";
import { claimPaths, releasePaths } from "../domain/reservations.ts";
import {
  ENDED_PHASES,
  JOINED_PHASES,
  phaseOf,
  type SessionPhase,
  sessionMachine,
  STARTED_PHASES,
} from "../lifecycle/session-machine.ts";
import { Claims } from "./claims.ts";
import { Feed } from "./feed.ts";
import { Inbox } from "./inbox.ts";
import { MainRegistry } from "./main-registry.ts";
import { Presence } from "./presence.ts";
import { SessionState, type State } from "./session-state.ts";
import { Throttle } from "./throttle.ts";

const RECENT_LIMIT = 5;
const HEARTBEAT = "5 seconds";
const DELIVERY_REPLAY = 64;

export interface JoinInput {
  readonly sessionId: string;
  readonly cwd: string;
  readonly group: string;
  readonly branch: string | undefined;
  readonly model: string | undefined;
  readonly readTitle: Effect.Effect<string | undefined>;
}

const withPeer = (state: State, patch: Partial<Peer>): State => ({
  ...state,
  peer: { ...state.peer, ...patch },
});

const requireBody = (action: "send" | "broadcast", body: string) =>
  body.trim() === "" ? Effect.fail(new EmptyBody({ action })) : Effect.void;

export class MeshSession extends Context.Service<MeshSession>()(
  "omp-agent-mesh/services/MeshSession",
  {
    make: Effect.fn("MeshSession.make")(function* (input: JoinInput) {
      const presence = yield* Presence;
      const inbox = yield* Inbox;
      const feedLog = yield* Feed;
      const claims = yield* Claims;
      const throttle = yield* Throttle;
      const registry = yield* MainRegistry;

      yield* presence.ensureDir;
      yield* inbox.ensureDir;
      yield* presence.reapDead;
      const others = yield* presence.livePeers(input.sessionId);
      const name = generateName(new Set(others.map((p) => p.name)));
      const title = yield* input.readTitle;
      const joinedAt = yield* Clock.currentTimeMillis;
      const startOffset = yield* inbox.size(input.sessionId);

      const store = yield* SessionState.make({
        peer: {
          name,
          pid: process.pid,
          sessionId: input.sessionId,
          cwd: input.cwd,
          group: input.group,
          title,
          branch: input.branch,
          model: input.model,
          status: "idle",
          reservations: [],
          subagents: 0,
          recent: [],
          updatedAt: joinedAt,
        },
        subs: new Map(),
        unread: 0,
        peerCount: others.length,
      });
      const state = store.ref;
      const { persist } = store;
      const deliveries = yield* Effect.acquireRelease(
        PubSub.unbounded<MeshMessage>({ replay: DELIVERY_REPLAY }),
        PubSub.shutdown,
      );

      const actor = yield* createEffectActor(sessionMachine, {
        input: { name, sessionId: input.sessionId },
      }).pipe(Effect.provideService(SessionState, store));
      yield* Effect.addFinalizer(() =>
        sendEvent(actor, { type: "LEAVE" }).pipe(Effect.andThen(join(actor)), Effect.orDie),
      );

      const awaitPhase = (accepted: ReadonlySet<SessionPhase>) =>
        waitFor(actor, (snapshot) => accepted.has(phaseOf(snapshot))).pipe(
          Effect.orDie,
          Effect.flatMap((snapshot) =>
            phaseOf(snapshot).endsWith(".unsynced") && snapshot.context.failure
              ? Effect.fail(snapshot.context.failure)
              : Effect.void,
          ),
        );

      yield* awaitPhase(JOINED_PHASES);

      yield* inbox.messages(input.sessionId, startOffset).pipe(
        Stream.filter((message) => message.from !== name),
        Stream.runForEach((message) =>
          (message.broadcast
            ? Effect.void
            : SubscriptionRef.update(state, (s) => ({ ...s, unread: s.unread + 1 }))
          ).pipe(Effect.andThen(PubSub.publish(deliveries, message))),
        ),
        Effect.catchDefect((defect) =>
          Effect.logWarning(`inbox watcher defect: ${String(defect)}`),
        ),
        Effect.forkScoped,
      );

      const heartbeat = Effect.gen(function* () {
        const latest = yield* input.readTitle;
        const peers = yield* presence.livePeers(input.sessionId);
        yield* SubscriptionRef.update(state, (s) => ({ ...s, peerCount: peers.length }));
        yield* persist((s) =>
          withPeer(s, latest && latest !== s.peer.title ? { title: latest } : {}),
        );
      }).pipe(
        Effect.catch((error) => Effect.logWarning(`heartbeat failed: ${error.message}`)),
        Effect.catchDefect((defect) => Effect.logWarning(`heartbeat defect: ${String(defect)}`)),
      );

      yield* Stream.tick(HEARTBEAT).pipe(
        Stream.runForEach(() => heartbeat),
        Effect.forkScoped,
      );

      const livePeers = presence.livePeers(input.sessionId);

      const send = Effect.fn("MeshSession.send")(function* (to: string, body: string) {
        yield* requireBody("send", body);
        const target = yield* Effect.fromResult(resolveTarget(yield* livePeers, to));
        const waitedMs = yield* throttle.acquire;
        const at = yield* Clock.currentTimeMillis;
        yield* inbox.append(target.sessionId, {
          from: name,
          to: target.name,
          body,
          broadcast: false,
          at,
        });
        yield* feedLog.append({
          type: "message",
          agent: name,
          target: target.name,
          preview: body.slice(0, 200),
        });
        return { target, crossGroup: effectiveGroup(target) !== input.group, waitedMs };
      });

      const broadcast = Effect.fn("MeshSession.broadcast")(function* (
        body: string,
        scope: BroadcastScope,
      ) {
        yield* requireBody("broadcast", body);
        const waitedMs = yield* throttle.acquire;
        const targets = broadcastTargets(yield* livePeers, input.group, scope);
        const at = yield* Clock.currentTimeMillis;
        yield* Effect.forEach(
          targets,
          (target) =>
            inbox.append(target.sessionId, {
              from: name,
              to: target.name,
              body,
              broadcast: true,
              at,
            }),
          { discard: true },
        );
        yield* feedLog.append({ type: "message", agent: name, preview: body.slice(0, 200) });
        return { recipients: targets.length, waitedMs };
      });

      const claim = Effect.fn("MeshSession.claim")(function* (
        paths: ReadonlyArray<string>,
        reason: string | undefined,
      ) {
        if (paths.length === 0) {
          return yield* new InvalidInput({ detail: "mesh claim needs at least one path" });
        }
        const since = yield* Clock.currentTimeMillis;
        const added: ReadonlyArray<Reservation> = paths.map((pattern) => ({
          pattern,
          reason,
          since,
        }));
        yield* persist((s) =>
          withPeer(s, { reservations: claimPaths(s.peer.reservations, added) }),
        );
        yield* Effect.forEach(
          added,
          (a) => feedLog.append({ type: "claim", agent: name, target: a.pattern, preview: reason }),
          { discard: true },
        );
      });

      const release = Effect.fn("MeshSession.release")(function* (
        paths: ReadonlyArray<string> | undefined,
      ) {
        const before = (yield* SubscriptionRef.get(state)).peer.reservations;
        const kept = releasePaths(before, paths);
        yield* persist((s) => withPeer(s, { reservations: kept }));
        const released = before.length - kept.length;
        yield* feedLog.append({ type: "release", agent: name, preview: `${released} released` });
        return released;
      });

      const guardEdit = Effect.fn("MeshSession.guardEdit")(function* (path: string, by?: string) {
        const agent = by ? `${name}/${by}` : name;
        yield* claims.guard(input.sessionId, path).pipe(
          Effect.tapErrorTag("ClaimConflict", (conflict) =>
            feedLog.append({
              type: "blocked",
              agent,
              target: path,
              preview: `reserved by ${conflict.holder}`,
            }),
          ),
        );
        if (by) {
          const at = yield* Clock.currentTimeMillis;
          yield* persist((s) =>
            withPeer(s, {
              recent: [
                { path, by, at },
                ...s.peer.recent.filter((r) => !(r.path === path && r.by === by)),
              ].slice(0, RECENT_LIMIT),
            }),
          );
          yield* feedLog.append({ type: "edit", agent, target: path });
        }
      });

      const subagentStarted = (key: string, label: string) =>
        SubscriptionRef.get(state).pipe(
          Effect.flatMap((current) =>
            current.subs.get(key) === label
              ? Effect.void
              : persist((s) => ({ ...s, subs: new Map(s.subs).set(key, label) })),
          ),
          Effect.asVoid,
        );

      const subagentEnded = (key: string) =>
        SubscriptionRef.get(state).pipe(
          Effect.flatMap((current) =>
            current.subs.has(key)
              ? persist((s) => {
                  const subs = new Map(s.subs);
                  subs.delete(key);
                  return { ...s, subs };
                })
              : Effect.void,
          ),
          Effect.asVoid,
        );

      yield* registry.register({
        sessionId: input.sessionId,
        guardEdit,
        subagentStarted,
        subagentEnded,
      });
      yield* Effect.addFinalizer(() => registry.unregister(input.sessionId));

      return {
        name,
        sessionId: input.sessionId,
        group: input.group,
        view: SubscriptionRef.get(state).pipe(Effect.map((s) => s.peer)),
        phase: Effect.sync(() => phaseOf(actor.getSnapshot())),
        peers: livePeers,
        status: SubscriptionRef.changes(state).pipe(
          Stream.map((s) => formatStatus(name, s.peerCount, s.unread)),
          Stream.changes,
        ),
        deliveries: Stream.fromPubSub(deliveries),
        send,
        broadcast,
        claim,
        release,
        note: (body: string | undefined) =>
          persist((s) => withPeer(s, { note: body })).pipe(Effect.asVoid),
        feed: feedLog.read,
        guardEdit,
        subagentStarted,
        subagentEnded,
        agentStarted: sendEvent(actor, { type: "AGENT_START" }).pipe(
          Effect.andThen(awaitPhase(STARTED_PHASES)),
        ),
        agentEnded: sendEvent(actor, { type: "AGENT_END" }).pipe(
          Effect.andThen(awaitPhase(ENDED_PHASES)),
        ),
      };
    }),
  },
) {
  static readonly layer = (input: JoinInput) => Layer.effect(this, this.make(input));
}
