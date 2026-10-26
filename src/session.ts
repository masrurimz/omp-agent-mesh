import { Clock, Effect, Option, Ref, Semaphore, Stream } from "effect";
import type { MeshIoError } from "./errors.ts";
import { MainRegistry } from "./main-registry.ts";
import { MeshStore } from "./mesh-store.ts";
import type { MeshMessage } from "./message.ts";
import { matchesReservation } from "./paths.ts";
import type { Peer, Reservation } from "./peer.ts";
import {
  broadcastTargets,
  type BroadcastScope,
  type ClaimConflict,
  effectiveGroup,
  findConflict,
  generateName,
  resolveTarget,
} from "./peers.ts";
import { makeThrottle } from "./throttle.ts";

const RECENT_LIMIT = 5;
const HEARTBEAT = "5 seconds";

export interface JoinInput {
  readonly sessionId: string;
  readonly cwd: string;
  readonly group: string;
  readonly branch: string | undefined;
  readonly model: string | undefined;
  readonly readTitle: Effect.Effect<string | undefined>;
  readonly onMessage: (message: MeshMessage) => Effect.Effect<void>;
}

export type SendOutcome =
  | {
      readonly kind: "sent";
      readonly target: Peer;
      readonly crossGroup: boolean;
      readonly waitedMs: number;
    }
  | { readonly kind: "ambiguous"; readonly names: ReadonlyArray<string> }
  | { readonly kind: "none" };

export interface BroadcastOutcome {
  readonly recipients: number;
  readonly waitedMs: number;
}

type Io<A> = Effect.Effect<A, MeshIoError>;

export interface MeshSession {
  readonly name: string;
  readonly sessionId: string;
  readonly group: string;
  readonly view: Effect.Effect<Peer>;
  readonly peers: Io<ReadonlyArray<Peer>>;
  readonly statusLine: Io<string>;
  readonly send: (to: string, body: string) => Io<SendOutcome>;
  readonly broadcast: (body: string, scope: BroadcastScope) => Io<BroadcastOutcome>;
  readonly claim: (paths: ReadonlyArray<string>, reason: string | undefined) => Io<void>;
  readonly release: (paths: ReadonlyArray<string> | undefined) => Io<number>;
  readonly note: (body: string | undefined) => Io<void>;
  readonly setWorking: (working: boolean) => Io<void>;
  readonly feed: (limit: number) => Io<ReadonlyArray<string>>;
  // Blocks edits on paths another live peer claimed. A subagent edit (`by` set) is
  // attributed to this session as `<name>/<by>` in the feed and in `recent`.
  readonly guardEdit: (path: string, by?: string) => Io<Option.Option<ClaimConflict>>;
  readonly subagentStarted: (key: string, label: string) => Io<void>;
  readonly subagentEnded: (key: string) => Io<void>;
}

interface State {
  readonly peer: Peer;
  readonly subs: ReadonlyMap<string, string>;
  readonly unread: number;
  readonly offset: number;
}

export const joinMesh = Effect.fn("joinMesh")(function* (input: JoinInput) {
  const store = yield* MeshStore;
  const registry = yield* MainRegistry;

  yield* store.ensureDirs;
  yield* store.reapDead;
  const taken = new Set((yield* store.livePeers(input.sessionId)).map((p) => p.name));
  const name = generateName(taken);
  const title = yield* input.readTitle;
  const joinedAt = yield* Clock.currentTimeMillis;

  const state = yield* Ref.make<State>({
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
    offset: yield* store.inboxSize(input.sessionId),
  });
  const writeLock = yield* Semaphore.make(1);
  const throttle = yield* makeThrottle(5, 20_000);

  yield* Effect.acquireRelease(
    Effect.gen(function* () {
      yield* store.writePresence((yield* Ref.get(state)).peer);
      yield* store.appendFeed({ type: "join", agent: name });
    }),
    () =>
      store.appendFeed({ type: "leave", agent: name }).pipe(
        Effect.andThen(store.removePresence(input.sessionId)),
        Effect.catch((error) => Effect.logWarning(`leave cleanup failed: ${error.message}`)),
      ),
  );

  const persist = (update: (current: State) => State): Io<State> =>
    writeLock.withPermits(1)(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const next = yield* Ref.updateAndGet(state, (current) => {
          const updated = update(current);
          return {
            ...updated,
            peer: { ...updated.peer, subagents: updated.subs.size, updatedAt: now },
          };
        });
        yield* store.writePresence(next.peer);
        return next;
      }),
    );

  const withPeer =
    (patch: Partial<Peer>) =>
    (current: State): State => ({
      ...current,
      peer: { ...current.peer, ...patch },
    });

  const drain = Effect.gen(function* () {
    const { offset } = yield* Ref.get(state);
    const inbox = yield* store.readInbox(input.sessionId, offset);
    yield* Ref.update(state, (current) => ({ ...current, offset: inbox.offset }));
    for (const message of inbox.messages) {
      if (message.from === name) continue;
      if (!message.broadcast) {
        yield* Ref.update(state, (current) => ({ ...current, unread: current.unread + 1 }));
      }
      yield* input.onMessage(message);
    }
  });

  const refreshTitle = Effect.gen(function* () {
    const latest = yield* input.readTitle;
    const current = (yield* Ref.get(state)).peer.title;
    yield* persist(withPeer(latest && latest !== current ? { title: latest } : {}));
  });

  const pulse = drain.pipe(
    Effect.andThen(refreshTitle),
    Effect.catch((error) => Effect.logWarning(`pulse failed: ${error.message}`)),
    Effect.catchDefect((defect) => Effect.logWarning(`pulse defect: ${String(defect)}`)),
  );

  yield* Stream.merge(
    store.inboxChanges.pipe(Stream.catch(() => Stream.empty)),
    Stream.tick(HEARTBEAT),
  ).pipe(
    Stream.runForEach(() => pulse),
    Effect.forkScoped,
  );

  const livePeers = store.livePeers(input.sessionId);

  const send = Effect.fn("MeshSession.send")(function* (to: string, body: string) {
    const resolution = resolveTarget(yield* livePeers, to);
    if (resolution.kind === "none") return { kind: "none" } as const;
    if (resolution.kind === "ambiguous")
      return { kind: "ambiguous", names: resolution.names } as const;
    const target = resolution.peer;
    const waitedMs = yield* throttle.acquire;
    const at = yield* Clock.currentTimeMillis;
    yield* store.appendInbox(target.sessionId, {
      from: name,
      to: target.name,
      body,
      broadcast: false,
      at,
    });
    yield* store.appendFeed({
      type: "message",
      agent: name,
      target: target.name,
      preview: body.slice(0, 200),
    });
    return {
      kind: "sent",
      target,
      crossGroup: effectiveGroup(target) !== input.group,
      waitedMs,
    } as const;
  });

  const broadcast = Effect.fn("MeshSession.broadcast")(function* (
    body: string,
    scope: BroadcastScope,
  ) {
    const waitedMs = yield* throttle.acquire;
    const targets = broadcastTargets(yield* livePeers, input.group, scope);
    const at = yield* Clock.currentTimeMillis;
    yield* Effect.forEach(
      targets,
      (target) =>
        store.appendInbox(target.sessionId, {
          from: name,
          to: target.name,
          body,
          broadcast: true,
          at,
        }),
      { discard: true },
    );
    yield* store.appendFeed({ type: "message", agent: name, preview: body.slice(0, 200) });
    return { recipients: targets.length, waitedMs } satisfies BroadcastOutcome;
  });

  const claim = Effect.fn("MeshSession.claim")(function* (
    paths: ReadonlyArray<string>,
    reason: string | undefined,
  ) {
    const since = yield* Clock.currentTimeMillis;
    const added: ReadonlyArray<Reservation> = paths.map((pattern) => ({ pattern, reason, since }));
    yield* persist((current) =>
      withPeer({
        reservations: [
          ...current.peer.reservations.filter((r) => !added.some((a) => a.pattern === r.pattern)),
          ...added,
        ],
      })(current),
    );
    yield* Effect.forEach(
      added,
      (a) => store.appendFeed({ type: "claim", agent: name, target: a.pattern, preview: reason }),
      { discard: true },
    );
  });

  const release = Effect.fn("MeshSession.release")(function* (
    paths: ReadonlyArray<string> | undefined,
  ) {
    const before = (yield* Ref.get(state)).peer.reservations;
    const kept = paths?.length ? before.filter((r) => !paths.includes(r.pattern)) : [];
    yield* persist(withPeer({ reservations: kept }));
    const released = before.length - kept.length;
    yield* store.appendFeed({ type: "release", agent: name, preview: `${released} released` });
    return released;
  });

  const guardEdit = Effect.fn("MeshSession.guardEdit")(function* (path: string, by?: string) {
    const agent = by ? `${name}/${by}` : name;
    const conflict = findConflict(yield* livePeers, input.sessionId, path, matchesReservation);
    if (conflict) {
      yield* store.appendFeed({
        type: "blocked",
        agent,
        target: path,
        preview: `reserved by ${conflict.peer.name}`,
      });
      return Option.some(conflict);
    }
    if (by) {
      const at = yield* Clock.currentTimeMillis;
      yield* persist((current) =>
        withPeer({
          recent: [
            { path, by, at },
            ...current.peer.recent.filter((r) => !(r.path === path && r.by === by)),
          ].slice(0, RECENT_LIMIT),
        })(current),
      );
      yield* store.appendFeed({ type: "edit", agent, target: path });
    }
    return Option.none<ClaimConflict>();
  });

  const subagentStarted = (key: string, label: string) =>
    Ref.get(state).pipe(
      Effect.flatMap((current) =>
        current.subs.get(key) === label
          ? Effect.void
          : persist((s) => ({ ...s, subs: new Map(s.subs).set(key, label) })).pipe(Effect.asVoid),
      ),
    );

  const subagentEnded = (key: string) =>
    Ref.get(state).pipe(
      Effect.flatMap((current) =>
        current.subs.has(key)
          ? persist((s) => {
              const subs = new Map(s.subs);
              subs.delete(key);
              return { ...s, subs };
            }).pipe(Effect.asVoid)
          : Effect.void,
      ),
    );

  const session: MeshSession = {
    name,
    sessionId: input.sessionId,
    group: input.group,
    view: Ref.get(state).pipe(Effect.map((s) => s.peer)),
    peers: livePeers,
    statusLine: Effect.gen(function* () {
      const peers = (yield* livePeers).length;
      const { unread } = yield* Ref.get(state);
      return `mesh: ${name} (${peers} peer${peers === 1 ? "" : "s"})${unread > 0 ? ` ●${unread}` : ""}`;
    }),
    send,
    broadcast,
    claim,
    release,
    note: (body) => persist(withPeer({ note: body })).pipe(Effect.asVoid),
    setWorking: (working) =>
      persist((current) => ({
        ...withPeer({ status: working ? "working" : "idle" })(current),
        unread: working ? 0 : current.unread,
      })).pipe(Effect.asVoid),
    feed: store.readFeed,
    guardEdit,
    subagentStarted,
    subagentEnded,
  };

  yield* registry.register(session);
  yield* Effect.addFinalizer(() => registry.unregister(input.sessionId));
  return session;
});
