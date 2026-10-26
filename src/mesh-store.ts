import { join } from "node:path";
import { Context, DateTime, Effect, FileSystem, Layer, Option, Schema, Stream } from "effect";
import { MeshIoError } from "./errors.ts";
import { FeedEvent, MeshMessage, type NewFeedEvent } from "./message.ts";
import { Peer } from "./peer.ts";
import { isAlive } from "./peers.ts";

export const meshDir = (): string =>
  process.env.OMP_AGENT_MESH_DIR ?? join(process.env.HOME ?? "", ".omp/agent/mesh");

export interface InboxRead {
  readonly messages: ReadonlyArray<MeshMessage>;
  readonly offset: number;
}

const decodePeer = Schema.decodeUnknownEffect(Schema.fromJsonString(Peer));
const encodePeer = Schema.encodeEffect(Schema.fromJsonString(Peer));
const decodeMessage = Schema.decodeUnknownEffect(Schema.fromJsonString(MeshMessage));
const encodeMessage = Schema.encodeEffect(Schema.fromJsonString(MeshMessage));
const encodeFeedEvent = Schema.encodeEffect(Schema.fromJsonString(FeedEvent));

const NEWLINE = 10;

export class MeshStore extends Context.Service<
  MeshStore,
  {
    readonly base: string;
    readonly ensureDirs: Effect.Effect<void, MeshIoError>;
    readonly writePresence: (peer: Peer) => Effect.Effect<void, MeshIoError>;
    readonly removePresence: (sessionId: string) => Effect.Effect<void, MeshIoError>;
    readonly listPresence: Effect.Effect<ReadonlyArray<Peer>, MeshIoError>;
    readonly livePeers: (selfSessionId: string) => Effect.Effect<ReadonlyArray<Peer>, MeshIoError>;
    readonly reapDead: Effect.Effect<void, MeshIoError>;
    readonly appendInbox: (
      toSessionId: string,
      message: MeshMessage,
    ) => Effect.Effect<void, MeshIoError>;
    readonly inboxSize: (sessionId: string) => Effect.Effect<number, MeshIoError>;
    readonly readInbox: (
      sessionId: string,
      offset: number,
    ) => Effect.Effect<InboxRead, MeshIoError>;
    readonly inboxChanges: Stream.Stream<void, MeshIoError>;
    readonly appendFeed: (event: NewFeedEvent) => Effect.Effect<void, MeshIoError>;
    readonly readFeed: (limit: number) => Effect.Effect<ReadonlyArray<string>, MeshIoError>;
  }
>()("omp-agent-mesh/MeshStore") {
  static readonly layer = (base: string) => Layer.effect(MeshStore, makeStore(base));
}

const makeStore = (base: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const agentsDir = join(base, "agents");
    const inboxDir = join(base, "inbox");
    const feedPath = join(base, "feed.jsonl");
    const presencePath = (sessionId: string) => join(agentsDir, `${sessionId}.json`);
    const inboxPath = (sessionId: string) => join(inboxDir, `${sessionId}.jsonl`);

    const io =
      (op: string, path: string) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, MeshIoError, R> =>
        Effect.mapError(effect, (cause) => new MeshIoError({ op, path, cause }));

    const ensureDirs = Effect.all([
      fs.makeDirectory(agentsDir, { recursive: true }),
      fs.makeDirectory(inboxDir, { recursive: true }),
    ]).pipe(Effect.asVoid, io("ensureDirs", base));

    const writePresence = Effect.fnUntraced(
      function* (peer: Peer) {
        const path = presencePath(peer.sessionId);
        const tmp = `${path}.tmp-${process.pid}`;
        const text = yield* encodePeer(peer);
        yield* fs.writeFileString(tmp, text);
        yield* fs.rename(tmp, path);
      },
      (effect, peer) => io("writePresence", presencePath(peer.sessionId))(effect),
    );

    const removePresence = (sessionId: string) =>
      fs
        .remove(presencePath(sessionId), { force: true })
        .pipe(io("removePresence", presencePath(sessionId)));

    const readPeer = Effect.fnUntraced(function* (name: string) {
      const text = yield* fs.readFileString(join(agentsDir, name)).pipe(Effect.option);
      if (Option.isNone(text)) return Option.none<Peer>();
      return yield* decodePeer(text.value).pipe(
        Effect.tapError(() => Effect.logWarning(`skipping unreadable presence file ${name}`)),
        Effect.option,
      );
    });

    const listPresence = Effect.gen(function* () {
      if (!(yield* fs.exists(agentsDir))) return [];
      const names = yield* fs.readDirectory(agentsDir);
      const found = yield* Effect.forEach(
        names.filter((name) => name.endsWith(".json")),
        readPeer,
        { concurrency: 8 },
      );
      return found.flatMap((peer) => (Option.isSome(peer) ? [peer.value] : []));
    }).pipe(io("listPresence", agentsDir));

    const livePeers = (selfSessionId: string) =>
      listPresence.pipe(
        Effect.map((peers) => peers.filter((p) => p.sessionId !== selfSessionId && isAlive(p.pid))),
      );

    const reapDead = Effect.gen(function* () {
      const peers = yield* listPresence;
      yield* Effect.forEach(
        peers.filter((p) => !isAlive(p.pid)),
        (p) => removePresence(p.sessionId),
        { discard: true },
      );
    });

    const appendInbox = Effect.fnUntraced(
      function* (toSessionId: string, message: MeshMessage) {
        const text = yield* encodeMessage(message);
        yield* fs.writeFileString(inboxPath(toSessionId), `${text}\n`, { flag: "a" });
      },
      (effect, toSessionId) => io("appendInbox", inboxPath(toSessionId))(effect),
    );

    const inboxSize = (sessionId: string) =>
      Effect.gen(function* () {
        if (!(yield* fs.exists(inboxPath(sessionId)))) return 0;
        return Number((yield* fs.stat(inboxPath(sessionId))).size);
      }).pipe(io("inboxSize", inboxPath(sessionId)));

    const readInbox = (sessionId: string, offset: number) =>
      Effect.gen(function* () {
        const path = inboxPath(sessionId);
        if (!(yield* fs.exists(path))) return { messages: [], offset: 0 } satisfies InboxRead;
        const bytes = yield* fs.readFile(path);
        const from = bytes.length < offset ? 0 : offset;
        const chunk = bytes.subarray(from);
        const complete = chunk.lastIndexOf(NEWLINE) + 1;
        if (complete === 0) return { messages: [], offset: from } satisfies InboxRead;
        const lines = new TextDecoder().decode(chunk.subarray(0, complete)).split("\n");
        const decoded = yield* Effect.forEach(
          lines.filter((line) => line.trim() !== ""),
          (line) =>
            decodeMessage(line).pipe(
              Effect.tapError(() => Effect.logWarning(`skipping unreadable inbox line in ${path}`)),
              Effect.option,
            ),
        );
        return {
          messages: decoded.flatMap((m) => (Option.isSome(m) ? [m.value] : [])),
          offset: from + complete,
        } satisfies InboxRead;
      }).pipe(io("readInbox", inboxPath(sessionId)));

    const inboxChanges = fs.watch(inboxDir).pipe(
      Stream.map(() => undefined),
      Stream.mapError((cause) => new MeshIoError({ op: "watch", path: inboxDir, cause })),
    );

    const appendFeed = (event: NewFeedEvent) =>
      Effect.gen(function* () {
        const ts = DateTime.formatIso(yield* DateTime.now);
        const text = yield* encodeFeedEvent({ ts, ...event });
        yield* fs.writeFileString(feedPath, `${text}\n`, { flag: "a" });
      }).pipe(io("appendFeed", feedPath));

    const readFeed = (limit: number) =>
      Effect.gen(function* () {
        if (!(yield* fs.exists(feedPath))) return [];
        const text = yield* fs.readFileString(feedPath);
        return text.trim().split("\n").filter(Boolean).slice(-limit);
      }).pipe(io("readFeed", feedPath));

    return MeshStore.of({
      base,
      ensureDirs,
      writePresence,
      removePresence,
      listPresence,
      livePeers,
      reapDead,
      appendInbox,
      inboxSize,
      readInbox,
      inboxChanges,
      appendFeed,
      readFeed,
    });
  });
